import { app, safeStorage } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import type { AuthKind, Library, ServerInput, ServerPublic } from './types'

// The server list lives in servers.json in the app's data folder. Passwords, key passphrases and
// pasted private keys are encrypted with the operating system's keychain (Electron safeStorage)
// before they are written; when the system has no keychain they are stored as plain text in a
// file only the current user can read.

const ENC = 'enc:v1:'

export interface StoredServer {
  id: string
  name: string
  host: string
  port: number
  user: string
  auth: AuthKind
  group: string
  note: string
  keyPath: string
  watch?: boolean
  password: string
  passphrase: string
  privateKey: string
}

interface Doc {
  servers: StoredServer[]
  groups: string[]
}

export function seal(plain: string): string {
  if (!plain) return ''
  if (!safeStorage.isEncryptionAvailable()) return plain
  return ENC + safeStorage.encryptString(plain).toString('base64')
}

export function unseal(stored: string): string {
  if (!stored || !stored.startsWith(ENC)) return stored ?? ''
  if (!safeStorage.isEncryptionAvailable()) return ''
  try { return safeStorage.decryptString(Buffer.from(stored.slice(ENC.length), 'base64')) } catch { return '' }
}

const file = () => path.join(app.getPath('userData'), 'servers.json')

let doc: Doc | null = null

function load(): Doc {
  if (doc) return doc
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8'))
    doc = {
      servers: Array.isArray(raw.servers) ? raw.servers : [],
      groups: Array.isArray(raw.groups) ? raw.groups : [],
    }
  } catch {
    doc = { servers: [], groups: [] }
  }
  return doc
}

function save() {
  const tmp = file() + '.tmp'
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  fs.writeFileSync(tmp, JSON.stringify(load(), null, 2), { mode: 0o600 })
  fs.renameSync(tmp, file())
}

const pub = (s: StoredServer): ServerPublic => ({
  id: s.id, name: s.name, host: s.host, port: s.port, user: s.user, auth: s.auth, group: s.group, note: s.note,
  keyPath: s.keyPath, watch: s.watch !== false, hasPassword: !!s.password, hasPassphrase: !!s.passphrase, hasPrivateKey: !!s.privateKey,
})

export function library(): Library {
  const d = load()
  const groups = new Set(d.groups)
  for (const s of d.servers) if (s.group) groups.add(s.group)
  return { servers: d.servers.map(pub), groups: [...groups].sort((a, b) => a.localeCompare(b)) }
}

// The server with its secrets decrypted, for connecting. Never sent to the UI.
export function getServer(id: string): (StoredServer & { password: string; passphrase: string; privateKey: string }) | null {
  const s = load().servers.find(x => x.id === id)
  if (!s) return null
  return { ...s, password: unseal(s.password), passphrase: unseal(s.passphrase), privateKey: unseal(s.privateKey) }
}

export function saveServer(input: ServerInput): ServerPublic {
  const d = load()
  const name = input.name.trim()
  const host = input.host.trim()
  const user = input.user.trim()
  if (!host) throw new Error('Enter the server address')
  if (!user) throw new Error('Enter the user name')
  const port = Math.round(Number(input.port)) || 22
  if (port < 1 || port > 65535) throw new Error('The port must be between 1 and 65535')
  const existing = input.id ? d.servers.find(s => s.id === input.id) : undefined
  // undefined keeps the stored secret, '' clears it, anything else replaces it
  const secret = (next: string | undefined, prev: string | undefined) => next === undefined ? (prev ?? '') : seal(next)
  const next: StoredServer = {
    id: existing?.id ?? randomUUID(),
    name: name || host,
    host,
    port,
    user,
    auth: input.auth,
    group: input.group.trim(),
    note: input.note.trim(),
    keyPath: input.auth === 'key' ? (input.keyPath ?? '').trim() : '',
    watch: input.watch ?? existing?.watch ?? true,
    password: input.auth === 'password' ? secret(input.password, existing?.password) : '',
    passphrase: input.auth === 'key' ? secret(input.passphrase, existing?.passphrase) : '',
    privateKey: input.auth === 'key' ? secret(input.privateKey, existing?.privateKey) : '',
  }
  if (existing) d.servers[d.servers.indexOf(existing)] = next
  else d.servers.push(next)
  save()
  return pub(next)
}

export function removeServer(id: string) {
  const d = load()
  d.servers = d.servers.filter(s => s.id !== id)
  save()
}

export function duplicateServer(id: string): ServerPublic {
  const d = load()
  const s = d.servers.find(x => x.id === id)
  if (!s) throw new Error('Server not found')
  const copy: StoredServer = { ...s, id: randomUUID(), name: `${s.name} (copy)` }
  d.servers.push(copy)
  save()
  return pub(copy)
}

export function addGroup(name: string) {
  const g = name.trim()
  if (!g) throw new Error('Enter a group name')
  const d = load()
  if (!d.groups.includes(g)) d.groups.push(g)
  save()
}

export function renameGroup(from: string, to: string) {
  const g = to.trim()
  if (!g) throw new Error('Enter a group name')
  const d = load()
  d.groups = [...new Set(d.groups.map(x => x === from ? g : x))]
  for (const s of d.servers) if (s.group === from) s.group = g
  save()
}

// Servers in a removed group stay, without a group.
export function removeGroup(name: string) {
  const d = load()
  d.groups = d.groups.filter(x => x !== name)
  for (const s of d.servers) if (s.group === name) s.group = ''
  save()
}

export function moveServer(id: string, group: string) {
  const s = load().servers.find(x => x.id === id)
  if (!s) return
  s.group = group.trim()
  save()
}

// Used by tests to start from a clean state.
export function resetCache() { doc = null }
