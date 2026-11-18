'use client'

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

export function Dialog({ title, onClose, children, width = 'max-w-md' }: { title: string; onClose: () => void; children: React.ReactNode; width?: string }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-6 pt-[8vh]" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`w-full ${width} rounded-xl border border-border bg-popover shadow-2xl`} role="dialog" aria-label={title}>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button onClick={onClose} className="btn btn-ghost h-6 w-6 p-0" aria-label="Close"><X className="h-3.5 w-3.5" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function ConfirmDialog({ title, message, confirmLabel = 'Delete', danger = true, onConfirm, onClose }: {
  title: string; message: React.ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onClose: () => void
}) {
  return (
    <Dialog title={title} onClose={onClose}>
      <div className="px-4 py-4 text-sm text-muted-foreground">{message}</div>
      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} autoFocus onClick={() => { onConfirm(); onClose() }}>{confirmLabel}</button>
      </div>
    </Dialog>
  )
}

export function PromptDialog({ title, label, initial = '', confirmLabel = 'Save', onSubmit, onClose }: {
  title: string; label: string; initial?: string; confirmLabel?: string; onSubmit: (value: string) => void | Promise<void>; onClose: () => void
}) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])
  const submit = async () => { if (!value.trim()) return; await onSubmit(value.trim()); onClose() }
  return (
    <Dialog title={title} onClose={onClose}>
      <form className="px-4 py-4" onSubmit={e => { e.preventDefault(); void submit() }}>
        <label className="label">{label}</label>
        <input ref={ref} className="field" value={value} onChange={e => setValue(e.target.value)} />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!value.trim()}>{confirmLabel}</button>
        </div>
      </form>
    </Dialog>
  )
}

export interface MenuItem { label: string; onClick: () => void; danger?: boolean; disabled?: boolean; separator?: boolean }

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  useEffect(() => {
    const el = ref.current
    if (el) setPos({ x: Math.min(x, window.innerWidth - el.offsetWidth - 8), y: Math.min(y, window.innerHeight - el.offsetHeight - 8) })
    const close = () => onClose()
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('blur', close); window.removeEventListener('keydown', key) }
  }, [x, y, onClose])
  return (
    <div ref={ref} className="fixed z-[60] min-w-44 rounded-lg border border-border bg-popover p-1 shadow-xl" style={{ left: pos.x, top: pos.y }} onMouseDown={e => e.stopPropagation()} onContextMenu={e => e.preventDefault()}>
      {items.map((it, i) => it.separator
        ? <div key={i} className="my-1 h-px bg-border" />
        : (
          <button key={i} disabled={it.disabled} onClick={() => { onClose(); it.onClick() }}
            className={`flex w-full items-center rounded px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-secondary disabled:opacity-40 ${it.danger ? 'text-destructive hover:text-destructive' : ''}`}>
            {it.label}
          </button>
        ))}
    </div>
  )
}
