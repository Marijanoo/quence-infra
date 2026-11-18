'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Pause, Play, RefreshCw, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { ContextMenu, ConfirmDialog, type MenuItem } from '@/components/dialog'
import { api, errText } from '@/lib/api'
import { bytes } from '@/lib/format'
import type { ProcessRow } from '@/electron/types'

type SortKey = 'cpu' | 'mem' | 'pid' | 'user' | 'command'

export function ProcessesTab({ serverId }: { serverId: string }) {
  const [rows, setRows] = useState<ProcessRow[]>([])
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'cpu', desc: true })
  const [live, setLive] = useState(true)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [kill, setKill] = useState<{ row: ProcessRow; force: boolean } | null>(null)

  const load = useCallback(async () => {
    try { setRows(await api().system.processes(serverId)); setError('') } catch (e) { setError(errText(e)) }
    setLoading(false)
  }, [serverId])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => void load(), 3000)
    return () => clearInterval(t)
  }, [live, load])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const f = q ? rows.filter(r => r.command.toLowerCase().includes(q) || r.user.toLowerCase().includes(q) || String(r.pid) === q) : rows
    const dir = sort.desc ? -1 : 1
    return [...f].sort((a, b) => {
      const x = a[sort.key], y = b[sort.key]
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * dir
    })
  }, [rows, query, sort])

  const th = (key: SortKey, label: string, right = false) => (
    <th className={`cursor-pointer select-none px-3 py-2 font-medium hover:text-foreground ${right ? 'text-right' : ''}`} onClick={() => setSort(s => ({ key, desc: s.key === key ? !s.desc : key !== 'user' && key !== 'command' }))}>
      <span className="inline-flex items-center gap-1">{label}{sort.key === key && (sort.desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}</span>
    </th>
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card/40 px-3 py-2">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <input className="field pl-8" placeholder="Filter by name, user or PID" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <span className="text-xs text-muted-foreground">{shown.length} of {rows.length} processes</span>
        <span className="flex-1" />
        <button className="btn" onClick={() => setLive(l => !l)}>{live ? <><Pause className="h-3.5 w-3.5" />Pause</> : <><Play className="h-3.5 w-3.5" />Resume</>}</button>
        <button className="btn" onClick={() => void load()}><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
      </div>
      {error && <p className="m-3 rounded-md bg-destructive/15 px-3 py-2 text-sm text-destructive">{error}</p>}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>{th('pid', 'PID', true)}{th('user', 'User')}{th('cpu', 'CPU', true)}{th('mem', 'Memory', true)}<th className="px-3 py-2 text-right font-medium">Resident</th><th className="px-3 py-2 font-medium">Running</th>{th('command', 'Command')}</tr>
          </thead>
          <tbody className="tabular-nums">
            {shown.map(r => (
              <tr key={r.pid} className="border-t border-border/50 hover:bg-secondary/50" onContextMenu={e => {
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY, items: [
                  { label: 'Stop (TERM)…', onClick: () => setKill({ row: r, force: false }) },
                  { label: 'Force kill (KILL)…', danger: true, onClick: () => setKill({ row: r, force: true }) },
                  { label: 'Copy command', onClick: () => void navigator.clipboard.writeText(r.command) },
                ] })
              }}>
                <td className="px-3 py-1 text-right text-muted-foreground">{r.pid}</td>
                <td className="px-3 py-1 text-muted-foreground">{r.user}</td>
                <td className="px-3 py-1 text-right">{r.cpu.toFixed(1)}%</td>
                <td className="px-3 py-1 text-right">{r.mem.toFixed(1)}%</td>
                <td className="px-3 py-1 text-right text-muted-foreground">{bytes(r.rss)}</td>
                <td className="px-3 py-1 text-muted-foreground">{r.time}</td>
                <td className="max-w-0 truncate px-3 py-1 font-mono text-xs" title={r.command}>{r.command}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && shown.length === 0 && !error && <p className="py-10 text-center text-sm text-muted-foreground">No process matches.</p>}
      </div>
      <p className="shrink-0 border-t border-border bg-card/40 px-3 py-1.5 text-[11px] text-muted-foreground/70">Right-click a process to stop it. You can only stop processes your login user is allowed to.</p>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {kill && <ConfirmDialog title={kill.force ? 'Force kill process' : 'Stop process'} confirmLabel={kill.force ? 'Force kill' : 'Stop'} onClose={() => setKill(null)}
        message={<>{kill.force ? 'Kill' : 'Ask to stop'} <b className="text-foreground">{kill.row.command.slice(0, 80)}</b> (PID {kill.row.pid}, user {kill.row.user})?{kill.force ? ' It gets no chance to save its work.' : ''}</>}
        onConfirm={async () => { try { await api().system.kill(serverId, kill.row.pid, kill.force); toast.success('Signal sent'); await load() } catch (e) { toast.error(errText(e)) } }} />}
    </div>
  )
}
