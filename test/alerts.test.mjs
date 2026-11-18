import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
const require = createRequire(import.meta.url)
const { AlertEngine, DEFAULT_ALERTS } = require(`${process.env.INFRA_OUT}/alerts.js`)
const { SettingsStore, normalizeAlerts } = require(`${process.env.INFRA_OUT}/settings.js`)
const { parseFailed, Watcher } = require(`${process.env.INFRA_OUT}/watcher.js`)
const { Connections } = require(`${process.env.INFRA_OUT}/ssh.js`)

const cfg = (over = {}) => ({ ...DEFAULT_ALERTS, intervalSec: 60, cpu: { on: true, pct: 90, minutes: 3 }, ...over })
const ok = (o = {}) => ({ t: Date.now(), reachable: true, cpu: 10, memPct: 30, disks: [{ mount: '/', pct: 40 }], failed: [], ...o })

test('down needs two failed checks, then recovers once', () => {
  const e = new AlertEngine(() => cfg())
  assert.deepEqual(e.observe('s', 'web', { t: 1, reachable: false, error: 'timeout' }), [])
  const down = e.observe('s', 'web', { t: 2, reachable: false, error: 'timeout' })
  assert.equal(down.length, 1)
  assert.deepEqual([down[0].kind, down[0].severity, down[0].title], ['down', 'critical', 'web is not reachable'])
  assert.deepEqual(e.active('s'), ['down'])
  assert.deepEqual(e.observe('s', 'web', { t: 3, reachable: false }), [])   // not repeated
  const up = e.observe('s', 'web', ok())
  assert.deepEqual(up.map(x => [x.kind, x.severity]), [['down', 'ok']])
  assert.deepEqual(e.active('s'), [])
})

test('one dropped check does not raise down', () => {
  const e = new AlertEngine(() => cfg())
  e.observe('s', 'web', { t: 1, reachable: false })
  assert.deepEqual(e.observe('s', 'web', ok()), [])
  assert.deepEqual(e.observe('s', 'web', { t: 3, reachable: false }), [])
})

test('cpu must stay high for the configured time, and recovers with hysteresis', () => {
  const e = new AlertEngine(() => cfg())   // 3 minutes at 60 s = 3 checks
  assert.deepEqual(e.observe('s', 'web', ok({ cpu: 95 })), [])
  assert.deepEqual(e.observe('s', 'web', ok({ cpu: 95 })), [])
  const a = e.observe('s', 'web', ok({ cpu: 96 }))
  assert.deepEqual(a.map(x => [x.kind, x.severity]), [['cpu', 'warning']])
  assert.deepEqual(e.observe('s', 'web', ok({ cpu: 97 })), [])        // already active
  assert.deepEqual(e.observe('s', 'web', ok({ cpu: 88 })), [])        // within 5 points of the limit: stays
  assert.deepEqual(e.observe('s', 'web', ok({ cpu: 40 })).map(x => x.severity), ['ok'])
  // a dip resets the count
  e.observe('s', 'web', ok({ cpu: 95 })); e.observe('s', 'web', ok({ cpu: 20 })); e.observe('s', 'web', ok({ cpu: 95 }))
  assert.deepEqual(e.observe('s', 'web', ok({ cpu: 95 })), [])
})

test('memory, disk and services', () => {
  const e = new AlertEngine(() => cfg())
  assert.deepEqual(e.observe('s', 'web', ok({ memPct: 95 })), [])
  assert.equal(e.observe('s', 'web', ok({ memPct: 95 }))[0].kind, 'mem')

  const d = e.observe('s', 'web', ok({ memPct: 95, disks: [{ mount: '/', pct: 93 }, { mount: '/data', pct: 50 }] }))
  assert.deepEqual(d.map(x => x.title), ['Disk / is filling up on web'])
  assert.deepEqual(e.observe('s', 'web', ok({ memPct: 95, disks: [{ mount: '/', pct: 93 }] })), [])
  assert.equal(e.observe('s', 'web', ok({ memPct: 95, disks: [{ mount: '/', pct: 70 }] }))[0].severity, 'ok')

  const f = e.observe('s', 'web', ok({ memPct: 95, failed: ['nginx.service'] }))
  assert.equal(f[0].title, 'Service nginx failed on web')
  assert.deepEqual(e.observe('s', 'web', ok({ memPct: 95, failed: ['nginx.service'] })), [])
  const f2 = e.observe('s', 'web', ok({ memPct: 95, failed: ['nginx.service', 'redis.service', 'cron.service'] }))
  assert.equal(f2[0].title, '2 services failed on web')
  assert.match(f2[0].message, /redis, cron/)
  assert.deepEqual(e.observe('s', 'web', ok({ memPct: 95, failed: [] })).map(x => x.severity), ['ok'])
})

test('rules can be switched off, and servers are tracked separately', () => {
  const e = new AlertEngine(() => cfg({ down: false, mem: { on: false, pct: 90 } }))
  e.observe('a', 'A', { t: 1, reachable: false }); assert.deepEqual(e.observe('a', 'A', { t: 2, reachable: false }), [])
  e.observe('b', 'B', ok({ memPct: 99 })); assert.deepEqual(e.observe('b', 'B', ok({ memPct: 99 })), [])
  const e2 = new AlertEngine(() => cfg())
  e2.observe('a', 'A', ok({ memPct: 99 })); e2.observe('a', 'A', ok({ memPct: 99 }))
  assert.deepEqual(e2.active('a'), ['mem']); assert.deepEqual(e2.active('b'), [])
  e2.forget('a'); assert.deepEqual(e2.active('a'), [])
})

test('settings are validated, kept and the alert list is capped', () => {
  assert.throws(() => normalizeAlerts({ webhook: 'ftp://x' }), /http/)
  const n = normalizeAlerts({ intervalSec: 1, cpu: { on: true, pct: 500, minutes: 0 } })
  assert.deepEqual([n.intervalSec, n.cpu.pct, n.cpu.minutes], [15, 100, 1])
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-set-'))
  const s = new SettingsStore(dir)
  assert.equal(s.get().tray, true)
  s.set({ tray: false, alerts: { ...s.get().alerts, webhook: 'https://hooks.example.com/x' } })
  const again = new SettingsStore(dir)
  assert.equal(again.get().tray, false)
  assert.equal(again.get().alerts.webhook, 'https://hooks.example.com/x')
  const ev = i => ({ id: `${i}`, t: i, serverId: 's', serverName: 'S', kind: 'down', severity: 'critical', title: 't', message: 'm' })
  again.addAlerts(Array.from({ length: 320 }, (_, i) => ev(i)))
  assert.equal(again.alerts().length, 300)
  assert.equal(again.alerts()[0].read, false)
  again.markRead(); assert.ok(again.alerts().every(a => a.read))
  again.clearAlerts(); assert.equal(new SettingsStore(dir).alerts().length, 0)
})

test('reads the failed services list', () => {
  assert.deepEqual(parseFailed('##top\n1 a\n##failed\nnginx.service\nfoo.service\n'), ['nginx.service', 'foo.service'])
  assert.deepEqual(parseFailed('##failed\n'), [])
  assert.equal(parseFailed('nothing'), undefined)
})

const cfgSsh = process.env.INFRA_TEST_SSH
const maybe = cfgSsh ? test : test.skip
const [port, dir] = (cfgSsh ?? ':').split(':')

maybe('the watcher reads a real server and detects an unreachable one', async () => {
  const conns = new Connections({
    getServer: id => ({ id, host: '127.0.0.1', port: id === 'dead' ? 1 : Number(port), user: 'root', auth: 'key', password: '', keyPath: `${dir}/clientkey`, passphrase: '', privateKey: '' }),
    checkHostKey: () => 'new', onState: () => {},
  })
  const settings = cfg({ mem: { on: true, pct: 1 }, disk: { on: true, pct: 1 }, cpu: { on: false, pct: 90, minutes: 1 } })   // thresholds the real server will exceed
  const engine = new AlertEngine(() => settings)
  const events = []
  const active = {}
  const w = new Watcher(conns, engine, () => [{ id: 'live', name: 'Live', watch: true }, { id: 'dead', name: 'Dead', watch: true }, { id: 'off', name: 'Off', watch: false }],
    () => 60, () => true, e => events.push(...e), (id, k) => { active[id] = k })
  await w.cycle(); await w.cycle()
  conns.disconnectAll()
  assert.ok(events.some(e => e.serverId === 'live' && e.kind === 'mem'), 'memory alert')
  assert.ok(events.some(e => e.serverId === 'live' && e.kind === 'disk'), 'disk alert')
  assert.ok(events.some(e => e.serverId === 'dead' && e.kind === 'down'), 'down alert')
  assert.ok(!events.some(e => e.serverId === 'off'), 'unwatched server skipped')
  assert.deepEqual(active.dead, ['down'])
})
