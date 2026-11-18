import type { StreamRequest } from './types'

// Every command the app runs on a server for the more complex features is built here, from typed
// requests, so that names coming from the screen can never be read by the remote shell as code.

// Single-quote a value for a POSIX shell.
export function sh(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9_.:/@+-]*$/

export function assertName(value: string, what = 'name'): string {
  if (!NAME.test(value)) throw new Error(`Unexpected ${what}`)
  return value
}

export function assertPath(value: string): string {
  if (!value.trim() || value.includes('\0') || value.includes('\n')) throw new Error('Unexpected path')
  return value
}

// "docker", or "sudo -n docker" for a user who is not allowed to reach the Docker socket directly.
export const dockerBin = (sudo: boolean) => (sudo ? 'sudo -n docker' : 'docker')

export function composeBase(r: { project: string; workdir: string; configFiles: string }, sudo: boolean): string {
  assertName(r.project, 'project name')
  const files = r.configFiles.split(',').map(f => f.trim()).filter(Boolean).map(f => `-f ${sh(assertPath(f))}`).join(' ')
  const dir = r.workdir ? `--project-directory ${sh(assertPath(r.workdir))}` : ''
  return `${dockerBin(sudo)} compose -p ${sh(r.project)} ${files} ${dir}`.replace(/\s+/g, ' ').trim()
}

const PRIORITIES = ['emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug']

export function streamCommand(req: StreamRequest, sudo: boolean): string {
  const lines = (n: number) => Math.min(5000, Math.max(0, Math.floor(Number(n) || 0)))
  switch (req.kind) {
    case 'docker-logs':
      return `${dockerBin(sudo)} logs -f --timestamps --tail ${lines(req.tail)} ${sh(assertName(req.container, 'container'))} 2>&1`
    case 'docker-pull':
      return `${dockerBin(sudo)} pull ${sh(assertName(req.image, 'image'))} 2>&1`
    case 'compose': {
      const base = composeBase(req, sudo)
      const tail: Record<typeof req.action, string> = {
        up: 'up -d --remove-orphans', down: 'down', restart: 'restart', stop: 'stop', pull: 'pull', logs: 'logs -f --tail 200 --timestamps',
      }
      if (!(req.action in tail)) throw new Error('Unknown action')
      return `${base} ${tail[req.action]} 2>&1`
    }
    case 'journal': {
      const unit = req.unit ? `-u ${sh(assertName(req.unit, 'unit'))}` : ''
      const pr = req.priority ? `-p ${sh(PRIORITIES.includes(req.priority) ? req.priority : 'info')}` : ''
      return `if [ "$(id -u)" = 0 ]; then J="journalctl"; else J="sudo -n journalctl"; fi; $J ${unit} ${pr} -n ${lines(req.lines)} -f --no-pager -o short-iso 2>&1`
    }
    case 'file':
      return `tail -n ${lines(req.lines)} -F ${sh(assertPath(req.path))} 2>&1`
    case 'script': {
      if (!req.command.trim()) throw new Error('The script is empty')
      const cd = req.cwd.trim() ? `cd ${sh(assertPath(req.cwd))} && ` : ''
      return `${cd}sh -c ${sh(req.command)} 2>&1`
    }
  }
}
