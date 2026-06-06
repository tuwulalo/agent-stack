import { KIMI_API } from './config'
import { type Persona, pickPersona } from './personas'

export interface CustomAgent {
  id: string
  name: string
  description?: string
  defaultMode?: 'auto' | 'chat' | 'agent'
  /** Index into PERSONAS palette for mascot colour + label colour */
  personaIndex?: number
  systemPrompt: string
}

export interface CustomAgentExt extends CustomAgent {
  persona: Persona
}

export async function fetchAgents(signal?: AbortSignal): Promise<CustomAgentExt[]> {
  try {
    const res = await fetch(`${KIMI_API}/agents`, { signal })
    if (!res.ok) return []
    const json = await res.json()
    const list = Array.isArray(json?.agents) ? (json.agents as CustomAgent[]) : []
    return list.map((a, i) => ({
      ...a,
      persona: pickPersona(typeof a.personaIndex === 'number' ? a.personaIndex : i),
    }))
  } catch {
    return []
  }
}
