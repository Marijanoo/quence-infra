import { contextBridge, ipcRenderer } from 'electron'

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
  monitor: {
    start:   (id: string) => ipcRenderer.invoke('monitor:start', id),
    stop:    (id: string) => ipcRenderer.send('monitor:stop', id),
    retry:   (id: string) => ipcRenderer.send('monitor:retry', id),
    onSample: (cb: (e: unknown) => void) => on('monitor:sample', cb),
    onError:  (cb: (e: unknown) => void) => on('monitor:error', cb),
  },
})
