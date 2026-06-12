'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight, Terminal, Wrench, FileText, Brain } from 'lucide-react'
import { SubagentMascot } from '@/components/ui/subagent-mascot'
import { SubagentDebate } from './SubagentDebate'
import type { AgentStep } from '../lib/agent'

interface PairedStep {
  call?: Extract<AgentStep, { kind: 'tool_call' }>
  result?: Extract<AgentStep, { kind: 'tool_result' }>
  note?: Extract<AgentStep, { kind: 'note' }>
  thinking?: Extract<AgentStep, { kind: 'thinking' }>
}

/** Pair tool_call + matching tool_result (by id) for nicer rendering. */
function pairSteps(steps: AgentStep[]): PairedStep[] {
  const out: PairedStep[] = []
  const callIndex = new Map<string, number>()
  for (const s of steps) {
    if (s.kind === 'tool_call') {
      const idx = out.length
      out.push({ call: s })
      if (s.toolCallId) callIndex.set(s.toolCallId, idx)
    } else if (s.kind === 'tool_result') {
      const idx = s.toolCallId ? callIndex.get(s.toolCallId) : undefined
      if (idx !== undefined && out[idx] && !out[idx].result) {
        out[idx].result = s
      } else {
        out.push({ result: s })
      }
    } else if (s.kind === 'note') {
      out.push({ note: s })
    } else if (s.kind === 'thinking') {
      out.push({ thinking: s })
    }
  }
  return out
}

function toolIcon(name: string) {
  const n = name.toLowerCase()
  if (n.includes('term') || n.includes('shell') || n.includes('bash') || n.includes('cmd'))
    return <Terminal className="w-3.5 h-3.5" />
  if (n.includes('file') || n.includes('read') || n.includes('write') || n.includes('edit'))
    return <FileText className="w-3.5 h-3.5" />
  return <Wrench className="w-3.5 h-3.5" />
}

export function AgentTrace({
  steps,
  streaming,
}: {
  steps: AgentStep[]
  streaming: boolean
}) {
  const [open, setOpen] = useState(true)
  const paired = pairSteps(steps)
  if (paired.length === 0) return null

  const toolCalls = steps.filter((s) => s.kind === 'tool_call').length

  return (
    <div className="mb-3 rounded-lg border border-violet-500/15 bg-gradient-to-b from-violet-500/[0.04] to-transparent overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-[11.5px] text-white/70 hover:text-white hover:bg-white/[0.03] transition"
      >
        <Brain className="w-3.5 h-3.5 text-violet-300/80" />
        <span className="uppercase tracking-[0.1em] text-violet-200/75">
          Thought process
        </span>
        <span className="text-white/40">·</span>
        <span className="text-white/55">
          {toolCalls > 0 ? `${toolCalls} tool call${toolCalls === 1 ? '' : 's'}` : `${paired.length} step${paired.length === 1 ? '' : 's'}`}
        </span>
        {streaming && (
          <span className="ml-1 flex items-center gap-1 text-[10px] text-violet-300/80">
            <span className="w-1 h-1 rounded-full bg-violet-300 animate-pulse" />
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
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="px-3 pb-2.5 pt-0.5 space-y-2"
          >
            {paired.map((p, i) => {
              // Special render for delegate_task — show debate panel instead of generic row
              if (p.call && p.call.subagent && p.call.name === 'delegate_task') {
                return (
                  <SubagentDebate
                    key={i}
                    subtasks={p.call.subtasks}
                    results={p.result?.subagentResults}
                    streaming={streaming && !p.result}
                  />
                )
              }
              return (
              <div
                key={i}
                className="rounded-md border border-white/[0.06] bg-black/30 overflow-hidden"
              >
                {p.call && (
                  <div
                    className={
                      'flex items-center gap-2 px-2.5 py-1.5 text-[11.5px] ' +
                      (p.call.subagent
                        ? 'bg-cyan-500/[0.06] border-l-2 border-cyan-400/60'
                        : 'bg-white/[0.025]') +
                      ' text-white/85'
                    }
                  >
                    {p.call.subagent ? (
                      <span className="flex-shrink-0 w-5 h-5 grid place-items-center bg-cyan-500/10 border border-cyan-400/30 rounded overflow-hidden">
                        <SubagentMascot size={16} />
                      </span>
                    ) : (
                      <span className="text-violet-300/85">{toolIcon(p.call.name)}</span>
                    )}
                    <span
                      className={
                        'font-mono ' +
                        (p.call.subagent ? 'text-cyan-200/90' : 'text-violet-200/85')
                      }
                    >
                      {p.call.name}
                    </span>
                    {p.call.subagent && p.call.subagentRole && (
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-200/85">
                        {p.call.subagentRole}
                      </span>
                    )}
                    {p.call.subagent && !p.call.subagentRole && (
                      <span className="text-[10px] uppercase tracking-wider text-cyan-300/65">
                        sub-agent
                      </span>
                    )}
                    {p.call.args && (
                      <code className="font-mono text-[11px] text-white/55 truncate" title={p.call.args}>
                        {p.call.args}
                      </code>
                    )}
                  </div>
                )}
                {p.result && (
                  <pre className="px-2.5 py-1.5 text-[11px] leading-[1.55] text-white/65 font-mono whitespace-pre-wrap break-words max-h-44 overflow-auto">
                    {p.result.text}
                  </pre>
                )}
                {p.note && !p.call && !p.result && (
                  <div className="px-2.5 py-1.5 text-[11.5px] text-white/65">
                    {p.note.text}
                  </div>
                )}
                {p.thinking && !p.call && !p.result && !p.note && (
                  <div className="px-2.5 py-2 text-[11.5px] italic text-white/55 leading-relaxed bg-violet-500/[0.03] border-l-2 border-violet-400/30">
                    <div className="flex items-center gap-1.5 not-italic mb-1 text-[10px] uppercase tracking-wider text-violet-300/70">
                      <Brain className="w-3 h-3" />
                      thinking
                    </div>
                    {p.thinking.text}
                  </div>
                )}
              </div>
              )
            })}
            {streaming && (
              <div className="flex items-center gap-2 px-1 py-1 text-[11px] text-white/45">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-300/70 animate-pulse" />
                <span>Hermes is still working…</span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
