'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Activity, CheckCircle2, Clock } from 'lucide-react'
import { Mascot, guessMascot, ROSTER_IDENTITY, type MascotId } from '../../components/Mascot'
import { listAgentSessions, type AgentSession } from '../../lib/agent-sessions'
import { TweaksPanel } from '../../components/TweaksPanel'

/**
 * «Поток» — живая инфографика как оркестраторы общаются с воркерами.
 * Для каждой root-сессии рисуем swimlane: оркестратор сверху, его
 * воркеры внизу, между ними анимированные стрелки (фиолетовые бегущие
 * пунктиры — активные, зелёные тонкие — завершённые). Auto-refresh 4с.
 *
 * Без хардкода: всё на основе живых сессий, parentSessionId связи.
 */

interface Lane {
  parent: AgentSession
  children: AgentSession[]
  parentLive: boolean
  parentDone: boolean
  // совокупно — есть ли хотя бы один активный воркер
  anyChildLive: boolean
}

function StatusBadge({ s }: { s: AgentSession }) {
  const ageMs = Date.now() - (s.lastUsedAt || 0)
  const live = ageMs < 60_000 && s.turns > 0
  if (live) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[var(--zek-purple-soft)] text-[var(--zek-purple)] font-mono text-[10px] uppercase tracking-wider">
        <Activity className="w-2.5 h-2.5 animate-pulse" />
        идёт
      </span>
    )
  }
  if (s.turns > 0) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[var(--zek-accent-soft)] text-[var(--zek-accent)] font-mono text-[10px] uppercase tracking-wider">
        <CheckCircle2 className="w-2.5 h-2.5" />
        готов
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-white/[0.05] text-white/40 font-mono text-[10px] uppercase tracking-wider">
      <Clock className="w-2.5 h-2.5" />
      ждёт
    </span>
  )
}

function ConnectionArrow({ active, done }: { active: boolean; done: boolean }) {
  // Vertical line from parent (top) to child (bottom) with animated dots if active
  return (
    <svg className="w-8 h-8" viewBox="0 0 32 32" overflow="visible">
      <line
        x1="16"
        y1="0"
        x2="16"
        y2="32"
        stroke={active ? 'var(--zek-purple)' : done ? 'var(--zek-accent)' : 'rgba(255,255,255,0.1)'}
        strokeWidth="1.5"
        strokeDasharray="3 4"
        strokeLinecap="round"
        className={active ? 'connection-path active' : done ? 'connection-path done' : ''}
        style={active ? { filter: 'drop-shadow(0 0 4px var(--zek-purple-soft))' } : undefined}
      />
      {/* arrowhead at bottom */}
      <path
        d="M16 30 L12 24 L20 24 Z"
        fill={active ? 'var(--zek-purple)' : done ? 'var(--zek-accent)' : 'rgba(255,255,255,0.15)'}
      />
    </svg>
  )
}

function LaneCard({ lane }: { lane: Lane }) {
  const parentMid = guessMascot(lane.parent.name + ' ' + (lane.parent.lastPrompt || ''))
  const parentIdent = ROSTER_IDENTITY.find((m) => m.id === parentMid)!

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{
        background: 'var(--zek-bg-1)',
        borderColor: lane.parentLive || lane.anyChildLive ? 'var(--zek-purple)' : 'var(--zek-line)',
        boxShadow: lane.parentLive || lane.anyChildLive ? `0 0 24px var(--zek-purple-soft)` : 'none',
        transition: 'border-color .2s, box-shadow .2s',
      }}
    >
      {/* === ORCHESTRATOR HEAD === */}
      <div className="flex items-start gap-4 p-5 border-b border-[var(--zek-line)]">
        <div className="flex-shrink-0">
          <Mascot id={parentMid} size={56} live={lane.parentLive || lane.anyChildLive} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--zek-text-3)]">оркестратор</span>
            <span className="font-mono text-[10px] text-[var(--zek-text-3)]">·</span>
            <span className="font-semibold text-[var(--zek-text)] text-[15px] tracking-tight">{parentIdent.name}</span>
            <span className="text-[var(--zek-text-3)] text-[12px] font-mono">{parentIdent.domain}</span>
            <span className="ml-auto"><StatusBadge s={lane.parent} /></span>
          </div>
          <div className="text-[13px] text-[var(--zek-text-2)] leading-snug line-clamp-2 mb-1.5">
            {lane.parent.name}
          </div>
          {lane.parent.lastSummary && (
            <div
              className="text-[12px] text-[var(--zek-text)] leading-snug line-clamp-2 px-2.5 py-1.5 rounded border border-[var(--zek-line)] bg-black/30"
              title={lane.parent.lastSummary}
            >
              <span className="font-mono text-[9px] uppercase tracking-wider text-[var(--zek-text-3)] mr-1.5">итог:</span>
              {lane.parent.lastSummary}
            </div>
          )}
          <div className="flex items-center gap-3 mt-2 font-mono text-[10px] text-[var(--zek-text-3)]">
            <Link
              href={`/automations?session=${lane.parent.id}`}
              className="text-[var(--zek-accent)] hover:text-[var(--zek-text)] transition"
            >
              ↪ открыть
            </Link>
            <span>·</span>
            <span>{lane.parent.turns} turn{lane.parent.turns === 1 ? '' : 's'}</span>
            <span>·</span>
            <span>{formatRel(lane.parent.lastUsedAt)}</span>
          </div>
        </div>
      </div>

      {/* === CHILDREN GRID === */}
      {lane.children.length > 0 ? (
        <div className="p-4">
          <div className="flex items-center justify-center mb-2 -mt-2">
            <ConnectionArrow active={lane.anyChildLive} done={!lane.anyChildLive} />
          </div>
          <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${Math.min(lane.children.length, 4)}, minmax(0, 1fr))` }}>
            {lane.children.map((c) => {
              const mid = guessMascot(c.name + ' ' + (c.lastPrompt || ''))
              const ident = ROSTER_IDENTITY.find((m) => m.id === mid)!
              const live = Date.now() - (c.lastUsedAt || 0) < 60_000 && c.turns > 0
              return (
                <div
                  key={c.id}
                  className="rounded-lg border p-3 transition"
                  style={{
                    borderColor: live ? 'var(--zek-purple)' : 'var(--zek-line)',
                    background: 'var(--zek-bg-2)',
                    boxShadow: live ? `0 0 12px var(--zek-purple-soft)` : 'none',
                  }}
                >
                  <div className="flex items-start gap-2.5">
                    <Mascot id={mid} size={32} live={live} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-[12.5px] font-medium text-[var(--zek-text)] truncate">{ident.name}</span>
                        <span className="text-[9.5px] font-mono text-[var(--zek-text-3)]">{ident.domain}</span>
                      </div>
                      <div className="text-[10.5px] text-[var(--zek-text-2)] line-clamp-1 mb-1" title={c.name}>{c.name}</div>
                      <StatusBadge s={c} />
                    </div>
                  </div>
                  {c.lastSummary && (
                    <div
                      className="mt-2 text-[10px] text-[var(--zek-text)] line-clamp-3 leading-snug px-1.5 py-1 rounded bg-black/40 border border-[var(--zek-line)]"
                      title={c.lastSummary}
                    >
                      {c.lastSummary}
                    </div>
                  )}
                  <Link
                    href={`/automations?session=${c.id}`}
                    className="block mt-1.5 text-center font-mono text-[9.5px] text-[var(--zek-accent)] hover:text-[var(--zek-text)] transition"
                  >
                    ↪ открыть
                  </Link>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="px-5 py-3 text-center font-mono text-[10px] text-[var(--zek-text-3)] uppercase tracking-wider">
          без воркеров · соло-задача
        </div>
      )}
    </div>
  )
}

export default function FlowPage() {
  const [sessions, setSessions] = useState<AgentSession[]>([])

  useEffect(() => {
    let cancelled = false
    const pull = async () => {
      try {
        const s = await listAgentSessions(80)
        if (!cancelled) setSessions(s)
      } catch { /* ignore */ }
    }
    void pull()
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void pull()
    }, 4000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  /** Построить swimlanes — только root-сессии (parent=null) с их воркерами. */
  const lanes: Lane[] = useMemo(() => {
    const orchestrators = sessions.filter((s) => !s.parentSessionId)
    return orchestrators
      .map((p) => {
        const children = sessions.filter((c) => c.parentSessionId === p.id)
        children.sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0))
        const parentLive = Date.now() - (p.lastUsedAt || 0) < 60_000 && p.turns > 0
        const anyChildLive = children.some((c) => Date.now() - (c.lastUsedAt || 0) < 60_000 && c.turns > 0)
        return {
          parent: p,
          children,
          parentLive,
          parentDone: !parentLive && p.turns > 0,
          anyChildLive,
        }
      })
      .sort((a, b) => {
        // активные сверху, потом по lastUsedAt
        const aActive = a.parentLive || a.anyChildLive ? 1 : 0
        const bActive = b.parentLive || b.anyChildLive ? 1 : 0
        if (aActive !== bActive) return bActive - aActive
        return (b.parent.lastUsedAt || 0) - (a.parent.lastUsedAt || 0)
      })
  }, [sessions])

  const stats = useMemo(() => {
    const live = lanes.filter((l) => l.parentLive || l.anyChildLive).length
    const totalChildren = lanes.reduce((acc, l) => acc + l.children.length, 0)
    return { lanes: lanes.length, live, children: totalChildren }
  }, [lanes])

  return (
    <div
      className="min-h-screen text-[var(--zek-text)]"
      style={{
        background: 'var(--zek-bg)',
        fontFamily: 'var(--zek-font-active, "Geist", system-ui, -apple-system, sans-serif)',
      }}
    >
      <header className="h-12 border-b border-[var(--zek-line)] flex items-center px-5 gap-6 sticky top-0 z-20 bg-[var(--zek-bg)]">
        <Link href="/automations" className="text-[var(--zek-text-2)] hover:text-[var(--zek-text)] transition flex items-center gap-1.5 text-[13px]">
          <ArrowLeft className="w-3.5 h-3.5" />
          к автоматам
        </Link>
        <span className="flex items-center gap-2.5">
          <span className="w-[18px] h-[18px] rounded grid place-items-center font-mono text-[11px] font-bold" style={{ background: 'var(--zek-accent)', color: '#062014' }}>з</span>
          <span className="font-mono text-[13px] tracking-wider">
            зек <span className="text-[var(--zek-text-3)]">/ поток</span>
          </span>
        </span>
        <span className="flex-1" />
        <Link href="/automations/squad" className="font-mono text-[11px] text-[var(--zek-text-2)] hover:text-[var(--zek-text)] transition">
          → отряд
        </Link>
      </header>

      <div className="px-8 pt-7 pb-10">
        <div className="flex items-end justify-between mb-7 gap-4 flex-wrap">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--zek-text-3)] mb-1.5">
              поток · live · обновление 4с
            </div>
            <h1 className="text-[28px] font-semibold tracking-tight m-0">Как они общаются</h1>
          </div>
          <div className="flex gap-5 font-mono text-xs text-[var(--zek-text-2)]">
            <span><b className="text-[var(--zek-text)] font-medium">{stats.lanes}</b> оркестратор{stats.lanes === 1 ? '' : 'ов'}</span>
            <span><b className="text-[var(--zek-purple)] font-medium">{stats.live}</b> идут прямо сейчас</span>
            <span><b className="text-[var(--zek-text)] font-medium">{stats.children}</b> воркер{stats.children === 1 ? '' : 'ов'} суммарно</span>
          </div>
        </div>

        {lanes.length === 0 ? (
          <div className="text-center py-20 text-[var(--zek-text-3)] font-mono text-[12px] uppercase tracking-wider">
            пока никто никого не позвал · зайди в /automations и запусти оркестратор
          </div>
        ) : (
          <div className="space-y-5">
            {lanes.map((l) => <LaneCard key={l.parent.id} lane={l} />)}
          </div>
        )}
      </div>

      <TweaksPanel />
    </div>
  )
}

function formatRel(ts: number): string {
  const ageMs = Date.now() - ts
  const m = Math.floor(ageMs / 60_000)
  if (m < 1) return 'сейчас'
  if (m < 60) return `${m}м назад`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}ч назад`
  const d = Math.floor(h / 24)
  return `${d}д назад`
}
