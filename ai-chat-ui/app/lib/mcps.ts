import { KIMI_API } from './config'

export type McpStatus = 'connecting' | 'connected' | 'failed' | 'stopped' | 'unknown'

export interface McpTool {
  name: string
  description: string
}

export interface McpConfigured {
  id: string
  name: string
  fromCatalog: string | null
  command: string
  args: string[]
  envKeys: string[]
  enabled: boolean
  createdAt: number
  status: McpStatus
  tools: McpTool[]
  toolCount: number
  error: string | null
  connectedAt: number | null
}

export interface McpCatalogItem {
  id: string
  name: string
  description: string
  command: string
  args: string[]
  env: string[]            // required env var names
  argsHint: string | null
  docs?: string | null
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

export const listMcps = () =>
  j<{ mcps: McpConfigured[] }>(`${KIMI_API}/automations/mcps`).then((r) => r.mcps)

export const getMcpCatalog = () =>
  j<{ catalog: McpCatalogItem[] }>(`${KIMI_API}/automations/mcps/catalog`).then((r) => r.catalog)

export const addMcp = (body: {
  catalogId?: string
  name?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  enabled?: boolean
}) =>
  j<{ mcp: McpConfigured }>(`${KIMI_API}/automations/mcps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.mcp)

export const updateMcp = (id: string, patch: Partial<Pick<McpConfigured, 'name' | 'args' | 'enabled'>> & { env?: Record<string, string> }) =>
  j<{ mcp: McpConfigured }>(`${KIMI_API}/automations/mcps/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }).then((r) => r.mcp)

export const deleteMcp = (id: string) =>
  j<{ ok: boolean }>(`${KIMI_API}/automations/mcps/${encodeURIComponent(id)}`, { method: 'DELETE' }).then((r) => r.ok)

export const restartMcp = (id: string) =>
  j<{ ok: boolean }>(`${KIMI_API}/automations/mcps/${encodeURIComponent(id)}/restart`, { method: 'POST' }).then((r) => r.ok)

export function statusLabel(s: McpStatus): string {
  return ({
    connecting: 'подключаю…',
    connected:  'подключено',
    failed:     'ошибка',
    stopped:    'остановлено',
    unknown:    '—',
  })[s] || s
}

export function statusClass(s: McpStatus): string {
  return ({
    connecting: 'text-amber-300 border-amber-400/30 bg-amber-500/5',
    connected:  'text-emerald-300 border-emerald-400/30 bg-emerald-500/5',
    failed:     'text-red-300 border-red-400/30 bg-red-500/5',
    stopped:    'text-white/45 border-white/10',
    unknown:    'text-white/45 border-white/10',
  })[s] || 'text-white/45 border-white/10'
}
