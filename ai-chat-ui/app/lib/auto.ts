import { KIMI_API } from './config'
import type { AgentEvent } from './agent'

/**
 * Wraps the proxy's /auto/run endpoint. Same SSE shape as agentRun() so
 * the consumer just handles AgentEvent — plus an extra 'route' event at the
 * very start telling us whether the request went to Hermes or direct Kimi.
 */
export type AutoEvent =
  | { type: 'route'; route: 'hermes' | 'kimi'; reason: string; at: number }
  | AgentEvent

export interface AutoRunArgs {
  prompt: string
  context?: { role: 'user' | 'assistant'; content: string }[]
  /** Force a specific route, bypassing the heuristic. */
  force?: 'hermes' | 'kimi'
  /** Optional custom-agent id (from /agents endpoint) */
  agentId?: string | null
  /** Chat id — enables per-chat MD memory injection + post-response digest. */
  chatId?: string | null
  signal: AbortSignal
  onEvent: (e: AutoEvent) => void
}

export async function autoRun({ prompt, context, force, agentId, chatId, signal, onEvent }: AutoRunArgs): Promise<void> {
  const res = await fetch(`${KIMI_API}/auto/run`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, context, force, agentId, chatId }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}${detail ? ` — ${detail.slice(0, 250)}` : ''}`)
  }
  if (!res.body) throw new Error('Пустой ответ от роутера')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let idx: number
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)

      const dataLines: string[] = []
      for (const line of block.split('\n')) {
        const trimmed = line.trim()
        if (trimmed.startsWith('data:')) dataLines.push(trimmed.slice(5).trim())
      }
      if (dataLines.length === 0) continue

      const payload = dataLines.join('\n')
      try {
        const ev = JSON.parse(payload) as AutoEvent
        onEvent(ev)
      } catch {
        /* ignore malformed event */
      }
    }
  }
}
