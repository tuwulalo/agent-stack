import type { ChatMode } from '@/components/ui/animated-ai-chat'
import type { Message } from './types'
import type { AgentArtifact, AgentStep } from './agent'

export interface UserAttachment {
  name: string
  size: number
  mime: string
  isImage: boolean
  /** data: URL for image thumbnails (omitted for large/binary files) */
  dataUrl?: string
}

export interface SessionMessage extends Message {
  via?: 'kimi' | 'agent'
  stderr?: string
  exitCode?: number | null
  steps?: AgentStep[]
  artifacts?: AgentArtifact[]
  userAttachments?: UserAttachment[]
}

export interface ChatSession {
  id: string
  title: string
  mode: ChatMode
  /** Optional custom-agent id from /agents endpoint */
  agentId?: string | null
  messages: SessionMessage[]
  createdAt: number
  updatedAt: number
}

const SESSIONS_KEY = 'hk:sessions:v2'
const ACTIVE_KEY = 'hk:active:v2'

export function uid(): string {
  return Math.random().toString(36).slice(2, 11) + Date.now().toString(36).slice(-3)
}

export function deriveTitle(text: string, fallback = 'Новый чат'): string {
  const cleaned = (text || '').trim().replace(/\s+/g, ' ').replace(/_📎.*$/, '').trim()
  if (!cleaned) return fallback
  return cleaned.length > 48 ? cleaned.slice(0, 48) + '…' : cleaned
}

export function loadSessions(): ChatSession[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(SESSIONS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((s) => s && typeof s.id === 'string')
  } catch {
    return []
  }
}

export function saveSessions(list: ChatSession[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SESSIONS_KEY, JSON.stringify(list))
  } catch {
    /* quota */
  }
}

export function loadActiveId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(ACTIVE_KEY)
  } catch {
    return null
  }
}

export function saveActiveId(id: string | null) {
  if (typeof window === 'undefined') return
  try {
    if (id) window.localStorage.setItem(ACTIVE_KEY, id)
    else window.localStorage.removeItem(ACTIVE_KEY)
  } catch {
    /* quota */
  }
}

export function createSession(mode: ChatMode = 'auto'): ChatSession {
  const now = Date.now()
  return {
    id: uid(),
    title: 'Новый чат',
    mode,
    messages: [],
    createdAt: now,
    updatedAt: now,
  }
}
