'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Play, RefreshCw, RotateCw, Search, Square } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/dialog'
import { api, errText } from '@/lib/api'
import type { ServiceAction, ServiceRow } from '@/electron/types'

type Filter = 'all' | 'running' | 'failed' | 'inactive'

const tone = (s: ServiceRow) => s.active === 'failed' ? 'bg-destructive/20 text-destructive'
  : s.sub === 'running' ? 'bg-primary/20 text-primary'
  : s.active === 'active' ? 'bg-primary/10 text-primary/80'
  : 'bg-secondary text-muted-foreground'

export function ServicesTab({ serverId }: { serverId: string }) {
  const [rows, setRows] = useState<ServiceRow[]>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('running')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ name: string; action: ServiceAction } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { setRows(await api().system.services(serverId)); setError('') } catch (e) { setError(errText(e)) }
    setLoading(false)
  }, [serverId])
  useEffect(() => { void load() }, [load])

  const act = async (name: string, action: ServiceAction) => {
    setBusy(name)
    try { await api().system.serviceAction(serverId, name, action); toast.success(`${name}: ${action} done`) } catch (e) { toast.error(errText(e)) }
    await load()
    setBusy(null)
  }

  const counts = useMemo(() => ({
    all: rows.length,
    running: rows.filter(r => r.sub === 'running').length,
    failed: rows.filter(r => r.active === 'failed').length,
    inactive: rows.filter(r => r.active === 'inactive').length,
  }), [rows])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter(r =>
      (filter === 'all' || (filter === 'running' ? r.sub === 'running' : filter === 'failed' ? r.active === 'failed' : r.active === 'inactive'))
      && (!q || r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)))
  }, [rows, query, filter])

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card/40 px-3 py-2">
        <div className="relative max-w-xs flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <input className="field pl-8" placeholder="Filter services" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <div className="inline-flex rounded-md border border-border bg-input p-0.5">
          {(['all', 'running', 'failed', 'inactive'] as Filter[]).map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors ${filter === f ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              {f} <span className="opacity-60">{counts[f]}</span>
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <button className="btn" onClick={() => void load()}><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
      </div>
      {error && <p className="m-3 rounded-md bg-destructive/15 px-3 py-2 text-sm text-destructive">{error}</p>}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr><th className="px-4 py-2 font-medium">Service</th><th className="px-3 py-2 font-medium">State</th><th className="w-[55%] px-3 py-2 font-medium">Description</th><th className="px-4 py-2 text-right font-medium">Actions</th></tr>
          </thead>
          <tbody>
            {shown.map(r => (
              <tr key={r.name} className="border-t border-border/50 hover:bg-secondary/50">
                <td className="px-4 py-1.5 font-mono text-xs">{r.name}</td>
                <td className="px-3 py-1.5"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tone(r)}`}>{r.active === 'failed' ? 'failed' : r.sub}</span></td>
                <td className="max-w-0 truncate px-3 py-1.5 text-muted-foreground" title={r.description}>{r.description}</td>
                <td className="whitespace-nowrap px-4 py-1 text-right">
                  <button className="btn btn-ghost h-7 w-7 p-0" title="Start" disabled={busy !== null || r.sub === 'running'} onClick={() => void act(r.name, 'start')}><Play className="h-3.5 w-3.5" /></button>
                  <button className="btn btn-ghost h-7 w-7 p-0" title="Restart" disabled={busy !== null} onClick={() => setConfirm({ name: r.name, action: 'restart' })}><RotateCw className="h-3.5 w-3.5" /></button>
                  <button className="btn btn-ghost h-7 w-7 p-0" title="Stop" disabled={busy !== null || r.active === 'inactive'} onClick={() => setConfirm({ name: r.name, action: 'stop' })}><Square className="h-3.5 w-3.5" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && shown.length === 0 && !error && <p className="py-10 text-center text-sm text-muted-foreground">No service matches.</p>}
      </div>
      {confirm && <ConfirmDialog title={`${confirm.action === 'stop' ? 'Stop' : 'Restart'} service`} confirmLabel={confirm.action === 'stop' ? 'Stop' : 'Restart'} danger={confirm.action === 'stop'} onClose={() => setConfirm(null)}
        message={<>{confirm.action === 'stop' ? 'Stop' : 'Restart'} <b className="text-foreground">{confirm.name}</b>? Anything that depends on it is interrupted.</>}
        onConfirm={() => void act(confirm.name, confirm.action)} />}
    </div>
  )
}
