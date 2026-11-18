import { randomUUID } from 'crypto'
import type { AlertEvent, AlertKind, AlertSettings, Observation } from './types'

// Decides when an observation of a server is worth telling the user about. Alerts are sent when
// something changes (a server goes down, a disk fills up) and again when it recovers, never on
// every check. Thresholds have a little hysteresis so a value hovering around the limit doesn't
// flip the alert back and forth.

export const DEFAULT_ALERTS: AlertSettings = {
  enabled: true,
  intervalSec: 60,
  down: true,
  cpu: { on: true, pct: 90, minutes: 5 },
  mem: { on: true, pct: 90 },
  disk: { on: true, pct: 90 },
  services: true,
  desktop: true,
  webhook: '',
}

interface ServerState {
  failedChecks: number
  down: boolean
  cpuCount: number
  cpuActive: boolean
  memCount: number
  memActive: boolean
  disks: Set<string>
  failed: Set<string>
}

const fresh = (): ServerState => ({ failedChecks: 0, down: false, cpuCount: 0, cpuActive: false, memCount: 0, memActive: false, disks: new Set(), failed: new Set() })

export class AlertEngine {
  private states = new Map<string, ServerState>()

  constructor(private settings: () => AlertSettings) {}

  // The kinds of alert that are currently active for a server
  active(serverId: string): AlertKind[] {
    const s = this.states.get(serverId)
    if (!s) return []
    const out: AlertKind[] = []
    if (s.down) out.push('down')
    if (s.cpuActive) out.push('cpu')
    if (s.memActive) out.push('mem')
    if (s.disks.size) out.push('disk')
    if (s.failed.size) out.push('services')
    return out
  }

  forget(serverId: string) { this.states.delete(serverId) }

  observe(serverId: string, serverName: string, o: Observation): AlertEvent[] {
    const cfg = this.settings()
    let s = this.states.get(serverId)
    if (!s) { s = fresh(); this.states.set(serverId, s) }
    const out: AlertEvent[] = []
    const emit = (kind: AlertKind, severity: AlertEvent['severity'], title: string, message: string) =>
      out.push({ id: randomUUID(), t: o.t, serverId, serverName, kind, severity, title, message })

    if (!o.reachable) {
      s.failedChecks++
      // Two failed checks in a row, so one dropped connection doesn't raise the alarm
      if (cfg.down && s.failedChecks >= 2 && !s.down) {
        s.down = true
        emit('down', 'critical', `${serverName} is not reachable`, o.error || 'The connection failed.')
      }
      return out
    }
    s.failedChecks = 0
    if (s.down) {
      s.down = false
      emit('down', 'ok', `${serverName} is back`, 'The server is reachable again.')
    }

    // CPU: it has to stay high for the configured time
    if (o.cpu !== undefined) {
      const needed = Math.max(1, Math.ceil((cfg.cpu.minutes * 60) / Math.max(1, cfg.intervalSec)))
      if (o.cpu >= cfg.cpu.pct) {
        s.cpuCount++
        if (cfg.cpu.on && s.cpuCount >= needed && !s.cpuActive) {
          s.cpuActive = true
          emit('cpu', 'warning', `High CPU on ${serverName}`, `CPU has been at ${o.cpu.toFixed(0)}% for ${cfg.cpu.minutes} minute${cfg.cpu.minutes === 1 ? '' : 's'} (limit ${cfg.cpu.pct}%).`)
        }
      } else if (o.cpu < cfg.cpu.pct - 5) {
        s.cpuCount = 0
        if (s.cpuActive) { s.cpuActive = false; emit('cpu', 'ok', `CPU back to normal on ${serverName}`, `CPU is at ${o.cpu.toFixed(0)}%.`) }
      }
    }

    if (o.memPct !== undefined) {
      if (o.memPct >= cfg.mem.pct) {
        s.memCount++
        if (cfg.mem.on && s.memCount >= 2 && !s.memActive) {
          s.memActive = true
          emit('mem', 'warning', `Memory is running low on ${serverName}`, `Memory use is ${o.memPct.toFixed(0)}% (limit ${cfg.mem.pct}%).`)
        }
      } else if (o.memPct < cfg.mem.pct - 5) {
        s.memCount = 0
        if (s.memActive) { s.memActive = false; emit('mem', 'ok', `Memory back to normal on ${serverName}`, `Memory use is ${o.memPct.toFixed(0)}%.`) }
      }
    }

    if (o.disks) {
      for (const d of o.disks) {
        if (d.pct >= cfg.disk.pct && cfg.disk.on && !s.disks.has(d.mount)) {
          s.disks.add(d.mount)
          emit('disk', 'warning', `Disk ${d.mount} is filling up on ${serverName}`, `${d.mount} is ${d.pct.toFixed(0)}% full (limit ${cfg.disk.pct}%).`)
        } else if (d.pct < cfg.disk.pct - 3 && s.disks.has(d.mount)) {
          s.disks.delete(d.mount)
          emit('disk', 'ok', `Disk ${d.mount} has room again on ${serverName}`, `${d.mount} is ${d.pct.toFixed(0)}% full.`)
        }
      }
      // A mount that disappeared no longer counts
      for (const m of [...s.disks]) if (!o.disks.some(d => d.mount === m)) s.disks.delete(m)
    }

    if (o.failed) {
      const now = new Set(o.failed)
      const added = [...now].filter(n => !s.failed.has(n))
      if (cfg.services && added.length) {
        emit('services', 'warning', `${added.length === 1 ? `Service ${added[0].replace(/\.service$/, '')} failed` : `${added.length} services failed`} on ${serverName}`,
          added.map(a => a.replace(/\.service$/, '')).join(', ') + (added.length === 1 ? ' is in a failed state.' : ' are in a failed state.'))
      } else if (!now.size && s.failed.size) {
        emit('services', 'ok', `Services recovered on ${serverName}`, 'No service is failed any more.')
      }
      s.failed = now
    }
    return out
  }
}
