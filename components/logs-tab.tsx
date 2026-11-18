'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowUp, Box, FileText, Folder, ScrollText, Search } from 'lucide-react'
import { OutputView } from '@/components/output-view'
import { api, errText } from '@/lib/api'
import type { DockerContainer, FileEntry, ServiceRow, StreamRequest } from '@/electron/types'

type Kind = 'journal' | 'files' | 'docker'

const KINDS: { id: Kind; label: string; icon: React.ReactNode }[] = [
  { id: 'journal', label: 'System', icon: <ScrollText className="h-3.5 w-3.5" /> },
  { id: 'files', label: 'Files', icon: <FileText className="h-3.5 w-3.5" /> },
  { id: 'docker', label: 'Docker', icon: <Box className="h-3.5 w-3.5" /> },
]

const parent = (p: string) => (p === '/' ? '/' : p.replace(/\/[^/]*\/?$/, '') || '/')
const join = (d: string, n: string) => (d.endsWith('/') ? d : d + '/') + n

// Follow system logs (journalctl), log files (tail -F) and container logs, live.
export function LogsTab({ serverId }: { serverId: string }) {
  const [kind, setKind] = useState<Kind>('journal')
  const [query, setQuery] = useState('')
  const [lines, setLines] = useState(300)
  const [error, setError] = useState('')

  const [unit, setUnit] = useState('')
  const [priority, setPriority] = useState('')
  const [services, setServices] = useState<ServiceRow[] | null>(null)

  const [dir, setDir] = useState('/var/log')
  const [dirInput, setDirInput] = useState('/var/log')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [file, setFile] = useState('')

  const [containers, setContainers] = useState<DockerContainer[] | null>(null)
  const [container, setContainer] = useState('')

  useEffect(() => {
    setError('')
    if (kind === 'journal' && !services) api().system.services(serverId).then(setServices).catch(() => setServices([]))
    if (kind === 'docker' && !containers) api().docker.snapshot(serverId).then(s => setContainers(s.containers)).catch(e => { setError(errText(e)); setContainers([]) })
  }, [kind, serverId, services, containers])

  useEffect(() => {
    if (kind !== 'files') return
    api().files.list(serverId, dir).then(r => { setEntries(r.entries); setDirInput(r.path); setError('') }).catch(e => setError(errText(e)))
  }, [kind, serverId, dir])

  const request: StreamRequest | null = kind === 'journal' ? { kind: 'journal', unit, priority, lines }
    : kind === 'files' ? (file ? { kind: 'file', path: file, lines } : null)
    : container ? { kind: 'docker-logs', container, tail: lines } : null

  const q = query.trim().toLowerCase()
  const svc = useMemo(() => (services ?? []).filter(s => s.sub === 'running' && (!q || s.name.toLowerCase().includes(q))), [services, q])
  const ctn = useMemo(() => (containers ?? []).filter(c => !q || c.name.toLowerCase().includes(q)), [containers, q])
  const ents = useMemo(() => entries.filter(e => !q || e.name.toLowerCase().includes(q)), [entries, q])

  const item = (active: boolean) => `flex w-full items-center gap-2 truncate rounded-md px-2 py-1.5 text-left text-sm transition-colors ${active ? 'bg-primary/15 text-foreground' : 'text-foreground/90 hover:bg-secondary'}`

  return (
    <div className="flex h-full">
      <div className="flex w-72 shrink-0 flex-col border-r border-border bg-card/30">
        <div className="space-y-2 border-b border-border p-3">
          <div className="inline-flex w-full rounded-md border border-border bg-input p-0.5">
            {KINDS.map(k => (
              <button key={k.id} onClick={() => { setKind(k.id); setQuery('') }} className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors ${kind === k.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{k.icon}{k.label}</button>
            ))}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
            <input className="field h-7 pl-8 text-xs" placeholder="Filter the list" value={query} onChange={e => setQuery(e.target.value)} />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">Start with</label>
            <select className="field h-7 w-auto flex-1 text-xs" value={lines} onChange={e => setLines(Number(e.target.value))}>
              {[50, 100, 300, 1000, 3000].map(n => <option key={n} value={n}>last {n} lines</option>)}
            </select>
          </div>
          {kind === 'journal' && (
            <select className="field h-7 text-xs" value={priority} onChange={e => setPriority(e.target.value)}>
              <option value="">All levels</option>
              <option value="err">Errors and worse</option>
              <option value="warning">Warnings and worse</option>
              <option value="info">Info and worse</option>
            </select>
          )}
          {kind === 'files' && (
            <form onSubmit={e => { e.preventDefault(); setDir(dirInput) }}>
              <input className="field h-7 font-mono text-xs" value={dirInput} onChange={e => setDirInput(e.target.value)} spellCheck={false} />
            </form>
          )}
        </div>

        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
          {error && <p className="rounded-md bg-destructive/15 px-2 py-1.5 text-xs text-destructive">{error}</p>}
          {kind === 'journal' && <>
            <button className={item(unit === '')} onClick={() => setUnit('')}><ScrollText className="h-3.5 w-3.5 shrink-0" />Whole system</button>
            {services === null && <p className="px-2 py-1 text-xs text-muted-foreground">Loading services…</p>}
            {svc.map(s => <button key={s.name} className={item(unit === s.name)} onClick={() => setUnit(s.name)} title={s.description}><span className="truncate">{s.name}</span></button>)}
          </>}
          {kind === 'files' && <>
            {dir !== '/' && <button className={item(false)} onClick={() => setDir(parent(dir))}><ArrowUp className="h-3.5 w-3.5 shrink-0" />..</button>}
            {ents.map(e => e.dir
              ? <button key={e.name} className={item(false)} onClick={() => setDir(join(dir, e.name))}><Folder className="h-3.5 w-3.5 shrink-0 text-primary" /><span className="truncate">{e.name}</span></button>
              : <button key={e.name} className={item(file === join(dir, e.name))} onClick={() => setFile(join(dir, e.name))}><FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /><span className="flex-1 truncate">{e.name}</span></button>)}
          </>}
          {kind === 'docker' && <>
            {containers === null && <p className="px-2 py-1 text-xs text-muted-foreground">Loading containers…</p>}
            {ctn.map(c => (
              <button key={c.id} className={item(container === c.id)} onClick={() => setContainer(c.id)}>
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${c.state === 'running' ? 'bg-primary' : 'bg-muted-foreground/40'}`} /><span className="truncate">{c.name}</span>
              </button>
            ))}
          </>}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        {request
          ? <OutputView key={JSON.stringify(request)} serverId={serverId} request={request} />
          : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{kind === 'files' ? 'Pick a log file on the left.' : 'Pick a container on the left.'}</div>}
      </div>
    </div>
  )
}
