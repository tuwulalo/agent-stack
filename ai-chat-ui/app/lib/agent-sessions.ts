import { KIMI_API } from './config'
import type { AutomationLine } from './automation'

export interface AgentSession {
  id: string
  agent: 'claude'
  claudeSessionId: string
  name: string
  createdAt: number
  lastUsedAt: number
  turns: number
  lastPrompt: string
  lastSummary: string
  /** Parent session id if this was spawned via /automations/delegate */
  parentSessionId?: string | null
  /** 0 for root agents, parent.depth+1 for children */
  depth?: number
  /** false = last turn ended via kill/timeout/abort (interrupted) */
  lastClean?: boolean
  /** cumulative USD cost across this session's runs */
  costUsd?: number
  /** cumulative input/output token counts */
  tokensIn?: number
  tokensOut?: number
  feedback?: { rating: 'up' | 'down' | null; kind: 'good' | 'partial' | 'broken' | 'hallucination' | null; note?: string; at?: number }
  judge?: { score: number | null; verdict: 'good' | 'partial' | 'broken' | 'hallucination' | null; reason?: string; at?: number }
  /** true if a run for this session is live on the server right now */
  running?: boolean
}

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init)
  if (!r.ok) {
    let msg = `HTTP ${r.status}`
    try {
      const x = await r.json()
      if (x?.error?.message) msg += ' — ' + x.error.message
    } catch { /* ignore */ }
    throw new Error(msg)
  }
  return await r.json()
}

export const listAgentSessions = (limit = 50) =>
  j<{ sessions: AgentSession[] }>(`${KIMI_API}/automations/sessions?limit=${limit}`).then((r) => r.sessions)

export const renameAgentSession = (id: string, name: string) =>
  j<{ session: AgentSession }>(`${KIMI_API}/automations/sessions/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  }).then((r) => r.session)

export const setSessionFeedback = (
  id: string,
  fb: { rating?: 'up' | 'down' | null; kind?: 'good' | 'partial' | 'broken' | 'hallucination' | null; note?: string },
) =>
  j<{ session: AgentSession }>(`${KIMI_API}/automations/sessions/${encodeURIComponent(id)}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fb),
  }).then((r) => r.session)

export const judgeSession = (id: string) =>
  j<{ session: AgentSession; judge: AgentSession['judge'] }>(`${KIMI_API}/automations/sessions/${encodeURIComponent(id)}/judge`, {
    method: 'POST',
  }).then((r) => r.judge)

export const deleteAgentSession = (id: string) =>
  j<{ ok: boolean }>(`${KIMI_API}/automations/sessions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }).then((r) => r.ok)

/** Replay the Claude session transcript as a list of UI-renderable lines. */
export const getSessionHistory = (id: string) =>
  j<{ session: AgentSession; lines: AutomationLine[]; note?: string; running?: boolean }>(
    `${KIMI_API}/automations/sessions/${encodeURIComponent(id)}/history`,
  )

export function formatRel(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return 'только что'
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)} мин назад`
  if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / (60 * 60_000))} ч назад`
  return new Date(ms).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}
