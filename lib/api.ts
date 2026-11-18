// Thin helpers around the bridge the Electron main process exposes as window.electronAPI.

export const api = () => window.electronAPI!

// Errors thrown in the main process arrive as "Error invoking remote method 'x': Error: message".
export function errText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '')
}
