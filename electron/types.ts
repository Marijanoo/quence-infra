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

// ── Docker ───────────────────────────────────────────────────────────────────

export interface DockerContainer {
  id: string
  name: string
  image: string
  state: string        // running, exited, paused, restarting, created, dead
  status: string       // "Up 3 hours (healthy)"
  ports: string
  created: string
  project: string      // docker compose project, '' when none
  workdir: string
  configFiles: string
}

export interface DockerStat { id: string; cpu: number; memPct: number; mem: string; net: string; block: string }
export interface DockerImage { id: string; repo: string; tag: string; size: string; created: string; inUse: boolean }
export interface DockerVolume { name: string; driver: string; mountpoint: string }
export interface DockerNetwork { id: string; name: string; driver: string; scope: string }

export interface DockerSnapshot {
  containers: DockerContainer[]
  images: DockerImage[]
  volumes: DockerVolume[]
  networks: DockerNetwork[]
  version: string
  sudo: boolean
}

export type ContainerAction = 'start' | 'stop' | 'restart' | 'pause' | 'unpause' | 'kill' | 'remove'

// ── Output streams (logs, long-running commands) ─────────────────────────────

export type StreamRequest =
  | { kind: 'docker-logs'; container: string; tail: number }
  | { kind: 'docker-pull'; image: string }
  | { kind: 'compose'; action: 'up' | 'down' | 'restart' | 'stop' | 'pull' | 'logs'; project: string; workdir: string; configFiles: string }
  | { kind: 'journal'; unit: string; priority: string; lines: number }
  | { kind: 'file'; path: string; lines: number }
  | { kind: 'script'; command: string; cwd: string }

export interface StreamData { streamId: string; data: string }
export interface StreamEnd { streamId: string; code: number | null; error?: string }
