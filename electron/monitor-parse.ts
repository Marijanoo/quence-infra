import type { DiskInfo, MonitorInfo, MonitorSample, ProcInfo } from './types'

// The monitoring runs one shell command per sample on the server and reads /proc, which every Linux
// server has, so nothing has to be installed there. The command prints sections introduced by
// "##name" lines; the parser below turns that text into numbers. CPU and network figures are
// differences between two samples, so the first sample after connecting has none.

export const SNAPSHOT_COMMAND = [
  'export LC_ALL=C',
  'if [ ! -r /proc/stat ]; then echo "##unsupported"; exit 0; fi',
  'echo "##stat"; grep "^cpu" /proc/stat',
  'echo "##mem"; grep -E "^(MemTotal|MemAvailable|MemFree|Buffers|Cached|SReclaimable|SwapTotal|SwapFree):" /proc/meminfo',
  'echo "##load"; cat /proc/loadavg',
  'echo "##up"; cat /proc/uptime',
  'echo "##net"; cat /proc/net/dev',
  'echo "##disk"; df -P -k -x tmpfs -x devtmpfs -x squashfs -x overlay -x efivarfs 2>/dev/null',
  'echo "##os"; (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME") || uname -s; uname -r; grep -m1 "model name" /proc/cpuinfo | cut -d: -f2; grep -c "^processor" /proc/cpuinfo; hostname',
  'echo "##top"; ps -eo pid=,user:16=,pcpu=,pmem=,comm= --sort=-pcpu 2>/dev/null | head -n 12',
].join('; ')

export interface Snapshot {
  t: number
  cpu: { total: number; idle: number }[]    // [0] is the whole machine, then one per core
  mem: Record<string, number>               // bytes
  load: [number, number, number]
  uptime: number
  net: { rx: number; tx: number }
  disks: DiskInfo[]
  info: MonitorInfo
  procs: ProcInfo[]
}

export class UnsupportedServerError extends Error {
  constructor() { super('Monitoring needs a Linux server: this one has no /proc') }
}

function sections(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  let cur: string | null = null
  for (const line of text.split('\n')) {
    const m = /^##(\w+)\s*$/.exec(line)
    if (m) { cur = m[1]; out[cur] = []; continue }
    if (cur && line.trim() !== '') out[cur].push(line)
  }
  return out
}

export function parseSnapshot(text: string, t = Date.now()): Snapshot {
  const s = sections(text)
  if (s.unsupported) throw new UnsupportedServerError()
  if (!s.stat?.length) throw new Error('The server did not return any figures')

  const cpu = s.stat.filter(l => l.startsWith('cpu')).map(l => {
    const n = l.trim().split(/\s+/).slice(1).map(Number)
    const total = n.slice(0, 8).reduce((a, b) => a + (b || 0), 0)   // user nice system idle iowait irq softirq steal
    return { total, idle: (n[3] || 0) + (n[4] || 0) }
  })

  const mem: Record<string, number> = {}
  for (const l of s.mem ?? []) {
    const m = /^(\w+):\s+(\d+)/.exec(l)
    if (m) mem[m[1]] = Number(m[2]) * 1024
  }

  const l3 = (s.load?.[0] ?? '').split(/\s+/).map(Number)
  const load: [number, number, number] = [l3[0] || 0, l3[1] || 0, l3[2] || 0]
  const uptime = Number((s.up?.[0] ?? '').split(/\s+/)[0]) || 0

  let rx = 0, tx = 0
  for (const l of s.net ?? []) {
    const m = /^\s*([^:\s]+):\s*(.*)$/.exec(l)
    if (!m || m[1] === 'lo') continue
    const f = m[2].trim().split(/\s+/).map(Number)
    if (f.length >= 9) { rx += f[0] || 0; tx += f[8] || 0 }
  }

  const disks: DiskInfo[] = []
  for (const l of (s.disk ?? []).slice(1)) {
    const f = l.trim().split(/\s+/)
    if (f.length < 6) continue
    const size = Number(f[1]) * 1024
    if (!size) continue
    disks.push({ fs: f[0], size, used: Number(f[2]) * 1024, mount: f.slice(5).join(' ') })
  }

  const os = s.os ?? []
  const info: MonitorInfo = {
    os: (os[0] ?? '').trim() || 'Linux',
    kernel: (os[1] ?? '').trim(),
    cpuModel: (os[2] ?? '').trim().replace(/\s+/g, ' '),
    cores: Number((os[3] ?? '').trim()) || Math.max(1, cpu.length - 1),
    hostname: (os[4] ?? '').trim(),
  }

  const procs: ProcInfo[] = []
  for (const l of s.top ?? []) {
    const m = /^\s*(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(.+?)\s*$/.exec(l)
    if (m) procs.push({ pid: Number(m[1]), user: m[2], cpu: Number(m[3]), mem: Number(m[4]), name: m[5] })
  }

  return { t, cpu, mem, load, uptime, net: { rx, tx }, disks, info, procs }
}

const pct = (a: { total: number; idle: number }, b: { total: number; idle: number }) => {
  const dt = b.total - a.total
  if (dt <= 0) return 0
  return Math.max(0, Math.min(100, (1 - (b.idle - a.idle) / dt) * 100))
}

export function toSample(prev: Snapshot | null, cur: Snapshot): MonitorSample {
  const total = cur.mem.MemTotal ?? 0
  // "used" the way free(1) counts it: what is neither free nor reclaimable cache
  const available = cur.mem.MemAvailable ?? ((cur.mem.MemFree ?? 0) + (cur.mem.Buffers ?? 0) + (cur.mem.Cached ?? 0))
  const swapTotal = cur.mem.SwapTotal ?? 0
  const dt = prev ? Math.max(0.001, (cur.t - prev.t) / 1000) : 0
  const rate = (a: number, b: number) => (prev && dt > 0 && b >= a ? (b - a) / dt : 0)
  return {
    t: cur.t,
    cpu: prev && prev.cpu[0] && cur.cpu[0] ? pct(prev.cpu[0], cur.cpu[0]) : 0,
    cores: prev ? cur.cpu.slice(1).map((c, i) => (prev.cpu[i + 1] ? pct(prev.cpu[i + 1], c) : 0)) : cur.cpu.slice(1).map(() => 0),
    memTotal: total,
    memUsed: Math.max(0, total - available),
    swapTotal,
    swapUsed: Math.max(0, swapTotal - (cur.mem.SwapFree ?? 0)),
    load: cur.load,
    uptime: cur.uptime,
    rx: rate(prev?.net.rx ?? 0, cur.net.rx),
    tx: rate(prev?.net.tx ?? 0, cur.net.tx),
    disks: cur.disks,
    procs: cur.procs,
  }
}
