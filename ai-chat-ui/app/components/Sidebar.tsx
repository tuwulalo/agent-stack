'use client'

import { ExternalIcon, PlusIcon, TerminalIcon, TrashIcon } from './icons'
import { HERMES_DASHBOARD } from '../lib/config'
import type { Session } from '../lib/types'

interface Props {
  sessions: Session[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
}

export function Sidebar({ sessions, activeId, onSelect, onNew, onDelete }: Props) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">HK</div>
        <div>
          <div className="brand-name">Hermes × Kimi</div>
          <div className="brand-tag">Workflow Hub</div>
        </div>
      </div>

      <div className="sidebar-section">
        <button className="new-chat" onClick={onNew}>
          <PlusIcon />
          <span>New chat</span>
        </button>
      </div>

      <div className="section-label">Sessions</div>

      <div className="session-list">
        {sessions.length === 0 ? (
          <div style={{ padding: '8px 12px', fontSize: 12.5, color: 'var(--text-tertiary)' }}>
            Nothing here yet. Start your first chat.
          </div>
        ) : (
          sessions.map(s => (
            <div
              key={s.id}
              className={`session ${s.id === activeId ? 'active' : ''}`}
              onClick={() => onSelect(s.id)}
            >
              <span className="session-title">{s.title || 'Untitled'}</span>
              <button
                className="session-delete"
                onClick={(e) => { e.stopPropagation(); onDelete(s.id) }}
                aria-label="Delete session"
              >
                <TrashIcon />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="sidebar-footer">
        <a className="sidebar-link" href={HERMES_DASHBOARD} target="_blank" rel="noopener noreferrer">
          <TerminalIcon size={14} />
          <span>Hermes Dashboard</span>
          <ExternalIcon size={12} />
        </a>
      </div>
    </aside>
  )
}
