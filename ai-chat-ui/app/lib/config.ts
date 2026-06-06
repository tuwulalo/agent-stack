/**
 * In the browser we use a same-origin path (`/api`) that Caddy reverse-proxies
 * to localhost:3001. This avoids the mixed-content block that would otherwise
 * trigger when the HTTPS UI tries to fetch from a plain http://… URL.
 *
 * On the server side (SSR/route handlers) we hit the proxy directly on loopback
 * to skip Caddy entirely.
 */
function defaultKimiApi(): string {
  if (typeof window === 'undefined') {
    return process.env.KIMI_API_INTERNAL || 'http://127.0.0.1:3001'
  }
  // `/_kp` (kimi-proxy) is reserved by Caddy and forwarded to localhost:3001.
  // We deliberately avoid `/api/*` so it doesn't collide with Next.js's own
  // API routes (e.g. /api/auth/login).
  return '/_kp'
}

export const KIMI_API = process.env.NEXT_PUBLIC_KIMI_API || defaultKimiApi()
export const HERMES_DASHBOARD = process.env.NEXT_PUBLIC_HERMES_URL || 'https://hermestuw.qd.je/hermes'

export function agentFileUrl(absPath: string): string {
  return `${KIMI_API}/agent/file?path=${encodeURIComponent(absPath)}`
}

export const MODELS = [
  { id: 'kimi-for-coding',     label: 'Kimi for Coding',     hint: 'Стандарт для кода и инструментов' },
  { id: 'kimi-k2-0711-preview', label: 'Kimi K2 (preview)',  hint: 'Универсальная флагманская' },
  { id: 'moonshot-v1-128k',    label: 'Moonshot v1 128k',    hint: 'Длинный контекст' },
]

export const DEFAULT_MODEL = MODELS[0].id

export const DEFAULT_SYSTEM_PROMPT = `Ты — AI-ассистент в воркфлоу Hermes × Kimi.
Отвечай по делу, без воды. Код оборачивай в \`\`\`блоки\`\`\` с указанием языка.
Если запрос требует выполнения инструментов на машине — предложи команду для Hermes.`
