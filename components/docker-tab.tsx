'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Boxes, ChevronDown, Database, Globe, Layers, MoreHorizontal, Pause, Play, RefreshCw, RotateCw, Search, Square, TerminalSquare, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog, ContextMenu, Dialog, PromptDialog, type MenuItem } from '@/components/dialog'
import { OutputView } from '@/components/output-view'
import { api, errText } from '@/lib/api'
import type { ContainerAction, DockerContainer, DockerSnapshot, DockerStat, StreamRequest } from '@/electron/types'

type Section = 'containers' | 'compose' | 'images' | 'volumes' | 'networks'

const STATE_TONE: Record<string, string> = {
  running: 'bg-primary/20 text-primary',
  paused: 'bg-[var(--term-yellow)]/20 text-[var(--term-yellow)]',
  restarting: 'bg-[var(--term-yellow)]/20 text-[var(--term-yellow)]',
  exited: 'bg-secondary text-muted-foreground',
  created: 'bg-secondary text-muted-foreground',
  dead: 'bg-destructive/20 text-destructive',
}

const SECTIONS: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: 'containers', label: 'Containers', icon: <Box className="h-3.5 w-3.5" /> },
  { id: 'compose', label: 'Compose', icon: <Layers className="h-3.5 w-3.5" /> },
  { id: 'images', label: 'Images', icon: <Boxes className="h-3.5 w-3.5" /> },
  { id: 'volumes', label: 'Volumes', icon: <Database className="h-3.5 w-3.5" /> },
  { id: 'networks', label: 'Networks', icon: <Globe className="h-3.5 w-3.5" /> },
]

type Panel =
  | { kind: 'logs'; container: DockerContainer }
  | { kind: 'inspect'; target: string; text: string }
  | { kind: 'stream'; title: string; request: StreamRequest }
  | { kind: 'pull' }
  | { kind: 'confirm'; title: string; message: React.ReactNode; label: string; run: () => Promise<void> }
  | null

export function DockerTab({ serverId, onShell }: { serverId: string; onShell: (container: string) => void }) {
  const [snap, setSnap] = useState<DockerSnapshot | null>(null)
  const [stats, setStats] = useState<Record<string, DockerStat>>({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [section, setSection] = useState<Section>('containers')
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [panel, setPanel] = useState<Panel>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const alive = useRef(true)

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try { const s = await api().docker.snapshot(serverId); if (alive.current) { setSnap(s); setError('') } }
    catch (e) { if (alive.current) setError(errText(e)) }
    if (alive.current) setLoading(false)
  }, [serverId])

  useEffect(() => {
    alive.current = true
    void load()
    const t = setInterval(() => void load(true), 8000)
    return () => { alive.current = false; clearInterval(t) }
  }, [load])

  useEffect(() => {
    if (!snap || section !== 'containers') return
    let stop = false
    const poll = async () => {
      try { const s = await api().docker.stats(serverId); if (!stop) setStats(Object.fromEntries(s.map(x => [x.id, x]))) } catch { /* shown by the snapshot */ }
    }
    void poll()
    const t = setInterval(() => void poll(), 6000)
    return () => { stop = true; clearInterval(t) }
    // the stats follow the tab, not each snapshot
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, serverId, !!snap])

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    try { await fn(); await load(true) } catch (e) { toast.error(errText(e)) }
    setBusy(null)
  }

  const act = (c: DockerContainer, action: ContainerAction) => run(`${action}-${c.id}`, () => api().docker.container(serverId, c.id, action))

  const q = query.trim().toLowerCase()
  const containers = useMemo(() => (snap?.containers ?? []).filter(c =>
    (showAll || c.state === 'running') && (!q || c.name.toLowerCase().includes(q) || c.image.toLowerCase().includes(q) || c.project.toLowerCase().includes(q))), [snap, showAll, q])

  const projects = useMemo(() => {
    const m = new Map<string, DockerContainer[]>()
    for (const c of snap?.containers ?? []) if (c.project) m.set(c.project, [...(m.get(c.project) ?? []), c])
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [snap])

  const containerMenu = (e: React.MouseEvent, c: DockerContainer) => {
    e.preventDefault(); e.stopPropagation()
    const running = c.state === 'running'
    setMenu({
      x: e.clientX, y: e.clientY, items: [
        { label: 'Logs', onClick: () => setPanel({ kind: 'logs', container: c }) },
        { label: 'Open a shell', onClick: () => onShell(c.id), disabled: !running },
        { label: 'Inspect', onClick: () => void api().docker.inspect(serverId, c.id).then(text => setPanel({ kind: 'inspect', target: c.name, text })).catch(err => toast.error(errText(err))) },
        { label: 'Copy ID', onClick: () => void navigator.clipboard.writeText(c.id) },
        { label: '', onClick: () => {}, separator: true },
        running ? { label: 'Pause', onClick: () => void act(c, 'pause') } : { label: 'Start', onClick: () => void act(c, 'start') },
        ...(c.state === 'paused' ? [{ label: 'Unpause', onClick: () => void act(c, 'unpause') }] : []),
        { label: 'Restart', onClick: () => void act(c, 'restart') },
        { label: 'Stop', onClick: () => void act(c, 'stop'), disabled: !running },
        { label: 'Kill', onClick: () => void act(c, 'kill'), disabled: !running, danger: true },
        { label: '', onClick: () => {}, separator: true },
        { label: 'Remove…', danger: true, onClick: () => setPanel({ kind: 'confirm', title: 'Remove container', label: 'Remove', message: <>Remove <b className="text-foreground">{c.name}</b>? It is stopped first. Data in volumes is kept.</>, run: () => act(c, 'remove') }) },
      ],
    })
  }

  const composeRun = (project: string, c: DockerContainer, action: 'up' | 'down' | 'restart' | 'stop' | 'pull' | 'logs') =>
    setPanel({ kind: 'stream', title: `${project}: ${action === 'up' ? 'up -d' : action}`, request: { kind: 'compose', action, project, workdir: c.workdir, configFiles: c.configFiles } })

  const th = 'px-3 py-2 font-medium'
  const head = 'sticky top-0 bg-background text-left text-[11px] uppercase tracking-wide text-muted-foreground'

  if (error && !snap) {
    return (
      <div className="p-6">
        <div className="mx-auto max-w-xl rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <p className="font-medium text-destructive">Docker isn’t available</p>
          <p className="mt-1 text-muted-foreground">{error}</p>
          <button className="btn mt-3" onClick={() => void load()}><RefreshCw className="h-3.5 w-3.5" />Try again</button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card/40 px-3 py-2">
        <div className="inline-flex rounded-md border border-border bg-input p-0.5">
          {SECTIONS.map(s => (
            <button key={s.id} onClick={() => setSection(s.id)} className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${section === s.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              {s.icon}{s.label}
              {snap && <span className="opacity-60">{s.id === 'containers' ? snap.containers.length : s.id === 'compose' ? projects.length : s.id === 'images' ? snap.images.length : s.id === 'volumes' ? snap.volumes.length : snap.networks.length}</span>}
            </button>
          ))}
        </div>
        {(section === 'containers' || section === 'images') && (
          <div className="relative w-56">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
            <input className="field pl-8" placeholder="Filter" value={query} onChange={e => setQuery(e.target.value)} />
          </div>
        )}
        {section === 'containers' && (
          <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground"><input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />Show stopped</label>
        )}
        <span className="flex-1" />
        {snap && <span className="whitespace-nowrap text-xs text-muted-foreground">Docker {snap.version}{snap.sudo ? ' (via sudo)' : ''}</span>}
        {section === 'images' && <>
          <button className="btn" onClick={() => setPanel({ kind: 'pull' })}>Pull an image</button>
          <button className="btn" onClick={() => setPanel({ kind: 'confirm', title: 'Remove unused images', label: 'Remove', message: 'Remove all dangling images (those without a name that no container uses)?', run: () => run('prune', () => api().docker.pruneImages(serverId)) })}>Prune</button>
        </>}
        <button className="btn" onClick={() => void load()}><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!snap && <p className="py-10 text-center text-sm text-muted-foreground">Reading Docker…</p>}

        {snap && section === 'containers' && (
          <table className="w-full text-sm">
            <thead className={head}><tr><th className={`${th} w-[24%]`}>Name</th><th className={`${th} w-[16%]`}>State</th><th className={`${th} w-[20%]`}>Image</th><th className={`${th} text-right`}>CPU</th><th className={`${th} text-right`}>Memory</th><th className={th}>Ports</th><th className={`${th} text-right`}>Actions</th></tr></thead>
            <tbody>
              {containers.map(c => {
                const st = stats[c.id] ?? stats[c.id.slice(0, 12)]
                const running = c.state === 'running'
                return (
                  <tr key={c.id} className="border-t border-border/50 hover:bg-secondary/40" onContextMenu={e => containerMenu(e, c)} onDoubleClick={() => setPanel({ kind: 'logs', container: c })}>
                    <td className="max-w-0 px-3 py-1.5"><div className="truncate font-medium">{c.name}</div>{c.project && <div className="truncate text-[11px] text-muted-foreground">{c.project}</div>}</td>
                    <td className="px-3 py-1.5"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATE_TONE[c.state] ?? STATE_TONE.exited}`}>{c.state}</span><div className="mt-0.5 text-[11px] text-muted-foreground">{c.status}</div></td>
                    <td className="max-w-0 truncate px-3 py-1.5 font-mono text-xs text-muted-foreground" title={c.image}>{c.image}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{running && st ? `${st.cpu.toFixed(1)}%` : ''}</td>
                    <td className="px-3 py-1.5 text-right text-xs tabular-nums">{running && st ? st.mem.split(' / ')[0] : ''}</td>
                    <td className="max-w-[16rem] truncate px-3 py-1.5 font-mono text-[11px] text-muted-foreground" title={c.ports}>{c.ports}</td>
                    <td className="whitespace-nowrap px-3 py-1 text-right">
                      {running
                        ? <button className="btn btn-ghost h-7 w-7 p-0" title="Stop" disabled={busy !== null} onClick={() => void act(c, 'stop')}><Square className="h-3.5 w-3.5" /></button>
                        : <button className="btn btn-ghost h-7 w-7 p-0" title="Start" disabled={busy !== null} onClick={() => void act(c, 'start')}><Play className="h-3.5 w-3.5" /></button>}
                      <button className="btn btn-ghost h-7 w-7 p-0" title="Restart" disabled={busy !== null} onClick={() => void act(c, 'restart')}><RotateCw className="h-3.5 w-3.5" /></button>
                      <button className="btn btn-ghost h-7 w-7 p-0" title="Open a shell" disabled={!running} onClick={() => onShell(c.id)}><TerminalSquare className="h-3.5 w-3.5" /></button>
                      <button className="btn btn-ghost h-7 w-7 p-0" title="More" onClick={e => containerMenu(e, c)}><MoreHorizontal className="h-4 w-4" /></button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {snap && section === 'containers' && containers.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">{snap.containers.length ? 'No container matches.' : 'No containers on this server.'}</p>}

        {snap && section === 'compose' && (
          <div className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-2">
            {projects.map(([name, list]) => {
              const up = list.filter(c => c.state === 'running').length
              const first = list[0]
              return (
                <div key={name} className="panel p-4">
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-primary" />
                    <span className="flex-1 truncate font-semibold">{name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${up === list.length ? STATE_TONE.running : up ? STATE_TONE.paused : STATE_TONE.exited}`}>{up}/{list.length} running</span>
                  </div>
                  <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground" title={first.workdir}>{first.workdir || 'no folder known'}</p>
                  <div className="mt-2 flex flex-wrap gap-1">{list.map(c => <span key={c.id} className="rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">{c.name}</span>)}</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button className="btn" onClick={() => composeRun(name, first, 'up')}><Play className="h-3.5 w-3.5" />Up</button>
                    <button className="btn" onClick={() => composeRun(name, first, 'restart')}><RotateCw className="h-3.5 w-3.5" />Restart</button>
                    <button className="btn" onClick={() => composeRun(name, first, 'stop')}><Square className="h-3.5 w-3.5" />Stop</button>
                    <button className="btn" onClick={() => composeRun(name, first, 'pull')}><ChevronDown className="h-3.5 w-3.5" />Pull</button>
                    <button className="btn" onClick={() => composeRun(name, first, 'logs')}>Logs</button>
                    <button className="btn btn-ghost text-destructive hover:text-destructive" onClick={() => setPanel({ kind: 'confirm', title: 'Take the stack down', label: 'Down', message: <>Stop and remove the containers and networks of <b className="text-foreground">{name}</b>? Volumes are kept.</>, run: async () => { setTimeout(() => composeRun(name, first, 'down'), 0) } })}><Pause className="h-3.5 w-3.5" />Down</button>
                  </div>
                </div>
              )
            })}
            {projects.length === 0 && <p className="col-span-full py-10 text-center text-sm text-muted-foreground">No Docker Compose stacks are running or created on this server.</p>}
          </div>
        )}

        {snap && section === 'images' && (
          <table className="w-full text-sm">
            <thead className={head}><tr><th className={th}>Repository</th><th className={th}>Tag</th><th className={th}>ID</th><th className={`${th} text-right`}>Size</th><th className={th}>Created</th><th className={th}>Used</th><th className={`${th} text-right`}>Actions</th></tr></thead>
            <tbody>
              {snap.images.filter(i => !q || `${i.repo}:${i.tag}`.toLowerCase().includes(q)).map(i => (
                <tr key={i.id + i.repo + i.tag} className="border-t border-border/50 hover:bg-secondary/40">
                  <td className="max-w-0 truncate px-3 py-1.5 font-medium">{i.repo}</td>
                  <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{i.tag}</td>
                  <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{i.id}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{i.size}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{i.created}</td>
                  <td className="px-3 py-1.5">{i.inUse ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATE_TONE.running}`}>in use</span> : <span className="text-xs text-muted-foreground">unused</span>}</td>
                  <td className="px-3 py-1 text-right"><button className="btn btn-ghost h-7 w-7 p-0 text-destructive hover:text-destructive" title="Remove" onClick={() => setPanel({ kind: 'confirm', title: 'Remove image', label: 'Remove', message: <>Remove <b className="text-foreground">{i.repo}:{i.tag}</b>?</>, run: () => run('rmi', () => api().docker.removeImage(serverId, i.tag === '<none>' ? i.id : `${i.repo}:${i.tag}`)) })}><Trash2 className="h-3.5 w-3.5" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {snap && section === 'volumes' && (
          <table className="w-full text-sm">
            <thead className={head}><tr><th className={th}>Name</th><th className={th}>Driver</th><th className={th}>Mount point</th><th className={`${th} text-right`}>Actions</th></tr></thead>
            <tbody>
              {snap.volumes.map(v => (
                <tr key={v.name} className="border-t border-border/50 hover:bg-secondary/40">
                  <td className="max-w-0 truncate px-3 py-1.5 font-mono text-xs" title={v.name}>{v.name}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{v.driver}</td>
                  <td className="max-w-0 truncate px-3 py-1.5 font-mono text-[11px] text-muted-foreground" title={v.mountpoint}>{v.mountpoint}</td>
                  <td className="px-3 py-1 text-right"><button className="btn btn-ghost h-7 w-7 p-0 text-destructive hover:text-destructive" title="Remove" onClick={() => setPanel({ kind: 'confirm', title: 'Remove volume', label: 'Remove', message: <>Remove the volume <b className="text-foreground">{v.name}</b>? Its data is lost.</>, run: () => run('vol', () => api().docker.removeVolume(serverId, v.name)) })}><Trash2 className="h-3.5 w-3.5" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {snap && section === 'networks' && (
          <table className="w-full text-sm">
            <thead className={head}><tr><th className={th}>Name</th><th className={th}>Driver</th><th className={th}>Scope</th><th className={th}>ID</th><th className={`${th} text-right`}>Actions</th></tr></thead>
            <tbody>
              {snap.networks.map(n => (
                <tr key={n.id} className="border-t border-border/50 hover:bg-secondary/40">
                  <td className="px-3 py-1.5 font-medium">{n.name}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{n.driver}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{n.scope}</td>
                  <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{n.id}</td>
                  <td className="px-3 py-1 text-right">{['bridge', 'host', 'none'].includes(n.name) ? null : <button className="btn btn-ghost h-7 w-7 p-0 text-destructive hover:text-destructive" title="Remove" onClick={() => setPanel({ kind: 'confirm', title: 'Remove network', label: 'Remove', message: <>Remove the network <b className="text-foreground">{n.name}</b>?</>, run: () => run('net', () => api().docker.removeNetwork(serverId, n.name)) })}><Trash2 className="h-3.5 w-3.5" /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {panel?.kind === 'logs' && (
        <Dialog title={`Logs · ${panel.container.name}`} onClose={() => setPanel(null)} width="max-w-6xl">
          <div className="h-[70vh]"><OutputView serverId={serverId} request={{ kind: 'docker-logs', container: panel.container.id, tail: 300 }} /></div>
        </Dialog>
      )}
      {panel?.kind === 'stream' && (
        <Dialog title={panel.title} onClose={() => { setPanel(null); void load(true) }} width="max-w-5xl">
          <div className="h-[60vh]"><OutputView serverId={serverId} request={panel.request} onEnd={() => void load(true)} /></div>
        </Dialog>
      )}
      {panel?.kind === 'inspect' && (
        <Dialog title={`Inspect · ${panel.target}`} onClose={() => setPanel(null)} width="max-w-4xl">
          <pre className="selectable max-h-[70vh] overflow-auto bg-[var(--term-bg)] p-3 font-mono text-xs leading-5">{panel.text}</pre>
        </Dialog>
      )}
      {panel?.kind === 'pull' && (
        <PromptDialog title="Pull an image" label="Image (for example nginx:latest)" confirmLabel="Pull" onClose={() => setPanel(null)}
          onSubmit={image => { setTimeout(() => setPanel({ kind: 'stream', title: `Pull ${image}`, request: { kind: 'docker-pull', image } }), 0) }} />
      )}
      {panel?.kind === 'confirm' && <ConfirmDialog title={panel.title} message={panel.message} confirmLabel={panel.label} onClose={() => setPanel(null)} onConfirm={() => void panel.run()} />}
    </div>
  )
}
