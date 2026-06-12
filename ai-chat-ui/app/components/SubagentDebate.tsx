'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronRight, X, Users, Check, AlertTriangle, Hourglass,
  ArrowDownLeft, ArrowUpRight, Send, MessageSquare,
} from 'lucide-react'
import { SubagentMascot } from '@/components/ui/subagent-mascot'
import { Markdown } from './Markdown'
import { type Persona, pickPersona } from '../lib/personas'
import type { SubagentResult, SubagentTask } from '../lib/agent'

function statusInfo(status?: string | null) {
  const s = (status || '').toLowerCase()
  if (s.includes('compl') || s === 'ok' || s === 'done')
    return { Icon: Check, fg: 'text-emerald-300', bg: 'bg-emerald-500/15', label: 'готово' }
  if (s.includes('fail') || s.includes('error'))
    return { Icon: AlertTriangle, fg: 'text-red-300', bg: 'bg-red-500/15', label: 'ошибка' }
  if (s.includes('pending') || s.includes('running') || s.includes('wait'))
    return { Icon: Hourglass, fg: 'text-amber-300', bg: 'bg-amber-500/15', label: 'ждёт' }
  return { Icon: Hourglass, fg: 'text-white/55', bg: 'bg-white/[0.06]', label: status || 'в работе' }
}

function previewText(s: string, n: number) {
  const t = (s || '').replace(/\s+/g, ' ').trim()
  if (t.length <= n) return t
  return t.slice(0, n) + '…'
}

export interface SubagentDebateProps {
  subtasks?: SubagentTask[]
  results?: SubagentResult[]
  /** When true, cards stagger in (used while live streaming) */
  streaming?: boolean
}

export function SubagentDebate({ subtasks, results, streaming }: SubagentDebateProps) {
  const tasks = subtasks || []
  const res = results || []
  const count = Math.max(tasks.length, res.length)
  if (count === 0) return null

  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const [open, setOpen] = useState(true)

  // pair tasks ↔ results by index, attach a stable persona by index
  const cards = Array.from({ length: count }, (_, i) => ({
    index: i,
    goal: tasks[i]?.goal || '',
    context: tasks[i]?.context || null,
    role: tasks[i]?.role || null,
    toolsets: tasks[i]?.toolsets || null,
    status: res[i]?.status || (res.length === 0 ? 'pending' : null),
    summary: res[i]?.summary || '',
    error: res[i]?.error || null,
    exitReason: res[i]?.exitReason || null,
    durationSec: res[i]?.durationSec ?? null,
    apiCalls: res[i]?.apiCalls ?? null,
    toolTrace: res[i]?.toolTrace || null,
    persona: pickPersona(i),
  }))

  const completed = cards.filter((c) => c.status && /compl|ok|done/i.test(c.status)).length

  return (
    <div className="my-2 rounded-lg border border-cyan-500/20 bg-gradient-to-b from-cyan-500/[0.05] to-transparent overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-[11.5px] text-white/80 hover:text-white hover:bg-white/[0.03] transition"
      >
        <Users className="w-3.5 h-3.5 text-cyan-300/85" />
        <span className="uppercase tracking-[0.1em] text-cyan-200/85">Дебаты</span>
        <span className="text-white/40">·</span>
        <span className="text-white/65">
          {count} саб-агент{count === 1 ? '' : count < 5 ? 'а' : 'ов'}
          {res.length > 0 && ` · ${completed}/${count} ответили`}
        </span>
        {streaming && (
          <span className="ml-1 flex items-center gap-1 text-[10px] text-cyan-300/80">
            <span className="w-1 h-1 rounded-full bg-cyan-300 animate-pulse" />
            live
          </span>
        )}
        <ChevronRight
          className={`w-3.5 h-3.5 ml-auto text-white/40 transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="grid"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className={
              'px-2 pb-2.5 grid gap-2 ' +
              (count === 1
                ? 'grid-cols-1'
                : count === 2
                  ? 'grid-cols-2'
                  : 'grid-cols-2 md:grid-cols-3')
            }
          >
            {cards.map((c, i) => {
              const st = statusInfo(c.status)
              return (
                <motion.button
                  key={i}
                  type="button"
                  onClick={() => setOpenIndex(i)}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.08, duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
                  className={
                    'group flex flex-col text-left rounded-md bg-black/35 ring-1 transition shadow-md p-2 ' +
                    'hover:bg-black/50 hover:scale-[1.01] cursor-pointer ' +
                    c.persona.ringClass + ' ' + c.persona.glowClass
                  }
                  title={`${c.persona.name} · ${st.label} — открыть полную работу`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="w-6 h-6 grid place-items-center bg-black/50 ring-1 ring-white/10 rounded overflow-hidden flex-shrink-0">
                      <SubagentMascot
                        size={20}
                        bodyFrom={c.persona.bodyFrom}
                        bodyTo={c.persona.bodyTo}
                        visor={c.persona.visor}
                      />
                    </span>
                    <span className={'flex-1 min-w-0 truncate text-[12px] font-semibold ' + c.persona.labelClass}>
                      {c.persona.name}
                    </span>
                    <span
                      className={'flex-shrink-0 w-5 h-5 grid place-items-center rounded-full ' + st.bg + ' ' + st.fg}
                      title={st.label}
                    >
                      <st.Icon className="w-3 h-3" />
                    </span>
                  </div>
                  {c.role && (
                    <span className="text-[9.5px] uppercase tracking-[0.12em] text-white/35 font-mono mb-1">
                      {c.role}
                    </span>
                  )}
                  {c.goal && (
                    <div className="text-[11px] text-white/55 mb-1.5 leading-snug">
                      <span className="text-white/35 mr-1">цель:</span>
                      {previewText(c.goal, 80)}
                    </div>
                  )}
                  {c.error || (c.status && /fail|error/i.test(c.status)) ? (
                    <div className="text-[11.5px] text-red-300/85 leading-snug">
                      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-red-300/65 mb-0.5">
                        <AlertTriangle className="w-3 h-3" />
                        {c.exitReason || 'failed'}
                      </div>
                      {c.error
                        ? previewText(c.error, 160)
                        : <span className="text-white/40 italic">детали в окне</span>}
                    </div>
                  ) : (
                    <div className="text-[12px] text-white/85 leading-[1.45] line-clamp-4">
                      {c.summary
                        ? previewText(c.summary, 220)
                        : <span className="text-white/40 italic">думает…</span>}
                    </div>
                  )}
                  {c.toolTrace && c.toolTrace.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {c.toolTrace.slice(0, 3).map((tt, ti) => (
                        <span
                          key={ti}
                          className={
                            'text-[9.5px] font-mono px-1.5 py-0.5 rounded ' +
                            (/ok|success|complet/i.test(tt.status || '')
                              ? 'bg-emerald-500/10 text-emerald-300/85'
                              : 'bg-red-500/10 text-red-300/85')
                          }
                          title={`${tt.tool} · ${tt.status || ''}`}
                        >
                          {tt.tool}
                        </span>
                      ))}
                      {c.toolTrace.length > 3 && (
                        <span className="text-[9.5px] font-mono text-white/45 px-1">
                          +{c.toolTrace.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </motion.button>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>

      <SubagentDetail
        card={openIndex !== null ? cards[openIndex] : null}
        onClose={() => setOpenIndex(null)}
      />
    </div>
  )
}

interface SubagentDetailProps {
  card: {
    index: number
    goal: string
    context: string | null
    role: string | null
    toolsets: string[] | null
    status: string | null
    summary: string
    error: string | null
    exitReason: string | null
    durationSec: number | null
    apiCalls: number | null
    toolTrace: import('../lib/agent').SubagentToolTrace[] | null
    persona: Persona
  } | null
  onClose: () => void
}

function SubagentDetail({ card, onClose }: SubagentDetailProps) {
  useEffect(() => {
    if (!card) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [card, onClose])

  return (
    <AnimatePresence>
      {card && (
        <motion.div
          key="bg"
          className="fixed inset-0 z-[110] flex items-center justify-center p-6 cursor-zoom-out backdrop-blur-2xl bg-black/65"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
          onClick={onClose}
        >
          <motion.div
            key="card"
            className={
              'relative max-w-[640px] w-full max-h-[88vh] overflow-auto cursor-default ' +
              'rounded-xl border bg-[#0b0a14] ring-2 shadow-[0_30px_80px_rgba(0,0,0,0.7)] ' +
              card.persona.ringClass + ' ' + card.persona.glowClass + ' ' +
              'border-white/[0.08]'
            }
            initial={{ scale: 0.92, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.94, opacity: 0, y: 4 }}
            transition={{ type: 'spring', damping: 30, stiffness: 220, mass: 0.9 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className={
                'flex items-center gap-2.5 px-4 py-3 border-b border-white/[0.06] sticky top-0 backdrop-blur ' +
                'bg-gradient-to-b ' + card.persona.accentClass + ' to-transparent'
              }
            >
              <span className="w-9 h-9 grid place-items-center bg-black/55 ring-1 ring-white/10 rounded-md overflow-hidden flex-shrink-0">
                <SubagentMascot
                  size={28}
                  bodyFrom={card.persona.bodyFrom}
                  bodyTo={card.persona.bodyTo}
                  visor={card.persona.visor}
                />
              </span>
              <div className="flex flex-col leading-tight flex-1 min-w-0">
                <span className={'text-[14px] font-bold ' + card.persona.labelClass}>
                  {card.persona.name}
                </span>
                <span className="text-[10.5px] text-white/45 uppercase tracking-wider">
                  саб-агент #{card.index + 1}
                  {card.role && ` · ${card.role}`}
                </span>
              </div>
              {card.status && (() => {
                const st = statusInfo(card.status)
                return (
                  <span
                    className={
                      'flex items-center gap-1.5 px-2 py-1 rounded text-[11px] uppercase tracking-wider ' +
                      st.bg + ' ' + st.fg
                    }
                  >
                    <st.Icon className="w-3.5 h-3.5" />
                    {st.label}
                  </span>
                )
              })()}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onClose()
                }}
                className="w-8 h-8 grid place-items-center rounded-md text-white/55 hover:text-white hover:bg-white/[0.06]"
                aria-label="Закрыть"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 📤 Orchestrator → Subagent */}
            <section className="px-4 py-3 border-b border-white/[0.05]">
              <div className="flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-[0.14em] text-white/45">
                <ArrowDownLeft className="w-3 h-3" />
                Orchestrator → {card.persona.name}
              </div>
              <div className="space-y-2.5 text-[13px]">
                {card.goal && (
                  <div>
                    <div className="text-[10.5px] uppercase text-white/35 tracking-wider mb-0.5">
                      цель
                    </div>
                    <div className="text-white/85 leading-[1.5] whitespace-pre-wrap break-words">
                      {card.goal}
                    </div>
                  </div>
                )}
                {card.context && (
                  <div>
                    <div className="text-[10.5px] uppercase text-white/35 tracking-wider mb-0.5">
                      контекст
                    </div>
                    <div className="text-white/70 leading-[1.5] whitespace-pre-wrap break-words text-[12.5px]">
                      {card.context}
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {card.role && (
                    <span className="px-2 py-0.5 rounded text-[10.5px] font-mono uppercase tracking-wider bg-white/[0.06] text-white/65">
                      role: {card.role}
                    </span>
                  )}
                  {card.toolsets && card.toolsets.length > 0 ? (
                    card.toolsets.map((t, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 rounded text-[10.5px] font-mono bg-white/[0.06] text-white/65"
                      >
                        🔧 {t}
                      </span>
                    ))
                  ) : (
                    <span className="px-2 py-0.5 rounded text-[10.5px] font-mono bg-white/[0.04] text-white/40">
                      🔧 toolsets: —
                    </span>
                  )}
                </div>
              </div>
            </section>

            {/* 🛠 What the subagent attempted (tool_trace from delegate_task) */}
            {(card.toolTrace && card.toolTrace.length > 0) && (
              <section className="px-4 py-3 border-b border-white/[0.05]">
                <div className="flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-[0.14em] text-white/45">
                  <MessageSquare className="w-3 h-3" />
                  что пробовал сделать ({card.toolTrace.length} вызов{card.toolTrace.length === 1 ? '' : card.toolTrace.length < 5 ? 'а' : 'ов'})
                </div>
                <div className="space-y-1">
                  {card.toolTrace.map((tt, i) => {
                    const ok = /ok|success|complet/i.test(tt.status || '')
                    return (
                      <div
                        key={i}
                        className={
                          'flex items-center gap-2 px-2 py-1 rounded text-[11.5px] font-mono ' +
                          (ok
                            ? 'bg-emerald-500/[0.06] border-l-2 border-emerald-400/40'
                            : 'bg-red-500/[0.06] border-l-2 border-red-400/40')
                        }
                      >
                        <span className="text-white/40 w-4 text-right">{i + 1}.</span>
                        <span className={ok ? 'text-emerald-200/85' : 'text-red-200/85'}>
                          {tt.tool}
                        </span>
                        {tt.status && (
                          <span className="text-white/35 text-[10.5px]">· {tt.status}</span>
                        )}
                        {(tt.argsBytes != null || tt.resultBytes != null) && (
                          <span className="text-white/30 text-[10px] ml-auto">
                            {tt.argsBytes != null && `↓${tt.argsBytes}b`}
                            {tt.argsBytes != null && tt.resultBytes != null && ' · '}
                            {tt.resultBytes != null && `↑${tt.resultBytes}b`}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
                {(card.exitReason || card.durationSec != null || card.apiCalls != null) && (
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[10.5px] text-white/45">
                    {card.exitReason && (
                      <span className="font-mono">exit: {card.exitReason}</span>
                    )}
                    {card.durationSec != null && (
                      <span className="font-mono">· {card.durationSec.toFixed(2)}s</span>
                    )}
                    {card.apiCalls != null && (
                      <span className="font-mono">· {card.apiCalls} api calls</span>
                    )}
                  </div>
                )}
              </section>
            )}

            {/* 💭 Subagent → Orchestrator */}
            <section className="px-4 py-3.5">
              <div className="flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-[0.14em] text-white/45">
                <ArrowUpRight className="w-3 h-3" />
                {card.persona.name} → Orchestrator
              </div>
              {card.error && (
                <div className="mb-3 flex items-start gap-2 px-3 py-2 rounded-md bg-red-500/[0.08] border border-red-500/20 text-[12.5px] text-red-200/90">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-red-300" />
                  <div className="font-mono break-words">{card.error}</div>
                </div>
              )}
              <div className="text-[14px] text-white/90 md leading-[1.6]">
                <Markdown text={card.summary || '_(саб-агент не дал текстового ответа)_'} />
              </div>
            </section>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
