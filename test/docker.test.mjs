import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { sh, assertName, streamCommand, composeBase } = require(`${process.env.INFRA_OUT}/commands.js`)
const { parseContainers, parseStats } = require(`${process.env.INFRA_OUT}/docker.js`)
const { Connections } = require(`${process.env.INFRA_OUT}/ssh.js`)
const { Docker } = require(`${process.env.INFRA_OUT}/docker.js`)
const { Streams } = require(`${process.env.INFRA_OUT}/streams.js`)

test('quotes shell values', () => {
  assert.equal(sh('a b'), `'a b'`)
  assert.equal(sh(`it's`), `'it'\\''s'`)
  assert.equal(sh('$(rm -rf /)'), `'$(rm -rf /)'`)
})

test('rejects names that could be read as code', () => {
  for (const bad of ['', 'a;b', 'a b', '$(x)', '`x`', '-rf', 'a\nb', 'a&&b', "a'b"]) assert.throws(() => assertName(bad), /Unexpected/, bad)
  for (const good of ['web-1', 'nginx:1.25', 'ghcr.io/org/app:latest', 'a_b.c', 'abc123def456']) assert.equal(assertName(good), good)
})

test('builds the stream commands', () => {
  assert.equal(streamCommand({ kind: 'docker-logs', container: 'web', tail: 100 }, false), "docker logs -f --timestamps --tail 100 'web' 2>&1")
  assert.match(streamCommand({ kind: 'docker-logs', container: 'web', tail: 100 }, true), /^sudo -n docker logs/)
  assert.equal(streamCommand({ kind: 'file', path: '/var/log/a b.log', lines: 50 }, false), "tail -n 50 -F '/var/log/a b.log' 2>&1")
  assert.match(streamCommand({ kind: 'journal', unit: 'nginx', priority: 'err', lines: 200 }, false), /-u 'nginx' -p 'err' -n 200 -f/)
  assert.match(streamCommand({ kind: 'journal', unit: '', priority: 'bogus', lines: 9999999 }, false), /-p 'info' -n 5000/)
  assert.equal(composeBase({ project: 'shop', workdir: '/srv/shop', configFiles: '/srv/shop/a.yml,/srv/shop/b.yml' }, false), "docker compose -p 'shop' -f '/srv/shop/a.yml' -f '/srv/shop/b.yml' --project-directory '/srv/shop'")
  assert.match(streamCommand({ kind: 'compose', action: 'up', project: 'shop', workdir: '/srv/shop', configFiles: '' }, false), /up -d --remove-orphans 2>&1$/)
  assert.match(streamCommand({ kind: 'script', command: "echo 'hi'", cwd: '/srv/app' }, false), /^cd '\/srv\/app' && sh -c 'echo '\\''hi'\\''' 2>&1$/)
  assert.throws(() => streamCommand({ kind: 'docker-logs', container: 'x; reboot', tail: 1 }, false), /Unexpected/)
  assert.throws(() => streamCommand({ kind: 'compose', action: 'burn', project: 'a', workdir: '', configFiles: '' }, false), /Unknown/)
})

test('parses docker output', () => {
  const c = parseContainers(`{"ID":"abc","Names":"web","Image":"nginx","State":"running","Status":"Up 2 hours","Ports":"0.0.0.0:80->80/tcp","CreatedAt":"2026-01-01","Labels":"com.docker.compose.project=shop,com.docker.compose.project.working_dir=/srv/shop,com.docker.compose.project.config_files=/srv/shop/c.yml,other=1"}
not json`)
  assert.equal(c.length, 1)
  assert.deepEqual([c[0].project, c[0].workdir, c[0].configFiles], ['shop', '/srv/shop', '/srv/shop/c.yml'])
  const s = parseStats(`{"ID":"abc","CPUPerc":"12.50%","MemPerc":"3.1%","MemUsage":"10MiB / 1GiB","NetIO":"1kB / 2kB","BlockIO":"0B / 0B"}`)
  assert.deepEqual([s[0].cpu, s[0].memPct], [12.5, 3.1])
})

const cfg = process.env.INFRA_TEST_SSH
const maybe = cfg ? test : test.skip
const [port, dir] = (cfg ?? ':').split(':')
const conns = () => new Connections({
  getServer: id => ({ id, host: '127.0.0.1', port: Number(port), user: 'root', auth: 'key', password: '', keyPath: `${dir}/clientkey`, passphrase: '', privateKey: '' }),
  checkHostKey: () => 'new', onState: () => {},
})

maybe('manages a real container and streams its logs', async () => {
  const c = conns()
  const d = new Docker(c)
  const name = `infra-test-${process.pid}`
  await c.exec('a', `docker rm -f ${name} >/dev/null 2>&1; docker run -d --name ${name} alpine sh -c 'while true; do echo tick-$$; sleep 1; done'`, 120_000)
  try {
    const snap = await d.snapshot('a')
    assert.ok(snap.version)
    const mine = snap.containers.find(x => x.name === name)
    assert.ok(mine && mine.state === 'running')
    assert.ok(snap.images.some(i => i.repo === 'alpine' && i.inUse))
    assert.ok(snap.networks.some(n => n.name === 'bridge'))

    const stats = await d.stats('a')
    assert.ok(stats.some(s => mine.id.startsWith(s.id) || s.id.startsWith(mine.id.slice(0, 12))))

    // logs stream
    let out = ''
    const streams = new Streams(c, (id, data) => { out += data }, () => {})
    await streams.start('l1', 'a', streamCommand({ kind: 'docker-logs', container: name, tail: 5 }, false))
    const t0 = Date.now()
    while (!/tick-/.test(out) && Date.now() - t0 < 8000) await new Promise(r => setTimeout(r, 100))
    streams.stop('l1')
    assert.match(out, /tick-/)

    assert.match(await d.inspect('a', name), /"Name": "\/infra-test/)
    await d.container('a', name, 'pause')
    assert.equal((await d.snapshot('a')).containers.find(x => x.name === name).state, 'paused')
    await d.container('a', name, 'unpause')
    await d.container('a', name, 'stop')
    assert.equal((await d.snapshot('a')).containers.find(x => x.name === name).state, 'exited')
    await d.container('a', name, 'remove')
    assert.ok(!(await d.snapshot('a')).containers.some(x => x.name === name))
    await assert.rejects(d.container('a', 'no-such-container-xyz', 'stop'), /No such container/i)
    await assert.rejects(d.container('a', 'x;y', 'stop'), /Unexpected/)
  } finally {
    await c.exec('a', `docker rm -f ${name} >/dev/null 2>&1; true`)
    c.disconnectAll()
  }
})

maybe('a script stream reports its exit code', async () => {
  const c = conns()
  let out = '', end = null
  const streams = new Streams(c, (id, d) => { out += d }, (id, code) => { end = code })
  await streams.start('s', 'a', streamCommand({ kind: 'script', command: 'echo one; echo two >&2; exit 3', cwd: '/tmp' }, false))
  const t0 = Date.now()
  while (end === null && Date.now() - t0 < 8000) await new Promise(r => setTimeout(r, 50))
  assert.equal(end, 3)
  assert.match(out, /one/)
  assert.match(out, /two/)
  c.disconnectAll()
})
