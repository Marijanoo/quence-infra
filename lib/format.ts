const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

export function bytes(n: number, digits = 1): string {
  if (!isFinite(n) || n < 0) return '–'
  let i = 0
  while (n >= 1024 && i < UNITS.length - 1) { n /= 1024; i++ }
  return `${i === 0 ? Math.round(n) : n.toFixed(digits)} ${UNITS[i]}`
}

export const rate = (n: number) => `${bytes(n)}/s`

export function uptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export const pct = (n: number, digits = 0) => `${n.toFixed(digits)}%`

// Green while there is room, yellow when it is getting full, red when it is nearly full.
export function levelColor(p: number): string {
  if (p >= 90) return 'var(--term-red)'
  if (p >= 70) return 'var(--term-yellow)'
  return 'var(--primary)'
}
