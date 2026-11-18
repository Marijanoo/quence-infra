import * as fs from 'fs'
import * as path from 'path'
import { DEFAULT_ALERTS } from './alerts'
import type { AlertEvent, AlertSettings, AppSettings } from './types'

// App settings (settings.json) and the list of past alerts (alerts.json) in the data folder.

const clamp = (n: unknown, min: number, max: number, fallback: number) => {
  const v = Number(n)
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback
}

export function normalizeAlerts(a: Partial<AlertSettings> | undefined): AlertSettings {
  const d = DEFAULT_ALERTS
  const x = a ?? {}
  const webhook = typeof x.webhook === 'string' ? x.webhook.trim() : ''
  if (webhook && !/^https?:\/\//i.test(webhook)) throw new Error('The webhook address must start with http:// or https://')
  return {
    enabled: x.enabled ?? d.enabled,
    intervalSec: clamp(x.intervalSec, 15, 3600, d.intervalSec),
    down: x.down ?? d.down,
    cpu: { on: x.cpu?.on ?? d.cpu.on, pct: clamp(x.cpu?.pct, 10, 100, d.cpu.pct), minutes: clamp(x.cpu?.minutes, 1, 120, d.cpu.minutes) },
    mem: { on: x.mem?.on ?? d.mem.on, pct: clamp(x.mem?.pct, 10, 100, d.mem.pct) },
    disk: { on: x.disk?.on ?? d.disk.on, pct: clamp(x.disk?.pct, 10, 100, d.disk.pct) },
    services: x.services ?? d.services,
    desktop: x.desktop ?? d.desktop,
    webhook,
  }
}

export class SettingsStore {
  private settings: AppSettings
  private log: AlertEvent[]

  constructor(private dir: string) {
    fs.mkdirSync(dir, { recursive: true })
    let raw: Partial<AppSettings> = {}
    try { raw = JSON.parse(fs.readFileSync(this.file('settings.json'), 'utf8')) } catch { /* defaults */ }
    this.settings = { alerts: normalizeAlerts(raw.alerts), tray: raw.tray ?? true }
    try { this.log = JSON.parse(fs.readFileSync(this.file('alerts.json'), 'utf8')) } catch { this.log = [] }
  }

  private file(n: string) { return path.join(this.dir, n) }
  private write(n: string, v: unknown) {
    const tmp = this.file(n) + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(v, null, 2), { mode: 0o600 })
    fs.renameSync(tmp, this.file(n))
  }

  get(): AppSettings { return this.settings }

  set(patch: Partial<AppSettings>): AppSettings {
    const next: AppSettings = { alerts: patch.alerts ? normalizeAlerts(patch.alerts) : this.settings.alerts, tray: patch.tray ?? this.settings.tray }
    this.settings = next
    this.write('settings.json', next)
    return next
  }

  alerts(): AlertEvent[] { return this.log }

  addAlerts(events: AlertEvent[]) {
    if (!events.length) return
    this.log = [...events.map(e => ({ ...e, read: false })), ...this.log].slice(0, 300)
    this.write('alerts.json', this.log)
  }

  markRead() {
    this.log = this.log.map(e => ({ ...e, read: true }))
    this.write('alerts.json', this.log)
  }

  clearAlerts() {
    this.log = []
    this.write('alerts.json', this.log)
  }
}
