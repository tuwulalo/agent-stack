'use client'

import { useMemo, useRef, useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, Radio } from 'lucide-react'
import {
  Mascot,
  buildRosterFromSessions,
  buildConnectionsFromSessions,
  type MascotMeta,
  type MascotStatus,
  type Connection,
} from '../../components/Mascot'
import { listAgentSessions, type AgentSession } from '../../lib/agent-sessions'
import { TweaksPanel } from '../../components/TweaksPanel'

/**
 * «Отряд» — всё runtime-состояние берётся из живых серверных сессий
 * (auto-refresh каждые 4с). Никаких демо-данных:
 *   • ROSTER_IDENTITY → только имя/роль/домен/traits/defaultPrompt
 *   • buildRosterFromSessions() → реальные status/turns/runtime/lastTask
 *   • buildConnectionsFromSessions() → реальные parent→child дуги между маскотами
 *
 * Клик «↪ позвать в автомат»:
 *   • если у маскота уже есть свежая сессия → открыть её (?session=<id>)
 *   • если нет → открыть /automations с pre-filled промптом под этот домен
 */

function StatusDot({ status }: { status: MascotStatus }) {
  const cls = status === 'active' ? 'bg-violet-400 shadow-[0_0_8px_rgba(167,139,250,0.4)]'
            : status === 'ready'  ? 'bg-emerald-400 shadow-[0_0_8px_rgba(74,222,128,0.4)]'
            : status === 'idle'   ? 'bg-white/30'
            : 'bg-amber-400'
  return <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${cls}`} />
}

interface MascotCardProps {
  agent: MascotMeta
  active: boolean
  live: boolean
  onClick: () => void
}
function MascotCard({ agent, active, live, onClick }: MascotCardProps) {
  const isWorking = live && agent.status === 'active'
  return (
    <div
      data-agent-anchor={agent.id}
      onClick={onClick}
      className={
        'squad-grid-cell relative cursor-pointer flex flex-col gap-3 p-5 transition-colors min-h-[220px] ' +
        (active ? 'bg-[var(--zek-bg-2)]' : 'bg-[var(--zek-bg-1)] hover:bg-[var(--zek-bg-2)]')
      }
      style={active ? { boxShadow: 'inset 0 0 0 1px var(--zek-accent-line)' } : undefined}
    >
      <div className="flex justify-between items-start">
        <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--zek-text-3)]">{agent.idx}</span>
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--zek-text-2)]">
          <StatusDot status={agent.status} />
          {agent.statusLabel}
        </span>
      </div>
      <Mascot id={agent.id} size={56} live={isWorking} />
      <div>
        <p className="m-0 text-[15px] font-semibold tracking-tight text-[var(--zek-text)]">{agent.name}</p>
        <p className="m-0 text-xs leading-snug text-[var(--zek-text-2)]">{agent.role}</p>
      </div>
      <div className="mt-auto pt-2.5 border-t border-dashed border-[var(--zek-line)] font-mono text-[10px] text-[var(--zek-text-3)] flex justify-between gap-2">
        <span>{agent.domain}</span>
        <span className="text-[var(--zek-text-2)]">
          {agent.turns > 0 ? `${agent.turns} turn${agent.turns > 1 ? 's' : ''}` : '—'}
        </span>
      </div>
    </div>
  )
}

interface ConnectionsLayerProps {
  containerRef: React.RefObject<HTMLDivElement>
  connections: Connection[]
  live: boolean
}
function ConnectionsLayer({ containerRef, connections, live }: ConnectionsLayerProps) {
  const [paths, setPaths] = useState<Array<{ d: string; state: 'active' | 'done' }>>([])
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const recompute = () => {
      const rect = el.getBoundingClientRect()
      setSize({ w: rect.width, h: rect.height })
      const next = connections.map((c, i) => {
        const fromEl = el.querySelector(`[data-agent-anchor="${c.from}"]`)
        const toEl = el.querySelector(`[data-agent-anchor="${c.to}"]`)
        if (!fromEl || !toEl) return null
        const fr = fromEl.getBoundingClientRect()
        const tr = toEl.getBoundingClientRect()
        const x1 = fr.left + fr.width / 2 - rect.left
        const y1 = fr.top + 80 - rect.top
        const x2 = tr.left + tr.width / 2 - rect.left
        const y2 = tr.top + 80 - rect.top
        const mx = (x1 + x2) / 2
        const my = (y1 + y2) / 2
        const dx = x2 - x1, dy = y2 - y1
        const len = Math.sqrt(dx * dx + dy * dy) || 1
        const off = Math.min(70, len * 0.28)
        const sign = i % 2 === 0 ? 1 : -1
        const cxp = mx + (-dy / len) * off * sign
        const cyp = my + (dx / len) * off * sign
        return {
          d: `M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${cxp.toFixed(1)} ${cyp.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`,
          state: c.state,
        }
      }).filter(Boolean) as Array<{ d: string; state: 'active' | 'done' }>
      setPaths(next)
    }
    recompute()
    const ro = new ResizeObserver(recompute)
    ro.observe(el)
    window.addEventListener('resize', recompute)
    return () => { ro.disconnect(); window.removeEventListener('resize', recompute) }
  }, [containerRef, connections])

  if (!live || connections.length === 0) return null

  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none z-10 overflow-visible"
      width={size.w}
      height={size.h}
      viewBox={`0 0 ${size.w} ${size.h}`}
    >
      <defs>
        <marker id="arrowhead-purple" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L0,6 L6,3 z" fill="var(--zek-purple)" />
        </marker>
        <marker id="arrowhead-green" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L0,6 L6,3 z" fill="var(--zek-accent)" opacity="0.5" />
        </marker>
      </defs>
      {paths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          className={`connection-path ${p.state}`}
          markerEnd={p.state === 'active' ? 'url(#arrowhead-purple)' : 'url(#arrowhead-green)'}
        />
      ))}
    </svg>
  )
}

export default function SquadPage() {
  const [activeId, setActiveId] = useState<MascotMeta['id']>('maestro')
  const [liveMode, setLiveMode] = useState(true)
  const [serverSessions, setServerSessions] = useState<AgentSession[]>([])
  const gridRef = useRef<HTMLDivElement>(null)

  // Подтянуть сессии + auto-refresh каждые 4с пока вкладка видна
  useEffect(() => {
    let cancelled = false
    const pull = async () => {
      try {
        const s = await listAgentSessions(80)
        if (!cancelled) setServerSessions(s)
      } catch { /* offline / 502 — продолжаем с тем что есть */ }
    }
    void pull()
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void pull()
    }, 4000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  // Live-ростер и live-связи из реальных сессий (мемоизируем по lastUsedAt-сумме)
  const sessionFingerprint = useMemo(
    () => serverSessions.map((s) => `${s.id}:${s.turns}:${s.lastUsedAt}`).join('|'),
    [serverSessions],
  )
  const roster = useMemo(() => buildRosterFromSessions(serverSessions), [sessionFingerprint])
  const connections = useMemo(() => buildConnectionsFromSessions(serverSessions), [sessionFingerprint])

  const active = roster.find((a) => a.id === activeId)
  const counts = useMemo(() => {
    const c = { active: 0, ready: 0, idle: 0, failed: 0 }
    roster.forEach((a) => { c[a.status] += 1 })
    return c
  }, [roster])

  /** Открыть автомат: если у маскота уже есть свежая сессия → continue её;
      иначе — открыть /automations с pre-filled промптом под этот домен. */
  const openInAutomations = useCallback((m: MascotMeta) => {
    if (m.sessionId) {
      window.location.href = `/automations?session=${m.sessionId}`
    } else {
      const prefill = encodeURIComponent(m.defaultPrompt)
      window.location.href = `/automations?prefill=${prefill}&mascot=${m.id}`
    }
  }, [])

  return (
    <div
      className="min-h-screen text-[var(--zek-text)]"
      style={{
        background: 'var(--zek-bg)',
        fontFamily: 'var(--zek-font-active, "Geist", system-ui, -apple-system, sans-serif)',
      }}
    >
      {/* top bar */}
      <header className="h-12 border-b border-[var(--zek-line)] flex items-center px-5 gap-6 sticky top-0 z-20 bg-[var(--zek-bg)]">
        <Link href="/automations" className="text-[var(--zek-text-2)] hover:text-[var(--zek-text)] transition flex items-center gap-1.5 text-[13px]">
          <ArrowLeft className="w-3.5 h-3.5" />
          к автоматам
        </Link>
        <span className="flex items-center gap-2.5">
          <span
            className="w-[18px] h-[18px] rounded grid place-items-center font-mono text-[11px] font-bold"
            style={{ background: 'var(--zek-accent)', color: '#062014' }}
          >
            з
          </span>
          <span className="font-mono text-[13px] tracking-wider">
            зек <span className="text-[var(--zek-text-3)]">/ отряд</span>
          </span>
        </span>
      </header>

      <div className="px-10 pt-8 pb-6 overflow-y-auto">
        <div className="flex items-end justify-between mb-7 gap-6 flex-wrap">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--zek-text-3)] mb-1.5">
              отряд · 10 саб-агентов
            </div>
            <h1 className="text-[28px] font-semibold tracking-tight m-0">Кого позовём в этот раз?</h1>
          </div>
          <div className="flex gap-6 font-mono text-xs text-[var(--zek-text-2)] items-center flex-wrap">
            <span className="flex items-center gap-1.5">
              <StatusDot status="active" />
              <b className="text-[var(--zek-text)] font-medium">{counts.active}</b> идут
            </span>
            <span className="flex items-center gap-1.5">
              <StatusDot status="ready" />
              <b className="text-[var(--zek-text)] font-medium">{counts.ready}</b> готовы
            </span>
            <span className="flex items-center gap-1.5">
              <StatusDot status="idle" />
              <b className="text-[var(--zek-text)] font-medium">{counts.idle}</b> ждут
            </span>
            <button
              onClick={() => setLiveMode((v) => !v)}
              className={
                'inline-flex items-center gap-2 px-2.5 py-1 pl-1.5 rounded-full border text-[11px] transition cursor-pointer ' +
                (liveMode
                  ? 'border-[var(--zek-purple)] text-[var(--zek-purple)] bg-[var(--zek-purple-soft)]'
                  : 'border-[var(--zek-line)] text-[var(--zek-text-2)] bg-[var(--zek-bg-1)] hover:text-[var(--zek-text)]')
              }
            >
              <span
                className={'w-1.5 h-1.5 rounded-full ' + (liveMode ? 'bg-[var(--zek-purple)]' : 'bg-[var(--zek-text-3)]')}
                style={liveMode ? { animation: 'zek-pulse-dot 1.4s infinite' } : undefined}
              />
              живой режим
            </button>
          </div>
        </div>

        {/* squad grid + connections */}
        <div className="relative" ref={gridRef}>
          <div
            className="grid grid-cols-5 gap-px rounded-[10px] overflow-hidden border border-[var(--zek-line)]"
            style={{ background: 'var(--zek-line)' }}
          >
            {roster.map((a) => (
              <MascotCard
                key={a.id}
                agent={a}
                active={a.id === activeId}
                live={liveMode}
                onClick={() => setActiveId(a.id)}
              />
            ))}
          </div>
          <ConnectionsLayer containerRef={gridRef} connections={connections} live={liveMode} />
        </div>

        {/* mascot detail */}
        {active && (
          <div
            className="mt-8 border border-[var(--zek-line)] rounded-[10px] p-6 px-7 grid items-center gap-7"
            style={{ gridTemplateColumns: 'auto 1fr auto', background: 'var(--zek-bg-1)' }}
          >
            <div style={{ width: 80, height: 80 }}>
              <Mascot id={active.id} size={80} live={liveMode && active.status === 'active'} />
            </div>
            <div>
              <h2 className="m-0 mb-1.5 text-xl font-semibold tracking-tight">
                {active.name} <span className="text-[var(--zek-text-3)]">· {active.domain}</span>
              </h2>
              <div className="text-[var(--zek-text-2)] text-[13px] leading-[1.5]">
                {active.role}.{' '}
                {active.sessionId
                  ? <>Последняя задача: <span className="text-[var(--zek-text)]">{active.lastTask}</span></>
                  : <span className="text-[var(--zek-text-3)] italic">пока не звал — нажми «позвать в автомат» чтобы начать</span>
                }
              </div>
              <div className="flex gap-1.5 mt-2.5 flex-wrap">
                {active.traits.map((t) => (
                  <span
                    key={t}
                    className="font-mono text-[10px] py-0.5 px-2 rounded text-[var(--zek-text-2)] tracking-wide"
                    style={{ background: 'var(--zek-bg-2)' }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5 font-mono text-[11px] text-[var(--zek-text-3)] text-right">
              <div>
                статус ·{' '}
                <b
                  style={{
                    color: active.status === 'active' ? 'var(--zek-purple)'
                      : active.status === 'ready' ? 'var(--zek-accent)'
                      : 'var(--zek-text-2)',
                    fontWeight: 500,
                  }}
                >
                  {active.statusLabel}
                </b>
              </div>
              <div>
                turns · <b className="text-[var(--zek-text)] font-medium">{active.turns}</b>
              </div>
              <div>
                runtime · <b className="text-[var(--zek-text)] font-medium">{active.runtime}</b>
              </div>
              <button
                onClick={() => openInAutomations(active)}
                className="mt-2 py-1.5 px-3.5 rounded-md text-xs font-semibold border-0 cursor-pointer inline-flex items-center gap-1.5 self-end"
                style={{ background: 'var(--zek-accent)', color: '#062014', fontFamily: 'inherit' }}
                title={active.sessionId
                  ? `Открыть свежую сессию ${active.sessionId}`
                  : `Новая сессия с дефолтным промптом для ${active.name}`}
              >
                <Radio className="w-3 h-3" />
                {active.sessionId ? '↪ продолжить' : '+ позвать в автомат'}
              </button>
            </div>
          </div>
        )}

        {/* hint footer */}
        <div className="mt-6 text-center font-mono text-[10px] text-[var(--zek-text-3)] uppercase tracking-[0.12em]">
          {serverSessions.length > 0
            ? `${serverSessions.length} live-сессий · ${connections.length} parent→child связей · обновление каждые 4с`
            : 'нет активных сессий · нажми на маскота → «позвать в автомат» чтобы начать'}
        </div>
      </div>

      <TweaksPanel />
    </div>
  )
}
