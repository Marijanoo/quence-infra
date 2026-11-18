import type { ClientChannel } from 'ssh2'
import type { Connections } from './ssh'

// Long-running commands whose output is shown as it arrives: container logs, journalctl -f,
// image pulls, deployment scripts. The output is batched before it goes to the window.

const FLUSH_MS = 40
const MAX_CHUNK = 64 * 1024

// Something that also wants the output (the deployment history records it)
export interface Tap {
  data(chunk: string): void
  end(code: number | null, error?: string): void
}

interface Running {
  sent: number
  tap?: Tap
  channel: ClientChannel | null
  buf: string
  timer: NodeJS.Timeout | null
  stopped: boolean
}

export class Streams {
  private running = new Map<string, Running>()

  constructor(
    private conns: Connections,
    private onData: (streamId: string, data: string, offset: number) => void,
    private onEnd: (streamId: string, code: number | null, error?: string) => void,
  ) {}

  async start(streamId: string, serverId: string, command: string, tap?: Tap): Promise<void> {
    this.stop(streamId)
    const r: Running = { sent: 0, tap, channel: null, buf: '', timer: null, stopped: false }
    this.running.set(streamId, r)
    const flush = () => {
      r.timer = null
      if (!r.buf) return
      const d = r.buf
      r.buf = ''
      const offset = r.sent
      r.sent += d.length
      r.tap?.data(d)
      this.onData(streamId, d, offset)
    }
    const finish = (code: number | null, error?: string) => {
      if (r.timer) clearTimeout(r.timer)
      flush()
      if (this.running.get(streamId) === r) {
        this.running.delete(streamId)
        if (!r.stopped) { r.tap?.end(code, error); this.onEnd(streamId, code, error) }
      }
    }
    try {
      const client = await this.conns.connect(serverId)
      if (r.stopped) return
      client.exec(command, (err, channel) => {
        if (err) { finish(null, err.message); return }
        if (r.stopped) { channel.close(); return }
        r.channel = channel
        channel.setEncoding('utf8')
        channel.on('data', (d: string) => {
          r.buf += d
          if (r.buf.length > MAX_CHUNK) { if (r.timer) clearTimeout(r.timer); flush() }
          else if (!r.timer) r.timer = setTimeout(flush, FLUSH_MS)
        })
        channel.stderr.setEncoding('utf8')
        channel.stderr.on('data', (d: string) => { r.buf += d; if (!r.timer) r.timer = setTimeout(flush, FLUSH_MS) })
        channel.on('close', (code: number | null) => finish(code))
        channel.on('error', (e: Error) => finish(null, e.message))
      })
    } catch (e) {
      finish(null, e instanceof Error ? e.message : String(e))
    }
  }

  stop(streamId: string) {
    const r = this.running.get(streamId)
    if (!r) return
    r.stopped = true
    this.running.delete(streamId)
    if (r.timer) clearTimeout(r.timer)
    try { r.channel?.close() } catch { /* closed already */ }
  }

  stopAll() {
    for (const id of [...this.running.keys()]) this.stop(id)
  }
}
