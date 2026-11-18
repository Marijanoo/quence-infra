import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
const require = createRequire(import.meta.url)
const { Connections } = require(`${process.env.INFRA_OUT}/ssh.js`)
const { Streams } = require(`${process.env.INFRA_OUT}/streams.js`)
const { Deployments } = require(`${process.env.INFRA_OUT}/deployments.js`)

const cfg = process.env.INFRA_TEST_SSH
const maybe = cfg ? test : test.skip
const [port, dir] = (cfg ?? ':').split(':')

function setup() {
  const conns = new Connections({
    getServer: id => ({ id, host: '127.0.0.1', port: Number(port), user: 'root', auth: 'key', password: '', keyPath: `${dir}/clientkey`, passphrase: '', privateKey: '' }),
    checkHostKey: () => 'new', onState: () => {},
  })
  const events = []
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-dep-'))
  const streams = new Streams(conns, (id, d, offset) => events.push({ id, d, offset }), () => {})
  const changes = []
  const dep = new Deployments(data, streams, s => changes.push(s))
  return { conns, dep, data, events, changes, streams }
}
const until = async (f, ms = 10000) => { const t = Date.now(); while (!f() && Date.now() - t < ms) await new Promise(r => setTimeout(r, 50)) }

test('validates and stores deployments', () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-dep-'))
  const dep = new Deployments(data, {}, () => {})
  assert.throws(() => dep.saveDef({ serverId: 's', name: ' ', workdir: '', script: 'x' }), /name/)
  assert.throws(() => dep.saveDef({ serverId: 's', name: 'a', workdir: '', script: '  ' }), /empty/)
  const d = dep.saveDef({ serverId: 's', name: 'Release', workdir: '/srv/app', script: 'a\r\nb' })
  assert.equal(d.script, 'a\nb')
  dep.saveDef({ ...d, name: 'Release 2' })
  assert.deepEqual(dep.list('s').defs.map(x => x.name), ['Release 2'])
  assert.deepEqual(dep.list('other').defs, [])
  // a new instance reads it back, and a run that was going is marked interrupted
  const doc = JSON.parse(fs.readFileSync(path.join(data, 'deployments.json'), 'utf8'))
  doc.runs.push({ id: 'r1', deploymentId: d.id, serverId: 's', name: 'x', startedAt: 1, finishedAt: null, status: 'running', code: null })
  fs.writeFileSync(path.join(data, 'deployments.json'), JSON.stringify(doc))
  const again = new Deployments(data, {}, () => {})
  assert.equal(again.list('s').runs[0].status, 'interrupted')
  again.remove(d.id)
  assert.deepEqual(again.list('s'), { defs: [], runs: [] })
})

maybe('runs a deployment, records the output and exit code', async () => {
  const { conns, dep, events, changes } = setup()
  try {
    const def = dep.saveDef({ serverId: 'a', name: 'Say hi', workdir: '/tmp', script: 'pwd\necho deploying\nexit 0' })
    const run = await dep.run(def.id)
    assert.equal(run.status, 'running')
    await assert.rejects(dep.run(def.id), /already running/)
    await until(() => dep.list('a').runs[0].status !== 'running')
    const done = dep.list('a').runs[0]
    assert.equal(done.status, 'success')
    assert.equal(done.code, 0)
    const log = dep.log(run.id)
    assert.match(log.text, /\/tmp\ndeploying/)
    assert.equal(log.length, log.text.length)
    assert.ok(changes.includes('a'))
    // events carry running offsets so a viewer can join late without duplicates
    const mine = events.filter(e => e.id === run.id)
    assert.equal(mine[0].offset, 0)
    assert.equal(mine.reduce((n, e) => n + e.d.length, 0), log.length)

    const bad = dep.saveDef({ serverId: 'a', name: 'Fails', workdir: '', script: 'echo oops; exit 7' })
    await dep.run(bad.id)
    await until(() => dep.list('a').runs.find(r => r.name === 'Fails').status !== 'running')
    const failed = dep.list('a').runs.find(r => r.name === 'Fails')
    assert.deepEqual([failed.status, failed.code], ['failed', 7])
  } finally { conns.disconnectAll() }
})

maybe('cancels a running deployment', async () => {
  const { conns, dep } = setup()
  try {
    const def = dep.saveDef({ serverId: 'a', name: 'Slow', workdir: '', script: 'echo start; sleep 60; echo never' })
    const run = await dep.run(def.id)
    await until(() => dep.log(run.id).text.includes('start'))
    dep.cancel(run.id)
    const r = dep.list('a').runs[0]
    assert.equal(r.status, 'cancelled')
    assert.match(dep.log(run.id).text, /start[\s\S]*\[cancelled\]/)
    assert.doesNotMatch(dep.log(run.id).text, /never/)
  } finally { conns.disconnectAll() }
})

maybe('a deployment on an unreachable server fails cleanly', async () => {
  const conns = new Connections({ getServer: id => ({ id, host: '127.0.0.1', port: 1, user: 'root', auth: 'key', password: '', keyPath: `${dir}/clientkey`, passphrase: '', privateKey: '' }), checkHostKey: () => 'new', onState: () => {} })
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-dep-'))
  const streams = new Streams(conns, () => {}, () => {})
  const dep = new Deployments(data, streams, () => {})
  const def = dep.saveDef({ serverId: 'z', name: 'x', workdir: '', script: 'true' })
  await dep.run(def.id)
  await until(() => dep.list('z').runs[0].status !== 'running')
  assert.equal(dep.list('z').runs[0].status, 'failed')
  assert.match(dep.log(dep.list('z').runs[0].id).text, /refused/i)
})
