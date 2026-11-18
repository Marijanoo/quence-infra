'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Boxes, Cog, Cpu, FolderOpen, HardDrive, ListTree, MemoryStick, Rocket, ScrollText, PlugZap, RefreshCw, TerminalSquare, Unplug } from 'lucide-react'
import { AreaChart, Bar } from '@/components/charts'
import { STATUS_LABEL, StatusDot } from '@/components/status-dot'
import { api } from '@/lib/api'
import { bytes, levelColor, pct, rate, uptime } from '@/lib/format'
import type { ConnState, MonitorInfo, MonitorSample, ServerPublic } from '@/electron/types'

const HISTORY = 150

function Stat({ icon, title, value, sub, children }: { icon: React.ReactNode; title: string; value: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="panel flex flex-col p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{icon}{title}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums leading-none">{value}</div>
      <div className="mt-1 min-h-4 text-xs text-muted-foreground tabular-nums">{sub}</div>
      <div className="mt-3">{children}</div>
    </div>
  )
}

export function Overview({ server, state, onTerminal, onTool }: { server: ServerPublic; state: ConnState; onTerminal: () => void; onTool: (k: 'files' | 'processes' | 'services' | 'docker' | 'logs' | 'deploy') => void }) {
  const [info, setInfo] = useState<MonitorInfo | null>(null)
  const [history, setHistory] = useState<MonitorSample[]>([])
  const [error, setError] = useState<string | null>(null)
  const id = server.id
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    let alive = true
    setInfo(null); setHistory([]); setError(null)
    const offSample = api().monitor.onSample(e => {
      if (e.id !== id) return
      setInfo(e.info)
      setError(null)
      setHistory(h => [...h, e.sample].slice(-HISTORY))
    })
    const offError = api().monitor.onError(e => { if (e.id === id) setError(e.message) })
    void api().monitor.start(id).then(s => {
      if (!alive) return
      if (s.info) setInfo(s.info)
      if (s.history.length) setHistory(s.history)
    })
    return () => { alive = false; offSample(); offError(); api().monitor.stop(id) }
  }, [id])

  const reconnect = async () => {
    setError(null)
    try { await api().conn.connect(id) } catch { /* the state carries the reason */ }
    api().monitor.retry(id)
  }

  const last = history.at(-1)
  const failed = state.status === 'error' || (error && state.status !== 'online')
  const reason = state.status === 'error' ? state.error : error

  const rootDisk = last?.disks.find(d => d.mount === '/') ?? last?.disks[0]
  const memPct = last && last.memTotal ? (last.memUsed / last.memTotal) * 100 : 0
  const diskPct = rootDisk ? (rootDisk.used / rootDisk.size) * 100 : 0
  const cpuSeries = history.map(h => h.cpu)
  const memSeries = history.map(h => (h.memTotal ? (h.memUsed / h.memTotal) * 100 : 0))
  const netMax = Math.max(1024, ...history.map(h => Math.max(h.rx, h.tx)))

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <StatusDot status={state.status} />
              <h1 className="truncate text-lg font-semibold">{server.name}</h1>
              <span className="text-xs text-muted-foreground">{STATUS_LABEL[state.status]}</span>
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {server.user}@{server.host}{server.port !== 22 ? `:${server.port}` : ''}
              {info && <> · {info.os} · kernel {info.kernel}</>}
              {last && <> · up {uptime(last.uptime)}</>}
            </p>
            {server.note && <p className="mt-0.5 truncate text-xs text-muted-foreground/70">{server.note}</p>}
          </div>
          <div className="flex gap-2">
            <button className="btn btn-primary" onClick={onTerminal}><TerminalSquare className="h-3.5 w-3.5" />Terminal</button>
            <button className="btn" onClick={() => onTool('files')}><FolderOpen className="h-3.5 w-3.5" />Files</button>
            <button className="btn" onClick={() => onTool('processes')}><ListTree className="h-3.5 w-3.5" />Processes</button>
            <button className="btn" onClick={() => onTool('services')}><Cog className="h-3.5 w-3.5" />Services</button>
            <button className="btn" onClick={() => onTool('docker')}><Boxes className="h-3.5 w-3.5" />Docker</button>
            <button className="btn" onClick={() => onTool('logs')}><ScrollText className="h-3.5 w-3.5" />Logs</button>
            <button className="btn" onClick={() => onTool('deploy')}><Rocket className="h-3.5 w-3.5" />Deploy</button>
            {state.status === 'online'
              ? <button className="btn" onClick={() => void api().conn.disconnect(id)}><Unplug className="h-3.5 w-3.5" />Disconnect</button>
              : <button className="btn" onClick={() => void reconnect()} disabled={state.status === 'connecting'}><PlugZap className="h-3.5 w-3.5" />Connect</button>}
          </div>
        </div>

        {failed && (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-destructive">{state.status === 'error' ? 'Could not connect' : 'Monitoring stopped'}</p>
              <p className="mt-0.5 break-words text-muted-foreground">{reason}</p>
            </div>
            {state.hostKeyChanged && (
              <button className="btn shrink-0" onClick={async () => { await api().conn.forgetHost(id); void reconnect() }}>Forget host key and retry</button>
            )}
            <button className="btn shrink-0" onClick={() => void reconnect()}><RefreshCw className="h-3.5 w-3.5" />Retry</button>
          </div>
        )}

        {!failed && !last && (
          <div className="panel flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" />{state.status === 'online' ? 'Reading the first figures…' : 'Connecting…'}
          </div>
        )}

        {last && (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Stat icon={<Cpu className="h-3.5 w-3.5" />} title="CPU" value={pct(last.cpu, 1)}
                sub={<>load {last.load.map(l => l.toFixed(2)).join(' · ')}{info ? ` · ${info.cores} cores` : ''}</>}>
                <AreaChart series={[{ data: cpuSeries, color: levelColor(last.cpu) }]} max={100} length={HISTORY} />
              </Stat>
              <Stat icon={<MemoryStick className="h-3.5 w-3.5" />} title="Memory" value={pct(memPct, 1)}
                sub={<>{bytes(last.memUsed)} of {bytes(last.memTotal)}{last.swapTotal > 0 ? ` · swap ${bytes(last.swapUsed)}` : ''}</>}>
                <AreaChart series={[{ data: memSeries, color: levelColor(memPct) }]} max={100} length={HISTORY} />
              </Stat>
              <Stat icon={<ArrowDown className="h-3.5 w-3.5" />} title="Network"
                value={<span className="flex items-baseline gap-3"><span><ArrowDown className="mr-0.5 inline h-4 w-4 text-primary" />{rate(last.rx)}</span></span>}
                sub={<><ArrowUp className="mr-0.5 inline h-3 w-3 text-[var(--term-blue)]" />{rate(last.tx)} sent</>}>
                <AreaChart series={[{ data: history.map(h => h.rx), color: 'var(--primary)' }, { data: history.map(h => h.tx), color: 'var(--term-blue)' }]} max={netMax} length={HISTORY} />
              </Stat>
              <Stat icon={<HardDrive className="h-3.5 w-3.5" />} title={rootDisk ? `Disk ${rootDisk.mount}` : 'Disk'} value={rootDisk ? pct(diskPct, 0) : '–'}
                sub={rootDisk ? <>{bytes(rootDisk.used)} of {bytes(rootDisk.size)} · {bytes(rootDisk.size - rootDisk.used)} free</> : 'No disk found'}>
                {rootDisk && <Bar value={diskPct} color={levelColor(diskPct)} className="mt-7 h-2.5" />}
              </Stat>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <div className="space-y-4 xl:col-span-1">
                <div className="panel p-4">
                  <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">CPU cores</h2>
                  <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2 xl:grid-cols-1">
                    {last.cores.map((c, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs tabular-nums">
                        <span className="w-9 text-muted-foreground">#{i}</span>
                        <Bar value={c} color={levelColor(c)} className="flex-1" />
                        <span className="w-10 text-right">{pct(c, 0)}</span>
                      </div>
                    ))}
                  </div>
                  {info?.cpuModel && <p className="mt-3 truncate text-[11px] text-muted-foreground/70" title={info.cpuModel}>{info.cpuModel}</p>}
                </div>
                <div className="panel p-4">
                  <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Disks</h2>
                  <div className="space-y-3">
                    {last.disks.map(d => {
                      const p = (d.used / d.size) * 100
                      return (
                        <div key={d.mount} className="text-xs">
                          <div className="mb-1 flex justify-between gap-2">
                            <span className="truncate font-medium" title={`${d.mount} (${d.fs})`}>{d.mount}</span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">{bytes(d.used)} / {bytes(d.size)} · {pct(p)}</span>
                          </div>
                          <Bar value={p} color={levelColor(p)} />
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              <div className="panel overflow-hidden xl:col-span-2">
                <h2 className="border-b border-border px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Busiest processes</h2>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2 font-medium">Process</th>
                      <th className="px-2 py-2 font-medium">User</th>
                      <th className="px-2 py-2 text-right font-medium">PID</th>
                      <th className="px-2 py-2 text-right font-medium">CPU</th>
                      <th className="px-4 py-2 text-right font-medium">Memory</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {last.procs.map(pr => (
                      <tr key={pr.pid} className="border-t border-border/60">
                        <td className="max-w-0 truncate px-4 py-1.5 font-mono text-xs" title={pr.name}>{pr.name}</td>
                        <td className="px-2 py-1.5 text-xs text-muted-foreground">{pr.user}</td>
                        <td className="px-2 py-1.5 text-right text-xs text-muted-foreground">{pr.pid}</td>
                        <td className="px-2 py-1.5 text-right">{pr.cpu.toFixed(1)}%</td>
                        <td className="px-4 py-1.5 text-right">{pr.mem.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
