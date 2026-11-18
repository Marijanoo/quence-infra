import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import type { Streams, Tap } from './streams'
import { streamCommand } from './commands'
import type { DeploymentDef, DeploymentList, DeploymentRun, RunLog } from './types'

// Saved deployment scripts per server, and the history of running them: when, how it ended and
// the full output. The scripts run through the streams module, so the output can be watched live.

const KEEP_RUNS = 40
const MAX_LOG = 512 * 1024

interface Doc { defs: DeploymentDef[]; runs: DeploymentRun[] }

export class Deployments {
  private doc: Doc
  private live = new Map<string, { text: string; length: number }>()

  constructor(
    private dir: string,
    private streams: Streams,
    private changed: (serverId: string) => void,
  ) {
    fs.mkdirSync(path.join(dir, 'deploy-logs'), { recursive: true })
    try {
      const raw = JSON.parse(fs.readFileSync(this.file(), 'utf8'))
      this.doc = { defs: raw.defs ?? [], runs: raw.runs ?? [] }
    } catch { this.doc = { defs: [], runs: [] } }
    // Runs that were going when the app closed did not finish
    for (const r of this.doc.runs) if (r.status === 'running') { r.status = 'interrupted'; r.finishedAt = r.finishedAt ?? Date.now() }
    this.save()
  }

  private file() { return path.join(this.dir, 'deployments.json') }
  private logFile(runId: string) { return path.join(this.dir, 'deploy-logs', `${runId}.log`) }
  private save() {
    const tmp = this.file() + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(this.doc, null, 2), { mode: 0o600 })
    fs.renameSync(tmp, this.file())
  }

  list(serverId: string): DeploymentList {
    return {
      defs: this.doc.defs.filter(d => d.serverId === serverId),
      runs: this.doc.runs.filter(r => r.serverId === serverId).sort((a, b) => b.startedAt - a.startedAt),
    }
  }

  saveDef(input: Omit<DeploymentDef, 'id'> & { id?: string }): DeploymentDef {
    const name = input.name.trim()
    if (!name) throw new Error('Give the deployment a name')
    if (!input.script.trim()) throw new Error('The script is empty')
    const existing = input.id ? this.doc.defs.find(d => d.id === input.id) : undefined
    const def: DeploymentDef = { id: existing?.id ?? randomUUID(), serverId: input.serverId, name, workdir: input.workdir.trim(), script: input.script.replace(/\r\n/g, '\n') }
    if (existing) this.doc.defs[this.doc.defs.indexOf(existing)] = def
    else this.doc.defs.push(def)
    this.save()
    return def
  }

  remove(id: string) {
    const def = this.doc.defs.find(d => d.id === id)
    if (!def) return
    for (const r of this.doc.runs.filter(x => x.deploymentId === id)) {
      if (r.status === 'running') this.cancel(r.id)
      try { fs.unlinkSync(this.logFile(r.id)) } catch { /* no log */ }
    }
    this.doc.runs = this.doc.runs.filter(r => r.deploymentId !== id)
    this.doc.defs = this.doc.defs.filter(d => d.id !== id)
    this.save()
    this.changed(def.serverId)
  }

  // Starts a run and returns at once; the output is followed through the stream with the run's id.
  async run(deploymentId: string): Promise<DeploymentRun> {
    const def = this.doc.defs.find(d => d.id === deploymentId)
    if (!def) throw new Error('Deployment not found')
    if (this.doc.runs.some(r => r.deploymentId === deploymentId && r.status === 'running')) throw new Error('This deployment is already running')
    const run: DeploymentRun = { id: randomUUID(), deploymentId, serverId: def.serverId, name: def.name, startedAt: Date.now(), finishedAt: null, status: 'running', code: null }
    this.doc.runs.push(run)
    this.live.set(run.id, { text: '', length: 0 })
    this.trim(deploymentId)
    this.save()

    const cap = this.live.get(run.id)!
    const tap: Tap = {
      data: chunk => {
        cap.length += chunk.length
        cap.text += chunk
        if (cap.text.length > MAX_LOG) cap.text = cap.text.slice(-MAX_LOG)
      },
      end: (code, error) => {
        if (error) cap.text += `\n${error}\n`
        this.finish(run, code === 0 ? 'success' : 'failed', code)
      },
    }
    try {
      await this.streams.start(run.id, def.serverId, streamCommand({ kind: 'script', command: def.script, cwd: def.workdir }, false), tap)
    } catch (e) {
      tap.end(null, e instanceof Error ? e.message : String(e))
    }
    return run
  }

  private finish(run: DeploymentRun, status: DeploymentRun['status'], code: number | null) {
    if (run.status !== 'running') return
    run.status = status
    run.code = code
    run.finishedAt = Date.now()
    const cap = this.live.get(run.id)
    if (cap) { try { fs.writeFileSync(this.logFile(run.id), cap.text, { mode: 0o600 }) } catch { /* history without a log */ } }
    this.live.delete(run.id)
    this.save()
    this.changed(run.serverId)
  }

  cancel(runId: string) {
    const run = this.doc.runs.find(r => r.id === runId)
    if (!run || run.status !== 'running') return
    this.streams.stop(runId)
    const cap = this.live.get(runId)
    if (cap) cap.text += '\n[cancelled]\n'
    this.finish(run, 'cancelled', null)
  }

  log(runId: string): RunLog {
    const run = this.doc.runs.find(r => r.id === runId) ?? null
    const cap = this.live.get(runId)
    if (cap) return { text: cap.text, length: cap.length, run }
    try { const text = fs.readFileSync(this.logFile(runId), 'utf8'); return { text, length: text.length, run } } catch { return { text: '', length: 0, run } }
  }

  private trim(deploymentId: string) {
    const mine = this.doc.runs.filter(r => r.deploymentId === deploymentId).sort((a, b) => b.startedAt - a.startedAt)
    for (const r of mine.slice(KEEP_RUNS)) {
      try { fs.unlinkSync(this.logFile(r.id)) } catch { /* none */ }
      this.doc.runs = this.doc.runs.filter(x => x.id !== r.id)
    }
  }
}
