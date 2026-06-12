import { KIMI_API } from './config'

export type AutomationAgent = 'hermes' | 'claude' | 'shell'

export interface Schedule {
  id: string
  name: string
  cron: string
  agent: AutomationAgent
  task: string
  enabled: boolean
  createdAt: number
  lastFireAt: number | null
  lastFireOk: boolean | null
}

export interface RunRecord {
  id: string
  scheduleId: string | null
  agent: AutomationAgent
  name: string
  task: string
  source: 'cron' | 'manual' | 'adhoc'
  startedAt: number
  endedAt: number
  durationMs: number
  exitCode: number | null
  killed: boolean
  stdout: string
  stderr: string
}

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return await r.json()
}

async function jsend<T>(url: string, method: 'POST' | 'PUT' | 'DELETE', body?: any): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) {
    let msg = `HTTP ${r.status}`
    try {
      const j = await r.json()
      if (j?.error?.message) msg += ' — ' + j.error.message
    } catch { /* ignore */ }
    throw new Error(msg)
  }
  return await r.json()
}

export const listSchedules = () =>
  jget<{ schedules: Schedule[] }>(`${KIMI_API}/automations/schedules`).then((r) => r.schedules)

export const createSchedule = (s: Partial<Schedule>) =>
  jsend<{ schedule: Schedule }>(`${KIMI_API}/automations/schedules`, 'POST', s).then((r) => r.schedule)

export const updateSchedule = (id: string, patch: Partial<Schedule>) =>
  jsend<{ schedule: Schedule }>(`${KIMI_API}/automations/schedules/${encodeURIComponent(id)}`, 'PUT', patch).then((r) => r.schedule)

export const deleteSchedule = (id: string) =>
  jsend<{ ok: boolean }>(`${KIMI_API}/automations/schedules/${encodeURIComponent(id)}`, 'DELETE').then((r) => r.ok)

export const fireSchedule = (id: string) =>
  jsend<{ ok: boolean }>(`${KIMI_API}/automations/schedules/${encodeURIComponent(id)}/fire`, 'POST').then((r) => r.ok)

export const listRuns = (opts: { limit?: number; scheduleId?: string } = {}) => {
  const p = new URLSearchParams()
  if (opts.limit) p.set('limit', String(opts.limit))
  if (opts.scheduleId) p.set('scheduleId', opts.scheduleId)
  const q = p.toString()
  return jget<{ runs: RunRecord[] }>(`${KIMI_API}/automations/runs${q ? '?' + q : ''}`).then((r) => r.runs)
}

// Common cron presets shown in the UI
export const CRON_PRESETS: Array<{ label: string; expr: string }> = [
  { label: 'Каждые 5 минут',      expr: '*/5 * * * *' },
  { label: 'Каждый час (0 мин)',  expr: '0 * * * *' },
  { label: 'Каждые 6 часов',      expr: '0 */6 * * *' },
  { label: 'Ежедневно 09:00',     expr: '0 9 * * *' },
  { label: 'Ежедневно 21:00',     expr: '0 21 * * *' },
  { label: 'По понедельникам 09:00', expr: '0 9 * * 1' },
  { label: 'Первое число месяца 00:30', expr: '30 0 1 * *' },
]

export function describeCron(expr: string): string {
  const hit = CRON_PRESETS.find((p) => p.expr === expr.trim())
  if (hit) return hit.label
  return expr
}

export function formatRelTime(ms: number | null | undefined): string {
  if (!ms) return '—'
  const diff = Date.now() - ms
  if (diff < 60_000) return 'только что'
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)} мин назад`
  if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / (60 * 60_000))} ч назад`
  return new Date(ms).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} мс`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} с`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}м ${Math.floor((ms % 60_000) / 1000)}с`
  return `${Math.floor(ms / 3_600_000)}ч ${Math.floor((ms % 3_600_000) / 60_000)}м`
}
