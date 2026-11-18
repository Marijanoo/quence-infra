import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, shell, Tray } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { randomUUID } from 'crypto'
import serve from 'electron-serve'
import * as store from './store'
import { checkHostKey, forgetHostKey } from './known-hosts'
import { Connections, hostIdOf } from './ssh'
import { Monitors } from './monitor'
import { Shells } from './shells'
import { Sftp } from './sftp'
import { System } from './system'
import { Docker } from './docker'
import { Streams } from './streams'
import { Deployments } from './deployments'
import { AlertEngine } from './alerts'
import { SettingsStore } from './settings'
import { Watcher } from './watcher'
import { dockerBin, sh, assertName, streamCommand } from './commands'
import type { AlertEvent, AppSettings, FleetSample, ConnEvent, ContainerAction, ServerInput, ServiceAction, StreamRequest } from './types'

// A network error from a server (reset, timeout, a stray channel error) must never take the app
// down: log it and carry on, the connection's close handler reports the drop.
process.on('uncaughtException', (err: any) => {
  console.error('Uncaught error (ignored):', err?.stack || err)
})
process.on('unhandledRejection', reason => {
  console.error('Unhandled rejection (ignored):', reason)
})

if (process.platform === 'win32') app.setAppUserModelId('com.quence.infra')

const isProd = app.isPackaged || process.env.NODE_ENV === 'production'

if (isProd) {
  serve({ directory: 'out' })
} else {
  app.setPath('userData', `${app.getPath('userData')} (development)`)
}
// Tests and screenshots run against their own data folder.
if (process.env.INFRA_DATA_DIR) app.setPath('userData', process.env.INFRA_DATA_DIR)

let mainWindow: BrowserWindow | null = null

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
}

const send = (channel: string, payload: unknown) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

const conns = new Connections({
  getServer: id => store.getServer(id),
  checkHostKey,
  onState: (id, state) => {
    if (state.status !== 'online') sftp.forget(id)
    send('conn:state', { id, ...state } satisfies ConnEvent)
  },
})
const monitors = new Monitors(
  conns,
  (id, sample, info) => send('monitor:sample', { id, sample, info }),
  (id, message) => send('monitor:error', { id, message }),
)
const shells = new Shells(
  conns,
  (sessionId, data) => send('term:data', { sessionId, data }),
  sessionId => send('term:closed', { sessionId }),
)

const sftp = new Sftp(conns)
const system = new System(conns)
const docker = new Docker(conns)
const streams = new Streams(
  conns,
  (streamId, data, offset) => send('stream:data', { streamId, data, offset }),
  (streamId, code, error) => send('stream:end', { streamId, code, error }),
)

// Created once the app is ready (they need the data folder)
let deployments: Deployments
let settingsStore: SettingsStore
let watcher: Watcher
let tray: Tray | null = null
let quitting = false
const fleet = new Map<string, FleetSample>()
const engine = new AlertEngine(() => settingsStore.get().alerts)

async function postWebhook(url: string, text: string): Promise<void> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: text, text }), signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`The webhook answered ${res.status}`)
}

function notify(events: AlertEvent[]) {
  const cfg = settingsStore.get().alerts
  settingsStore.addAlerts(events)
  send('alerts:events', events)
  if (cfg.desktop && Notification.isSupported()) {
    // Many at once (a server with several problems) become one notification
    const shown = events.length > 3 ? [{ title: `${events.length} new alerts`, message: events.map(e => e.title).join('\n') }] : events
    for (const e of shown) {
      const n = new Notification({ title: e.title, body: e.message, icon: path.join(__dirname, '..', 'public', 'logo.png') })
      n.on('click', () => showWindow())
      n.show()
    }
  }
  if (cfg.webhook) {
    const text = events.map(e => `${e.severity === 'ok' ? '✅' : e.severity === 'critical' ? '🔴' : '⚠️'} ${e.title}: ${e.message}`).join('\n')
    postWebhook(cfg.webhook, text).catch(err => console.error('webhook failed:', err instanceof Error ? err.message : err))
  }
}

function showWindow() {
  if (!mainWindow) { void createWindow(); return }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function syncTray() {
  const want = settingsStore.get().tray
  if (!want && tray) { tray.destroy(); tray = null }
  if (want && !tray) {
    try {
      const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'public', 'logo.png')).resize({ width: 22, height: 22 })
      tray = new Tray(icon)
      tray.setToolTip('QuenceInfra')
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Open QuenceInfra', click: () => showWindow() },
        { type: 'separator' },
        { label: 'Quit', click: () => { quitting = true; app.quit() } },
      ]))
      tray.on('click', () => showWindow())
    } catch { tray = null }
  }
}

const windowStatePath = () => path.join(app.getPath('userData'), 'window-state.json')

function loadWindowState(): { width: number; height: number; x?: number; y?: number; isMaximized?: boolean } {
  try { return JSON.parse(fs.readFileSync(windowStatePath(), 'utf-8')) } catch { return { width: 1280, height: 820 } }
}

function saveWindowState() {
  if (!mainWindow) return
  try {
    const isMaximized = mainWindow.isMaximized()
    let state = loadWindowState()
    if (!isMaximized) state = { ...state, ...mainWindow.getBounds() }
    state.isMaximized = isMaximized
    fs.writeFileSync(windowStatePath(), JSON.stringify(state))
  } catch {}
}

async function createWindow() {
  const windowState = loadWindowState()
  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    minWidth: 760,
    minHeight: 480,
    frame: false,
    show: false,
    backgroundColor: '#32323a',
    icon: path.join(__dirname, '..', 'public', 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (windowState.isMaximized) mainWindow.maximize()
  mainWindow.show()

  if (isProd) await mainWindow.loadURL('app://-')
  else await mainWindow.loadURL(`http://localhost:${process.argv[2] || 3003}`)

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const mod = input.control || input.meta
    if (input.key === 'F12') {
      if (!isProd) mainWindow!.webContents.toggleDevTools()
      event.preventDefault()
    } else if (mod && input.key === 'r') {
      // A reload would drop the open terminals
      event.preventDefault()
    } else if (mod && (input.key === '=' || input.key === '+')) {
      mainWindow!.webContents.setZoomLevel(mainWindow!.webContents.getZoomLevel() + 0.5)
      event.preventDefault()
    } else if (mod && input.key === '-') {
      mainWindow!.webContents.setZoomLevel(mainWindow!.webContents.getZoomLevel() - 0.5)
      event.preventDefault()
    } else if (mod && input.key === '0') {
      mainWindow!.webContents.setZoomLevel(0)
      event.preventDefault()
    }
  })

  mainWindow.webContents.on('will-reload' as any, (event: Electron.Event) => event.preventDefault())
  mainWindow.on('resize', saveWindowState)
  mainWindow.on('move', saveWindowState)
  // With the tray on, closing the window only hides it: the servers stay watched
  mainWindow.on('close', e => {
    if (!quitting && settingsStore.get().tray && tray) { e.preventDefault(); mainWindow?.hide() }
  })
  mainWindow.on('closed', () => {
    saveWindowState()
    mainWindow = null
  })
}

// Runs the transfers one after another and tells the window how each is going.
async function runTransfers(
  serverId: string,
  kind: 'upload' | 'download',
  items: { source: string; isDir: boolean }[],
  run: (p: { source: string; isDir: boolean; progress: (name: string, done: number, total: number) => void }) => Promise<void>,
) {
  for (const item of items) {
    const id = randomUUID()
    const name = path.basename(item.source)
    const emit = (patch: Record<string, unknown>) => send('files:progress', { id, serverId, kind, name, done: 0, total: 0, ...patch })
    let last = 0
    emit({})
    try {
      await run({ ...item, progress: (n, done, total) => { if (Date.now() - last > 120) { last = Date.now(); emit({ name: n, done, total }) } } })
      emit({ finished: true })
    } catch (err) {
      emit({ finished: true, error: err instanceof Error ? err.message : String(err) })
    }
  }
}

function registerIpc() {
  ipcMain.on('window-minimize', e => BrowserWindow.fromWebContents(e.sender)?.minimize())
  ipcMain.on('window-maximize', e => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (win?.isMaximized()) win.unmaximize()
    else win?.maximize()
  })
  ipcMain.on('window-close', e => BrowserWindow.fromWebContents(e.sender)?.close())
  ipcMain.on('window-zoom-in', () => mainWindow?.webContents.setZoomLevel(mainWindow.webContents.getZoomLevel() + 0.5))
  ipcMain.on('window-zoom-out', () => mainWindow?.webContents.setZoomLevel(mainWindow.webContents.getZoomLevel() - 0.5))

  // Errors thrown here reach the window as rejected promises; Electron prefixes the message, which
  // the UI strips again.
  ipcMain.handle('library:get', () => store.library())
  ipcMain.handle('library:save', (_e, input: ServerInput) => {
    const before = input.id ? store.getServer(input.id) : null
    const saved = store.saveServer(input)
    // A different address, user or credentials: the old connection no longer matches. Edits to the
    // name, group or note leave the open terminals alone.
    if (before) {
      const after = store.getServer(saved.id)!
      const same = (['host', 'port', 'user', 'auth', 'keyPath', 'password', 'passphrase', 'privateKey'] as const).every(k => before[k] === after[k])
      if (!same) { shells.closeForServer(saved.id); conns.disconnect(saved.id) }
    }
    return saved
  })
  ipcMain.handle('library:remove', (_e, id: string) => {
    shells.closeForServer(id)
    monitors.drop(id)
    conns.disconnect(id)
    store.removeServer(id)
  })
  ipcMain.handle('library:duplicate', (_e, id: string) => store.duplicateServer(id))
  ipcMain.handle('library:move', (_e, id: string, group: string) => store.moveServer(id, group))
  ipcMain.handle('library:add-group', (_e, name: string) => store.addGroup(name))
  ipcMain.handle('library:rename-group', (_e, from: string, to: string) => store.renameGroup(from, to))
  ipcMain.handle('library:remove-group', (_e, name: string) => store.removeGroup(name))
  ipcMain.handle('library:pick-key', async () => {
    const r = await dialog.showOpenDialog(mainWindow!, {
      title: 'Choose a private key',
      defaultPath: path.join(app.getPath('home'), '.ssh'),
      properties: ['openFile', 'showHiddenFiles'],
    })
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.handle('conn:states', () => conns.states())
  ipcMain.handle('conn:connect', async (_e, id: string) => { await conns.connect(id); return conns.state(id) })
  ipcMain.handle('conn:disconnect', (_e, id: string) => { conns.disconnect(id) })
  ipcMain.handle('conn:forget-host', (_e, id: string) => {
    const s = store.getServer(id)
    if (s) forgetHostKey(hostIdOf(s.host, s.port))
  })

  ipcMain.handle('term:open', (_e, a: { sessionId: string; serverId: string; cols: number; rows: number }) =>
    shells.open(a.sessionId, a.serverId, a.cols, a.rows))
  // A shell inside a container
  ipcMain.handle('term:open-container', async (_e, a: { sessionId: string; serverId: string; container: string; cols: number; rows: number }) => {
    await docker.detect(a.serverId)
    const c = sh(assertName(a.container, 'container'))
    const cmd = `${dockerBin(docker.isSudo(a.serverId))} exec -it ${c} sh -c 'command -v bash >/dev/null 2>&1 && exec bash || exec sh'`
    await shells.open(a.sessionId, a.serverId, a.cols, a.rows, cmd)
  })
  ipcMain.on('term:write', (_e, a: { sessionId: string; data: string }) => shells.write(a.sessionId, a.data))
  ipcMain.on('term:resize', (_e, a: { sessionId: string; cols: number; rows: number }) => shells.resize(a.sessionId, a.cols, a.rows))
  ipcMain.on('term:close', (_e, a: { sessionId: string }) => shells.close(a.sessionId))

  ipcMain.handle('files:home', (_e, id: string) => sftp.home(id))
  ipcMain.handle('files:list', (_e, id: string, dir: string) => sftp.list(id, dir))
  ipcMain.handle('files:read', (_e, id: string, file: string) => sftp.read(id, file))
  ipcMain.handle('files:write', (_e, id: string, file: string, content: string) => sftp.write(id, file, content))
  ipcMain.handle('files:mkdir', (_e, id: string, dir: string) => sftp.mkdir(id, dir))
  ipcMain.handle('files:rename', (_e, id: string, from: string, to: string) => sftp.rename(id, from, to))
  ipcMain.handle('files:remove', (_e, id: string, target: string, isDir: boolean) => sftp.remove(id, target, isDir))
  // Uploads take local paths (chosen in a dialog, or dropped on the window); downloads ask for a folder.
  ipcMain.handle('files:upload', async (_e, id: string, remoteDir: string, locals?: string[]) => {
    let paths = locals
    if (!paths?.length) {
      const r = await dialog.showOpenDialog(mainWindow!, { title: 'Upload files', properties: ['openFile', 'multiSelections'] })
      if (r.canceled) return 0
      paths = r.filePaths
    }
    await runTransfers(id, 'upload', paths.map(p => ({ source: p, isDir: false })), p => sftp.upload(id, p.source, remoteDir, p.progress))
    return paths.length
  })
  ipcMain.handle('files:upload-folder', async (_e, id: string, remoteDir: string) => {
    const r = await dialog.showOpenDialog(mainWindow!, { title: 'Upload a folder', properties: ['openDirectory'] })
    if (r.canceled) return 0
    await runTransfers(id, 'upload', r.filePaths.map(p => ({ source: p, isDir: true })), p => sftp.upload(id, p.source, remoteDir, p.progress))
    return r.filePaths.length
  })
  ipcMain.handle('files:download', async (_e, id: string, items: { path: string; dir: boolean }[]) => {
    const r = await dialog.showOpenDialog(mainWindow!, { title: 'Download to…', properties: ['openDirectory', 'createDirectory'] })
    if (r.canceled) return null
    const dest = r.filePaths[0]
    await runTransfers(id, 'download', items.map(i => ({ source: i.path, isDir: i.dir })), p => sftp.download(id, p.source, p.isDir, dest, p.progress))
    return dest
  })
  ipcMain.handle('files:reveal', (_e, p: string) => { shell.showItemInFolder(p) })

  ipcMain.handle('system:processes', (_e, id: string) => system.processes(id))
  ipcMain.handle('system:kill', (_e, id: string, pid: number, force: boolean) => system.kill(id, pid, force))
  ipcMain.handle('system:services', (_e, id: string) => system.services(id))
  ipcMain.handle('system:service-action', (_e, id: string, name: string, action: ServiceAction) => system.serviceAction(id, name, action))

  ipcMain.handle('docker:snapshot', (_e, id: string) => docker.snapshot(id))
  ipcMain.handle('docker:stats', (_e, id: string) => docker.stats(id))
  ipcMain.handle('docker:inspect', (_e, id: string, target: string) => docker.inspect(id, target))
  ipcMain.handle('docker:container', (_e, id: string, target: string, action: ContainerAction) => docker.container(id, target, action))
  ipcMain.handle('docker:remove-image', (_e, id: string, image: string) => docker.removeImage(id, image))
  ipcMain.handle('docker:prune-images', (_e, id: string) => docker.pruneImages(id))
  ipcMain.handle('docker:remove-volume', (_e, id: string, name: string) => docker.removeVolume(id, name))
  ipcMain.handle('docker:remove-network', (_e, id: string, name: string) => docker.removeNetwork(id, name))

  ipcMain.handle('stream:start', async (_e, a: { streamId: string; serverId: string; request: StreamRequest }) => {
    const usesDocker = a.request.kind === 'docker-logs' || a.request.kind === 'docker-pull' || a.request.kind === 'compose'
    if (usesDocker) await docker.detect(a.serverId)
    await streams.start(a.streamId, a.serverId, streamCommand(a.request, usesDocker && docker.isSudo(a.serverId)))
  })
  ipcMain.on('stream:stop', (_e, streamId: string) => streams.stop(streamId))

  ipcMain.handle('deploy:list', (_e, serverId: string) => deployments.list(serverId))
  ipcMain.handle('deploy:save', (_e, def: Parameters<Deployments['saveDef']>[0]) => deployments.saveDef(def))
  ipcMain.handle('deploy:remove', (_e, id: string) => deployments.remove(id))
  ipcMain.handle('deploy:run', (_e, id: string) => deployments.run(id))
  ipcMain.on('deploy:cancel', (_e, runId: string) => deployments.cancel(runId))
  ipcMain.handle('deploy:log', (_e, runId: string) => deployments.log(runId))

  ipcMain.handle('settings:get', () => settingsStore.get())
  ipcMain.handle('settings:set', (_e, patch: Partial<AppSettings>) => {
    const s = settingsStore.set(patch)
    syncTray()
    watcher.start()
    return s
  })
  ipcMain.handle('fleet:get', () => Object.fromEntries(fleet))
  ipcMain.handle('alerts:list', () => settingsStore.alerts())
  ipcMain.handle('alerts:mark-read', () => settingsStore.markRead())
  ipcMain.handle('alerts:clear', () => settingsStore.clearAlerts())
  ipcMain.handle('alerts:test', async () => {
    const cfg = settingsStore.get().alerts
    const result: { desktop: boolean; webhook: string } = { desktop: Notification.isSupported() && cfg.desktop, webhook: cfg.webhook ? 'ok' : 'not set' }
    const ev: AlertEvent = { id: randomUUID(), t: Date.now(), serverId: '', serverName: 'Test', kind: 'down', severity: 'ok', title: 'QuenceInfra test notification', message: 'Alerts reach you like this.' }
    if (result.desktop) new Notification({ title: ev.title, body: ev.message }).show()
    if (cfg.webhook) { try { await postWebhook(cfg.webhook, `✅ ${ev.title}: ${ev.message}`) } catch (err) { result.webhook = err instanceof Error ? err.message : String(err) } }
    return result
  })
  ipcMain.handle('alerts:active', () => Object.fromEntries(store.library().servers.map(s => [s.id, engine.active(s.id)])))

  ipcMain.handle('monitor:start', (_e, id: string) => monitors.start(id))
  ipcMain.on('monitor:stop', (_e, id: string) => monitors.stop(id))
  ipcMain.on('monitor:retry', (_e, id: string) => monitors.retry(id))
}

app.on('ready', () => {
  deployments = new Deployments(app.getPath('userData'), streams, serverId => send('deploy:changed', { serverId }))
  settingsStore = new SettingsStore(app.getPath('userData'))
  watcher = new Watcher(
    conns, engine,
    () => store.library().servers.map(s => ({ id: s.id, name: s.name, watch: s.watch })),
    () => settingsStore.get().alerts.intervalSec,
    () => settingsStore.get().alerts.enabled,
    notify,
    (serverId, kinds) => send('alerts:active', { serverId, kinds }),
    sample => {
      // keep the last good figures when a check fails, so a card doesn't go blank
      const prev = fleet.get(sample.serverId)
      const merged = sample.reachable ? sample : { ...prev, ...sample, cpu: prev?.cpu, memPct: prev?.memPct, diskPct: prev?.diskPct }
      fleet.set(sample.serverId, merged)
      send('fleet:sample', merged)
    },
  )
  registerIpc()
  syncTray()
  // Tests and screenshots don't want background checks
  if (!process.env.INFRA_NO_WATCH) watcher.start()
  void createWindow()
})

app.on('before-quit', () => {
  quitting = true
  watcher?.stop()
  monitors.stopAll()
  streams.stopAll()
  shells.closeAll()
  conns.disconnectAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !(settingsStore?.get().tray && tray)) app.quit()
})

app.on('activate', () => showWindow())
