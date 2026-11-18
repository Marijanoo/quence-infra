import { Client, type ClientChannel, type ConnectConfig } from 'ssh2'
import * as fs from 'fs'
import { createHash } from 'crypto'
import type { ConnState } from './types'
import type { HostKeyResult } from './known-hosts'

// One SSH connection per server, shared by everything that talks to it (the terminals, the
// monitoring). It is opened the first time something needs it and reopened when it is needed
// again after it dropped.

export interface Credentials {
  id: string
  host: string
  port: number
  user: string
  auth: 'password' | 'key' | 'agent'
  password: string
  keyPath: string
  passphrase: string
  privateKey: string
}

export interface Deps {
  getServer: (id: string) => Credentials | null
  checkHostKey: (hostId: string, fingerprint: string) => HostKeyResult
  onState: (id: string, state: ConnState) => void
}

export function fingerprintOf(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`
}

export const hostIdOf = (host: string, port: number) => `${host}:${port || 22}`

function defaultAgent(): string | undefined {
  return process.env.SSH_AUTH_SOCK || (process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : undefined)
}

interface Entry {
  client: Client | null
  pending: Promise<Client> | null
  state: ConnState
}

export function describeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/All configured authentication methods failed/i.test(msg)) return 'Sign-in failed: check the user name and the password or key'
  if (/ENOTFOUND|EAI_AGAIN/i.test(msg)) return 'Could not find that server: check the address'
  if (/ECONNREFUSED/i.test(msg)) return 'The server refused the connection: is SSH running on that port?'
  if (/ETIMEDOUT|Timed out while waiting for handshake/i.test(msg)) return 'The server did not answer in time'
  if (/EHOSTUNREACH|ENETUNREACH/i.test(msg)) return 'The server could not be reached'
  if (/Encrypted private key detected|passphrase/i.test(msg)) return 'The private key needs its passphrase (or the passphrase is wrong)'
  if (/Cannot parse privateKey|Unsupported key format/i.test(msg)) return 'The private key could not be read'
  return msg
}

export class Connections {
  private entries = new Map<string, Entry>()

  constructor(private deps: Deps) {}

  state(id: string): ConnState {
    return this.entries.get(id)?.state ?? { status: 'offline' }
  }

  states(): Record<string, ConnState> {
    const out: Record<string, ConnState> = {}
    for (const [id, e] of this.entries) out[id] = e.state
    return out
  }

  private set(id: string, e: Entry, state: ConnState) {
    e.state = state
    this.deps.onState(id, state)
  }

  // The live client, connecting first when needed. Several callers at once share one attempt.
  connect(id: string): Promise<Client> {
    let e = this.entries.get(id)
    if (!e) { e = { client: null, pending: null, state: { status: 'offline' } }; this.entries.set(id, e) }
    if (e.client) return Promise.resolve(e.client)
    if (e.pending) return e.pending
    const entry = e
    entry.pending = this.open(id, entry).finally(() => { entry.pending = null })
    return entry.pending
  }

  private async open(id: string, e: Entry): Promise<Client> {
    const s = this.deps.getServer(id)
    if (!s) throw new Error('Server not found')
    this.set(id, e, { status: 'connecting' })
    const hostId = hostIdOf(s.host, s.port)
    let hostKeyChanged = false
    let keyProblem: string | null = null
    try {
      const config: ConnectConfig = {
        host: s.host,
        port: s.port || 22,
        username: s.user,
        readyTimeout: 20_000,
        keepaliveInterval: 15_000,
        keepaliveCountMax: 4,
        hostVerifier: (key: Buffer) => {
          const fp = fingerprintOf(key)
          if (this.deps.checkHostKey(hostId, fp) === 'changed') {
            hostKeyChanged = true
            keyProblem = `The host key of ${hostId} has changed (now ${fp}). This can mean someone is intercepting the connection. If the server was reinstalled, forget its host key and connect again.`
            return false
          }
          return true
        },
      }
      if (s.auth === 'password') {
        if (!s.password) throw new Error('No password saved for this server')
        config.password = s.password
        config.tryKeyboard = true
      } else if (s.auth === 'key') {
        if (s.privateKey) config.privateKey = s.privateKey
        else {
          if (!s.keyPath) throw new Error('Choose the private key file')
          try { config.privateKey = fs.readFileSync(s.keyPath) } catch (err) {
            throw new Error(`Could not read the private key ${s.keyPath}: ${err instanceof Error ? err.message : String(err)}`)
          }
        }
        if (s.passphrase) config.passphrase = s.passphrase
      } else {
        const agent = defaultAgent()
        if (!agent) throw new Error('No SSH agent found (SSH_AUTH_SOCK is not set)')
        config.agent = agent
      }

      const client = new Client()
      if (s.auth === 'password') {
        client.on('keyboard-interactive', (_n, _i, _l, prompts, finish) => finish(prompts.map(() => s.password)))
      }
      await new Promise<void>((resolve, reject) => {
        client.once('ready', () => resolve())
        client.once('error', err => reject(new Error(keyProblem ?? err.message)))
        try { client.connect(config) } catch (err) { reject(err) }
      })
      // After this point errors are not fatal to the caller: the close handler reports the drop.
      client.on('error', () => { /* followed by 'close' */ })
      client.on('close', () => {
        if (e.client === client) {
          e.client = null
          this.set(id, e, { status: 'offline' })
        }
      })
      e.client = client
      this.set(id, e, { status: 'online' })
      return client
    } catch (err) {
      this.set(id, e, { status: 'error', error: keyProblem ?? describeError(err), ...(hostKeyChanged ? { hostKeyChanged: true } : {}) })
      throw new Error(keyProblem ?? describeError(err))
    }
  }

  disconnect(id: string) {
    const e = this.entries.get(id)
    if (!e) return
    const c = e.client
    e.client = null
    if (c) { c.end(); this.set(id, e, { status: 'offline' }) }
  }

  disconnectAll() {
    for (const id of [...this.entries.keys()]) this.disconnect(id)
  }

  // Runs one command and returns its output.
  async exec(id: string, command: string, timeoutMs = 15_000): Promise<{ stdout: string; stderr: string; code: number | null }> {
    const client = await this.connect(id)
    return new Promise((resolve, reject) => {
      client.exec(command, (err, stream) => {
        if (err) { reject(err); return }
        let stdout = ''
        let stderr = ''
        const timer = setTimeout(() => { stream.close(); reject(new Error('The command took too long')) }, timeoutMs)
        stream.setEncoding('utf8')
        stream.on('data', (d: string) => { stdout += d })
        stream.stderr.setEncoding('utf8')
        stream.stderr.on('data', (d: string) => { stderr += d })
        stream.on('close', (code: number | null) => { clearTimeout(timer); resolve({ stdout, stderr, code }) })
        stream.on('error', (e: Error) => { clearTimeout(timer); reject(e) })
      })
    })
  }

  // A command in a terminal of its own (docker exec -it …)
  async pty(id: string, command: string, cols: number, rows: number): Promise<ClientChannel> {
    const client = await this.connect(id)
    return new Promise((resolve, reject) => {
      client.exec(command, { pty: { term: 'xterm-256color', cols, rows, width: 0, height: 0, modes: {} } }, (err, stream) => (err ? reject(err) : resolve(stream)))
    })
  }

  async shell(id: string, cols: number, rows: number): Promise<ClientChannel> {
    const client = await this.connect(id)
    return new Promise((resolve, reject) => {
      client.shell({ term: 'xterm-256color', cols, rows, width: 0, height: 0 }, { env: { LANG: 'en_US.UTF-8' } }, (err, stream) => {
        if (err) reject(err)
        else resolve(stream)
      })
    })
  }
}
