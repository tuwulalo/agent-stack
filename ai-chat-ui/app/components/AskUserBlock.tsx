'use client'

import { useState } from 'react'
import { CheckCircle2, MessageCircleQuestion, Send } from 'lucide-react'
import type { AskUserPayload } from '../lib/automation'

interface Props {
  payload: AskUserPayload
  /** Already-submitted answers (parallel array, one entry per question) */
  answered?: string[][]
  onSubmit: (formatted: string, byQuestion: string[][]) => void
}

/**
 * Inline interactive widget rendered inside the terminal when the agent
 * prints a [[ASK_USER]]{...}[[/ASK_USER]] block. Mirrors the Claude
 * AskUserQuestion UX: single-select radio per question (multi-select = checkboxes),
 * label + description per option, "Other" free-text fallback, submit button
 * that formats answers and pipes them back as the next --resume prompt.
 */
export function AskUserBlock({ payload, answered, onSubmit }: Props) {
  // Defensive: payload could come from a stale localStorage hydration where
  // shape changed across versions — fall back to an empty question set so the
  // page doesn't crash on render.
  const questions = Array.isArray(payload?.questions) ? payload.questions : []
  const isLocked = Array.isArray(answered) && answered.length > 0
  // per-question selected option indices
  const [selected, setSelected] = useState<number[][]>(
    questions.map(() => []),
  )
  // per-question "Other" free-text answer
  const [other, setOther] = useState<string[]>(questions.map(() => ''))

  const toggle = (qi: number, oi: number) => {
    if (isLocked) return
    setSelected((prev) => {
      const next = prev.map((arr) => [...arr])
      const cur = next[qi]
      const multi = !!questions[qi]?.multiSelect
      if (multi) {
        const i = cur.indexOf(oi)
        if (i >= 0) cur.splice(i, 1)
        else cur.push(oi)
      } else {
        next[qi] = [oi]
      }
      return next
    })
  }

  const allAnswered = questions.every(
    (q, qi) => (selected[qi]?.length ?? 0) > 0 || (other[qi] || '').trim().length > 0,
  )

  const submit = () => {
    if (isLocked || !allAnswered) return
    const byQuestion: string[][] = questions.map((q, qi) => {
      const sel = Array.isArray(selected[qi]) ? selected[qi] : []
      const labels = sel.map((oi) => q.options?.[oi]?.label).filter(Boolean) as string[]
      const o = (other[qi] || '').trim()
      return o ? [...labels, o] : labels
    })
    const lines: string[] = ['Ответы пользователя:', '']
    questions.forEach((q, qi) => {
      const header = q.header || q.question
      const ans = byQuestion[qi]
      if (ans.length === 0) {
        lines.push(`- **${header}**: _(пропущено)_`)
      } else if (ans.length === 1) {
        lines.push(`- **${header}**: «${ans[0]}»`)
      } else {
        lines.push(`- **${header}**: ${ans.map((a) => '«' + a + '»').join(', ')}`)
      }
    })
    lines.push('', 'Продолжай с этими решениями.')
    onSubmit(lines.join('\n'), byQuestion)
  }

  return (
    <div className="my-2 rounded-lg border border-violet-400/25 bg-gradient-to-br from-violet-500/[0.08] to-indigo-500/[0.04] overflow-hidden">
      <div className="px-3.5 py-2 flex items-center gap-2 border-b border-violet-400/15 bg-violet-500/[0.06]">
        <MessageCircleQuestion className="w-4 h-4 text-violet-300" />
        <div className="text-[12px] font-medium text-white/90 flex-1">
          {isLocked ? 'Вопросы (ответ отправлен)' : 'Агент спрашивает'}
        </div>
        <span className="text-[10px] text-white/40 tabular-nums">
          {questions.length} вопрос{questions.length === 1 ? '' : questions.length < 5 ? 'а' : 'ов'}
        </span>
      </div>

      <div className="px-3.5 py-3 space-y-4">
        {questions.map((q, qi) => {
          const lockedAns = isLocked ? answered?.[qi] : null
          const options = Array.isArray(q?.options) ? q.options : []
          return (
            <div key={qi}>
              {q.header && (
                <div className="text-[10px] uppercase tracking-wider text-violet-300/85 mb-0.5">
                  {q.header}
                </div>
              )}
              <div className="text-[13px] text-white/95 mb-2">{q.question}</div>
              <div className="space-y-1">
                {options.map((opt, oi) => {
                  const picked = Array.isArray(selected[qi]) && selected[qi].includes(oi)
                  const wasAnswered = Array.isArray(lockedAns) && lockedAns.includes(opt.label)
                  const active = isLocked ? wasAnswered : picked
                  const multi = !!q.multiSelect
                  return (
                    <button
                      key={oi}
                      onClick={() => toggle(qi, oi)}
                      disabled={isLocked}
                      className={
                        'w-full text-left px-2.5 py-2 rounded-md border transition flex items-start gap-2.5 ' +
                        (active
                          ? 'border-violet-400/45 bg-violet-500/15'
                          : 'border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/15') +
                        (isLocked ? ' opacity-90 cursor-default' : ' cursor-pointer')
                      }
                    >
                      <span
                        className={
                          'flex-shrink-0 mt-0.5 grid place-items-center w-4 h-4 ' +
                          (multi ? 'rounded' : 'rounded-full') +
                          ' border ' +
                          (active
                            ? 'border-violet-300 bg-violet-400/30'
                            : 'border-white/25 bg-transparent')
                        }
                      >
                        {active && (multi
                          ? <CheckCircle2 className="w-3 h-3 text-violet-100" />
                          : <span className="w-1.5 h-1.5 rounded-full bg-violet-100" />)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className={'text-[12.5px] ' + (active ? 'text-white font-medium' : 'text-white/85')}>{opt.label}</div>
                        {opt.description && (
                          <div className="text-[11px] text-white/45 leading-snug mt-0.5">{opt.description}</div>
                        )}
                      </div>
                    </button>
                  )
                })}
                {!isLocked && (
                  <input
                    value={other[qi]}
                    onChange={(e) => setOther((p) => p.map((x, i) => (i === qi ? e.target.value : x)))}
                    placeholder="…или впиши свой ответ"
                    className="w-full px-2.5 py-1.5 rounded-md bg-black/30 border border-white/[0.06] text-[12px] text-white/85 placeholder:text-white/30 outline-none focus:border-violet-400/40 transition"
                  />
                )}
              </div>
            </div>
          )
        })}
      </div>

      {!isLocked && (
        <div className="flex items-center gap-2 px-3.5 py-2.5 border-t border-violet-400/15 bg-black/20">
          <span className="text-[10.5px] text-white/40">
            ответ улетит как новый ход в той же сессии (--resume)
          </span>
          <span className="flex-1" />
          <button
            onClick={submit}
            disabled={!allAnswered}
            className="px-3 py-1.5 rounded-md text-[12px] bg-gradient-to-b from-violet-500 to-indigo-600 text-white hover:from-violet-400 hover:to-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center gap-1.5"
          >
            <Send className="w-3.5 h-3.5" />
            Отправить
          </button>
        </div>
      )}
    </div>
  )
}
