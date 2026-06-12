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
export const HERMES_DASHBOARD = process.env.NEXT_PUBLIC_HERMES_URL || ''

export function agentFileUrl(absPath: string): string {
  return `${KIMI_API}/agent/file?path=${encodeURIComponent(absPath)}`
}

export const MODELS = [
  { id: 'claude-5',            label: 'Claude 5',            hint: 'Anthropic\'s next-generation flagship' },
  { id: 'fable-5',             label: 'Fable 5',             hint: 'New flagship model' },
  { id: 'kimi-for-coding',     label: 'Kimi for Coding',     hint: 'The standard for code and tools' },
  { id: 'kimi-k2-0711-preview', label: 'Kimi K2 (preview)',  hint: 'General-purpose flagship' },
  { id: 'moonshot-v1-128k',    label: 'Moonshot v1 128k',    hint: 'Long context' },
]

// Pinned explicitly so that adding new models to the top of the list
// doesn't change the working default.
export const DEFAULT_MODEL = 'kimi-for-coding'

export const DEFAULT_SYSTEM_PROMPT = `You are an AI assistant in the Hermes × Kimi workflow.
Answer to the point, no fluff. Wrap code in \`\`\`blocks\`\`\` with the language specified.
If the request requires running tools on the machine, suggest a command for Hermes.`
