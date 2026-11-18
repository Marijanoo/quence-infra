'use client'

import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { RefreshCw } from 'lucide-react'
import { api, errText } from '@/lib/api'

const css = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback

function theme() {
  return {
    background: css('--term-bg', '#0f0f0f'),
    foreground: css('--term-fg', '#e4e4e7'),
    cursor: css('--term-cursor', '#4FD6E8'),
    selectionBackground: '#4FD6E840',
    red: css('--term-red', '#f87171'),
    green: css('--term-green', '#85F08F'),
    yellow: css('--term-yellow', '#facc15'),
    blue: css('--term-blue', '#60a5fa'),
    magenta: css('--term-magenta', '#c084fc'),
    cyan: css('--term-cyan', '#22d3ee'),
  }
}

type Phase = 'connecting' | 'live' | 'ended' | 'failed'

// One interactive shell on a server. The tab stays mounted while it is in the background, so the
// scrollback and the running session survive switching tabs.
export function TerminalTab({ sessionId, serverId, container, active }: { sessionId: string; serverId: string; container?: string; active: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)
  const [phase, setPhase] = useState<Phase>('connecting')
  const [error, setError] = useState('')
  const phaseRef = useRef<Phase>('connecting')
  const setP = (p: Phase) => { phaseRef.current = p; setPhase(p) }

  const open = async () => {
    const t = term.current
    if (!t) return
    setP('connecting'); setError('')
    try {
      fit.current?.fit()
      await (container ? api().term.openContainer(sessionId, serverId, container, t.cols, t.rows) : api().term.open(sessionId, serverId, t.cols, t.rows))
      setP('live')
      t.focus()
    } catch (e) {
      setError(errText(e))
      setP('failed')
    }
  }

  useEffect(() => {
    const el = host.current!
    const t = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 10000,
      allowProposedApi: true,
      theme: theme(),
    })
    const f = new FitAddon()
    t.loadAddon(f)
    t.loadAddon(new WebLinksAddon((_e, uri) => window.open(uri, '_blank')))
    t.open(el)
    term.current = t
    fit.current = f

    t.onData(d => { if (phaseRef.current === 'live') api().term.write(sessionId, d) })
    t.onResize(({ cols, rows }) => { if (phaseRef.current === 'live') api().term.resize(sessionId, cols, rows) })
    // Ctrl+C copies while text is selected (and still interrupts otherwise); Ctrl+Shift+C/V always copy and paste.
    t.attachCustomKeyEventHandler(e => {
      if (e.type !== 'keydown') return true
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'c' && (e.shiftKey || t.hasSelection())) {
        void navigator.clipboard.writeText(t.getSelection()); t.clearSelection(); return false
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'v') {
        void navigator.clipboard.readText().then(s => t.paste(s)); return false
      }
      return true
    })
    const onContext = (e: MouseEvent) => {
      e.preventDefault()
      if (t.hasSelection()) { void navigator.clipboard.writeText(t.getSelection()); t.clearSelection() }
      else void navigator.clipboard.readText().then(s => t.paste(s))
    }
    el.addEventListener('contextmenu', onContext)

    const offData = api().term.onData(e => { if (e.sessionId === sessionId) t.write(e.data) })
    const offClose = api().term.onClose(e => {
      if (e.sessionId !== sessionId) return
      setP('ended')
      t.write('\r\n\x1b[2m[session ended]\x1b[0m\r\n')
    })

    const ro = new ResizeObserver(() => {
      if (el.offsetWidth > 0 && el.offsetHeight > 0) { try { f.fit() } catch {} }
    })
    ro.observe(el)

    void open()
    return () => {
      ro.disconnect(); offData(); offClose()
      el.removeEventListener('contextmenu', onContext)
      api().term.close(sessionId)
      t.dispose()
      term.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, serverId, container])

  useEffect(() => {
    if (!active) return
    const id = requestAnimationFrame(() => { try { fit.current?.fit() } catch {} term.current?.focus() })
    return () => cancelAnimationFrame(id)
  }, [active])

  return (
    <div className="term-host">
      <div ref={host} className="term-surface" />
      {phase !== 'live' && (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 border-t border-border bg-card/95 px-4 py-2 text-sm">
          {phase === 'connecting' && <span className="flex items-center gap-2 text-muted-foreground"><RefreshCw className="h-3.5 w-3.5 animate-spin" />Connecting…</span>}
          {phase === 'failed' && <span className="min-w-0 truncate text-destructive" title={error}>{error}</span>}
          {phase === 'ended' && <span className="text-muted-foreground">The session ended.</span>}
          {phase !== 'connecting' && (
            <button className="btn shrink-0" onClick={() => { term.current?.reset(); void open() }}><RefreshCw className="h-3.5 w-3.5" />{phase === 'ended' ? 'Start a new session' : 'Try again'}</button>
          )}
        </div>
      )}
    </div>
  )
}
