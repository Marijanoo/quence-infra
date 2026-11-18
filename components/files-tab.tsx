'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Download, File as FileIcon, Folder, FolderPlus, Link2, RefreshCw, Trash2, Upload, X, Check } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog, ContextMenu, Dialog, PromptDialog, type MenuItem } from '@/components/dialog'
import { api, errText } from '@/lib/api'
import { bytes } from '@/lib/format'
import type { FileEntry, TransferProgress } from '@/electron/types'

const join = (dir: string, name: string) => (dir.endsWith('/') ? dir : dir + '/') + name
const parent = (p: string) => (p === '/' ? '/' : p.replace(/\/[^/]*\/?$/, '') || '/')

function modeString(mode: number, dir: boolean): string {
  const f = 'rwxrwxrwx'
  let s = dir ? 'd' : '-'
  for (let i = 0; i < 9; i++) s += mode & (1 << (8 - i)) ? f[i] : '-'
  return s
}

function when(sec: number): string {
  if (!sec) return ''
  const d = new Date(sec * 1000)
  const now = new Date()
  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleString(undefined, sameYear ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' } : { year: 'numeric', month: 'short', day: 'numeric' })
}

function Editor({ serverId, path, onClose }: { serverId: string; path: string; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null)
  const [orig, setOrig] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    api().files.read(serverId, path).then(r => { setText(r.content); setOrig(r.content) }).catch(e => setError(errText(e)))
  }, [serverId, path])
  const dirty = text !== null && text !== orig
  const save = useCallback(async () => {
    if (text === null) return
    setSaving(true)
    try { await api().files.write(serverId, path, text); setOrig(text); toast.success('Saved') } catch (e) { toast.error(errText(e)) }
    setSaving(false)
  }, [serverId, path, text])
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void save() } }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [save])
  const close = () => { if (!dirty || window.confirm('Close without saving your changes?')) onClose() }
  return (
    <Dialog title={path} onClose={close} width="max-w-4xl">
      {error ? <p className="px-4 py-6 text-sm text-destructive">{error}</p> : text === null ? <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p> : (
        <>
          <textarea className="selectable block h-[60vh] w-full resize-none border-0 bg-[var(--term-bg)] p-3 font-mono text-[13px] leading-5 outline-none" spellCheck={false}
            value={text} onChange={e => setText(e.target.value)} autoFocus />
          <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
            <span className="text-xs text-muted-foreground">{dirty ? 'Unsaved changes' : 'No changes'} · Ctrl+S saves</span>
            <div className="flex gap-2">
              <button className="btn" onClick={close}>Close</button>
              <button className="btn btn-primary" disabled={!dirty || saving} onClick={() => void save()}>Save</button>
            </div>
          </div>
        </>
      )}
    </Dialog>
  )
}

export function FilesTab({ serverId }: { serverId: string }) {
  const [path, setPath] = useState('')
  const [pathInput, setPathInput] = useState('')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [dialog, setDialog] = useState<{ kind: 'mkdir' } | { kind: 'rename'; entry: FileEntry } | { kind: 'delete'; entries: FileEntry[] } | { kind: 'edit'; path: string } | null>(null)
  const [transfers, setTransfers] = useState<TransferProgress[]>([])
  const [dropping, setDropping] = useState(false)
  const [uploadMenu, setUploadMenu] = useState(false)
  const pathRef = useRef('')

  const load = useCallback(async (dir: string) => {
    setLoading(true); setError('')
    try {
      const r = await api().files.list(serverId, dir)
      pathRef.current = r.path
      setPath(r.path); setPathInput(r.path); setEntries(r.entries); setSelected(new Set())
      try { localStorage.setItem(`infra-path-${serverId}`, r.path) } catch {}
    } catch (e) { setError(errText(e)); setPathInput(pathRef.current) }
    setLoading(false)
  }, [serverId])

  useEffect(() => {
    let start = ''
    try { start = localStorage.getItem(`infra-path-${serverId}`) ?? '' } catch {}
    void load(start || '.').then(() => {})
  }, [serverId, load])

  useEffect(() => api().files.onProgress(p => {
    if (p.serverId !== serverId) return
    setTransfers(list => {
      const i = list.findIndex(x => x.id === p.id)
      if (i < 0) return [...list, p]
      const next = [...list]; next[i] = p; return next
    })
    if (p.finished && p.kind === 'upload' && !p.error) void load(pathRef.current)
    if (p.finished && p.error) toast.error(`${p.name}: ${p.error}`)
  }), [serverId, load])

  const sel = useMemo(() => entries.filter(e => selected.has(e.name)), [entries, selected])

  const open = (e: FileEntry) => { if (e.dir) void load(join(path, e.name)); else setDialog({ kind: 'edit', path: join(path, e.name) }) }

  const click = (e: React.MouseEvent, f: FileEntry) => {
    setSelected(prev => {
      if (e.ctrlKey || e.metaKey) { const n = new Set(prev); if (n.has(f.name)) n.delete(f.name); else n.add(f.name); return n }
      return new Set([f.name])
    })
  }

  const download = async (items: FileEntry[]) => {
    if (!items.length) return
    try {
      const dest = await api().files.download(serverId, items.map(i => ({ path: join(path, i.name), dir: i.dir })))
      if (dest) toast.success(`Downloaded to ${dest}`)
    } catch (e) { toast.error(errText(e)) }
  }

  const upload = async (folder = false) => {
    setUploadMenu(false)
    try { await (folder ? api().files.uploadFolder(serverId, path) : api().files.upload(serverId, path)) } catch (e) { toast.error(errText(e)) }
  }

  const rowMenu = (e: React.MouseEvent, f: FileEntry) => {
    e.preventDefault()
    const items = selected.has(f.name) ? sel : [f]
    if (!selected.has(f.name)) setSelected(new Set([f.name]))
    setMenu({
      x: e.clientX, y: e.clientY, items: [
        { label: f.dir ? 'Open' : 'Edit', onClick: () => open(f), disabled: items.length > 1 },
        { label: items.length > 1 ? `Download ${items.length} items…` : 'Download…', onClick: () => void download(items) },
        { label: 'Rename…', onClick: () => setDialog({ kind: 'rename', entry: f }), disabled: items.length > 1 },
        { label: 'Copy path', onClick: () => void navigator.clipboard.writeText(join(path, f.name)), disabled: items.length > 1 },
        { label: '', onClick: () => {}, separator: true },
        { label: items.length > 1 ? `Delete ${items.length} items…` : 'Delete…', danger: true, onClick: () => setDialog({ kind: 'delete', entries: items }) },
      ],
    })
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDropping(false)
    const paths = [...e.dataTransfer.files].map(f => api().files.pathOf(f)).filter(Boolean)
    if (paths.length) void api().files.upload(serverId, path, paths).catch(err => toast.error(errText(err)))
  }

  const active = transfers.filter(t => !t.finished)
  const finished = transfers.filter(t => t.finished)

  return (
    <div className="relative flex h-full flex-col"
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropping(true) } }}
      onDragLeave={e => { if (e.currentTarget === e.target) setDropping(false) }}
      onDrop={onDrop}>
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border bg-card/40 px-3 py-2">
        <button className="btn btn-ghost h-8 w-8 p-0" title="Up one folder" onClick={() => void load(parent(path))} disabled={path === '/'}><ArrowUp className="h-4 w-4" /></button>
        <button className="btn btn-ghost h-8 w-8 p-0" title="Refresh" onClick={() => void load(path)}><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /></button>
        <form className="min-w-0 flex-1" onSubmit={e => { e.preventDefault(); void load(pathInput) }}>
          <input className="field font-mono text-xs" value={pathInput} onChange={e => setPathInput(e.target.value)} spellCheck={false} onFocus={e => e.currentTarget.select()} />
        </form>
        <div className="relative">
          <button className="btn" onClick={() => setUploadMenu(m => !m)}><Upload className="h-3.5 w-3.5" />Upload</button>
          {uploadMenu && (
            <div className="absolute right-0 top-9 z-20 w-40 rounded-lg border border-border bg-popover p-1 shadow-xl" onMouseLeave={() => setUploadMenu(false)}>
              <button className="w-full rounded px-2.5 py-1.5 text-left text-sm hover:bg-secondary" onClick={() => void upload(false)}>Files…</button>
              <button className="w-full rounded px-2.5 py-1.5 text-left text-sm hover:bg-secondary" onClick={() => void upload(true)}>Folder…</button>
            </div>
          )}
        </div>
        <button className="btn" onClick={() => void download(sel)} disabled={!sel.length}><Download className="h-3.5 w-3.5" />Download</button>
        <button className="btn" onClick={() => setDialog({ kind: 'mkdir' })}><FolderPlus className="h-3.5 w-3.5" />New folder</button>
        <button className="btn btn-ghost text-destructive hover:text-destructive" onClick={() => setDialog({ kind: 'delete', entries: sel })} disabled={!sel.length} title="Delete selected"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" onClick={e => { if (e.target === e.currentTarget) setSelected(new Set()) }}>
        {error ? (
          <div className="m-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"><p className="font-medium text-destructive">Could not open this folder</p><p className="mt-0.5 text-muted-foreground">{error}</p></div>
        ) : (
          <table className="w-full select-none text-sm">
            <thead className="sticky top-0 bg-background text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-4 py-2 font-medium">Name</th><th className="px-2 py-2 text-right font-medium">Size</th><th className="px-2 py-2 font-medium">Modified</th><th className="px-4 py-2 font-medium">Permissions</th></tr>
            </thead>
            <tbody>
              {path !== '/' && path !== '' && (
                <tr className="cursor-pointer border-t border-border/50 hover:bg-secondary/50" onDoubleClick={() => void load(parent(path))}>
                  <td className="px-4 py-1.5 text-muted-foreground" colSpan={4}>..</td>
                </tr>
              )}
              {entries.map(f => (
                <tr key={f.name} onClick={e => click(e, f)} onDoubleClick={() => open(f)} onContextMenu={e => rowMenu(e, f)}
                  className={`cursor-pointer border-t border-border/50 ${selected.has(f.name) ? 'bg-primary/15' : 'hover:bg-secondary/50'}`}>
                  <td className="max-w-0 px-4 py-1.5">
                    <span className="flex items-center gap-2">
                      {f.dir ? <Folder className="h-4 w-4 shrink-0 text-primary" /> : f.link ? <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" /> : <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />}
                      <span className="truncate">{f.name}</span>
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{f.dir ? '' : bytes(f.size)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">{when(f.mtime)}</td>
                  <td className="whitespace-nowrap px-4 py-1.5 font-mono text-xs text-muted-foreground">{modeString(f.mode, f.dir)}</td>
                </tr>
              ))}
              {!loading && entries.length === 0 && <tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">This folder is empty. Drop files here to upload them.</td></tr>}
            </tbody>
          </table>
        )}
      </div>

      {(active.length > 0 || finished.length > 0) && (
        <div className="max-h-40 shrink-0 space-y-1 overflow-y-auto border-t border-border bg-card/60 px-3 py-2 text-xs">
          {[...active, ...finished.slice(-3)].map(t => (
            <div key={t.id} className="flex items-center gap-2">
              {t.finished ? (t.error ? <X className="h-3.5 w-3.5 shrink-0 text-destructive" /> : <Check className="h-3.5 w-3.5 shrink-0 text-primary" />) : (t.kind === 'upload' ? <Upload className="h-3.5 w-3.5 shrink-0" /> : <Download className="h-3.5 w-3.5 shrink-0" />)}
              <span className="w-56 truncate">{t.name}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-background/60"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${t.finished ? 100 : t.total ? (t.done / t.total) * 100 : 0}%` }} /></div>
              <span className="w-28 text-right tabular-nums text-muted-foreground">{t.error ? 'Failed' : t.finished ? 'Done' : `${bytes(t.done)} / ${bytes(t.total)}`}</span>
              {t.finished && <button className="text-muted-foreground hover:text-foreground" onClick={() => setTransfers(l => l.filter(x => x.id !== t.id))}><X className="h-3 w-3" /></button>}
            </div>
          ))}
        </div>
      )}

      {dropping && <div className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary/10 text-lg font-medium text-primary">Drop to upload to {path}</div>}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {dialog?.kind === 'mkdir' && <PromptDialog title="New folder" label="Folder name" confirmLabel="Create" onClose={() => setDialog(null)}
        onSubmit={async name => { try { await api().files.mkdir(serverId, join(path, name)); await load(path) } catch (e) { toast.error(errText(e)) } }} />}
      {dialog?.kind === 'rename' && <PromptDialog title="Rename" label="New name" initial={dialog.entry.name} confirmLabel="Rename" onClose={() => setDialog(null)}
        onSubmit={async name => { try { await api().files.rename(serverId, join(path, dialog.entry.name), join(path, name)); await load(path) } catch (e) { toast.error(errText(e)) } }} />}
      {dialog?.kind === 'delete' && <ConfirmDialog title="Delete" onClose={() => setDialog(null)}
        message={<>Delete {dialog.entries.length === 1 ? <b className="text-foreground">{dialog.entries[0].name}</b> : `${dialog.entries.length} items`}{dialog.entries.some(e => e.dir) ? ' and everything inside' : ''}? This can’t be undone.</>}
        onConfirm={async () => { try { for (const e of dialog.entries) await api().files.remove(serverId, join(path, e.name), e.dir) } catch (e) { toast.error(errText(e)) } await load(path) }} />}
      {dialog?.kind === 'edit' && <Editor serverId={serverId} path={dialog.path} onClose={() => setDialog(null)} />}
    </div>
  )
}
