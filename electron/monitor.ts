import type { Connections } from './ssh'
import { SNAPSHOT_COMMAND, parseSnapshot, toSample, UnsupportedServerError, type Snapshot } from './monitor-parse'
import type { MonitorInfo, MonitorSample, MonitorStart } from './types'

// Samples a server every couple of seconds while something is watching it (an open overview tab)
// and keeps the last few minutes so a tab opened later shows the recent past straight away.

const INTERVAL_MS = 2000
const HISTORY = 150
const MAX_FAILURES = 3

interface Watch {
  timer: NodeJS.Timeout | null
  watchers: number
  running: boolean
  prev: Snapshot | null
  info: MonitorInfo | null
  history: MonitorSample[]
  failures: number
  wait: number
}

export class Monitors {
  private watches = new Map<string, Watch>()

  constructor(
    private conns: Connections,
    private emit: (id: string, sample: MonitorSample, info: MonitorInfo) => void,
    private emitError: (id: string, message: string) => void,
  ) {}

  start(id: string): MonitorStart {
    let w = this.watches.get(id)
    if (!w) {
      w = { timer: null, watchers: 0, running: false, prev: null, info: null, history: [], failures: 0, wait: 0 }
      this.watches.set(id, w)
    }
    w.watchers++
    if (!w.timer) {
      w.timer = setInterval(() => void this.tick(id), INTERVAL_MS)
      void this.tick(id)
    }
    return { info: w.info, history: w.history }
  }

  // Starts sampling again after it gave up (the UI's Reconnect button).
  retry(id: string) {
    const w = this.watches.get(id)
    if (!w || w.timer || w.watchers === 0) return
    w.failures = 0
    w.wait = 0
    w.timer = setInterval(() => void this.tick(id), INTERVAL_MS)
    void this.tick(id)
  }

  stop(id: string) {
    const w = this.watches.get(id)
    if (!w) return
    w.watchers = Math.max(0, w.watchers - 1)
    if (w.watchers === 0) this.halt(id)
  }

  private halt(id: string) {
    const w = this.watches.get(id)
    if (!w) return
    if (w.timer) clearInterval(w.timer)
    w.timer = null
    // Keep history and info for a while so a quick return is seamless; drop the CPU baseline
    // because the gap would make the first difference meaningless.
    w.prev = null
  }

  // Forget a server entirely (it was removed).
  drop(id: string) {
    this.halt(id)
    this.watches.delete(id)
  }

  stopAll() {
    for (const id of [...this.watches.keys()]) this.halt(id)
  }

  private async tick(id: string) {
    const w = this.watches.get(id)
    if (!w || w.running || !w.timer) return
    if (w.wait > 0) { w.wait--; return }
    w.running = true
    try {
      const { stdout } = await this.conns.exec(id, SNAPSHOT_COMMAND, 10_000)
      const snap = parseSnapshot(stdout)
      const sample = toSample(w.prev, snap)
      const first = w.prev === null
      w.prev = snap
      w.info = snap.info
      w.failures = 0
      if (!first) {
        w.history.push(sample)
        if (w.history.length > HISTORY) w.history.shift()
      }
      this.emit(id, sample, snap.info)
    } catch (err) {
      w.prev = null
      w.failures++
      if (err instanceof UnsupportedServerError) {
        this.emitError(id, err.message)
        this.halt(id)
      } else {
        this.emitError(id, err instanceof Error ? err.message : String(err))
        // Retry a few times with growing pauses, then stop: hammering a server that refuses us
        // (a wrong password, say) can get the address blocked. Retry() starts again.
        if (w.failures >= MAX_FAILURES) this.halt(id)
        else w.wait = w.failures
      }
    } finally {
      w.running = false
    }
  }
}
