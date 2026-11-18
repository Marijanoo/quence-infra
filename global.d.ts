import type { ConnEvent, ConnState, Library, MonitorInfo, MonitorSample, MonitorStart, ServerInput, ServerPublic } from '@/electron/types'

export {}

declare global {
  interface Window {
    electronAPI?: {
      minimize: () => void
      maximize: () => void
      close: () => void
      zoomIn: () => void
      zoomOut: () => void
      library: {
        get: () => Promise<Library>
        save: (input: ServerInput) => Promise<ServerPublic>
        remove: (id: string) => Promise<void>
        duplicate: (id: string) => Promise<ServerPublic>
        move: (id: string, group: string) => Promise<void>
        addGroup: (name: string) => Promise<void>
        renameGroup: (from: string, to: string) => Promise<void>
        removeGroup: (name: string) => Promise<void>
        pickKeyFile: () => Promise<string | null>
      }
      conn: {
        states: () => Promise<Record<string, ConnState>>
        connect: (id: string) => Promise<ConnState>
        disconnect: (id: string) => Promise<void>
        forgetHost: (id: string) => Promise<void>
        onState: (cb: (e: ConnEvent) => void) => () => void
      }
      term: {
        open: (sessionId: string, serverId: string, cols: number, rows: number) => Promise<void>
        write: (sessionId: string, data: string) => void
        resize: (sessionId: string, cols: number, rows: number) => void
        close: (sessionId: string) => void
        onData: (cb: (e: { sessionId: string; data: string }) => void) => () => void
        onClose: (cb: (e: { sessionId: string }) => void) => () => void
      }
      monitor: {
        start: (id: string) => Promise<MonitorStart>
        stop: (id: string) => void
        retry: (id: string) => void
        onSample: (cb: (e: { id: string; sample: MonitorSample; info: MonitorInfo }) => void) => () => void
        onError: (cb: (e: { id: string; message: string }) => void) => () => void
      }
    }
  }
}
