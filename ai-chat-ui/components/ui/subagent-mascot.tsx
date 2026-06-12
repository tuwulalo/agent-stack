'use client'

import * as React from 'react'

export interface SubagentMascotProps {
  size?: number
  className?: string
  /** body gradient start (top) */
  bodyFrom?: string
  /** body gradient end (bottom) */
  bodyTo?: string
  /** visor scan colour */
  visor?: string
}

const DEFAULT_FROM = '#67e8f9'
const DEFAULT_TO = '#0e7490'
const DEFAULT_VISOR = '#67e8f9'

/**
 * Pixel mascot for Hermes subagents. Same silhouette as before — square
 * helmet, side wings, narrow visor, chin lightning — but accepts colour
 * overrides so each delegated agent gets a distinct look.
 *
 * Each instance generates a unique gradient id via React.useId so multiple
 * coloured mascots can co-exist on the page without sharing definitions.
 */
export function SubagentMascot({
  size = 18,
  className,
  bodyFrom = DEFAULT_FROM,
  bodyTo = DEFAULT_TO,
  visor = DEFAULT_VISOR,
}: SubagentMascotProps) {
  const uid = React.useId().replace(/[:]/g, '')
  const bodyId = `sub-body-${uid}`
  const shadeId = `sub-shade-${uid}`
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      className={className}
      role="img"
      aria-label="Subagent"
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id={bodyId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={bodyFrom} />
          <stop offset="100%" stopColor={bodyTo} />
        </linearGradient>
        <linearGradient id={shadeId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.28" />
        </linearGradient>
      </defs>

      {/* tiny wings — tinted from bodyFrom (lighter) and bodyTo (darker) */}
      <rect x="1" y="4" width="1" height="2" fill={bodyFrom} opacity="0.85" />
      <rect x="0" y="5" width="1" height="2" fill={bodyTo} opacity="0.7" />
      <rect x="14" y="4" width="1" height="2" fill={bodyFrom} opacity="0.85" />
      <rect x="15" y="5" width="1" height="2" fill={bodyTo} opacity="0.7" />

      {/* helm */}
      <rect x="3" y="2" width="10" height="1" fill={`url(#${bodyId})`} />
      <rect x="2" y="3" width="12" height="1" fill={`url(#${bodyId})`} />
      <rect x="2" y="4" width="12" height="8" fill={`url(#${bodyId})`} />
      <rect x="2" y="12" width="12" height="1" fill={`url(#${bodyId})`} />
      <rect x="3" y="13" width="10" height="1" fill={`url(#${bodyId})`} />

      {/* shading */}
      <rect x="2" y="4" width="12" height="9" fill={`url(#${shadeId})`} />

      {/* visor — narrow slit, persona-tinted scan dots */}
      <rect x="3" y="7" width="10" height="2" fill="#0a1f2e" />
      <rect x="5" y="7" width="2" height="1" fill={visor} />
      <rect x="9" y="7" width="2" height="1" fill={visor} />

      {/* chin "↳" mark */}
      <rect x="7" y="10" width="1" height="1" fill="#fde047" />
      <rect x="8" y="11" width="2" height="1" fill="#fde047" />
    </svg>
  )
}
