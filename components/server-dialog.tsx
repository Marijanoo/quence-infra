'use client'

import { useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { Dialog } from '@/components/dialog'
import { api, errText } from '@/lib/api'
import type { AuthKind, ServerInput, ServerPublic } from '@/electron/types'

const AUTHS: { id: AuthKind; label: string }[] = [
  { id: 'password', label: 'Password' },
  { id: 'key', label: 'Private key' },
  { id: 'agent', label: 'SSH agent' },
]

export function ServerDialog({ server, groups, defaultGroup = '', onSaved, onClose }: {
  server?: ServerPublic
  groups: string[]
  defaultGroup?: string
  onSaved: (s: ServerPublic, created: boolean) => void
  onClose: () => void
}) {
  const [name, setName] = useState(server?.name ?? '')
  const [group, setGroup] = useState(server?.group ?? defaultGroup)
  const [host, setHost] = useState(server?.host ?? '')
  const [port, setPort] = useState(String(server?.port ?? 22))
  const [user, setUser] = useState(server?.user ?? 'root')
  const [auth, setAuth] = useState<AuthKind>(server?.auth ?? 'password')
  const [password, setPassword] = useState('')
  const [keyPath, setKeyPath] = useState(server?.keyPath ?? '')
  const [pasteKey, setPasteKey] = useState(false)
  const [privateKey, setPrivateKey] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [note, setNote] = useState(server?.note ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setError('')
    const input: ServerInput = {
      id: server?.id, name, host, port: Number(port), user, auth, group, note,
      keyPath: pasteKey ? '' : keyPath,
      // An untouched secret field keeps what is saved; a typed value replaces it.
      password: password !== '' ? password : undefined,
      passphrase: passphrase !== '' ? passphrase : undefined,
      privateKey: pasteKey ? (privateKey !== '' ? privateKey : undefined) : (server?.hasPrivateKey ? '' : undefined),
    }
    if (auth === 'password' && !password && !server?.hasPassword) { setError('Enter the password'); return }
    if (auth === 'key' && !pasteKey && !keyPath.trim()) { setError('Choose the private key file, or paste the key'); return }
    if (auth === 'key' && pasteKey && !privateKey.trim() && !server?.hasPrivateKey) { setError('Paste the private key'); return }
    setBusy(true)
    try {
      const saved = await api().library.save(input)
      onSaved(saved, !server)
      onClose()
    } catch (e) {
      setError(errText(e))
      setBusy(false)
    }
  }

  const browse = async () => {
    const p = await api().library.pickKeyFile()
    if (p) setKeyPath(p)
  }

  return (
    <Dialog title={server ? 'Edit server' : 'Add a server'} onClose={onClose} width="max-w-lg">
      <form className="space-y-3 px-4 py-4" onSubmit={e => { e.preventDefault(); void submit() }}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Name</label>
            <input className="field" value={name} onChange={e => setName(e.target.value)} placeholder="Production web" autoFocus />
          </div>
          <div>
            <label className="label">Group</label>
            <input className="field" list="infra-groups" value={group} onChange={e => setGroup(e.target.value)} placeholder="None" />
            <datalist id="infra-groups">{groups.map(g => <option key={g} value={g} />)}</datalist>
          </div>
        </div>

        <div className="grid grid-cols-[1fr_6rem] gap-3">
          <div>
            <label className="label">Address</label>
            <input className="field" value={host} onChange={e => setHost(e.target.value)} placeholder="203.0.113.10 or server.example.com" />
          </div>
          <div>
            <label className="label">Port</label>
            <input className="field" inputMode="numeric" value={port} onChange={e => setPort(e.target.value.replace(/\D/g, ''))} />
          </div>
        </div>

        <div>
          <label className="label">User</label>
          <input className="field" value={user} onChange={e => setUser(e.target.value)} autoCapitalize="none" spellCheck={false} />
        </div>

        <div>
          <label className="label">Sign in with</label>
          <div className="inline-flex rounded-md border border-border bg-input p-0.5">
            {AUTHS.map(a => (
              <button key={a.id} type="button" onClick={() => setAuth(a.id)}
                className={`rounded px-3 py-1 text-xs font-medium transition-colors ${auth === a.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                {a.label}
              </button>
            ))}
          </div>
        </div>

        {auth === 'password' && (
          <div>
            <label className="label">Password</label>
            <input className="field" type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder={server?.hasPassword ? 'Saved: leave empty to keep it' : ''} autoComplete="off" />
          </div>
        )}

        {auth === 'key' && (
          <div className="space-y-3">
            {!pasteKey ? (
              <div>
                <label className="label">Private key file</label>
                <div className="flex gap-2">
                  <input className="field" value={keyPath} onChange={e => setKeyPath(e.target.value)} placeholder="~/.ssh/id_ed25519" spellCheck={false} />
                  <button type="button" className="btn shrink-0" onClick={browse}><FolderOpen className="h-3.5 w-3.5" />Browse</button>
                </div>
              </div>
            ) : (
              <div>
                <label className="label">Private key</label>
                <textarea className="field h-28 font-mono text-xs" value={privateKey} onChange={e => setPrivateKey(e.target.value)}
                  placeholder={server?.hasPrivateKey ? 'Saved: leave empty to keep it' : '-----BEGIN OPENSSH PRIVATE KEY-----'} spellCheck={false} />
              </div>
            )}
            <button type="button" className="text-xs text-primary hover:underline" onClick={() => setPasteKey(p => !p)}>
              {pasteKey ? 'Use a key file instead' : 'Paste the key instead'}
            </button>
            <div>
              <label className="label">Key passphrase (if it has one)</label>
              <input className="field" type="password" value={passphrase} onChange={e => setPassphrase(e.target.value)}
                placeholder={server?.hasPassphrase ? 'Saved: leave empty to keep it' : ''} autoComplete="off" />
            </div>
          </div>
        )}

        {auth === 'agent' && (
          <p className="rounded-md bg-background/40 px-3 py-2 text-xs text-muted-foreground">
            Uses the keys loaded in your SSH agent (ssh-agent, or the OpenSSH agent on Windows). Nothing is saved here.
          </p>
        )}

        <div>
          <label className="label">Note</label>
          <input className="field" value={note} onChange={e => setNote(e.target.value)} placeholder="What this server is for" />
        </div>

        {error && <p className="rounded-md bg-destructive/15 px-3 py-2 text-sm text-destructive">{error}</p>}

        <div className="flex items-center justify-between pt-1">
          <span className="text-[11px] text-muted-foreground/60">Secrets are stored encrypted.</span>
          <div className="flex gap-2">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{server ? 'Save' : 'Add server'}</button>
          </div>
        </div>
      </form>
    </Dialog>
  )
}
