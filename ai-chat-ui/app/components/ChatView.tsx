'use client'

import { useEffect, useRef, useState } from 'react'
import { Markdown } from './Markdown'
import { CheckIcon, CopyIcon, RefreshIcon, SparkIcon } from './icons'
import type { Message, Session } from '../lib/types'
import { MODELS } from '../lib/config'

interface Props {
  session: Session | null
  busy: boolean
  onSuggestion: (text: string) => void
  onRegenerate: () => void
}

const SUGGESTIONS = [
  { title: 'Explain code',    prompt: 'Explain this TypeScript snippet: ```ts\n\n```' },
  { title: 'Write a service', prompt: 'Write an Express endpoint POST /api/widgets with zod validation and a Vitest test.' },
  { title: 'SQL query',       prompt: 'Write SQL for PostgreSQL: top 10 users by total order amount over the last 30 days.' },
  { title: 'Hermes command',  prompt: 'Suggest a hermes command to start the agent in gateway mode with an openrouter fallback.' },
]

export function ChatView({ session, busy, onSuggestion, onRegenerate }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [session?.messages])

  const visible = session?.messages.filter(m => m.role !== 'system') ?? []
  const lastAssistant = [...visible].reverse().find(m => m.role === 'assistant')

  const onCopyMessage = async (m: Message) => {
    try {
      await navigator.clipboard.writeText(m.content)
      setCopiedId(m.id)
      setTimeout(() => setCopiedId(null), 1400)
    } catch { /* clipboard blocked */ }
  }

  return (
    <div className="messages" ref={scrollRef}>
      {visible.length === 0 ? (
        <div className="empty-state">
          <div className="empty-mark">HK</div>
          <div className="empty-title">Hermes × Kimi</div>
          <div className="empty-subtitle">
            {session
              ? `Model ${MODELS.find(m => m.id === session.model)?.label || session.model}. Where shall we start?`
              : 'Create a new chat to get started.'}
          </div>
          {session && (
            <div className="suggestions">
              {SUGGESTIONS.map((s, i) => (
                <button key={i} className="suggestion" onClick={() => onSuggestion(s.prompt)}>
                  <div className="suggestion-title">
                    <SparkIcon size={12} /> {s.title}
                  </div>
                  <div>{s.prompt.length > 80 ? s.prompt.slice(0, 80) + '…' : s.prompt}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="messages-inner">
          {visible.map((m) => {
            const isLastAssistant = m.id === lastAssistant?.id
            const isStreaming = busy && isLastAssistant
            return (
              <div key={m.id} className={`message ${m.role}`}>
                <div className="message-avatar">{m.role === 'user' ? 'You' : 'AI'}</div>
                <div className="message-body">
                  <div className="message-meta">
                    <span className="message-role">{m.role === 'user' ? 'You' : 'Kimi'}</span>
                  </div>
                  <div className="message-content">
                    {m.role === 'assistant'
                      ? (m.content
                          ? <Markdown text={m.content} />
                          : (isStreaming ? null : <em style={{ color: 'var(--text-tertiary)' }}>empty</em>))
                      : <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>}
                    {isStreaming && <span className="streaming-cursor" />}
                  </div>
                  {!isStreaming && (
                    <div className="message-actions">
                      <button className="action-btn" onClick={() => onCopyMessage(m)}>
                        {copiedId === m.id ? <CheckIcon /> : <CopyIcon />}
                        {copiedId === m.id ? 'Copied' : 'Copy'}
                      </button>
                      {isLastAssistant && (
                        <button className="action-btn" onClick={onRegenerate}>
                          <RefreshIcon />
                          Regenerate
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
