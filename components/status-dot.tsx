import type { ConnStatus } from '@/electron/types'

const COLORS: Record<ConnStatus, string> = {
  online: 'bg-primary',
  connecting: 'bg-[var(--term-yellow)] pulse-dot',
  error: 'bg-destructive',
  offline: 'bg-muted-foreground/40',
}

export const STATUS_LABEL: Record<ConnStatus, string> = {
  online: 'Connected',
  connecting: 'Connecting…',
  error: 'Connection failed',
  offline: 'Not connected',
}

export function StatusDot({ status, className = '' }: { status: ConnStatus; className?: string }) {
  return <span title={STATUS_LABEL[status]} className={`inline-block h-2 w-2 shrink-0 rounded-full ${COLORS[status]} ${className}`} />
}
