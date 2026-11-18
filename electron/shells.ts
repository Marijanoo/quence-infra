import type { ClientChannel } from 'ssh2'
import type { Connections } from './ssh'

// Interactive shells on the servers. The output is gathered for a few milliseconds before it is
// sent to the window, so a command that prints a lot doesn't flood the app with messages.

const FLUSH_MS = 8

interface Session {
  serverId: string
  stream: ClientChannel
  buf: string
  timer: NodeJS.Timeout | null
}

export class Shells {
  private sessions = new Map<string, Session>()

  constructor(
    private conns: Connections,
    private onData: (sessionId: string, data: string) => void,
    private onClose: (sessionId: string, reason?: string) => void,
  ) {}

  async open(sessionId: string, serverId: string, cols: number, rows: number) {
    this.close(sessionId)
    const stream = await this.conns.shell(serverId, Math.max(2, cols), Math.max(2, rows))
    const s: Session = { serverId, stream, buf: '', timer: null }
    this.sessions.set(sessionId, s)
    stream.setEncoding('utf8')
    const flush = () => {
      s.timer = null
      if (!s.buf) return
      const data = s.buf
      s.buf = ''
      this.onData(sessionId, data)
    }
    stream.on('data', (d: string) => {
      s.buf += d
      if (s.buf.length > 64 * 1024) { if (s.timer) clearTimeout(s.timer); flush() }
      else if (!s.timer) s.timer = setTimeout(flush, FLUSH_MS)
    })
    stream.on('close', () => {
      if (s.timer) clearTimeout(s.timer)
      flush()
      if (this.sessions.get(sessionId) === s) {
        this.sessions.delete(sessionId)
        this.onClose(sessionId)
      }
    })
    stream.on('error', () => { /* followed by close */ })
  }

  write(sessionId: string, data: string) {
    this.sessions.get(sessionId)?.stream.write(data)
  }

  resize(sessionId: string, cols: number, rows: number) {
    if (cols < 2 || rows < 2) return
    this.sessions.get(sessionId)?.stream.setWindow(rows, cols, 0, 0)
  }

  close(sessionId: string) {
    const s = this.sessions.get(sessionId)
    if (!s) return
    this.sessions.delete(sessionId)
    if (s.timer) clearTimeout(s.timer)
    try { s.stream.close() } catch { /* already closed */ }
  }

  closeForServer(serverId: string) {
    for (const [id, s] of [...this.sessions]) if (s.serverId === serverId) this.close(id)
  }

  closeAll() {
    for (const id of [...this.sessions.keys()]) this.close(id)
  }
}
