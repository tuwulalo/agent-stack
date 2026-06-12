'use client'

import * as React from 'react'

export interface HermesMascotProps {
  size?: number
  className?: string
}

/**
 * Pixel mascot for Hermes Agent. 16×16 SVG with crisp edges.
 * Robot-style head: horizontal scanning visor, mini wings on the sides
 * (nod to Hermes' winged helm), tiny lightning mark on the chin.
 * Fuchsia-leaning gradient to set it apart from Kimi (violet-leaning).
 */
export function HermesMascot({ size = 32, className }: HermesMascotProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      className={className}
      role="img"
      aria-label="Hermes"
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id="hermes-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#f0abfc" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
        <linearGradient id="hermes-shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.22" />
        </linearGradient>
      </defs>

      {/* wings — small angular pixels at the sides of the helm */}
      <rect x="1" y="4" width="1" height="2" fill="#f0abfc" />
      <rect x="0" y="5" width="1" height="2" fill="#c084fc" />
      <rect x="14" y="4" width="1" height="2" fill="#f0abfc" />
      <rect x="15" y="5" width="1" height="2" fill="#c084fc" />

      {/* helm — chunky rounded square */}
      <rect x="3" y="2" width="10" height="1" fill="url(#hermes-body)" />
      <rect x="2" y="3" width="12" height="1" fill="url(#hermes-body)" />
      <rect x="2" y="4" width="12" height="8" fill="url(#hermes-body)" />
      <rect x="2" y="12" width="12" height="1" fill="url(#hermes-body)" />
      <rect x="3" y="13" width="10" height="1" fill="url(#hermes-body)" />

      {/* shading — subtle bottom darken to add depth */}
      <rect x="2" y="4" width="12" height="9" fill="url(#hermes-shade)" />

      {/* visor — dark recessed strip across the face */}
      <rect x="3" y="6" width="10" height="3" fill="#1a0f2e" />
      <rect x="3" y="6" width="10" height="1" fill="#000" opacity="0.45" />

      {/* scanning visor lights */}
      <g className="hermes-scan">
        <rect x="4"  y="7" width="2" height="1" fill="#67e8f9" />
        <rect x="7"  y="7" width="2" height="1" fill="#fff"   />
        <rect x="10" y="7" width="2" height="1" fill="#67e8f9" />
      </g>

      {/* small lightning bolt mark on chin */}
      <rect x="8" y="10" width="1" height="1" fill="#fde047" />
      <rect x="7" y="11" width="1" height="1" fill="#fde047" />
      <rect x="8" y="11" width="1" height="1" fill="#facc15" opacity="0.85" />

      <style>{`
        .hermes-scan { animation: hermes-pulse 2.6s ease-in-out infinite; }
        @keyframes hermes-pulse {
          0%, 100% { opacity: 0.95; }
          45%      { opacity: 0.55; }
          50%      { opacity: 1; }
        }
      `}</style>
    </svg>
  )
}
