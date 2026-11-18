'use client'

import Image from 'next/image'
import { Minus, Square, X } from 'lucide-react'

const drag = { WebkitAppRegion: 'drag' } as React.CSSProperties
const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

export function TitleBar({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex h-9 shrink-0 select-none items-stretch overflow-hidden border-b border-border bg-card" style={drag}>
      <div className="flex min-w-0 flex-1 items-center gap-2 px-3" style={drag}>
        <Image src="/logo.png" alt="QuenceInfra" width={16} height={16} className="shrink-0" style={noDrag} />
        <span className="truncate text-sm font-semibold text-foreground">QuenceInfra</span>
        {children}
      </div>
      <div className="flex shrink-0 items-stretch" style={noDrag}>
        <button onClick={() => window.electronAPI?.minimize()} tabIndex={-1} aria-label="Minimize"
          className="flex h-full w-9 items-center justify-center text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"><Minus className="h-3.5 w-3.5" /></button>
        <button onClick={() => window.electronAPI?.maximize()} tabIndex={-1} aria-label="Maximize"
          className="flex h-full w-9 items-center justify-center text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"><Square className="h-3 w-3" /></button>
        <button onClick={() => window.electronAPI?.close()} tabIndex={-1} aria-label="Close"
          className="flex h-full w-9 items-center justify-center text-muted-foreground transition-colors hover:bg-[oklch(0.65_0.22_25)] hover:text-white"><X className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  )
}
