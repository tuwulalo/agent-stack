import type { Session } from './types'

const KEY = 'hk-sessions-v1'
const ACTIVE_KEY = 'hk-active-session-v1'

export function loadSessions(): Session[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveSessions(sessions: Session[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(KEY, JSON.stringify(sessions))
  } catch {
    /* quota / private mode — fail silently */
  }
}

export function loadActiveId(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(ACTIVE_KEY)
}

export function saveActiveId(id: string | null) {
  if (typeof window === 'undefined') return
  if (id) window.localStorage.setItem(ACTIVE_KEY, id)
  else window.localStorage.removeItem(ACTIVE_KEY)
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}
