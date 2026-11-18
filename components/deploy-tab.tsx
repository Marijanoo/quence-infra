'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, CircleDashed, Loader2, Play, Plus, Rocket, Save, Square, Trash2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/dialog'
import { OutputView } from '@/components/output-view'
import { api, errText } from '@/lib/api'
import type { DeploymentDef, DeploymentRun, RunStatus } from '@/electron/types'

const EXAMPLES: { label: string; workdir: string; script: string }[] = [
  { label: 'Git pull and restart a service', workdir: '/srv/app', script: 'set -e\ngit pull --ff-only\nnpm ci --omit=dev\nsudo systemctl restart app\nsystemctl is-active app' },
  { label: 'Update a Docker Compose stack', workdir: '/srv/stack', script: 'set -e\ndocker compose pull\ndocker compose up -d --remove-orphans\ndocker image prune -f' },
  { label: 'Back up a folder', workdir: '', script: 'set -e\ntar czf /var/backups/app-$(date +%F).tar.gz /srv/app\nls -lh /var/backups | tail -n 5' },
]

const ICON: Record<RunStatus, React.ReactNode> = {
  running: <Loader2 className="h-4 w-4 animate-spin text-primary" />,
  success: <CheckCircle2 className="h-4 w-4 text-primary" />,
  failed: <XCircle className="h-4 w-4 text-destructive" />,
  cancelled: <CircleDashed className="h-4 w-4 text-muted-foreground" />,
  interrupted: <CircleDashed className="h-4 w-4 text-[var(--term-yellow)]" />,
}

const duration = (r: DeploymentRun) => {
  const s = Math.max(0, Math.round(((r.finishedAt ?? Date.now()) - r.startedAt) / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}
const stamp = (ms: number) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

type Draft = { id?: string; name: string; workdir: string; script: string }
const EMPTY: Draft = { name: '', workdir: '', script: '' }

export function DeployTab({ serverId }: { serverId: string }) {
  const [defs, setDefs] = useState<DeploymentDef[]>([])
  const [runs, setRuns] = useState<DeploymentRun[]>([])
  const [selected, setSelected] = useState<string | 'new'>('new')
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [watching, setWatching] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [, tick] = useState(0)

  const load = useCallback(async () => {
    const l = await api().deploy.list(serverId)
    setDefs(l.defs); setRuns(l.runs)
    return l
  }, [serverId])

  useEffect(() => { void load().then(l => { if (l.defs[0]) { setSelected(l.defs[0].id); setDraft(l.defs[0]) } }) }, [load])
  useEffect(() => api().deploy.onChanged(e => { if (e.serverId === serverId) void load() }), [serverId, load])
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 1000); return () => clearInterval(t) }, [])

  const def = defs.find(d => d.id === selected)
  const dirty = selected === 'new' ? !!(draft.name || draft.script) : !def || def.name !== draft.name || def.workdir !== draft.workdir || def.script !== draft.script
  const myRuns = useMemo(() => runs.filter(r => r.deploymentId === selected), [runs, selected])
  const running = myRuns.find(r => r.status === 'running')
  const lastOf = (id: string) => runs.find(r => r.deploymentId === id)

  const pick = (id: string | 'new') => {
    setSelected(id)
    const d = defs.find(x => x.id === id)
    setDraft(d ? { ...d } : EMPTY)
    setWatching(null)
  }

  const save = async (): Promise<DeploymentDef | null> => {
    try {
      const d = await api().deploy.save({ ...draft, serverId })
      await load(); setSelected(d.id); setDraft({ ...d })
      return d
    } catch (e) { toast.error(errText(e)); return null }
  }

  const run = async () => {
    const d = dirty ? await save() : def
    if (!d) return
    try { const r = await api().deploy.run(d.id); setWatching(r.id); await load() } catch (e) { toast.error(errText(e)) }
  }

  const shownRun = watching ?? myRuns[0]?.id ?? null
  const shownStatus = runs.find(r => r.id === shownRun)?.status

  return (
    <div className="flex h-full">
      <div className="flex w-64 shrink-0 flex-col border-r border-border bg-card/30">
        <div className="flex items-center gap-1 px-3 pt-3">
          <span className="flex-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Deployments</span>
          <button className="btn btn-ghost h-6 w-6 p-0" title="New deployment" onClick={() => pick('new')}><Plus className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
          {defs.map(d => {
            const last = lastOf(d.id)
            return (
              <button key={d.id} onClick={() => pick(d.id)} className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${selected === d.id ? 'bg-primary/15' : 'hover:bg-secondary'}`}>
                {last ? ICON[last.status] : <CircleDashed className="h-4 w-4 text-muted-foreground/50" />}
                <span className="min-w-0 flex-1"><span className="block truncate">{d.name}</span><span className="block truncate text-[11px] text-muted-foreground">{last ? `${stamp(last.startedAt)} · ${duration(last)}` : 'never run'}</span></span>
              </button>
            )
          })}
          {defs.length === 0 && <p className="px-2 py-4 text-center text-xs text-muted-foreground">No deployments yet. Write a script on the right and run it on this server.</p>}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="shrink-0 space-y-3 border-b border-border p-4">
          <div className="flex items-end gap-3">
            <div className="flex-1"><label className="label">Name</label><input className="field" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Release to production" /></div>
            <div className="flex-1"><label className="label">Run in folder (optional)</label><input className="field font-mono text-xs" value={draft.workdir} onChange={e => setDraft({ ...draft, workdir: e.target.value })} placeholder="/srv/app" spellCheck={false} /></div>
            {selected === 'new' && (
              <select className="field w-auto" value="" onChange={e => { const x = EXAMPLES[Number(e.target.value)]; if (x) setDraft({ ...draft, name: draft.name || x.label, workdir: x.workdir, script: x.script }) }}>
                <option value="" disabled>Start from an example…</option>
                {EXAMPLES.map((x, i) => <option key={x.label} value={i}>{x.label}</option>)}
              </select>
            )}
          </div>
          <div>
            <label className="label">Script (runs with sh on the server; it stops at the first error if you start with <code className="rounded bg-secondary px-1">set -e</code>)</label>
            <textarea className="field selectable h-32 font-mono text-xs leading-5" value={draft.script} onChange={e => setDraft({ ...draft, script: e.target.value })} spellCheck={false} placeholder={'git pull\nsystemctl restart app'} />
          </div>
          <div className="flex items-center gap-2">
            {running
              ? <button className="btn btn-danger" onClick={() => api().deploy.cancel(running.id)}><Square className="h-3.5 w-3.5" />Cancel the run</button>
              : <button className="btn btn-primary" onClick={() => void run()} disabled={!draft.script.trim() || !draft.name.trim()}><Play className="h-3.5 w-3.5" />{dirty && selected !== 'new' ? 'Save and run' : 'Run'}</button>}
            <button className="btn" onClick={() => void save()} disabled={!dirty}><Save className="h-3.5 w-3.5" />Save</button>
            {def && <button className="btn btn-ghost text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}><Trash2 className="h-3.5 w-3.5" />Delete</button>}
            <span className="flex-1" />
            {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1">
            {shownRun
              ? <OutputView key={`${shownRun}-${shownStatus}`} serverId={serverId} attach={shownRun} />
              : <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground"><Rocket className="h-6 w-6 opacity-50" />The output of a run shows here.</div>}
          </div>
          <div className="w-64 shrink-0 overflow-y-auto border-l border-border bg-card/30">
            <h2 className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">History</h2>
            <div className="space-y-0.5 p-2">
              {myRuns.map(r => (
                <button key={r.id} onClick={() => setWatching(r.id)} className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${shownRun === r.id ? 'bg-primary/15' : 'hover:bg-secondary'}`}>
                  {ICON[r.status]}
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm">{stamp(r.startedAt)}</span><span className="block text-muted-foreground">{r.status === 'failed' && r.code !== null ? `failed (exit ${r.code})` : r.status} · {duration(r)}</span></span>
                </button>
              ))}
              {myRuns.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">No runs yet.</p>}
            </div>
          </div>
        </div>
      </div>

      {confirmDelete && def && <ConfirmDialog title="Delete deployment" message={<>Delete <b className="text-foreground">{def.name}</b> and its run history?</>} onClose={() => setConfirmDelete(false)}
        onConfirm={() => void api().deploy.remove(def.id).then(() => load()).then(l => { setSelected(l.defs[0]?.id ?? 'new'); setDraft(l.defs[0] ?? EMPTY); setWatching(null) })} />}
    </div>
  )
}
