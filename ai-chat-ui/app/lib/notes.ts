import { KIMI_API } from './config'

export interface NoteSummary {
  name: string
  size: number
  mtime: number
  preview: string
  isSystem: boolean
}

const SYSTEM_TITLES: Record<string, string> = {
  'facts.md':     'Факты',
  'decisions.md': 'Решения',
  'summary.md':   'Кратко',
}

export function noteTitle(name: string): string {
  return SYSTEM_TITLES[name] || name.replace(/\.md$/, '').replace(/[_-]+/g, ' ')
}

const SAFE_ID  = /^[a-zA-Z0-9_\-]{3,64}$/
const SAFE_NAME = /^[a-zA-Z0-9_\-]{1,80}\.md$/

export function isValidChatId(id: string | null | undefined): id is string {
  return typeof id === 'string' && SAFE_ID.test(id)
}

export function isValidNoteName(name: string | null | undefined): name is string {
  return typeof name === 'string' && SAFE_NAME.test(name)
}

export async function listNotes(chatId: string): Promise<NoteSummary[]> {
  if (!isValidChatId(chatId)) return []
  const res = await fetch(`${KIMI_API}/chats/${encodeURIComponent(chatId)}/notes`)
  if (!res.ok) return []
  const j = await res.json().catch(() => null)
  return Array.isArray(j?.notes) ? j.notes : []
}

export async function readNote(chatId: string, name: string): Promise<string | null> {
  if (!isValidChatId(chatId) || !isValidNoteName(name)) return null
  const res = await fetch(
    `${KIMI_API}/chats/${encodeURIComponent(chatId)}/notes/${encodeURIComponent(name)}`,
  )
  if (!res.ok) return null
  const j = await res.json().catch(() => null)
  return typeof j?.content === 'string' ? j.content : null
}

export async function writeNote(chatId: string, name: string, content: string): Promise<boolean> {
  if (!isValidChatId(chatId) || !isValidNoteName(name)) return false
  const res = await fetch(
    `${KIMI_API}/chats/${encodeURIComponent(chatId)}/notes/${encodeURIComponent(name)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    },
  )
  return res.ok
}

export async function deleteNote(chatId: string, name: string): Promise<boolean> {
  if (!isValidChatId(chatId) || !isValidNoteName(name)) return false
  const res = await fetch(
    `${KIMI_API}/chats/${encodeURIComponent(chatId)}/notes/${encodeURIComponent(name)}`,
    { method: 'DELETE' },
  )
  return res.ok
}

/**
 * Force-trigger a digest pass — Kimi reads the latest exchange + current
 * memory and rewrites facts.md / decisions.md / summary.md.
 */
export async function regenerateDigest(
  chatId: string,
  userMessage: string,
  assistantMessage: string,
): Promise<NoteSummary[]> {
  if (!isValidChatId(chatId)) return []
  const res = await fetch(`${KIMI_API}/chats/${encodeURIComponent(chatId)}/digest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userMessage, assistantMessage }),
  })
  if (!res.ok) return []
  const j = await res.json().catch(() => null)
  return Array.isArray(j?.notes) ? j.notes : []
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} Б`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`
  return `${(n / 1024 / 1024).toFixed(2)} МБ`
}

export function formatRelTime(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return 'только что'
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)} мин назад`
  if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / (60 * 60_000))} ч назад`
  return new Date(ms).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
