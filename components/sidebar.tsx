'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, FolderPlus, Plus, Search, Server, TerminalSquare } from 'lucide-react'
import { StatusDot } from '@/components/status-dot'
import type { ConnState, ServerPublic } from '@/electron/types'
import type { MenuItem } from '@/components/dialog'

export interface SidebarProps {
  servers: ServerPublic[]
  groups: string[]
  states: Record<string, ConnState>
  activeServerId: string | null
  onOpen: (s: ServerPublic) => void
  onTerminal: (s: ServerPublic) => void
  onAddServer: (group?: string) => void
  onAddGroup: () => void
  onServerMenu: (s: ServerPublic, x: number, y: number) => void
  onGroupMenu: (group: string, x: number, y: number) => void
}

export function Sidebar(p: SidebarProps) {
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('infra-collapsed') ?? '[]')) } catch { return new Set() }
  })

  const toggle = (g: string) => setCollapsed(prev => {
    const next = new Set(prev)
    if (next.has(g)) next.delete(g); else next.add(g)
    try { localStorage.setItem('infra-collapsed', JSON.stringify([...next])) } catch {}
    return next
  })

  const q = query.trim().toLowerCase()
  const match = (s: ServerPublic) => !q || [s.name, s.host, s.group, s.note, s.user].some(v => v.toLowerCase().includes(q))

  const sections = useMemo(() => {
    const names = [...p.groups]
    const out = names.map(g => ({ group: g, items: p.servers.filter(s => s.group === g && match(s)) }))
    const loose = p.servers.filter(s => !s.group && match(s))
    return { out: out.filter(s => !q || s.items.length > 0), loose }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.servers, p.groups, q])

  const row = (s: ServerPublic) => {
    const st = p.states[s.id]?.status ?? 'offline'
    const active = p.activeServerId === s.id
    return (
      <div key={s.id}
        onClick={() => p.onOpen(s)}
        onDoubleClick={() => p.onTerminal(s)}
        onContextMenu={e => { e.preventDefault(); p.onServerMenu(s, e.clientX, e.clientY) }}
        className={`group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${active ? 'bg-primary/15 text-foreground' : 'text-foreground/90 hover:bg-secondary'}`}>
        <StatusDot status={st} />
        <div className="min-w-0 flex-1">
          <div className="truncate leading-tight">{s.name}</div>
          <div className="truncate text-[11px] leading-tight text-muted-foreground">{s.user}@{s.host}</div>
        </div>
        <button title="New terminal" onClick={e => { e.stopPropagation(); p.onTerminal(s) }} onDoubleClick={e => e.stopPropagation()}
          className="hidden h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background/60 hover:text-primary group-hover:flex">
          <TerminalSquare className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  const empty = p.servers.length === 0 && p.groups.length === 0

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card/60">
      <div className="flex items-center gap-1 px-3 pt-3">
        <span className="flex-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Servers</span>
        <button title="New group" onClick={p.onAddGroup} className="btn btn-ghost h-6 w-6 p-0"><FolderPlus className="h-3.5 w-3.5" /></button>
        <button title="Add a server" onClick={() => p.onAddServer()} className="btn btn-ghost h-6 w-6 p-0"><Plus className="h-4 w-4" /></button>
      </div>
      <div className="relative px-3 py-2">
        <Search className="pointer-events-none absolute left-5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search servers" className="field h-7 pl-7 text-xs" />
      </div>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {empty && (
          <div className="mx-1 mt-4 rounded-lg border border-dashed border-border p-4 text-center">
            <Server className="mx-auto mb-2 h-6 w-6 text-muted-foreground/60" />
            <p className="text-sm font-medium">No servers yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Add one to open a terminal and watch how it is doing.</p>
            <button className="btn btn-primary mt-3" onClick={() => p.onAddServer()}><Plus className="h-3.5 w-3.5" />Add a server</button>
          </div>
        )}

        {sections.loose.map(row)}

        {sections.out.map(({ group, items }) => {
          const open = q ? true : !collapsed.has(group)
          return (
            <div key={group} className="pt-1">
              <div onClick={() => toggle(group)} onContextMenu={e => { e.preventDefault(); p.onGroupMenu(group, e.clientX, e.clientY) }}
                className="group flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
                {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                <span className="flex-1 truncate">{group}</span>
                <span className="text-[10px] font-normal tabular-nums">{items.length}</span>
                <button title="Add a server to this group" onClick={e => { e.stopPropagation(); p.onAddServer(group) }}
                  className="hidden h-5 w-5 items-center justify-center rounded hover:bg-secondary group-hover:flex"><Plus className="h-3 w-3" /></button>
              </div>
              {open && (items.length > 0
                ? <div className="space-y-0.5">{items.map(row)}</div>
                : <p className="px-3 py-1 text-xs text-muted-foreground/50">Empty</p>)}
            </div>
          )
        })}

        {!empty && q && sections.loose.length === 0 && sections.out.length === 0 && (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">No server matches “{query}”.</p>
        )}
      </div>
    </aside>
  )
}

export type { MenuItem }
