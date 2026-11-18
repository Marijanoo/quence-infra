import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { parseSnapshot, toSample, UnsupportedServerError } = require(`${process.env.INFRA_OUT}/monitor-parse.js`)

const text = (cpu, rx, tx) => `##stat
cpu  ${cpu[0]} 0 ${cpu[1]} ${cpu[2]} ${cpu[3]} 0 0 0 0 0
cpu0 ${cpu[0] / 2} 0 ${cpu[1] / 2} ${cpu[2] / 2} 0 0 0 0 0 0
cpu1 ${cpu[0] / 2} 0 ${cpu[1] / 2} ${cpu[2] / 2} 0 0 0 0 0 0
##mem
MemTotal:        4000000 kB
MemFree:          500000 kB
MemAvailable:    1000000 kB
Buffers:          100000 kB
Cached:           800000 kB
SwapTotal:       2000000 kB
SwapFree:        1500000 kB
##load
0.52 0.40 0.30 1/200 1234
##up
86400.50 170000.10
##net
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 999999 100 0 0 0 0 0 0 999999 100 0 0 0 0 0 0
  eth0: ${rx} 100 0 0 0 0 0 0 ${tx} 100 0 0 0 0 0 0
##disk
Filesystem     1024-blocks      Used Available Capacity Mounted on
/dev/sda1         40000000  30000000  10000000      75% /
/dev/sdb1          1000000    500000    500000      50% /mnt/my disk
##os
Ubuntu 22.04.5 LTS
5.15.0-198-generic
 Intel(R) Xeon(R)   CPU @ 2.20GHz
2
web-1
##top
  1234 root             12.5  3.1 node
 99 www-data 0.0 0.1 nginx: worker process
`

test('parses a snapshot', () => {
  const s = parseSnapshot(text([1000, 500, 8000, 100], 5000, 2000), 1000)
  assert.equal(s.cpu.length, 3)
  assert.deepEqual(s.cpu[0], { total: 9600, idle: 8100 })
  assert.equal(s.mem.MemTotal, 4000000 * 1024)
  assert.deepEqual(s.load, [0.52, 0.4, 0.3])
  assert.equal(s.uptime, 86400.5)
  assert.deepEqual(s.net, { rx: 5000, tx: 2000 })
  assert.equal(s.disks.length, 2)
  assert.equal(s.disks[1].mount, '/mnt/my disk')
  assert.equal(s.disks[0].used, 30000000 * 1024)
  assert.deepEqual(s.info, { os: 'Ubuntu 22.04.5 LTS', kernel: '5.15.0-198-generic', cpuModel: 'Intel(R) Xeon(R) CPU @ 2.20GHz', cores: 2, hostname: 'web-1' })
  assert.deepEqual(s.procs.map(p => [p.pid, p.user, p.cpu, p.name]), [[1234, 'root', 12.5, 'node'], [99, 'www-data', 0, 'nginx: worker process']])
})

test('turns two snapshots into rates', () => {
  const a = parseSnapshot(text([1000, 500, 8000, 100], 5000, 2000), 1000)
  const b = parseSnapshot(text([2000, 1000, 8500, 100], 25000, 12000), 3000)
  const first = toSample(null, a)
  assert.equal(first.cpu, 0)
  assert.equal(first.rx, 0)
  const s = toSample(a, b)
  // busy 1500 of 2000 ticks → 75%
  assert.ok(Math.abs(s.cpu - 75) < 0.01, String(s.cpu))
  assert.equal(s.cores.length, 2)
  assert.equal(s.rx, 10000)   // 20000 bytes over 2 s
  assert.equal(s.tx, 5000)
  assert.equal(s.memTotal, 4000000 * 1024)
  assert.equal(s.memUsed, 3000000 * 1024)   // total - available
  assert.equal(s.swapUsed, 500000 * 1024)
})

test('a counter that went backwards (reboot) gives no negative rate', () => {
  const a = parseSnapshot(text([1000, 500, 8000, 100], 50000, 20000), 1000)
  const b = parseSnapshot(text([10, 5, 80, 1], 100, 100), 3000)
  const s = toSample(a, b)
  assert.equal(s.rx, 0)
  assert.ok(s.cpu >= 0 && s.cpu <= 100)
})

test('a server without /proc is reported', () => {
  assert.throws(() => parseSnapshot('##unsupported\n'), UnsupportedServerError)
  assert.throws(() => parseSnapshot('garbage'), /did not return/)
})
