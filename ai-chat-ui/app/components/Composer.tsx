'use client'

import { useEffect, useRef } from 'react'
import { SendIcon, StopIcon } from './icons'

interface Props {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  onStop: () => void
  busy: boolean
  disabled?: boolean
}

export function Composer({ value, onChange, onSend, onStop, busy, disabled }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 220) + 'px'
  }, [value])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!busy && value.trim()) onSend()
    }
  }

  return (
    <div className="composer-wrap">
      <div className="composer">
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask Kimi anything…"
          rows={1}
          disabled={disabled}
        />
        <div className="composer-toolbar">
          <div className="composer-hint">
            <kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line
          </div>
          {busy ? (
            <button className="send-btn stop" onClick={onStop} aria-label="Stop">
              <StopIcon />
            </button>
          ) : (
            <button
              className="send-btn"
              onClick={onSend}
              disabled={!value.trim() || disabled}
              aria-label="Send"
            >
              <SendIcon size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
