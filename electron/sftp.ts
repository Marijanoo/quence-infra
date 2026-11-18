import type { SFTPWrapper, Stats } from 'ssh2'
import * as fs from 'fs'
import * as path from 'path'
import { posix } from 'path'
import type { Connections } from './ssh'
import type { FileEntry, FileList } from './types'

// File access over SFTP, on the server's shared SSH connection.

const S_IFMT = 0o170000
const S_IFDIR = 0o040000
const S_IFLNK = 0o120000

export const MAX_EDIT_BYTES = 2 * 1024 * 1024

const ok = <T>(fn: (cb: (err: Error | null | undefined, v: T) => void) => void) =>
  new Promise<T>((resolve, reject) => fn((err, v) => (err ? reject(err) : resolve(v))))

export class Sftp {
  private sessions = new Map<string, Promise<SFTPWrapper>>()

  constructor(private conns: Connections) {}

  private async session(id: string): Promise<SFTPWrapper> {
    const client = await this.conns.connect(id)
    let s = this.sessions.get(id)
    if (!s) {
      s = new Promise<SFTPWrapper>((resolve, reject) => client.sftp((err, sftp) => {
        if (!err) { resolve(sftp); return }
        reject(/subsystem/i.test(err.message) ? new Error('This server doesn’t offer SFTP, so files can’t be browsed (the SSH server has no sftp subsystem)') : err)
      }))
      this.sessions.set(id, s)
      s.then(sftp => {
        sftp.once('close', () => { if (this.sessions.get(id) === s) this.sessions.delete(id) })
        sftp.once('end', () => { if (this.sessions.get(id) === s) this.sessions.delete(id) })
      }, () => { if (this.sessions.get(id) === s) this.sessions.delete(id) })
    }
    return s
  }

  forget(id: string) { this.sessions.delete(id) }

  async home(id: string): Promise<string> {
    const s = await this.session(id)
    return ok<string>(cb => s.realpath('.', cb))
  }

  async list(id: string, dir: string): Promise<FileList> {
    const s = await this.session(id)
    const real = await ok<string>(cb => s.realpath(dir || '.', cb))
    const items = await ok<{ filename: string; attrs: Stats }[]>(cb => s.readdir(real, cb as never))
    const entries: FileEntry[] = await Promise.all(items.filter(i => i.filename !== '.' && i.filename !== '..').map(async i => {
      const mode = i.attrs.mode ?? 0
      let dirFlag = (mode & S_IFMT) === S_IFDIR
      const link = (mode & S_IFMT) === S_IFLNK
      if (link) {
        // a link to a folder opens like a folder
        try { const st = await ok<Stats>(cb => s.stat(posix.join(real, i.filename), cb)); dirFlag = ((st.mode ?? 0) & S_IFMT) === S_IFDIR } catch { /* broken link */ }
      }
      return { name: i.filename, dir: dirFlag, link, size: i.attrs.size ?? 0, mtime: i.attrs.mtime ?? 0, mode }
    }))
    entries.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) : a.dir ? -1 : 1))
    return { path: real, entries }
  }

  async read(id: string, file: string): Promise<{ content: string; size: number }> {
    const s = await this.session(id)
    const st = await ok<Stats>(cb => s.stat(file, cb))
    if (st.size > MAX_EDIT_BYTES) throw new Error(`The file is too large to edit here (${(st.size / 1048576).toFixed(1)} MB; the limit is ${MAX_EDIT_BYTES / 1048576} MB). Download it instead.`)
    const buf = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = []
      const r = s.createReadStream(file)
      r.on('data', (c: Buffer) => chunks.push(c))
      r.on('error', reject)
      r.on('end', () => resolve(Buffer.concat(chunks)))
    })
    if (buf.includes(0)) throw new Error('This looks like a binary file, so it can’t be edited as text. Download it instead.')
    return { content: buf.toString('utf8'), size: st.size }
  }

  async write(id: string, file: string, content: string): Promise<void> {
    const s = await this.session(id)
    // Keep the permissions of an existing file
    let mode: number | undefined
    try { mode = (await ok<Stats>(cb => s.stat(file, cb))).mode & 0o7777 } catch { /* new file */ }
    await new Promise<void>((resolve, reject) => {
      const w = s.createWriteStream(file, mode === undefined ? undefined : { mode })
      w.on('error', reject)
      w.on('close', () => resolve())
      w.end(Buffer.from(content, 'utf8'))
    })
  }

  async mkdir(id: string, dir: string) { const s = await this.session(id); await ok<void>(cb => s.mkdir(dir, cb as never)) }
  async rename(id: string, from: string, to: string) { const s = await this.session(id); await ok<void>(cb => s.rename(from, to, cb as never)) }

  async remove(id: string, target: string, isDir: boolean): Promise<void> {
    const s = await this.session(id)
    if (!isDir) { await ok<void>(cb => s.unlink(target, cb as never)); return }
    const items = await ok<{ filename: string; attrs: Stats }[]>(cb => s.readdir(target, cb as never))
    for (const i of items) {
      if (i.filename === '.' || i.filename === '..') continue
      const child = posix.join(target, i.filename)
      // a link is removed as a link, never followed into
      await this.remove(id, child, ((i.attrs.mode ?? 0) & S_IFMT) === S_IFDIR)
    }
    await ok<void>(cb => s.rmdir(target, cb as never))
  }

  // ── Transfers ──────────────────────────────────────────────────────────────

  async upload(id: string, local: string, remoteDir: string, onProgress: (name: string, done: number, total: number) => void): Promise<void> {
    const s = await this.session(id)
    const st = fs.statSync(local)
    const name = path.basename(local)
    const target = posix.join(remoteDir, name)
    if (st.isDirectory()) {
      try { await ok<void>(cb => s.mkdir(target, cb as never)) } catch { /* exists */ }
      for (const child of fs.readdirSync(local)) await this.upload(id, path.join(local, child), target, onProgress)
      return
    }
    await ok<void>(cb => s.fastPut(local, target, { step: (done, _c, total) => onProgress(name, done, total) }, cb as never))
    onProgress(name, st.size, st.size)
  }

  async download(id: string, remote: string, isDir: boolean, localDir: string, onProgress: (name: string, done: number, total: number) => void): Promise<void> {
    const s = await this.session(id)
    const name = posix.basename(remote)
    const target = path.join(localDir, name)
    if (isDir) {
      fs.mkdirSync(target, { recursive: true })
      const items = await ok<{ filename: string; attrs: Stats }[]>(cb => s.readdir(remote, cb as never))
      for (const i of items) {
        if (i.filename === '.' || i.filename === '..') continue
        await this.download(id, posix.join(remote, i.filename), ((i.attrs.mode ?? 0) & S_IFMT) === S_IFDIR, target, onProgress)
      }
      return
    }
    await ok<void>(cb => s.fastGet(remote, target, { step: (done, _c, total) => onProgress(name, done, total) }, cb as never))
  }
}
