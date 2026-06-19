import { type ReactNode } from 'react'
import clsx from 'clsx'

interface PanelProps {
  children: ReactNode
  title?: string
  titleRight?: string | ReactNode
  className?: string
  noPadding?: boolean
  /** Override left-border and corner accent color (e.g. for regime panel) */
  accentColor?: string
  /** Ambient inner glow matching accent */
  accentGlow?: boolean
}

export function Panel({
  children,
  title,
  titleRight,
  className,
  noPadding = false,
  accentColor,
  accentGlow = false,
}: PanelProps) {
  const accentStyle = accentColor
    ? ({
        '--panel-accent': accentColor,
        ...(accentGlow ? { boxShadow: `inset 6px 0 28px ${accentColor}14, 0 0 0 0.5px ${accentColor}18` } : {}),
      } as React.CSSProperties)
    : undefined

  return (
    <div className={clsx('hud-panel flex flex-col', className)} style={accentStyle}>
      {(title || titleRight) && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-hud-line/60 shrink-0">
          {title && (
            <span
              className="hud-label whitespace-nowrap"
              style={{ color: accentColor ?? 'var(--color-hud-primary)' }}
            >
              {title}
            </span>
          )}
          {/* horizontal rule filling the gap */}
          <div className="flex-1 h-px" style={{ background: `linear-gradient(90deg, ${accentColor ?? 'var(--color-hud-primary)'}30, transparent)` }} />
          {titleRight && (
            <div className="shrink-0">
              {typeof titleRight === 'string'
                ? <span className="hud-value-sm text-hud-text-dim">{titleRight}</span>
                : titleRight}
            </div>
          )}
        </div>
      )}
      <div className={clsx('flex-1 min-h-0', noPadding ? '' : 'p-3')}>
        {children}
      </div>
    </div>
  )
}
