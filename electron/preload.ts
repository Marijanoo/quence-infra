import { contextBridge, ipcRenderer, webUtils } from 'electron'

const on = <T>(channel: string, cb: (payload: T) => void) => {
  const h = (_e: Electron.IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, h)
  return () => { ipcRenderer.removeListener(channel, h) }
}

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close:    () => ipcRenderer.send('window-close'),
  zoomIn:   () => ipcRenderer.send('window-zoom-in'),
  zoomOut:  () => ipcRenderer.send('window-zoom-out'),
  library: {
    get:       () => ipcRenderer.invoke('library:get'),
    save:      (input: unknown) => ipcRenderer.invoke('library:save', input),
    remove:    (id: string) => ipcRenderer.invoke('library:remove', id),
    duplicate: (id: string) => ipcRenderer.invoke('library:duplicate', id),
    move:      (id: string, group: string) => ipcRenderer.invoke('library:move', id, group),
    addGroup:    (name: string) => ipcRenderer.invoke('library:add-group', name),
    renameGroup: (from: string, to: string) => ipcRenderer.invoke('library:rename-group', from, to),
    removeGroup: (name: string) => ipcRenderer.invoke('library:remove-group', name),
    pickKeyFile: () => ipcRenderer.invoke('library:pick-key'),
  },
  conn: {
    states:     () => ipcRenderer.invoke('conn:states'),
    connect:    (id: string) => ipcRenderer.invoke('conn:connect', id),
    disconnect: (id: string) => ipcRenderer.invoke('conn:disconnect', id),
    forgetHost: (id: string) => ipcRenderer.invoke('conn:forget-host', id),
    onState:    (cb: (e: unknown) => void) => on('conn:state', cb),
  },
  term: {
    open:   (sessionId: string, serverId: string, cols: number, rows: number) => ipcRenderer.invoke('term:open', { sessionId, serverId, cols, rows }),
    write:  (sessionId: string, data: string) => ipcRenderer.send('term:write', { sessionId, data }),
    resize: (sessionId: string, cols: number, rows: number) => ipcRenderer.send('term:resize', { sessionId, cols, rows }),
    close:  (sessionId: string) => ipcRenderer.send('term:close', { sessionId }),
    onData:  (cb: (e: { sessionId: string; data: string }) => void) => on('term:data', cb),
    onClose: (cb: (e: { sessionId: string }) => void) => on('term:closed', cb),
  },
  files: {
    home:   (id: string) => ipcRenderer.invoke('files:home', id),
    list:   (id: string, dir: string) => ipcRenderer.invoke('files:list', id, dir),
    read:   (id: string, file: string) => ipcRenderer.invoke('files:read', id, file),
    write:  (id: string, file: string, content: string) => ipcRenderer.invoke('files:write', id, file, content),
    mkdir:  (id: string, dir: string) => ipcRenderer.invoke('files:mkdir', id, dir),
    rename: (id: string, from: string, to: string) => ipcRenderer.invoke('files:rename', id, from, to),
    remove: (id: string, target: string, isDir: boolean) => ipcRenderer.invoke('files:remove', id, target, isDir),
    upload: (id: string, remoteDir: string, locals?: string[]) => ipcRenderer.invoke('files:upload', id, remoteDir, locals),
    uploadFolder: (id: string, remoteDir: string) => ipcRenderer.invoke('files:upload-folder', id, remoteDir),
    download: (id: string, items: { path: string; dir: boolean }[]) => ipcRenderer.invoke('files:download', id, items),
    reveal: (p: string) => ipcRenderer.invoke('files:reveal', p),
    pathOf: (f: File) => webUtils.getPathForFile(f),
    onProgress: (cb: (e: unknown) => void) => on('files:progress', cb),
  },
  system: {
    processes: (id: string) => ipcRenderer.invoke('system:processes', id),
    kill: (id: string, pid: number, force: boolean) => ipcRenderer.invoke('system:kill', id, pid, force),
    services: (id: string) => ipcRenderer.invoke('system:services', id),
    serviceAction: (id: string, name: string, action: string) => ipcRenderer.invoke('system:service-action', id, name, action),
  },
  monitor: {
    start:   (id: string) => ipcRenderer.invoke('monitor:start', id),
    stop:    (id: string) => ipcRenderer.send('monitor:stop', id),
    retry:   (id: string) => ipcRenderer.send('monitor:retry', id),
    onSample: (cb: (e: unknown) => void) => on('monitor:sample', cb),
    onError:  (cb: (e: unknown) => void) => on('monitor:error', cb),
  },
})
