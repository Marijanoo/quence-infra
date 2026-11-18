import type { Connections } from './ssh'
import { assertName, dockerBin, sh } from './commands'
import type { ContainerAction, DockerContainer, DockerImage, DockerNetwork, DockerSnapshot, DockerStat, DockerVolume } from './types'

// Docker over SSH: the docker command line on the server, asked for JSON output. Users who are not
// in the docker group are retried through sudo (without a password prompt).

const jsonLines = <T>(text: string): T[] => {
  const out: T[] = []
  for (const l of text.split('\n')) {
    const t = l.trim()
    if (!t.startsWith('{')) continue
    try { out.push(JSON.parse(t) as T) } catch { /* a line of something else */ }
  }
  return out
}

function labelsOf(s: string): Record<string, string> {
  const o: Record<string, string> = {}
  for (const part of (s ?? '').split(',')) {
    const i = part.indexOf('=')
    if (i > 0) o[part.slice(0, i)] = part.slice(i + 1)
  }
  return o
}

export function parseContainers(text: string): DockerContainer[] {
  return jsonLines<Record<string, string>>(text).map(c => {
    const l = labelsOf(c.Labels)
    return {
      id: c.ID, name: c.Names, image: c.Image, state: c.State, status: c.Status, ports: c.Ports ?? '', created: c.CreatedAt ?? '',
      project: l['com.docker.compose.project'] ?? '', workdir: l['com.docker.compose.project.working_dir'] ?? '', configFiles: l['com.docker.compose.project.config_files'] ?? '',
    }
  })
}

const num = (s: string) => parseFloat((s ?? '').replace('%', '')) || 0

export function parseStats(text: string): DockerStat[] {
  return jsonLines<Record<string, string>>(text).map(s => ({
    id: s.ID ?? s.Container, cpu: num(s.CPUPerc), memPct: num(s.MemPerc), mem: s.MemUsage ?? '', net: s.NetIO ?? '', block: s.BlockIO ?? '',
  }))
}

export function parseImages(text: string, usedIds: Set<string>): DockerImage[] {
  return jsonLines<Record<string, string>>(text).map(i => ({
    id: i.ID, repo: i.Repository, tag: i.Tag, size: i.Size, created: i.CreatedSince ?? i.CreatedAt ?? '',
    inUse: [...usedIds].some(u => u.startsWith(i.ID) || i.ID.startsWith(u)),
  }))
}

export class Docker {
  private sudo = new Map<string, boolean>()

  constructor(private conns: Connections) {}

  isSudo(id: string) { return this.sudo.get(id) ?? false }

  private async run(id: string, args: string, timeout = 30_000) {
    return this.conns.exec(id, `${dockerBin(this.isSudo(id))} ${args}`, timeout)
  }

  // Works out once per connection whether docker is there and reachable.
  async detect(id: string): Promise<string> {
    let r = await this.conns.exec(id, "docker version --format '{{.Server.Version}}' 2>&1", 15_000)
    if (/command not found|not found/i.test(r.stdout + r.stderr)) throw new Error('Docker is not installed on this server')
    if (r.code !== 0 && /permission denied/i.test(r.stdout + r.stderr)) {
      const s = await this.conns.exec(id, "sudo -n docker version --format '{{.Server.Version}}' 2>&1", 15_000)
      if (s.code === 0) { this.sudo.set(id, true); return s.stdout.trim() }
      throw new Error('This user can’t use Docker: add it to the docker group (or allow sudo without a password for docker)')
    }
    if (r.code !== 0) {
      if (/cannot connect|is the docker daemon running/i.test(r.stdout)) throw new Error('The Docker service isn’t running on this server')
      throw new Error(r.stdout.trim().slice(0, 300) || 'Docker did not answer')
    }
    this.sudo.set(id, false)
    return r.stdout.trim()
  }

  async snapshot(id: string): Promise<DockerSnapshot> {
    const version = await this.detect(id)
    const q = (cmd: string) => this.run(id, cmd).then(r => r.stdout)
    const [ps, imgs, vols, nets] = await Promise.all([
      q("ps -a --format '{{json .}}'"),
      q("images --format '{{json .}}'"),
      q("volume ls --format '{{json .}}'"),
      q("network ls --format '{{json .}}'"),
    ])
    const containers = parseContainers(ps)
    const used = await this.run(id, "ps -a --format '{{.Image}}'").then(r => new Set(r.stdout.split('\n').filter(Boolean)))
    const images = parseImages(imgs, new Set<string>())
    for (const i of images) i.inUse = used.has(`${i.repo}:${i.tag}`) || used.has(i.repo) || used.has(i.id)
    const volumes: DockerVolume[] = jsonLines<Record<string, string>>(vols).map(v => ({ name: v.Name, driver: v.Driver, mountpoint: v.Mountpoint ?? '' }))
    const networks: DockerNetwork[] = jsonLines<Record<string, string>>(nets).map(n => ({ id: n.ID, name: n.Name, driver: n.Driver, scope: n.Scope }))
    return { containers, images, volumes, networks, version, sudo: this.isSudo(id) }
  }

  async stats(id: string): Promise<DockerStat[]> {
    const r = await this.run(id, "stats --no-stream --format '{{json .}}'", 20_000)
    return parseStats(r.stdout)
  }

  async inspect(id: string, target: string): Promise<string> {
    const r = await this.run(id, `inspect ${sh(assertName(target, 'name'))}`)
    if (r.code !== 0) throw new Error(r.stderr.trim() || r.stdout.trim() || 'Not found')
    try { return JSON.stringify(JSON.parse(r.stdout), null, 2) } catch { return r.stdout }
  }

  private async check(id: string, args: string) {
    const r = await this.run(id, args, 60_000)
    if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().replace(/^Error response from daemon: /, '') || 'Docker reported an error')
  }

  async container(id: string, target: string, action: ContainerAction) {
    const t = sh(assertName(target, 'container'))
    const verb: Record<ContainerAction, string> = { start: 'start', stop: 'stop', restart: 'restart', pause: 'pause', unpause: 'unpause', kill: 'kill', remove: 'rm -f' }
    if (!(action in verb)) throw new Error('Unknown action')
    await this.check(id, `${verb[action]} ${t}`)
  }

  async removeImage(id: string, image: string) { await this.check(id, `rmi ${sh(assertName(image, 'image'))}`) }
  async pruneImages(id: string) { await this.check(id, 'image prune -f') }
  async removeVolume(id: string, name: string) { await this.check(id, `volume rm ${sh(assertName(name, 'volume'))}`) }
  async removeNetwork(id: string, name: string) { await this.check(id, `network rm ${sh(assertName(name, 'network'))}`) }
}
