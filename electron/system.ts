import type { Connections } from './ssh'
import type { ProcessRow, ServiceAction, ServiceRow } from './types'

// Processes and services: read and controlled by running ps, kill and systemctl on the server.

export const PS_COMMAND = 'LC_ALL=C ps -eo pid=,ppid=,user:20=,pcpu=,pmem=,rss=,etime=,stat=,args= --sort=-pcpu 2>/dev/null | head -n 600'

export function parseProcesses(text: string): ProcessRow[] {
  const out: ProcessRow[] = []
  for (const line of text.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/.exec(line)
    if (m) out.push({ pid: +m[1], ppid: +m[2], user: m[3], cpu: +m[4], mem: +m[5], rss: +m[6] * 1024, time: m[7], state: m[8], command: m[9].trim() })
  }
  return out
}

export const SERVICES_COMMAND = 'LC_ALL=C systemctl list-units --type=service --all --no-legend --no-pager --plain 2>&1'

export function parseServices(text: string): ServiceRow[] {
  const out: ServiceRow[] = []
  for (const line of text.split('\n')) {
    const m = /^[●*\s]*(\S+\.service)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/.exec(line)
    if (m) out.push({ name: m[1].replace(/\.service$/, ''), load: m[2], active: m[3], sub: m[4], description: m[5].trim() })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

const SAFE_NAME = /^[A-Za-z0-9@._:-]+$/
const SERVICE_ACTIONS: ServiceAction[] = ['start', 'stop', 'restart', 'enable', 'disable']

export class System {
  constructor(private conns: Connections) {}

  async processes(id: string): Promise<ProcessRow[]> {
    const { stdout } = await this.conns.exec(id, PS_COMMAND, 15_000)
    return parseProcesses(stdout)
  }

  async kill(id: string, pid: number, force: boolean): Promise<void> {
    if (!Number.isInteger(pid) || pid < 2) throw new Error('That process can’t be stopped from here')
    const { stderr, code } = await this.conns.exec(id, `kill -${force ? 'KILL' : 'TERM'} ${pid}`, 10_000)
    if (code !== 0) throw new Error(stderr.trim().replace(/^.*kill: /, '') || 'The process could not be stopped')
  }

  async services(id: string): Promise<ServiceRow[]> {
    const { stdout, code } = await this.conns.exec(id, SERVICES_COMMAND, 20_000)
    const rows = parseServices(stdout)
    if (rows.length === 0 && (code !== 0 || /not found|Failed to connect|System has not been booted/i.test(stdout))) {
      throw new Error('This server has no systemd, so there are no services to list')
    }
    return rows
  }

  async serviceAction(id: string, name: string, action: ServiceAction): Promise<void> {
    if (!SAFE_NAME.test(name)) throw new Error('Unexpected service name')
    if (!SERVICE_ACTIONS.includes(action)) throw new Error('Unknown action')
    // As root directly; as another user through sudo without a password prompt
    const cmd = `if [ "$(id -u)" = 0 ]; then systemctl ${action} ${name}.service; else sudo -n systemctl ${action} ${name}.service; fi 2>&1`
    const { stdout, code } = await this.conns.exec(id, cmd, 60_000)
    if (code !== 0) {
      const msg = stdout.trim()
      throw new Error(/password is required|a terminal is required/i.test(msg) ? `${action} needs administrator rights, and this user can’t use sudo without a password` : msg || `Could not ${action} ${name}`)
    }
  }
}
