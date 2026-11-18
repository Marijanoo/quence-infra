'use client'

import { useId } from 'react'

interface Series { data: number[]; color: string }

// A small filled line chart. All series share one scale: 0 to `max`, or the largest value when
// no maximum is given. Points are spread over `length` slots so a short history sits at the right.
export function AreaChart({ series, max, length = 150, height = 64 }: { series: Series[]; max?: number; length?: number; height?: number }) {
  const id = useId().replace(/:/g, '')
  const W = 300
  const top = max ?? Math.max(1, ...series.flatMap(s => s.data))
  const y = (v: number) => height - 2 - Math.min(1, Math.max(0, v / top)) * (height - 4)
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="block w-full" style={{ height }}>
      <defs>
        {series.map((s, i) => (
          <linearGradient key={i} id={`${id}-${i}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={s.color} stopOpacity="0.35" />
            <stop offset="1" stopColor={s.color} stopOpacity="0" />
          </linearGradient>
        ))}
      </defs>
      {[0.25, 0.5, 0.75].map(f => (
        <line key={f} x1="0" x2={W} y1={height * f} y2={height * f} stroke="currentColor" strokeOpacity="0.08" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
      ))}
      {series.map((s, i) => {
        if (s.data.length < 2) return null
        const step = W / (length - 1)
        const x0 = W - (s.data.length - 1) * step
        const pts = s.data.map((v, k) => `${(x0 + k * step).toFixed(1)},${y(v).toFixed(1)}`)
        return (
          <g key={i}>
            <polygon points={`${x0.toFixed(1)},${height} ${pts.join(' ')} ${W},${height}`} fill={`url(#${id}-${i})`} />
            <polyline points={pts.join(' ')} fill="none" stroke={s.color} strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </g>
        )
      })}
    </svg>
  )
}

export function Bar({ value, color, className = '' }: { value: number; color: string; className?: string }) {
  return (
    <div className={`h-1.5 overflow-hidden rounded-full bg-background/60 ${className}`}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: color }} />
    </div>
  )
}
