import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import serve from 'electron-serve'
import * as store from './store'
import { checkHostKey, forgetHostKey } from './known-hosts'
import { Connections, hostIdOf } from './ssh'
import { Monitors } from './monitor'
import { Shells } from './shells'
import type { ConnEvent, ServerInput } from './types'

// A dropped connection can surface as an EPIPE on a socket that is already closing.
process.on('uncaughtException', (err: any) => {
  if (err?.code === 'EPIPE' || err?.code === 'ECONNRESET') return
  throw err
})
process.on('unhandledRejection', () => {})

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
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
}

const send = (channel: string, payload: unknown) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

const conns = new Connections({
  getServer: id => store.getServer(id),
  checkHostKey,
  onState: (id, state) => send('conn:state', { id, ...state } satisfies ConnEvent),
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
  mainWindow.on('closed', () => {
    saveWindowState()
    mainWindow = null
  })
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
  ipcMain.on('term:write', (_e, a: { sessionId: string; data: string }) => shells.write(a.sessionId, a.data))
  ipcMain.on('term:resize', (_e, a: { sessionId: string; cols: number; rows: number }) => shells.resize(a.sessionId, a.cols, a.rows))
  ipcMain.on('term:close', (_e, a: { sessionId: string }) => shells.close(a.sessionId))

  ipcMain.handle('monitor:start', (_e, id: string) => monitors.start(id))
  ipcMain.on('monitor:stop', (_e, id: string) => monitors.stop(id))
  ipcMain.on('monitor:retry', (_e, id: string) => monitors.retry(id))
}

app.on('ready', () => {
  registerIpc()
  void createWindow()
})

app.on('before-quit', () => {
  monitors.stopAll()
  shells.closeAll()
  conns.disconnectAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (mainWindow === null) void createWindow()
})
