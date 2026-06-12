import { KIMI_API } from './config'

export interface AskUserOption {
  label: string
  description?: string
}
export interface AskUserQuestion {
  header?: string
  question: string
  multiSelect?: boolean
  options: AskUserOption[]
}
export interface AskUserPayload {
  questions: AskUserQuestion[]
}

export type AutomationLine =
  | { kind: 'prompt';   text: string }                                   // user's full task (rendered as header block)
  | { kind: 'stdout';   text: string }
  | { kind: 'stderr';   text: string }
  | { kind: 'step';     text: string; meta?: string }
  | { kind: 'error';    text: string }
  | { kind: 'done';     code: number | null; ms: number }
  | { kind: 'meta';     text: string }
  | { kind: 'artifact'; path: string; name: string; mime: string; size: number }
  | { kind: 'session';  sessionId: string; turns: number }
  | { kind: 'ask_user'; payload: AskUserPayload; answered?: string[][] }

export type AutomationAgentId = 'hermes' | 'claude' | 'shell'

export interface AutomationRunArgs {
  agent: AutomationAgentId
  task: string
  /** Resume a previous Claude session (--resume <uuid>). Ignored for Hermes/Shell. */
  sessionId?: string | null
  /** live-join: attach to a running session's stream, never spawn a new turn */
  attachOnly?: boolean
  signal: AbortSignal
  onLine: (l: AutomationLine) => void
}

/**
 * Automation runner: dispatches to the right backend endpoint.
 *
 *   hermes  → /agent/run         (rich SSE: step/artifact/stdout/stderr)
 *   claude  → /automations/run-stream  (raw stdout/stderr stream)
 *   shell   → /automations/run-stream  (raw stdout/stderr stream)
 */
export async function runAutomation({ agent, task, sessionId, attachOnly, signal, onLine }: AutomationRunArgs): Promise<void> {
  const startedAt = Date.now()

  // Non-Hermes agents go through the simple SSE bridge.
  if (agent === 'claude' || agent === 'shell') {
    // Short command-only meta line (full prompt is rendered as a separate
    // 'prompt' block emitted by the page before this fires).
    const meta = agent === 'claude'
      ? (sessionId ? 'claude -p --resume <id> · stream-json' : 'claude -p · stream-json')
      : 'bash -c'
    onLine({ kind: 'meta', text: meta })

    const res = await fetch(`${KIMI_API}/automations/run-stream`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent, task, sessionId: sessionId || undefined, attachOnly: attachOnly || undefined }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}${detail ? ' — ' + detail.slice(0, 250) : ''}`)
    }
    if (!res.body) throw new Error('Пустой ответ')
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let idx: number
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        const dataLines: string[] = []
        for (const ln of block.split('\n')) {
          const t = ln.trim()
          if (t.startsWith('data:')) dataLines.push(t.slice(5).trim())
        }
        if (dataLines.length === 0) continue
        let ev: any
        try { ev = JSON.parse(dataLines.join('\n')) } catch { continue }
        if (ev.type === 'stdout') onLine({ kind: 'stdout', text: String(ev.data || '') })
        else if (ev.type === 'stderr') onLine({ kind: 'stderr', text: String(ev.data || '') })
        else if (ev.type === 'error') onLine({ kind: 'error', text: String(ev.message || 'error') })
        else if (ev.type === 'session') onLine({ kind: 'session', sessionId: String(ev.sessionId || ''), turns: Number(ev.turns) || 0 })
        else if (ev.type === 'step') {
          const kind = ev.kind || ''
          if (kind === 'thinking') onLine({ kind: 'step', text: String(ev.text || ''), meta: 'thinking' })
          else if (kind === 'tool_call') onLine({ kind: 'step', text: `${ev.name}(${String(ev.args || '')})`, meta: 'tool' })
          else if (kind === 'tool_result') onLine({ kind: 'step', text: String(ev.text || ''), meta: 'result' })
          else if (kind === 'note') onLine({ kind: 'step', text: String(ev.text || ''), meta: 'note' })
        }
        else if (ev.type === 'done') onLine({ kind: 'done', code: typeof ev.code === 'number' ? ev.code : null, ms: Date.now() - startedAt })
      }
    }
    return
  }

  // Hermes path (existing rich SSE).
  onLine({ kind: 'meta', text: `hermes -z "${task.length > 80 ? task.slice(0, 80) + '…' : task}"` })

  const res = await fetch(`${KIMI_API}/agent/run`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: task, context: [] }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}${detail ? ' — ' + detail.slice(0, 250) : ''}`)
  }
  if (!res.body) throw new Error('Пустой ответ от агента')

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
      for (const ln of block.split('\n')) {
        const t = ln.trim()
        if (t.startsWith('data:')) dataLines.push(t.slice(5).trim())
      }
      if (dataLines.length === 0) continue
      const payload = dataLines.join('\n')
      let ev: any
      try { ev = JSON.parse(payload) } catch { continue }

      switch (ev.type) {
        case 'stdout':
          onLine({ kind: 'stdout', text: String(ev.data || '') })
          break
        case 'stderr':
          onLine({ kind: 'stderr', text: String(ev.data || '') })
          break
        case 'artifact': {
          // Hermes produced a file we can render (image / pdf / md / etc.)
          if (ev.kind === 'image' && typeof ev.path === 'string') {
            onLine({
              kind: 'artifact',
              path: String(ev.path),
              name: String(ev.name || ev.path.split('/').pop() || 'image'),
              mime: String(ev.mime || 'image/png'),
              size: Number(ev.size || 0),
            })
          }
          break
        }
        case 'step': {
          const kind = ev.kind || ''
          if (kind === 'thinking') {
            onLine({ kind: 'step', text: String(ev.text || ''), meta: 'thinking' })
          } else if (kind === 'tool_call') {
            onLine({ kind: 'step', text: `${ev.name}(${String(ev.args || '').slice(0, 200)})`, meta: 'tool' })
          } else if (kind === 'tool_result') {
            onLine({ kind: 'step', text: String(ev.text || '').slice(0, 600), meta: 'result' })
          } else if (kind === 'note') {
            onLine({ kind: 'step', text: String(ev.text || ''), meta: 'note' })
          }
          break
        }
        case 'error':
          onLine({ kind: 'error', text: String(ev.message || ev.text || 'unknown error') })
          break
        case 'done':
          onLine({ kind: 'done', code: typeof ev.code === 'number' ? ev.code : null, ms: Date.now() - startedAt })
          break
      }
    }
  }
}
