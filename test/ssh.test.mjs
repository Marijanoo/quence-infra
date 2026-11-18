import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
const require = createRequire(import.meta.url)
const { Connections } = require(`${process.env.INFRA_OUT}/ssh.js`)
const { Monitors } = require(`${process.env.INFRA_OUT}/monitor.js`)
const { Shells } = require(`${process.env.INFRA_OUT}/shells.js`)

// These need a real SSH server: set INFRA_TEST_SSH to "port:dir" where dir holds clientkey and
// clientkey_pw (passphrase secret12), both authorised for root on 127.0.0.1.
const cfg = process.env.INFRA_TEST_SSH
const maybe = cfg ? test : test.skip
const [port, dir] = (cfg ?? ':').split(':')

function setup(overrides = {}) {
  const known = new Map()
  const states = []
  const servers = {
    key: { id: 'key', host: '127.0.0.1', port: Number(port), user: 'root', auth: 'key', password: '', keyPath: `${dir}/clientkey`, passphrase: '', privateKey: '' },
    pasted: { id: 'pasted', host: '127.0.0.1', port: Number(port), user: 'root', auth: 'key', password: '', keyPath: '', passphrase: '', privateKey: cfg ? fs.readFileSync(`${dir}/clientkey`, 'utf8') : '' },
    pass: { id: 'pass', host: '127.0.0.1', port: Number(port), user: 'root', auth: 'key', password: '', keyPath: `${dir}/clientkey_pw`, passphrase: 'secret12', privateKey: '' },
    nopass: { id: 'nopass', host: '127.0.0.1', port: Number(port), user: 'root', auth: 'key', password: '', keyPath: `${dir}/clientkey_pw`, passphrase: '', privateKey: '' },
    badkey: { id: 'badkey', host: '127.0.0.1', port: Number(port), user: 'nobody-here', auth: 'key', password: '', keyPath: `${dir}/clientkey`, passphrase: '', privateKey: '' },
    refused: { id: 'refused', host: '127.0.0.1', port: 1, user: 'root', auth: 'key', password: '', keyPath: `${dir}/clientkey`, passphrase: '', privateKey: '' },
    ...overrides,
  }
  const conns = new Connections({
    getServer: id => servers[id] ?? null,
    checkHostKey: (hostId, fp) => { if (!known.has(hostId)) { known.set(hostId, fp); return 'new' } return known.get(hostId) === fp ? 'known' : 'changed' },
    onState: (id, s) => states.push([id, s.status]),
  })
  return { conns, known, states, servers }
}

maybe('connects with a key file, runs a command, shares one connection', async () => {
  const { conns, states } = setup()
  const [a, b] = await Promise.all([conns.connect('key'), conns.connect('key')])
  assert.equal(a, b)
  const r = await conns.exec('key', 'echo hi; exit 3')
  assert.equal(r.stdout.trim(), 'hi')
  assert.equal(r.code, 3)
  assert.deepEqual(states.map(s => s[1]), ['connecting', 'online'])
  conns.disconnect('key')
  assert.equal(conns.state('key').status, 'offline')
  conns.disconnectAll()
})

maybe('connects with a pasted private key and with a passphrase-protected key', async () => {
  const { conns } = setup()
  await conns.connect('pasted')
  await conns.connect('pass')
  assert.equal((await conns.exec('pass', 'echo ok')).stdout.trim(), 'ok')
  conns.disconnectAll()
})

maybe('explains a missing passphrase, a wrong user and a closed port', async () => {
  const { conns } = setup()
  await assert.rejects(conns.connect('nopass'), /passphrase/i)
  assert.equal(conns.state('nopass').status, 'error')
  await assert.rejects(conns.connect('badkey'), /Sign-in failed/)
  await assert.rejects(conns.connect('refused'), /refused the connection/)
  conns.disconnectAll()
})

maybe('refuses a changed host key and says so', async () => {
  const { conns, known } = setup()
  await conns.connect('key')
  conns.disconnect('key')
  const id = [...known.keys()][0]
  known.set(id, 'SHA256:somethingelse')
  await assert.rejects(conns.connect('key'), /host key .* has changed/)
  assert.equal(conns.state('key').hostKeyChanged, true)
  conns.disconnectAll()
})

maybe('monitors a real server', async () => {
  const { conns } = setup()
  const got = []
  const errors = []
  const mon = new Monitors(conns, (id, sample, info) => got.push({ sample, info }), (id, m) => errors.push(m))
  mon.start('key')
  const t0 = Date.now()
  while (got.length < 2 && Date.now() - t0 < 12000) await new Promise(r => setTimeout(r, 200))
  const start = mon.start('key')   // a second watcher gets the history
  mon.stop('key'); mon.stop('key')
  conns.disconnectAll()
  assert.deepEqual(errors, [])
  assert.ok(got.length >= 2, `got ${got.length} samples`)
  const s = got.at(-1).sample
  assert.ok(s.memTotal > 0 && s.memUsed > 0 && s.memUsed <= s.memTotal)
  assert.ok(s.cpu >= 0 && s.cpu <= 100)
  assert.ok(s.disks.length > 0)
  assert.ok(s.cores.length >= 1)
  assert.ok(got[0].info.os.length > 0)
  assert.ok(start.history.length >= 1)
})

maybe('runs an interactive shell and reports when it ends', async () => {
  const { conns } = setup()
  let out = ''
  let closed = false
  const shells = new Shells(conns, (id, d) => { out += d }, () => { closed = true })
  await shells.open('s1', 'key', 100, 30)
  shells.write('s1', 'echo $((6*7)); stty size\n')
  const t0 = Date.now()
  while (!/30 100/.test(out) && Date.now() - t0 < 8000) await new Promise(r => setTimeout(r, 100))
  assert.match(out, /42/)
  assert.match(out, /30 100/)
  shells.resize('s1', 120, 40)
  shells.write('s1', 'stty size\nexit\n')
  while (!closed && Date.now() - t0 < 12000) await new Promise(r => setTimeout(r, 100))
  assert.match(out, /40 120/)
  assert.ok(closed)
  conns.disconnectAll()
})
