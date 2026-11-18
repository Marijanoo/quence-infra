import type { AlertEvent, AlertKind, AppSettings, DeploymentDef, DeploymentList, DeploymentRun, RunLog, ContainerAction, DockerSnapshot, DockerStat, StreamData, StreamEnd, StreamRequest, FileList, ProcessRow, ServiceAction, ServiceRow, TransferProgress, ConnEvent, ConnState, Library, MonitorInfo, MonitorSample, MonitorStart, ServerInput, ServerPublic } from '@/electron/types'

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
        openContainer: (sessionId: string, serverId: string, container: string, cols: number, rows: number) => Promise<void>
        close: (sessionId: string) => void
        onData: (cb: (e: { sessionId: string; data: string }) => void) => () => void
        onClose: (cb: (e: { sessionId: string }) => void) => () => void
      }
      files: {
        home: (id: string) => Promise<string>
        list: (id: string, dir: string) => Promise<FileList>
        read: (id: string, file: string) => Promise<{ content: string; size: number }>
        write: (id: string, file: string, content: string) => Promise<void>
        mkdir: (id: string, dir: string) => Promise<void>
        rename: (id: string, from: string, to: string) => Promise<void>
        remove: (id: string, target: string, isDir: boolean) => Promise<void>
        upload: (id: string, remoteDir: string, locals?: string[]) => Promise<number>
        uploadFolder: (id: string, remoteDir: string) => Promise<number>
        download: (id: string, items: { path: string; dir: boolean }[]) => Promise<string | null>
        reveal: (p: string) => Promise<void>
        pathOf: (f: File) => string
        onProgress: (cb: (e: TransferProgress) => void) => () => void
      }
      docker: {
        snapshot: (id: string) => Promise<DockerSnapshot>
        stats: (id: string) => Promise<DockerStat[]>
        inspect: (id: string, target: string) => Promise<string>
        container: (id: string, target: string, action: ContainerAction) => Promise<void>
        removeImage: (id: string, image: string) => Promise<void>
        pruneImages: (id: string) => Promise<void>
        removeVolume: (id: string, name: string) => Promise<void>
        removeNetwork: (id: string, name: string) => Promise<void>
      }
      stream: {
        start: (streamId: string, serverId: string, request: StreamRequest) => Promise<void>
        stop: (streamId: string) => void
        onData: (cb: (e: StreamData) => void) => () => void
        onEnd: (cb: (e: StreamEnd) => void) => () => void
      }
      settings: {
        get: () => Promise<AppSettings>
        set: (patch: Partial<AppSettings>) => Promise<AppSettings>
      }
      alerts: {
        list: () => Promise<AlertEvent[]>
        markRead: () => Promise<void>
        clear: () => Promise<void>
        test: () => Promise<{ desktop: boolean; webhook: string }>
        active: () => Promise<Record<string, AlertKind[]>>
        onEvents: (cb: (e: AlertEvent[]) => void) => () => void
        onActive: (cb: (e: { serverId: string; kinds: AlertKind[] }) => void) => () => void
      }
      deploy: {
        list: (serverId: string) => Promise<DeploymentList>
        save: (def: Omit<DeploymentDef, 'id'> & { id?: string }) => Promise<DeploymentDef>
        remove: (id: string) => Promise<void>
        run: (id: string) => Promise<DeploymentRun>
        cancel: (runId: string) => void
        log: (runId: string) => Promise<RunLog>
        onChanged: (cb: (e: { serverId: string }) => void) => () => void
      }
      system: {
        processes: (id: string) => Promise<ProcessRow[]>
        kill: (id: string, pid: number, force: boolean) => Promise<void>
        services: (id: string) => Promise<ServiceRow[]>
        serviceAction: (id: string, name: string, action: ServiceAction) => Promise<void>
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
