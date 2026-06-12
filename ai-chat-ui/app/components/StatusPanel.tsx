'use client'

import { useEffect, useState } from 'react'
import { ExternalIcon, TerminalIcon } from './icons'
import { HERMES_DASHBOARD, KIMI_API, MODELS } from '../lib/config'
import { pingService } from '../lib/stream'
import type { Session } from '../lib/types'

interface Props {
  session: Session | null
  onChangeModel: (model: string) => void
  onChangeSystemPrompt: (prompt: string) => void
}

interface Service {
  key: string
  name: string
  short: string
  url: string
  ping: string
}

const SERVICES: Service[] = [
  { key: 'kimi',   name: 'Kimi Proxy',       short: 'KP', url: KIMI_API,         ping: `${KIMI_API}/health` },
  { key: 'hermes', name: 'Hermes Dashboard', short: 'HD', url: HERMES_DASHBOARD, ping: HERMES_DASHBOARD },
  { key: 'ui',    name: 'Chat UI',           short: 'UI', url: '/',              ping: '/' },
]

type StatusMap = Record<string, 'up' | 'down' | 'unknown'>

export function StatusPanel({ session, onChangeModel, onChangeSystemPrompt }: Props) {
  const [statuses, setStatuses] = useState<StatusMap>(() =>
    Object.fromEntries(SERVICES.map(s => [s.key, 'unknown'])) as StatusMap
  )

  useEffect(() => {
    let cancelled = false
    const probe = async () => {
      const next: StatusMap = { ...statuses }
      await Promise.all(SERVICES.map(async (s) => {
        const r = await pingService(s.ping)
        next[s.key] = r.ok ? 'up' : 'down'
      }))
      if (!cancelled) setStatuses(next)
    }
    probe()
    const id = window.setInterval(probe, 15_000)
    return () => { cancelled = true; window.clearInterval(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const messageCount = session?.messages.filter(m => m.role !== 'system').length ?? 0
  const startedAt = session ? new Date(session.createdAt).toLocaleString('en-US', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  }) : '—'

  return (
    <aside className="status-panel">
      <div className="panel-section">
        <div className="panel-title">Services</div>
        {SERVICES.map(s => {
          const st = statuses[s.key]
          return (
            <div className="service" key={s.key}>
              <div className="service-icon">{s.short}</div>
              <div className="service-info">
                <div className="service-name">{s.name}</div>
                <div className="service-host">{s.url.replace(/^https?:\/\//, '')}</div>
              </div>
              <span className={`dot ${st} ${st === 'unknown' ? 'pulse' : ''}`} title={st} />
            </div>
          )
        })}
      </div>

      <div className="panel-section">
        <div className="panel-title">Hermes</div>
        <a className="action-link" href={HERMES_DASHBOARD} target="_blank" rel="noopener noreferrer">
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <TerminalIcon size={14} />
            Open Dashboard
          </span>
          <ExternalIcon size={12} />
        </a>
        <a
          className="action-link"
          href={`${HERMES_DASHBOARD}/sessions`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span>Agent sessions</span>
          <ExternalIcon size={12} />
        </a>
      </div>

      <div className="panel-section">
        <div className="panel-title">Model</div>
        <select
          value={session?.model || MODELS[0].id}
          onChange={(e) => onChangeModel(e.target.value)}
          className="system-prompt"
          style={{ minHeight: 0, padding: 10, cursor: 'pointer' }}
          disabled={!session}
        >
          {MODELS.map(m => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
        <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.4 }}>
          {MODELS.find(m => m.id === session?.model)?.hint || 'Pick the active Kimi model'}
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-title">System prompt</div>
        <textarea
          className="system-prompt"
          placeholder="Describe how the assistant should behave…"
          value={session?.systemPrompt || ''}
          onChange={(e) => onChangeSystemPrompt(e.target.value)}
          disabled={!session}
        />
      </div>

      <div className="panel-section">
        <div className="panel-title">Session</div>
        <div className="kv">
          <span className="kv-key">ID</span>
          <span className="kv-val">{session?.id.slice(0, 8) || '—'}</span>
        </div>
        <div className="kv">
          <span className="kv-key">Messages</span>
          <span className="kv-val">{messageCount}</span>
        </div>
        <div className="kv">
          <span className="kv-key">Started</span>
          <span className="kv-val">{startedAt}</span>
        </div>
      </div>
    </aside>
  )
}
