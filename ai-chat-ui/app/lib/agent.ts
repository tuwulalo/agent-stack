import { KIMI_API } from './config'

export interface SubagentTask {
  index: number
  goal: string
  context?: string | null
  role?: string | null
  toolsets?: string[] | null
}

export interface SubagentToolTrace {
  tool: string
  status?: string | null
  argsBytes?: number | null
  resultBytes?: number | null
}

export interface SubagentResult {
  index: number
  status?: string | null
  summary: string
  /** Failure reason when status='failed' */
  error?: string
  exitReason?: string
  durationSec?: number
  apiCalls?: number
  /** Ordered list of tool calls the subagent attempted internally */
  toolTrace?: SubagentToolTrace[]
}

export type AgentStep =
  | {
      kind: 'tool_call'
      name: string
      args: string
      toolCallId?: string | null
      subagent?: boolean
      subagentRole?: string | null
      subtasks?: SubagentTask[]
    }
  | {
      kind: 'tool_result'
      toolCallId?: string | null
      text: string
      subagentResults?: SubagentResult[]
    }
  | { kind: 'note'; text: string }
  | { kind: 'thinking'; text: string }

export interface AgentArtifact {
  kind: 'image'
  path: string
  name: string
  size: number
  mime: string
}

export interface AgentContextTurn {
  role: 'user' | 'assistant'
  content: string
}

export type AgentEvent =
  | { type: 'started'; prompt: string; at: number }
  | ({ type: 'step' } & AgentStep)
  | ({ type: 'artifact' } & AgentArtifact)
  | { type: 'stdout'; data: string }
  | { type: 'stderr'; data: string }
  | { type: 'error'; message: string }
  | { type: 'loop_detected'; tool: string; count: number; message: string }
  | {
      type: 'done'
      code: number | null
      signal: string | null
      killedByClient: boolean
      killedByTimeout: boolean
      sessionFile?: string | null
      at: number
    }

export interface AgentRunArgs {
  prompt: string
  context?: AgentContextTurn[]
  /** Chat id — passed through so future iterations can inject memory. */
  chatId?: string | null
  signal: AbortSignal
  onEvent: (e: AgentEvent) => void
}

/**
 * POST /agent/run on the Kimi proxy. Spawns `hermes -z "<prompt>" --yolo`
 * on the VPS and streams stdout/stderr back as SSE.
 */
export async function agentRun({ prompt, context, chatId, signal, onEvent }: AgentRunArgs): Promise<void> {
  const res = await fetch(`${KIMI_API}/agent/run`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, context: context || [], chatId }),
  })

  if (!res.ok) {
    let detail = ''
    try {
      detail = await res.text()
    } catch {
      /* ignore */
    }
    throw new Error(
      `HTTP ${res.status}${detail ? ` — ${detail.slice(0, 250)}` : ''}`,
    )
  }
  if (!res.body) throw new Error('Empty response from the agent')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE messages are separated by blank lines
    let idx: number
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)

      // each block can have multiple "data:" lines; concat them
      const dataLines: string[] = []
      for (const line of block.split('\n')) {
        const trimmed = line.trim()
        if (trimmed.startsWith('data:')) {
          dataLines.push(trimmed.slice(5).trim())
        }
      }
      if (dataLines.length === 0) continue

      const payload = dataLines.join('\n')
      try {
        const event = JSON.parse(payload) as AgentEvent
        onEvent(event)
      } catch {
        /* ignore malformed event */
      }
    }
  }
}
