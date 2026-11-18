'use client'

import { Plus, Server, TerminalSquare } from 'lucide-react'
import { StatusDot, STATUS_LABEL } from '@/components/status-dot'
import type { ConnState, ServerPublic } from '@/electron/types'

export function Home({ servers, states, onOpen, onTerminal, onAdd }: {
  servers: ServerPublic[]
  states: Record<string, ConnState>
  onOpen: (s: ServerPublic) => void
  onTerminal: (s: ServerPublic) => void
  onAdd: () => void
}) {
  const online = servers.filter(s => states[s.id]?.status === 'online').length
  const groups = [...new Set(servers.map(s => s.group))].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1100px] p-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Your servers</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {servers.length === 0 ? 'Nothing here yet.' : `${servers.length} server${servers.length === 1 ? '' : 's'}, ${online} connected.`}
            </p>
          </div>
          <button className="btn btn-primary" onClick={onAdd}><Plus className="h-3.5 w-3.5" />Add a server</button>
        </div>

        {servers.length === 0 && (
          <div className="panel mt-6 flex flex-col items-center px-6 py-14 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15 text-primary"><Server className="h-6 w-6" /></div>
            <h2 className="font-semibold">Connect your first server</h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Add a server with its address and a password or key. You get a terminal, and live CPU, memory, disk and network figures, nothing to install on the server.
            </p>
            <button className="btn btn-primary mt-4" onClick={onAdd}><Plus className="h-3.5 w-3.5" />Add a server</button>
          </div>
        )}

        {groups.map(g => (
          <section key={g || '_'} className="mt-6">
            {(g || groups.length > 1) && <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{g || 'Other'}</h2>}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {servers.filter(s => s.group === g).map(s => {
                const st = states[s.id]?.status ?? 'offline'
                return (
                  <div key={s.id} onClick={() => onOpen(s)} className="panel group cursor-pointer p-4 transition-colors hover:border-primary/50">
                    <div className="flex items-center gap-2">
                      <StatusDot status={st} />
                      <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                      <button title="New terminal" onClick={e => { e.stopPropagation(); onTerminal(s) }}
                        className="btn btn-ghost h-7 w-7 p-0 opacity-0 transition-opacity group-hover:opacity-100"><TerminalSquare className="h-4 w-4" /></button>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{s.user}@{s.host}{s.port !== 22 ? `:${s.port}` : ''}</p>
                    <p className="mt-2 truncate text-xs text-muted-foreground/70">{s.note || STATUS_LABEL[st]}</p>
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
