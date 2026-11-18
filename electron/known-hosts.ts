import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

// Host key fingerprints of the servers connected to, by "host:port". The first key seen is
// remembered; a different key later means the connection is refused, since that is what someone
// intercepting the connection looks like.

export type HostKeyResult = 'known' | 'new' | 'changed'

const file = () => path.join(app.getPath('userData'), 'known_hosts.json')

function read(): Record<string, string> {
  try { const v = JSON.parse(fs.readFileSync(file(), 'utf8')); return v && typeof v === 'object' ? v : {} } catch { return {} }
}

function write(v: Record<string, string>) {
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  fs.writeFileSync(file(), JSON.stringify(v, null, 2), { mode: 0o600 })
}

export function checkHostKey(hostId: string, fingerprint: string): HostKeyResult {
  const known = read()
  if (!known[hostId]) { write({ ...known, [hostId]: fingerprint }); return 'new' }
  return known[hostId] === fingerprint ? 'known' : 'changed'
}

export function forgetHostKey(hostId: string) {
  const known = read()
  delete known[hostId]
  write(known)
}
