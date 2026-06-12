'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, ChevronDown, Users } from 'lucide-react'
import { SubagentMascot } from '@/components/ui/subagent-mascot'
import { type CustomAgentExt, fetchAgents } from '../lib/customAgents'

export interface AgentPickerProps {
  /** Currently selected agent id (null = default Kimi, no persona) */
  agentId: string | null | undefined
  onChange: (id: string | null) => void
  /** Compact mode renders just the mascot+name pill (for the composer toolbar) */
  compact?: boolean
}

export function AgentPicker({ agentId, onChange, compact = true }: AgentPickerProps) {
  const [agents, setAgents] = useState<CustomAgentExt[]>([])
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    fetchAgents().then((list) => { if (!cancelled) setAgents(list) })
    return () => { cancelled = true }
  }, [])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const active = agentId ? agents.find((a) => a.id === agentId) : null

  // Don't render anything until agents loaded — avoids flicker
  if (agents.length === 0) return null

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={
          'flex items-center gap-1.5 h-8 px-2 rounded-md border text-[11px] transition ' +
          (active
            ? `bg-white/[0.04] hover:bg-white/[0.08] ${active.persona.ringClass.replace('ring-', 'border-')} ${active.persona.labelClass}`
            : 'bg-white/[0.02] hover:bg-white/[0.05] border-white/10 text-white/55 hover:text-white/85')
        }
        title={active?.description || 'Выбрать агента'}
      >
        {active ? (
          <>
            <span className="w-4 h-4 grid place-items-center bg-black/40 rounded-sm overflow-hidden flex-shrink-0">
              <SubagentMascot
                size={14}
                bodyFrom={active.persona.bodyFrom}
                bodyTo={active.persona.bodyTo}
                visor={active.persona.visor}
              />
            </span>
            <span className="truncate max-w-[140px]">{active.name}</span>
          </>
        ) : (
          <>
            <Users className="w-3.5 h-3.5" />
            <span>Агент</span>
          </>
        )}
        <ChevronDown className={'w-3 h-3 opacity-60 transition-transform ' + (open ? 'rotate-180' : '')} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            key="popover"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full mb-1.5 left-0 min-w-[260px] z-50 rounded-lg border border-white/10 bg-[#0b0a14]/95 backdrop-blur-xl shadow-2xl overflow-hidden"
          >
            <div className="px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-white/40 border-b border-white/[0.05]">
              Кастомные агенты · {agents.length}
            </div>
            <button
              type="button"
              onClick={() => { onChange(null); setOpen(false) }}
              className={
                'w-full flex items-center gap-2.5 px-3 py-2 text-[12.5px] transition ' +
                (!agentId ? 'bg-white/[0.04] text-white' : 'text-white/70 hover:bg-white/[0.04] hover:text-white')
              }
            >
              <span className="w-7 h-7 grid place-items-center bg-white/[0.04] border border-white/10 rounded text-white/45 text-[10px] uppercase">
                по умолч.
              </span>
              <div className="flex-1 min-w-0 text-left">
                <div className="truncate">Стандартный Kimi</div>
                <div className="text-[10.5px] text-white/40 truncate">Без специализации</div>
              </div>
              {!agentId && <Check className="w-4 h-4 text-emerald-300" />}
            </button>
            {agents.map((a) => {
              const isActive = a.id === agentId
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => { onChange(a.id); setOpen(false) }}
                  className={
                    'w-full flex items-center gap-2.5 px-3 py-2 text-[12.5px] transition ' +
                    (isActive ? 'bg-white/[0.04] text-white' : 'text-white/75 hover:bg-white/[0.04] hover:text-white')
                  }
                >
                  <span className="w-7 h-7 grid place-items-center bg-black/40 border border-white/10 rounded overflow-hidden flex-shrink-0">
                    <SubagentMascot
                      size={22}
                      bodyFrom={a.persona.bodyFrom}
                      bodyTo={a.persona.bodyTo}
                      visor={a.persona.visor}
                    />
                  </span>
                  <div className="flex-1 min-w-0 text-left">
                    <div className={'truncate font-medium ' + a.persona.labelClass}>{a.name}</div>
                    {a.description && (
                      <div className="text-[10.5px] text-white/45 truncate">{a.description}</div>
                    )}
                  </div>
                  {isActive && <Check className="w-4 h-4 text-emerald-300 flex-shrink-0" />}
                </button>
              )
            })}
            <div className="px-3 py-1.5 text-[10px] text-white/30 border-t border-white/[0.05]">
              Чтобы добавить агента — отредактируй <code className="text-white/55">/opt/kimi-mcp-proxy/agents.json</code>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
