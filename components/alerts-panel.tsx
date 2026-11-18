'use client'

import { AlertTriangle, CheckCircle2, OctagonAlert, Trash2 } from 'lucide-react'
import { Dialog } from '@/components/dialog'
import type { AlertEvent } from '@/electron/types'

const ICON = {
  critical: <OctagonAlert className="h-4 w-4 shrink-0 text-destructive" />,
  warning: <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--term-yellow)]" />,
  ok: <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />,
}

const when = (t: number) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export function AlertsPanel({ alerts, onOpenServer, onClear, onClose, onSettings }: {
  alerts: AlertEvent[]
  onOpenServer: (serverId: string) => void
  onClear: () => void
  onClose: () => void
  onSettings: () => void
}) {
  return (
    <Dialog title="Alerts" onClose={onClose} width="max-w-xl">
      <div className="max-h-[60vh] overflow-y-auto">
        {alerts.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <CheckCircle2 className="mx-auto mb-2 h-7 w-7 text-primary/70" />
            <p className="font-medium">All quiet</p>
            <p className="mt-1 text-sm text-muted-foreground">You’re told here, and by a desktop notification, when a server goes down, runs hot, fills a disk or has a failed service.</p>
          </div>
        ) : alerts.map(a => (
          <button key={a.id} onClick={() => { if (a.serverId) { onOpenServer(a.serverId); onClose() } }}
            className={`flex w-full items-start gap-3 border-b border-border/60 px-4 py-3 text-left transition-colors hover:bg-secondary/50 ${a.read ? '' : 'bg-primary/5'}`}>
            {ICON[a.severity]}
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{a.title}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{a.message}</span>
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground">{when(a.t)}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-border px-4 py-3">
        <button className="btn btn-ghost" onClick={onSettings}>Alert settings</button>
        <button className="btn btn-ghost text-destructive hover:text-destructive" onClick={onClear} disabled={alerts.length === 0}><Trash2 className="h-3.5 w-3.5" />Clear all</button>
      </div>
    </Dialog>
  )
}
