// Shared between the Electron main process and the UI (the UI imports these as types only).

export type AuthKind = 'password' | 'key' | 'agent'

export interface ServerInput {
  id?: string
  name: string
  host: string
  port: number
  user: string
  auth: AuthKind
  group: string
  note: string
  keyPath?: string
  // Secrets: undefined keeps what is stored, an empty string clears it.
  password?: string
  passphrase?: string
  privateKey?: string
}

// What the UI sees: never the secrets themselves, only whether they are set.
export interface ServerPublic {
  id: string
  name: string
  host: string
  port: number
  user: string
  auth: AuthKind
  group: string
  note: string
  keyPath: string
  hasPassword: boolean
  hasPassphrase: boolean
  hasPrivateKey: boolean
}

export interface Library {
  servers: ServerPublic[]
  groups: string[]
}

export type ConnStatus = 'offline' | 'connecting' | 'online' | 'error'

export interface ConnState {
  status: ConnStatus
  error?: string
  // Set when the error was a changed host key, so the UI can offer to forget it.
  hostKeyChanged?: boolean
}

export interface ConnEvent extends ConnState {
  id: string
}

export interface DiskInfo {
  mount: string
  fs: string
  size: number
  used: number
}

export interface ProcInfo {
  pid: number
  user: string
  cpu: number
  mem: number
  name: string
}

export interface MonitorInfo {
  hostname: string
  os: string
  kernel: string
  cpuModel: string
  cores: number
}

export interface MonitorSample {
  t: number
  cpu: number
  cores: number[]
  memTotal: number
  memUsed: number
  swapTotal: number
  swapUsed: number
  load: [number, number, number]
  uptime: number
  rx: number
  tx: number
  disks: DiskInfo[]
  procs: ProcInfo[]
}

export interface MonitorStart {
  info: MonitorInfo | null
  history: MonitorSample[]
}

export interface MonitorError {
  id: string
  message: string
}

// ── Files ────────────────────────────────────────────────────────────────────

export interface FileEntry {
  name: string
  dir: boolean
  link: boolean
  size: number
  mtime: number   // seconds
  mode: number
}

export interface FileList {
  path: string
  entries: FileEntry[]
}

export interface TransferProgress {
  id: string
  serverId: string
  kind: 'upload' | 'download'
  name: string
  done: number
  total: number
  finished?: boolean
  error?: string
}

// ── Processes and services ───────────────────────────────────────────────────

export interface ProcessRow {
  pid: number
  ppid: number
  user: string
  cpu: number
  mem: number
  rss: number     // bytes
  time: string
  state: string
  command: string
}

export interface ServiceRow {
  name: string
  load: string
  active: string
  sub: string
  description: string
}

export type ServiceAction = 'start' | 'stop' | 'restart' | 'enable' | 'disable'
