'use client'

import * as React from 'react'

export interface KimiMascotProps {
  size?: number
  className?: string
  /** Override face color tone */
  variant?: 'idle' | 'thinking' | 'happy'
}

/**
 * Crisp-edge pixel mascot for Kimi. 16×16 logical pixels rendered via SVG
 * <rect>s with shapeRendering="crispEdges" so it stays sharp at any size.
 * The face has subtle blink animation via CSS keyframes.
 */
export function KimiMascot({ size = 32, className, variant = 'idle' }: KimiMascotProps) {
  const happy = variant === 'happy'
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      className={className}
      role="img"
      aria-label="Kimi"
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id="kimi-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#e879f9" />
        </linearGradient>
        <linearGradient id="kimi-shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.18" />
        </linearGradient>
      </defs>

      {/* antenna */}
      <rect x="7" y="0" width="2" height="1" fill="#f0abfc" />
      <rect x="7" y="1" width="2" height="2" fill="#f5d0fe" />

      {/* head — stepped corners for a chunky-pixel rounded look */}
      <rect x="3" y="3" width="10" height="1" fill="url(#kimi-body)" />
      <rect x="2" y="4" width="12" height="1" fill="url(#kimi-body)" />
      <rect x="2" y="5" width="12" height="6" fill="url(#kimi-body)" />
      <rect x="2" y="11" width="12" height="1" fill="url(#kimi-body)" />
      <rect x="3" y="12" width="10" height="1" fill="url(#kimi-body)" />

      {/* soft bottom shading */}
      <rect x="2" y="5" width="12" height="8" fill="url(#kimi-shade)" />

      {/* cheeks */}
      <rect x="3" y="9" width="2" height="1" fill="#f9a8d4" opacity="0.55" />
      <rect x="11" y="9" width="2" height="1" fill="#f9a8d4" opacity="0.55" />

      {/* eyes (whites) */}
      <g className="kimi-eyes">
        <rect x="5" y="6" width="2" height="2" fill="#fff" />
        <rect x="9" y="6" width="2" height="2" fill="#fff" />
        {/* pupils — slight downward look gives a cute expression */}
        <rect x="5" y="7" width="1" height="1" fill="#1a1228" />
        <rect x="9" y="7" width="1" height="1" fill="#1a1228" />
      </g>

      {/* mouth */}
      {happy ? (
        // open smile
        <>
          <rect x="5" y="9" width="1" height="1" fill="#1a1228" />
          <rect x="10" y="9" width="1" height="1" fill="#1a1228" />
          <rect x="6" y="10" width="4" height="1" fill="#1a1228" />
        </>
      ) : (
        // gentle smile (corners tucked)
        <>
          <rect x="6" y="10" width="1" height="1" fill="#1a1228" />
          <rect x="9" y="10" width="1" height="1" fill="#1a1228" />
          <rect x="7" y="10" width="2" height="1" fill="#1a1228" opacity="0.6" />
        </>
      )}

      <style>{`
        .kimi-eyes { transform-origin: 8px 7px; animation: kimi-blink 5.5s ease-in-out infinite; }
        @keyframes kimi-blink {
          0%, 92%, 100% { transform: scaleY(1); }
          94%, 96%      { transform: scaleY(0.1); }
        }
      `}</style>
    </svg>
  )
}
