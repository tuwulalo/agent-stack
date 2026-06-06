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
  { title: 'Объясни код',     prompt: 'Объясни этот фрагмент TypeScript: ```ts\n\n```' },
  { title: 'Напиши сервис',   prompt: 'Напиши Express endpoint POST /api/widgets с валидацией zod и тестом на Vitest.' },
  { title: 'SQL-запрос',      prompt: 'Сформируй SQL для PostgreSQL: top-10 пользователей по сумме заказов за последние 30 дней.' },
  { title: 'Команда Hermes',  prompt: 'Подскажи команду hermes для запуска агента в режиме gateway с фоллбеком на openrouter.' },
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
              ? `Модель ${MODELS.find(m => m.id === session.model)?.label || session.model}. С чего начнём?`
              : 'Создай новый чат, чтобы начать.'}
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
                <div className="message-avatar">{m.role === 'user' ? 'Вы' : 'AI'}</div>
                <div className="message-body">
                  <div className="message-meta">
                    <span className="message-role">{m.role === 'user' ? 'You' : 'Kimi'}</span>
                  </div>
                  <div className="message-content">
                    {m.role === 'assistant'
                      ? (m.content
                          ? <Markdown text={m.content} />
                          : (isStreaming ? null : <em style={{ color: 'var(--text-tertiary)' }}>пусто</em>))
                      : <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>}
                    {isStreaming && <span className="streaming-cursor" />}
                  </div>
                  {!isStreaming && (
                    <div className="message-actions">
                      <button className="action-btn" onClick={() => onCopyMessage(m)}>
                        {copiedId === m.id ? <CheckIcon /> : <CopyIcon />}
                        {copiedId === m.id ? 'Скопировано' : 'Копировать'}
                      </button>
                      {isLastAssistant && (
                        <button className="action-btn" onClick={onRegenerate}>
                          <RefreshIcon />
                          Регенерировать
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
