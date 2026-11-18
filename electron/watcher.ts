import type { Connections } from './ssh'
import { SNAPSHOT_COMMAND, parseSnapshot, toSample, UnsupportedServerError, type Snapshot } from './monitor-parse'
import type { AlertEngine } from './alerts'
import type { AlertEvent, AlertKind, Observation } from './types'

// Checks the watched servers in the background, every minute or so, and feeds what it sees to the
// alert engine. It shares each server's SSH connection with everything else, so a server you are
// already working on costs nothing extra.

const FAILED_SERVICES = 'echo "##failed"; systemctl --failed --no-legend --plain 2>/dev/null | awk \'{print $1}\''

export function parseFailed(text: string): string[] | undefined {
  const i = text.indexOf('##failed')
  if (i < 0) return undefined
  return text.slice(i + 8).split('\n').map(l => l.trim()).filter(l => /\.service$/.test(l))
}

export interface WatchTarget { id: string; name: string; watch: boolean }

export class Watcher {
  private timer: NodeJS.Timeout | null = null
  private prev = new Map<string, Snapshot>()
  private running = false

  constructor(
    private conns: Connections,
    private engine: AlertEngine,
    private targets: () => WatchTarget[],
    private intervalSec: () => number,
    private enabled: () => boolean,
    private onEvents: (events: AlertEvent[]) => void,
    private onActive: (serverId: string, kinds: AlertKind[]) => void,
  ) {}

  start() {
    this.stop()
    const loop = () => {
      this.timer = setTimeout(async () => { await this.cycle(); if (this.timer) loop() }, Math.max(15, this.intervalSec()) * 1000)
    }
    this.timer = setTimeout(() => void this.cycle().then(() => { if (this.timer) loop() }), 3000)
  }

  stop() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  async cycle() {
    if (this.running || !this.enabled()) return
    this.running = true
    try {
      const list = this.targets().filter(t => t.watch)
      for (const id of [...this.prev.keys()]) if (!list.some(t => t.id === id)) { this.prev.delete(id); this.engine.forget(id); this.onActive(id, []) }
      // a few at a time, so one dead server doesn't hold up the others
      const queue = [...list]
      await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
        for (let t = queue.shift(); t; t = queue.shift()) await this.check(t)
      }))
    } finally { this.running = false }
  }

  async check(t: WatchTarget) {
    const now = Date.now()
    let obs: Observation
    try {
      const { stdout } = await this.conns.exec(t.id, `${SNAPSHOT_COMMAND}; ${FAILED_SERVICES}`, 25_000)
      try {
        const snap = parseSnapshot(stdout, now)
        const sample = toSample(this.prev.get(t.id) ?? null, snap)
        const hadPrev = this.prev.has(t.id)
        this.prev.set(t.id, snap)
        obs = {
          t: now, reachable: true,
          cpu: hadPrev ? sample.cpu : undefined,
          memPct: sample.memTotal ? (sample.memUsed / sample.memTotal) * 100 : undefined,
          disks: snap.disks.map(d => ({ mount: d.mount, pct: (d.used / d.size) * 100 })),
          failed: parseFailed(stdout),
        }
      } catch (e) {
        // Reachable, but not a Linux server we can read figures from
        if (!(e instanceof UnsupportedServerError)) throw e
        obs = { t: now, reachable: true }
      }
    } catch (err) {
      this.prev.delete(t.id)
      obs = { t: now, reachable: false, error: err instanceof Error ? err.message : String(err) }
    }
    const events = this.engine.observe(t.id, t.name, obs)
    this.onActive(t.id, this.engine.active(t.id))
    if (events.length) this.onEvents(events)
  }
}
