'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Dialog } from '@/components/dialog'
import { api, errText } from '@/lib/api'
import type { AlertSettings, AppSettings } from '@/electron/types'

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />{children}</label>
}

function Num({ value, onChange, min, max, suffix }: { value: number; onChange: (v: number) => void; min: number; max: number; suffix: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <input className="field h-7 w-16 px-2 text-center" inputMode="numeric" value={value} onChange={e => { const n = Number(e.target.value.replace(/\D/g, '')); onChange(Math.min(max, Math.max(min, n || min))) }} />
      <span className="text-xs text-muted-foreground">{suffix}</span>
    </span>
  )
}

export function SettingsDialog({ initial, onSaved, onClose }: { initial: AppSettings; onSaved: (s: AppSettings) => void; onClose: () => void }) {
  const [a, setA] = useState<AlertSettings>(initial.alerts)
  const [tray, setTray] = useState(initial.tray)
  const [error, setError] = useState('')
  const [testing, setTesting] = useState(false)
  const off = !a.enabled ? 'opacity-50 pointer-events-none' : ''

  const save = async () => {
    try { const s = await api().settings.set({ alerts: a, tray }); onSaved(s); onClose() } catch (e) { setError(errText(e)) }
  }

  const test = async () => {
    setTesting(true)
    try {
      await api().settings.set({ alerts: a, tray })
      const r = await api().alerts.test()
      toast.success(r.webhook === 'ok' ? 'Test sent to your desktop and the webhook' : r.webhook === 'not set' ? (r.desktop ? 'Test notification sent' : 'Desktop notifications are off or not supported here') : `Webhook problem: ${r.webhook}`)
    } catch (e) { toast.error(errText(e)) }
    setTesting(false)
  }

  return (
    <Dialog title="Settings" onClose={onClose} width="max-w-lg">
      <div className="space-y-5 px-4 py-4">
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Alerts</h3>
            <Check checked={a.enabled} onChange={v => setA({ ...a, enabled: v })}>Watch my servers</Check>
          </div>
          <p className="text-xs text-muted-foreground">Servers marked “watch” are checked in the background. You hear about a problem once, and again when it’s fixed.</p>
          <div className={`space-y-2.5 ${off}`}>
            <div className="flex items-center gap-2 text-sm">Check every <Num value={a.intervalSec} min={15} max={3600} suffix="seconds" onChange={v => setA({ ...a, intervalSec: v })} /></div>
            <Check checked={a.down} onChange={v => setA({ ...a, down: v })}>A server can’t be reached</Check>
            <div className="flex flex-wrap items-center gap-2"><Check checked={a.cpu.on} onChange={v => setA({ ...a, cpu: { ...a.cpu, on: v } })}>CPU above</Check><Num value={a.cpu.pct} min={10} max={100} suffix="% for" onChange={v => setA({ ...a, cpu: { ...a.cpu, pct: v } })} /><Num value={a.cpu.minutes} min={1} max={120} suffix="minutes" onChange={v => setA({ ...a, cpu: { ...a.cpu, minutes: v } })} /></div>
            <div className="flex flex-wrap items-center gap-2"><Check checked={a.mem.on} onChange={v => setA({ ...a, mem: { ...a.mem, on: v } })}>Memory above</Check><Num value={a.mem.pct} min={10} max={100} suffix="%" onChange={v => setA({ ...a, mem: { ...a.mem, pct: v } })} /></div>
            <div className="flex flex-wrap items-center gap-2"><Check checked={a.disk.on} onChange={v => setA({ ...a, disk: { ...a.disk, on: v } })}>A disk fuller than</Check><Num value={a.disk.pct} min={10} max={100} suffix="%" onChange={v => setA({ ...a, disk: { ...a.disk, pct: v } })} /></div>
            <Check checked={a.services} onChange={v => setA({ ...a, services: v })}>A systemd service fails</Check>
          </div>
        </section>

        <section className={`space-y-3 ${off}`}>
          <h3 className="text-sm font-semibold">Where alerts go</h3>
          <Check checked={a.desktop} onChange={v => setA({ ...a, desktop: v })}>Desktop notifications</Check>
          <div>
            <label className="label">Webhook (Discord, Slack or any service that accepts a JSON post)</label>
            <input className="field" value={a.webhook} onChange={e => setA({ ...a, webhook: e.target.value })} placeholder="https://discord.com/api/webhooks/…" spellCheck={false} />
          </div>
          <button className="btn" onClick={() => void test()} disabled={testing}>Send a test notification</button>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Background</h3>
          <Check checked={tray} onChange={setTray}>Keep running in the tray when the window is closed</Check>
          <p className="text-xs text-muted-foreground">Alerts only work while the app is running. With this on, closing the window keeps watching; quit from the tray icon.</p>
        </section>

        {error && <p className="rounded-md bg-destructive/15 px-3 py-2 text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => void save()}>Save</button>
        </div>
      </div>
    </Dialog>
  )
}
