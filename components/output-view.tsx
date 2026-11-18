'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, Copy, Eraser, Pause, Play, Search, WrapText } from 'lucide-react'
import { toast } from 'sonner'
import { api, errText } from '@/lib/api'
import { generateId } from '@/lib/utils'
import type { StreamRequest } from '@/electron/types'

const MAX_LINES = 5000
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g

const lineTone = (l: string) =>
  /\b(error|err|fatal|panic|critical|crit|failed|exception)\b/i.test(l) ? 'text-[var(--term-red)]'
  : /\b(warn|warning)\b/i.test(l) ? 'text-[var(--term-yellow)]'
  : ''

// The live output of a command on a server: container logs, journalctl, a deployment script…
// Starts when mounted, stops when closed. Keeps the last few thousand lines.
export function OutputView({ serverId, request, onEnd, follow = true, emptyHint }: {
  serverId: string
  request: StreamRequest
  onEnd?: (code: number | null) => void
  follow?: boolean
  emptyHint?: string
}) {
  const [lines, setLines] = useState<string[]>([])
  const [running, setRunning] = useState(true)
  const [exit, setExit] = useState<{ code: number | null; error?: string } | null>(null)
  const [filter, setFilter] = useState('')
  const [wrap, setWrap] = useState(false)
  const [stick, setStick] = useState(true)
  const [paused, setPaused] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const partial = useRef('')
  const pausedRef = useRef(false)
  const held = useRef<string[]>([])
  const idRef = useRef('')
  const reqKey = JSON.stringify(request)
  const onEndRef = useRef(onEnd)
  onEndRef.current = onEnd

  const append = useCallback((chunk: string) => {
    const text = partial.current + chunk.replace(ANSI, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const parts = text.split('\n')
    partial.current = parts.pop() ?? ''
    if (!parts.length) return
    if (pausedRef.current) { held.current.push(...parts); return }
    setLines(prev => { const n = prev.length + parts.length > MAX_LINES ? [...prev, ...parts].slice(-MAX_LINES) : [...prev, ...parts]; return n })
  }, [])

  useEffect(() => {
    const id = generateId()
    idRef.current = id
    setLines([]); setExit(null); setRunning(true); partial.current = ''; held.current = []
    const offData = api().stream.onData(e => { if (e.streamId === id) append(e.data) })
    const offEnd = api().stream.onEnd(e => {
      if (e.streamId !== id) return
      if (partial.current) { const rest = partial.current; partial.current = ''; setLines(p => [...p, rest]) }
      setRunning(false); setExit({ code: e.code, error: e.error }); onEndRef.current?.(e.code)
    })
    api().stream.start(id, serverId, JSON.parse(reqKey)).catch(e => { setRunning(false); setExit({ code: null, error: errText(e) }) })
    return () => { offData(); offEnd(); api().stream.stop(id) }
  }, [serverId, reqKey, append])

  useEffect(() => { if (stick && follow && box.current) box.current.scrollTop = box.current.scrollHeight }, [lines, stick, follow])

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? lines.filter(l => l.toLowerCase().includes(q)) : lines
  }, [lines, filter])

  const togglePause = () => {
    const next = !paused
    setPaused(next); pausedRef.current = next
    if (!next && held.current.length) { const h = held.current; held.current = []; setLines(p => [...p, ...h].slice(-MAX_LINES)) }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-2">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <input className="field h-7 pl-8 text-xs" placeholder="Filter lines" value={filter} onChange={e => setFilter(e.target.value)} />
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">{filter ? `${shown.length} of ${lines.length}` : `${lines.length}`} lines</span>
        <span className="flex-1" />
        {running && <button className="btn h-7 px-2 text-xs" onClick={togglePause}>{paused ? <><Play className="h-3 w-3" />Resume</> : <><Pause className="h-3 w-3" />Pause</>}</button>}
        <button className={`btn h-7 px-2 text-xs ${wrap ? 'border-primary/50 text-primary' : ''}`} onClick={() => setWrap(w => !w)} title="Wrap long lines"><WrapText className="h-3 w-3" /></button>
        <button className={`btn h-7 px-2 text-xs ${stick ? 'border-primary/50 text-primary' : ''}`} onClick={() => setStick(s => !s)} title="Keep scrolled to the newest line"><ArrowDownToLine className="h-3 w-3" /></button>
        <button className="btn h-7 px-2 text-xs" title="Copy" onClick={() => { void navigator.clipboard.writeText(shown.join('\n')); toast.success('Copied') }}><Copy className="h-3 w-3" /></button>
        <button className="btn h-7 px-2 text-xs" title="Clear" onClick={() => { setLines([]); held.current = [] }}><Eraser className="h-3 w-3" /></button>
      </div>
      <div ref={box} className="selectable min-h-0 flex-1 overflow-auto bg-[var(--term-bg)] p-3 font-mono text-[12.5px] leading-[1.45]"
        onWheel={e => { if (e.deltaY < 0) setStick(false) }}>
        {shown.map((l, i) => <div key={i} className={`${wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'} ${lineTone(l)}`}>{l || ' '}</div>)}
        {lines.length === 0 && running && <div className="text-muted-foreground">{emptyHint ?? 'Waiting for output…'}</div>}
        {exit && (
          <div className={`mt-2 border-t border-border/60 pt-2 text-xs ${exit.error || (exit.code ?? 0) !== 0 ? 'text-[var(--term-red)]' : 'text-muted-foreground'}`}>
            {exit.error ? exit.error : exit.code === 0 || exit.code === null ? 'Finished.' : `Finished with exit code ${exit.code}.`}
          </div>
        )}
      </div>
    </div>
  )
}
