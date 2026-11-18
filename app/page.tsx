'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Home as HomeIcon, Activity, Boxes, Cog, FolderOpen, ListTree, TerminalSquare, X } from 'lucide-react'
import { toast } from 'sonner'
import { TitleBar } from '@/components/title-bar'
import { Sidebar } from '@/components/sidebar'
import { Home } from '@/components/home'
import { Overview } from '@/components/overview'
import { TerminalTab } from '@/components/terminal-tab'
import { FilesTab } from '@/components/files-tab'
import { ProcessesTab } from '@/components/processes-tab'
import { ServicesTab } from '@/components/services-tab'
import { DockerTab } from '@/components/docker-tab'
import { ServerDialog } from '@/components/server-dialog'
import { ConfirmDialog, ContextMenu, PromptDialog, type MenuItem } from '@/components/dialog'
import { api, errText } from '@/lib/api'
import { generateId } from '@/lib/utils'
import type { ConnState, Library, ServerPublic } from '@/electron/types'

const version = '0.3.0'

type Tool = 'overview' | 'files' | 'processes' | 'services' | 'docker'
type Tab = { id: string; kind: 'home' | 'terminal' | Tool; serverId?: string; container?: string }

const TOOL_LABEL: Record<Tool, string> = { overview: '', files: 'Files', processes: 'Processes', services: 'Services', docker: 'Docker' }

type Dialog =
  | { kind: 'server'; server?: ServerPublic; group?: string }
  | { kind: 'group'; rename?: string }
  | { kind: 'delete-server'; server: ServerPublic }
  | { kind: 'delete-group'; group: string }
  | null

export default function App() {
  const [lib, setLib] = useState<Library>({ servers: [], groups: [] })
  const [states, setStates] = useState<Record<string, ConnState>>({})
  const [tabs, setTabs] = useState<Tab[]>([{ id: 'home', kind: 'home' }])
  const [activeId, setActiveId] = useState('home')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)

  const byId = useMemo(() => new Map(lib.servers.map(s => [s.id, s])), [lib.servers])
  const refresh = useCallback(async () => setLib(await api().library.get()), [])

  useEffect(() => {
    if (!window.electronAPI) return
    void refresh()
    void api().conn.states().then(setStates)
    return api().conn.onState(e => setStates(s => ({ ...s, [e.id]: { status: e.status, error: e.error, hostKeyChanged: e.hostKeyChanged } })))
  }, [refresh])

  const activate = (id: string) => setActiveId(id)

  const openTool = useCallback((s: ServerPublic, kind: Tool) => {
    const id = `${kind}-${s.id}`
    setTabs(t => t.some(x => x.id === id) ? t : [...t, { id, kind, serverId: s.id }])
    setActiveId(id)
  }, [])
  const openOverview = useCallback((s: ServerPublic) => openTool(s, 'overview'), [openTool])

  const openTerminal = useCallback((s: ServerPublic, container?: string) => {
    const id = generateId()
    setTabs(t => [...t, { id, kind: 'terminal', serverId: s.id, container }])
    setActiveId(id)
  }, [])

  const closeTab = useCallback((id: string) => {
    setTabs(t => {
      const i = t.findIndex(x => x.id === id)
      if (i < 0 || t[i].kind === 'home') return t
      const next = t.filter(x => x.id !== id)
      setActiveId(cur => cur === id ? (next[Math.min(i, next.length - 1)]?.id ?? 'home') : cur)
      return next
    })
  }, [])

  // Tabs of a server that was removed go with it
  useEffect(() => {
    const gone = tabs.filter(t => t.serverId && !byId.has(t.serverId))
    if (gone.length && lib.servers.length >= 0) gone.forEach(t => closeTab(t.id))
  }, [byId, tabs, closeTab, lib.servers.length])

  const activeTab = tabs.find(t => t.id === activeId) ?? tabs[0]
  const activeServerId = activeTab.serverId ?? null

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 't' && !e.shiftKey && activeServerId) {
        const s = byId.get(activeServerId); if (s) { e.preventDefault(); openTerminal(s) }
      } else if (k === 'w' && activeTab.kind !== 'home') {
        e.preventDefault(); closeTab(activeTab.id)
      } else if (e.key === 'Tab') {
        e.preventDefault()
        const i = tabs.findIndex(t => t.id === activeId)
        setActiveId(tabs[(i + (e.shiftKey ? tabs.length - 1 : 1)) % tabs.length].id)
      }
    }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [activeServerId, activeTab, activeId, tabs, byId, openTerminal, closeTab])

  const fail = (e: unknown) => toast.error(errText(e))

  const serverMenu = (s: ServerPublic, x: number, y: number) => {
    const st = states[s.id]?.status ?? 'offline'
    const others = lib.groups.filter(g => g !== s.group)
    setMenu({
      x, y, items: [
        { label: 'Overview', onClick: () => openOverview(s) },
        { label: 'New terminal', onClick: () => openTerminal(s) },
        { label: 'Files', onClick: () => openTool(s, 'files') },
        { label: 'Processes', onClick: () => openTool(s, 'processes') },
        { label: 'Services', onClick: () => openTool(s, 'services') },
        { label: 'Docker', onClick: () => openTool(s, 'docker') },
        st === 'online' ? { label: 'Disconnect', onClick: () => void api().conn.disconnect(s.id) }
          : { label: 'Connect', onClick: () => void api().conn.connect(s.id).catch(() => { /* shown on the overview */ }), disabled: st === 'connecting' },
        { label: '', onClick: () => {}, separator: true },
        { label: 'Edit…', onClick: () => setDialog({ kind: 'server', server: s }) },
        { label: 'Duplicate', onClick: () => void api().library.duplicate(s.id).then(refresh).catch(fail) },
        ...others.map(g => ({ label: `Move to ${g}`, onClick: () => void api().library.move(s.id, g).then(refresh).catch(fail) })),
        ...(s.group ? [{ label: 'Remove from group', onClick: () => void api().library.move(s.id, '').then(refresh).catch(fail) }] : []),
        { label: '', onClick: () => {}, separator: true },
        { label: 'Forget host key', onClick: () => void api().conn.forgetHost(s.id).then(() => toast.success('Host key forgotten: the next connection trusts the key it sees')) },
        { label: 'Delete…', danger: true, onClick: () => setDialog({ kind: 'delete-server', server: s }) },
      ],
    })
  }

  const groupMenu = (group: string, x: number, y: number) => setMenu({
    x, y, items: [
      { label: 'Add a server here…', onClick: () => setDialog({ kind: 'server', group }) },
      { label: 'Rename…', onClick: () => setDialog({ kind: 'group', rename: group }) },
      { label: 'Delete group…', danger: true, onClick: () => setDialog({ kind: 'delete-group', group }) },
    ],
  })

  const online = Object.values(states).filter(s => s.status === 'online').length
  const terminalNo = (t: Tab) => {
    const same = tabs.filter(x => x.kind === 'terminal' && x.serverId === t.serverId)
    return same.length > 1 ? ` ${same.indexOf(t) + 1}` : ''
  }

  if (typeof window !== 'undefined' && !window.electronAPI) {
    return <div className="flex h-screen items-center justify-center p-8 text-center text-muted-foreground">QuenceInfra runs inside its desktop app.</div>
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          servers={lib.servers} groups={lib.groups} states={states} activeServerId={activeServerId}
          onOpen={openOverview} onTerminal={openTerminal}
          onAddServer={group => setDialog({ kind: 'server', group })}
          onAddGroup={() => setDialog({ kind: 'group' })}
          onServerMenu={serverMenu} onGroupMenu={groupMenu}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border bg-card/40 scrollbar-none">
            {tabs.map(t => {
              const s = t.serverId ? byId.get(t.serverId) : undefined
              const active = t.id === activeTab.id
              const label = t.kind === 'home' ? 'Home' : `${s?.name ?? '…'}${t.kind === 'terminal' ? terminalNo(t) : t.kind !== 'overview' ? ` · ${TOOL_LABEL[t.kind]}` : ''}${t.kind === 'terminal' && t.container ? ` · ${t.container.slice(0, 12)}` : ''}`
              return (
                <div key={t.id} onClick={() => activate(t.id)} onAuxClick={e => { if (e.button === 1) closeTab(t.id) }}
                  className={`group flex shrink-0 cursor-pointer items-center gap-2 border-r border-border px-3 text-sm transition-colors ${active ? 'bg-background text-foreground shadow-[inset_0_-2px_0_var(--primary)]' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'}`}>
                  {t.kind === 'home' ? <HomeIcon className="h-3.5 w-3.5" /> : t.kind === 'overview' ? <Activity className="h-3.5 w-3.5" /> : t.kind === 'files' ? <FolderOpen className="h-3.5 w-3.5" /> : t.kind === 'processes' ? <ListTree className="h-3.5 w-3.5" /> : t.kind === 'services' ? <Cog className="h-3.5 w-3.5" /> : t.kind === 'docker' ? <Boxes className="h-3.5 w-3.5" /> : <TerminalSquare className="h-3.5 w-3.5" />}
                  <span className="max-w-40 truncate">{label}</span>
                  {t.kind !== 'home' && (
                    <button onClick={e => { e.stopPropagation(); closeTab(t.id) }} aria-label="Close tab"
                      className="flex h-4 w-4 items-center justify-center rounded opacity-50 hover:bg-background/60 hover:opacity-100"><X className="h-3 w-3" /></button>
                  )}
                </div>
              )
            })}
          </div>

          <div className="relative min-h-0 flex-1 bg-background">
            {tabs.map(t => {
              const s = t.serverId ? byId.get(t.serverId) : undefined
              const active = t.id === activeTab.id
              // Terminals stay mounted in the background so their sessions keep running; the other
              // views are cheap to rebuild and only exist while shown.
              if (t.kind === 'terminal') {
                return s ? <div key={t.id} className="absolute inset-0" style={{ display: active ? 'block' : 'none' }}><TerminalTab sessionId={t.id} serverId={s.id} container={t.container} active={active} /></div> : null
              }
              // Files keep their place (and any running transfers) while in the background
              if (t.kind === 'docker') {
                return s ? <div key={t.id} className="absolute inset-0" style={{ display: active ? 'block' : 'none' }}><DockerTab serverId={s.id} onShell={c => openTerminal(s, c)} /></div> : null
              }
              if (t.kind === 'files') {
                return s ? <div key={t.id} className="absolute inset-0" style={{ display: active ? 'block' : 'none' }}><FilesTab serverId={s.id} /></div> : null
              }
              if (!active) return null
              if (t.kind === 'processes') return s ? <div key={t.id} className="absolute inset-0"><ProcessesTab serverId={s.id} /></div> : null
              if (t.kind === 'services') return s ? <div key={t.id} className="absolute inset-0"><ServicesTab serverId={s.id} /></div> : null
              if (t.kind === 'home') {
                return <div key={t.id} className="absolute inset-0"><Home servers={lib.servers} states={states} onOpen={openOverview} onTerminal={openTerminal} onAdd={() => setDialog({ kind: 'server' })} /></div>
              }
              return s ? <div key={t.id} className="absolute inset-0"><Overview server={s} state={states[s.id] ?? { status: 'offline' }} onTerminal={() => openTerminal(s)} onTool={k => openTool(s, k)} /></div> : null
            })}
          </div>
        </div>
      </div>

      <div className="flex h-7 shrink-0 items-center gap-3 overflow-hidden border-t border-border bg-card px-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-primary' : 'bg-muted-foreground/40'}`} />{online} connected</span>
        <span className="flex-1" />
        <span className="hidden sm:inline text-muted-foreground/50">Ctrl+T new terminal · Ctrl+W close tab</span>
        <span className="select-none text-muted-foreground/40">v{version}</span>
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}

      {dialog?.kind === 'server' && (
        <ServerDialog server={dialog.server} groups={lib.groups} defaultGroup={dialog.group}
          onSaved={(s, created) => { void refresh().then(() => { if (created) openOverview(s) }) }}
          onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'group' && (
        <PromptDialog title={dialog.rename ? 'Rename group' : 'New group'} label="Group name" initial={dialog.rename ?? ''} confirmLabel={dialog.rename ? 'Rename' : 'Create'}
          onSubmit={async name => { try { await (dialog.rename ? api().library.renameGroup(dialog.rename, name) : api().library.addGroup(name)); await refresh() } catch (e) { fail(e) } }}
          onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'delete-server' && (
        <ConfirmDialog title="Delete server" message={<>Remove <b className="text-foreground">{dialog.server.name}</b> from QuenceInfra? The server itself is not touched.</>}
          onConfirm={() => void api().library.remove(dialog.server.id).then(refresh).catch(fail)} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'delete-group' && (
        <ConfirmDialog title="Delete group" message={<>Delete the group <b className="text-foreground">{dialog.group}</b>? Its servers stay, without a group.</>}
          onConfirm={() => void api().library.removeGroup(dialog.group).then(refresh).catch(fail)} onClose={() => setDialog(null)} />
      )}
    </div>
  )
}
