import { KIMI_API } from './config'

export interface ArenaProvider {
  id: string
  label: string
  model: string
  available: boolean
}

export interface ArenaTest {
  id: string
  title: string
  prompt: string
  system?: string
}

export interface ArenaUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

export interface ArenaResult {
  providerId: string
  model: string
  ms: number
  text?: string
  error?: string
  usage?: ArenaUsage | null
}

export async function fetchArenaProviders(signal?: AbortSignal): Promise<ArenaProvider[]> {
  const res = await fetch(`${KIMI_API}/arena/providers`, { signal, cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return Array.isArray(data?.providers) ? data.providers : []
}

export async function runArenaCell(
  providerId: string,
  test: ArenaTest,
  signal?: AbortSignal,
): Promise<ArenaResult> {
  const res = await fetch(`${KIMI_API}/arena/run`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerId, prompt: test.prompt, system: test.system || undefined }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    return { providerId, model: '', ms: 0, error: data?.error || `HTTP ${res.status}` }
  }
  return data as ArenaResult
}
