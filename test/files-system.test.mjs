import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
const require = createRequire(import.meta.url)
const { Connections } = require(`${process.env.INFRA_OUT}/ssh.js`)
const { Sftp } = require(`${process.env.INFRA_OUT}/sftp.js`)
const { System, parseProcesses, parseServices } = require(`${process.env.INFRA_OUT}/system.js`)

test('parses ps output', () => {
  const rows = parseProcesses(`    1     0 root                  0.0  0.1  12345 10-02:03:04 Ss   /sbin/init splash
 2345  1 www-data              12.5  3.2 204800       05:10 Sl   nginx: worker process
garbage line`)
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[1], { pid: 2345, ppid: 1, user: 'www-data', cpu: 12.5, mem: 3.2, rss: 204800 * 1024, time: '05:10', state: 'Sl', command: 'nginx: worker process' })
})

test('parses systemctl output', () => {
  const rows = parseServices(`  ssh.service                loaded active   running OpenBSD Secure Shell server
● foo.service                loaded failed   failed  Foo daemon
  cron.service               loaded active   running Regular background program processing daemon
  user@0.service             loaded active   running User Manager for UID 0`)
  assert.deepEqual(rows.map(r => r.name), ['cron', 'foo', 'ssh', 'user@0'])
  assert.equal(rows[1].active, 'failed')
  assert.equal(rows[2].description, 'OpenBSD Secure Shell server')
})

const cfg = process.env.INFRA_TEST_SSH
const maybe = cfg ? test : test.skip
const [port, dir] = (cfg ?? ':').split(':')

const conns = () => new Connections({
  getServer: id => ({ id, host: '127.0.0.1', port: Number(port), user: 'root', auth: 'key', password: '', keyPath: `${dir}/clientkey`, passphrase: '', privateKey: '' }),
  checkHostKey: () => 'new',
  onState: () => {},
})

maybe('browses, edits, renames, uploads, downloads and deletes over SFTP', async () => {
  const c = conns()
  const sftp = new Sftp(c)
  const base = `/tmp/infra-sftp-${process.pid}`
  const local = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-local-'))
  try {
    await c.exec('a', `rm -rf ${base}; mkdir -p ${base}/sub && echo hello > ${base}/a.txt && ln -s ${base}/sub ${base}/link && printf '\\0\\1' > ${base}/bin.dat`)
    const l = await sftp.list('a', base)
    assert.equal(l.path, base)
    assert.deepEqual(l.entries.map(e => [e.name, e.dir, e.link]), [['link', true, true], ['sub', true, false], ['a.txt', false, false], ['bin.dat', false, false]])
    assert.equal((await sftp.home('a')).startsWith('/'), true)

    assert.equal((await sftp.read('a', `${base}/a.txt`)).content, 'hello\n')
    await assert.rejects(sftp.read('a', `${base}/bin.dat`), /binary/)
    await sftp.write('a', `${base}/a.txt`, 'changed ✓\n')
    assert.equal((await c.exec('a', `cat ${base}/a.txt`)).stdout, 'changed ✓\n')

    await sftp.mkdir('a', `${base}/new dir`)
    await sftp.rename('a', `${base}/a.txt`, `${base}/new dir/b.txt`)
    assert.equal((await c.exec('a', `cat "${base}/new dir/b.txt"`)).stdout, 'changed ✓\n')

    // upload a folder with a file in it, then download it back
    fs.mkdirSync(path.join(local, 'up/inner'), { recursive: true })
    fs.writeFileSync(path.join(local, 'up/inner/f.txt'), 'x'.repeat(100000))
    const seen = []
    await sftp.upload('a', path.join(local, 'up'), base, (n, d, t) => seen.push([n, d, t]))
    assert.equal((await c.exec('a', `wc -c < ${base}/up/inner/f.txt`)).stdout.trim(), '100000')
    assert.ok(seen.some(s => s[0] === 'f.txt' && s[1] === 100000))
    const out = path.join(local, 'down'); fs.mkdirSync(out)
    await sftp.download('a', `${base}/up`, true, out, () => {})
    assert.equal(fs.readFileSync(path.join(out, 'up/inner/f.txt'), 'utf8').length, 100000)

    // removing a folder removes what is inside it and does not follow the link
    await sftp.remove('a', `${base}/up`, true)
    await sftp.remove('a', `${base}/link`, false)
    assert.equal((await c.exec('a', `test -e ${base}/up; echo $?; test -d ${base}/sub; echo $?`)).stdout.trim().split('\n').join(','), '1,0')
    await assert.rejects(sftp.list('a', `${base}/nope`), /No such file/)
  } finally {
    await c.exec('a', `rm -rf ${base}`)
    fs.rmSync(local, { recursive: true, force: true })
    c.disconnectAll()
  }
})

maybe('lists and stops processes, lists services', async () => {
  const c = conns()
  const sys = new System(c)
  const sleeper = await c.exec('a', 'nohup sleep 300 >/dev/null 2>&1 & echo $!')
  const pid = Number(sleeper.stdout.trim())
  try {
    const procs = await sys.processes('a')
    assert.ok(procs.length > 5)
    assert.ok(procs.some(p => p.pid === pid && p.command.startsWith('sleep 300')))
    await sys.kill('a', pid, false)
    await new Promise(r => setTimeout(r, 300))
    assert.ok(!(await sys.processes('a')).some(p => p.pid === pid))
    await assert.rejects(sys.kill('a', 99999999, false), /./)
    await assert.rejects(sys.kill('a', 1.5, false), /can’t be stopped/)

    const svcs = await sys.services('a')
    assert.ok(svcs.some(s => s.name === 'ssh' || s.name === 'sshd'))
    await assert.rejects(sys.serviceAction('a', 'x; rm -rf /', 'restart'), /Unexpected service name/)
    await assert.rejects(sys.serviceAction('a', 'ssh', 'explode'), /Unknown action/)
  } finally {
    await c.exec('a', `kill ${pid} 2>/dev/null; true`)
    c.disconnectAll()
  }
})
