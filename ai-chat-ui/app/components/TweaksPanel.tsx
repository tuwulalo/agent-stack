'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Sliders, X } from 'lucide-react'

/**
 * Lightweight Tweaks panel from the zek handoff. Floating gear button in the
 * bottom-right corner → popover with three controls:
 *   • Accent color (6 presets — green / purple / amber / cyan / pink / red)
 *   • Density (compact / regular / comfy) — segmented
 *   • Font (Geist / IBM Plex Sans / Mono) — segmented
 *
 * Applied via CSS variables on <html>:
 *   --zek-accent, --zek-accent-soft, --zek-accent-line
 * + a density-{compact|regular|comfy} class on <body>.
 *
 * Persisted in localStorage under the 'zek-tweaks-v1' key.
 */

const LS_KEY = 'zek-tweaks-v1'

type AccentKey = 'green' | 'purple' | 'amber' | 'cyan' | 'pink' | 'red'
const ACCENTS: Record<AccentKey, { hex: string; soft: string; line: string; label: string }> = {
  green:  { hex: '#4ade80', soft: '#4ade8022', line: '#4ade8044', label: 'green' },
  purple: { hex: '#a78bfa', soft: '#a78bfa22', line: '#a78bfa44', label: 'purple' },
  amber:  { hex: '#fbbf24', soft: '#fbbf2422', line: '#fbbf2444', label: 'amber' },
  cyan:   { hex: '#22d3ee', soft: '#22d3ee22', line: '#22d3ee44', label: 'cyan' },
  pink:   { hex: '#f472b6', soft: '#f472b622', line: '#f472b644', label: 'pink' },
  red:    { hex: '#f87171', soft: '#f8717122', line: '#f8717144', label: 'red' },
}

type Density = 'compact' | 'regular' | 'comfy'
type FontKey = 'geist' | 'plex' | 'mono'

const FONTS: Record<FontKey, { label: string; stack: string }> = {
  geist: { label: 'Geist',     stack: '"Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif' },
  plex:  { label: 'IBM Plex',  stack: '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif' },
  mono:  { label: 'Mono',      stack: '"Geist Mono", ui-monospace, "JetBrains Mono", "SF Mono", Menlo, monospace' },
}

interface TweaksState {
  accent: AccentKey
  density: Density
  font: FontKey
}
const DEFAULT_TWEAKS: TweaksState = { accent: 'green', density: 'regular', font: 'geist' }

function applyTweaks(t: TweaksState) {
  if (typeof document === 'undefined') return
  const a = ACCENTS[t.accent]
  document.documentElement.style.setProperty('--zek-accent',      a.hex)
  document.documentElement.style.setProperty('--zek-accent-soft', a.soft)
  document.documentElement.style.setProperty('--zek-accent-line', a.line)
  // density via body class
  document.body.classList.remove('zek-density-compact', 'zek-density-regular', 'zek-density-comfy')
  document.body.classList.add(`zek-density-${t.density}`)
  // font via body style
  document.body.style.setProperty('--zek-font-active', FONTS[t.font].stack)
}

export function TweaksPanel() {
  const [open, setOpen] = useState(false)
  const [tweaks, setTweaks] = useState<TweaksState>(DEFAULT_TWEAKS)
  const [hydrated, setHydrated] = useState(false)
  const popRef = useRef<HTMLDivElement>(null)

  // Hydrate from LS on mount, then apply
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<TweaksState>
        const merged: TweaksState = {
          accent:  (parsed.accent  && parsed.accent  in ACCENTS) ? parsed.accent  : DEFAULT_TWEAKS.accent,
          density: (parsed.density === 'compact' || parsed.density === 'comfy' || parsed.density === 'regular') ? parsed.density : DEFAULT_TWEAKS.density,
          font:    (parsed.font    && parsed.font    in FONTS)   ? parsed.font    : DEFAULT_TWEAKS.font,
        }
        setTweaks(merged)
        applyTweaks(merged)
      } else {
        applyTweaks(DEFAULT_TWEAKS)
      }
    } catch {
      applyTweaks(DEFAULT_TWEAKS)
    }
    setHydrated(true)
  }, [])

  // Persist + apply on change (after hydration)
  useEffect(() => {
    if (!hydrated) return
    try { localStorage.setItem(LS_KEY, JSON.stringify(tweaks)) } catch { /* quota */ }
    applyTweaks(tweaks)
  }, [hydrated, tweaks])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const setT = useCallback(<K extends keyof TweaksState>(k: K, v: TweaksState[K]) => {
    setTweaks((prev) => ({ ...prev, [k]: v }))
  }, [])

  return (
    <div ref={popRef} className="fixed right-4 bottom-4 z-[99]">
      {open && (
        <div
          className="mb-2 w-[280px] rounded-xl border shadow-2xl overflow-hidden"
          style={{
            background: 'rgba(20, 20, 25, 0.92)',
            backdropFilter: 'blur(20px) saturate(160%)',
            WebkitBackdropFilter: 'blur(20px) saturate(160%)',
            borderColor: 'rgba(255,255,255,0.08)',
            color: 'var(--zek-text)',
            fontFamily: 'var(--zek-font-active, var(--font-sans-loaded, system-ui))',
          }}
        >
          <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-white/[0.06]">
            <div className="flex items-center gap-2 text-[12px] font-semibold tracking-tight">
              <Sliders className="w-3.5 h-3.5 text-[var(--zek-accent)]" />
              tweaks
            </div>
            <button
              onClick={() => setOpen(false)}
              className="w-6 h-6 rounded grid place-items-center text-white/45 hover:text-white hover:bg-white/[0.06] transition"
              title="close"
            >
              <X className="w-3 h-3" />
            </button>
          </div>

          <div className="px-3.5 py-3 flex flex-col gap-4 text-[11.5px]">
            {/* ACCENT COLOR */}
            <div>
              <div className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-white/40 mb-2">
                Accent
              </div>
              <div className="grid grid-cols-6 gap-1.5">
                {(Object.keys(ACCENTS) as AccentKey[]).map((k) => {
                  const a = ACCENTS[k]
                  const on = tweaks.accent === k
                  return (
                    <button
                      key={k}
                      onClick={() => setT('accent', k)}
                      title={a.label}
                      className="h-7 rounded-md border transition relative"
                      style={{
                        background: a.hex,
                        borderColor: on ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.2)',
                        boxShadow: on ? `0 0 0 2px rgba(255,255,255,0.15), 0 0 12px ${a.soft}` : undefined,
                      }}
                    />
                  )
                })}
              </div>
            </div>

            {/* DENSITY */}
            <div>
              <div className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-white/40 mb-2">
                Density
              </div>
              <div className="flex gap-1 p-0.5 rounded-md bg-white/[0.04]">
                {(['compact', 'regular', 'comfy'] as Density[]).map((d) => {
                  const on = tweaks.density === d
                  return (
                    <button
                      key={d}
                      onClick={() => setT('density', d)}
                      className={
                        'flex-1 py-1 text-[10.5px] rounded transition font-medium ' +
                        (on
                          ? 'bg-white/15 text-white shadow-sm'
                          : 'text-white/55 hover:text-white/85')
                      }
                    >
                      {d === 'compact' ? 'compact' : d === 'regular' ? 'regular' : 'roomy'}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* FONT */}
            <div>
              <div className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-white/40 mb-2">
                Font
              </div>
              <div className="flex gap-1 p-0.5 rounded-md bg-white/[0.04]">
                {(Object.keys(FONTS) as FontKey[]).map((f) => {
                  const on = tweaks.font === f
                  return (
                    <button
                      key={f}
                      onClick={() => setT('font', f)}
                      className={
                        'flex-1 py-1 text-[10.5px] rounded transition font-medium ' +
                        (on
                          ? 'bg-white/15 text-white shadow-sm'
                          : 'text-white/55 hover:text-white/85')
                      }
                      style={{ fontFamily: FONTS[f].stack }}
                    >
                      {FONTS[f].label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="font-mono text-[9.5px] text-white/30 text-center pt-1 border-t border-white/[0.04]">
              saved in your browser
            </div>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        title="appearance settings"
        className="w-10 h-10 rounded-full border transition shadow-lg flex items-center justify-center"
        style={{
          background: open ? 'var(--zek-accent)' : 'rgba(20,20,25,0.92)',
          color: open ? '#062014' : 'var(--zek-text-2)',
          borderColor: open ? 'var(--zek-accent)' : 'rgba(255,255,255,0.1)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        <Sliders className="w-4 h-4" />
      </button>
    </div>
  )
}
