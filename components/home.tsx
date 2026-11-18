'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Plus, Server, SlidersHorizontal, TerminalSquare } from 'lucide-react'
import { Bar } from '@/components/charts'
import { StatusDot, STATUS_LABEL } from '@/components/status-dot'
import { levelColor, pct } from '@/lib/format'
import type { AlertKind, ConnState, FleetSample, ServerPublic } from '@/electron/types'

type Sort = 'name' | 'cpu' | 'mem' | 'disk'
interface Prefs { cpu: boolean; mem: boolean; disk: boolean; compact: boolean; sort: Sort }
const DEFAULT: Prefs = { cpu: true, mem: true, disk: true, compact: false, sort: 'name' }

function loadPrefs(): Prefs {
  try { return { ...DEFAULT, ...JSON.parse(localStorage.getItem('infra-dashboard') ?? '{}') } } catch { return DEFAULT }
}

function Gauge({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px]"><span className="text-muted-foreground">{label}</span><span className="tabular-nums">{value === undefined ? '–' : pct(value)}</span></div>
      <Bar value={value ?? 0} color={value === undefined ? 'transparent' : levelColor(value)} />
    </div>
  )
}

const ago = (t: number) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 90 ? `${s}s ago` : `${Math.round(s / 60)}m ago` }

export function Home({ servers, states, alerting, onOpen, onTerminal, onAdd }: {
  servers: ServerPublic[]
  states: Record<string, ConnState>
  alerting: Record<string, AlertKind[]>
  onOpen: (s: ServerPublic) => void
  onTerminal: (s: ServerPublic) => void
  onAdd: () => void
}) {
  const [fleet, setFleet] = useState<Record<string, FleetSample>>({})
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT)
  const [showPrefs, setShowPrefs] = useState(false)
  const [, tick] = useState(0)

  useEffect(() => {
    setPrefs(loadPrefs())
    void window.electronAPI?.fleet.get().then(setFleet)
    const off = window.electronAPI?.fleet.onSample(s => setFleet(f => ({ ...f, [s.serverId]: s })))
    const t = setInterval(() => tick(n => n + 1), 10_000)
    return () => { off?.(); clearInterval(t) }
  }, [])

  const set = (patch: Partial<Prefs>) => setPrefs(p => { const n = { ...p, ...patch }; try { localStorage.setItem('infra-dashboard', JSON.stringify(n)) } catch {}; return n })

  const online = servers.filter(s => states[s.id]?.status === 'online').length
  const problems = servers.filter(s => (alerting[s.id]?.length ?? 0) > 0).length
  const groups = useMemo(() => [...new Set(servers.map(s => s.group))].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b))), [servers])
  const order = (list: ServerPublic[]) => {
    const key = (s: ServerPublic) => prefs.sort === 'cpu' ? fleet[s.id]?.cpu : prefs.sort === 'mem' ? fleet[s.id]?.memPct : prefs.sort === 'disk' ? fleet[s.id]?.diskPct : undefined
    return [...list].sort((a, b) => prefs.sort === 'name' ? a.name.localeCompare(b.name) : (key(b) ?? -1) - (key(a) ?? -1))
  }
  const cols = [prefs.cpu, prefs.mem, prefs.disk].filter(Boolean).length

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1200px] p-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Your servers</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {servers.length === 0 ? 'Nothing here yet.' : `${servers.length} server${servers.length === 1 ? '' : 's'}, ${online} connected`}
              {problems > 0 && <span className="text-[var(--term-yellow)]"> · {problems} with an alert</span>}
            </p>
          </div>
          <div className="flex gap-2">
            {servers.length > 0 && <button className={`btn ${showPrefs ? 'border-primary/50 text-primary' : ''}`} onClick={() => setShowPrefs(v => !v)}><SlidersHorizontal className="h-3.5 w-3.5" />Customize</button>}
            <button className="btn btn-primary" onClick={onAdd}><Plus className="h-3.5 w-3.5" />Add a server</button>
          </div>
        </div>

        {showPrefs && (
          <div className="panel mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 p-3 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Show</span>
            {(['cpu', 'mem', 'disk'] as const).map(k => (
              <label key={k} className="flex items-center gap-1.5"><input type="checkbox" checked={prefs[k]} onChange={e => set({ [k]: e.target.checked })} />{k === 'cpu' ? 'CPU' : k === 'mem' ? 'Memory' : 'Disk'}</label>
            ))}
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={prefs.compact} onChange={e => set({ compact: e.target.checked })} />Compact cards</label>
            <span className="flex items-center gap-2"><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sort by</span>
              <select className="field h-7 w-auto text-xs" value={prefs.sort} onChange={e => set({ sort: e.target.value as Sort })}>
                <option value="name">Name</option><option value="cpu">Busiest CPU</option><option value="mem">Most memory used</option><option value="disk">Fullest disk</option>
              </select>
            </span>
          </div>
        )}

        {servers.length === 0 && (
          <div className="panel mt-6 flex flex-col items-center px-6 py-14 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15 text-primary"><Server className="h-6 w-6" /></div>
            <h2 className="font-semibold">Connect your first server</h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Add a server with its address and a password or key. You get a terminal, files, Docker, logs and live figures, with nothing to install on the server.
            </p>
            <button className="btn btn-primary mt-4" onClick={onAdd}><Plus className="h-3.5 w-3.5" />Add a server</button>
          </div>
        )}

        {groups.map(g => (
          <section key={g || '_'} className="mt-6">
            {(g || groups.length > 1) && <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{g || 'Other'}</h2>}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {order(servers.filter(s => s.group === g)).map(s => {
                const st = states[s.id]?.status ?? 'offline'
                const f = fleet[s.id]
                const alerts = alerting[s.id] ?? []
                const down = alerts.includes('down')
                return (
                  <div key={s.id} onClick={() => onOpen(s)} className={`panel group cursor-pointer transition-colors hover:border-primary/50 ${prefs.compact ? 'p-3' : 'p-4'} ${alerts.length ? 'border-[var(--term-yellow)]/40' : ''}`}>
                    <div className="flex items-center gap-2">
                      <StatusDot status={down ? 'error' : st} />
                      <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                      {alerts.length > 0 && <span title={`Alert: ${alerts.join(', ')}`} className="text-[var(--term-yellow)]"><AlertTriangle className="h-4 w-4" /></span>}
                      <button title="New terminal" onClick={e => { e.stopPropagation(); onTerminal(s) }} className="btn btn-ghost h-7 w-7 p-0 opacity-0 transition-opacity group-hover:opacity-100"><TerminalSquare className="h-4 w-4" /></button>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{s.user}@{s.host}{s.port !== 22 ? `:${s.port}` : ''}{!prefs.compact && s.note ? ` · ${s.note}` : ''}</p>
                    {cols > 0 && (f && (f.cpu !== undefined || f.memPct !== undefined || f.diskPct !== undefined) ? (
                      <div className={`mt-3 grid gap-3 ${cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                        {prefs.cpu && <Gauge label="CPU" value={f.cpu} />}
                        {prefs.mem && <Gauge label="Memory" value={f.memPct} />}
                        {prefs.disk && <Gauge label="Disk" value={f.diskPct} />}
                      </div>
                    ) : <p className="mt-3 text-xs text-muted-foreground/70">{s.watch ? (f && !f.reachable ? 'Not reachable' : 'Waiting for the first check…') : STATUS_LABEL[st] + ' · not watched'}</p>)}
                    {!prefs.compact && f && <p className="mt-2 text-[11px] text-muted-foreground/60">Checked {ago(f.t)}</p>}
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
