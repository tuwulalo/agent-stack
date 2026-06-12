import { KIMI_API } from './config'
import type { Role } from './types'

/** OpenAI-compatible content block — Kimi accepts the same shape */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }

export interface ApiMessage {
  role: Role
  content: string | ContentBlock[]
}

export interface StreamArgs {
  model: string
  messages: ApiMessage[]
  signal: AbortSignal
  onDelta: (chunk: string) => void
}

export async function streamChat({ model, messages, signal, onDelta }: StreamArgs): Promise<void> {
  const res = await fetch(`${KIMI_API}/v1/chat/completions`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true }),
  })

  if (!res.ok) {
    let detail = ''
    try { detail = await res.text() } catch { /* ignore */ }
    throw new Error(`HTTP ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ''}`)
  }
  if (!res.body) throw new Error('Empty response from the API')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let idx: number
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue
      try {
        const json = JSON.parse(data)
        const delta = json.choices?.[0]?.delta?.content
        if (typeof delta === 'string' && delta.length > 0) onDelta(delta)
      } catch {
        /* ignore malformed sse line */
      }
    }
  }
}

export interface PingResult { ok: boolean; ms: number }

export async function pingService(url: string, timeoutMs = 4000): Promise<PingResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const start = performance.now()
  try {
    await fetch(url, { method: 'GET', mode: 'no-cors', signal: ctrl.signal, cache: 'no-store' })
    return { ok: true, ms: Math.round(performance.now() - start) }
  } catch {
    return { ok: false, ms: Math.round(performance.now() - start) }
  } finally {
    clearTimeout(timer)
  }
}
