/**
 * OAuth2 helpers — провайдеры и обмен code → user email.
 * Node runtime (НЕ Edge): нужен сетевой fetch к провайдерам.
 */

export type Provider = 'github' | 'google'

export interface ProviderConfig {
  clientId: string
  clientSecret: string
  authUrl: string
  tokenUrl: string
  userInfoUrl: string
  scope: string
  /** Извлекает email из ответа userInfoUrl (для GitHub нужен дополнительный запрос за emails). */
  extractEmail: (userInfo: any, accessToken: string) => Promise<string | null>
}

const GITHUB: ProviderConfig = {
  clientId: process.env.OAUTH_GITHUB_CLIENT_ID || '',
  clientSecret: process.env.OAUTH_GITHUB_CLIENT_SECRET || '',
  authUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  userInfoUrl: 'https://api.github.com/user',
  scope: 'read:user user:email',
  extractEmail: async (userInfo, accessToken) => {
    if (userInfo?.email) return String(userInfo.email).toLowerCase()
    // GitHub скрывает приватный email — берём из /user/emails
    const r = await fetch('https://api.github.com/user/emails', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'agent-stack',
      },
    })
    if (!r.ok) return null
    const emails = (await r.json()) as Array<{ email: string; primary: boolean; verified: boolean }>
    const primary = emails.find((e) => e.primary && e.verified) || emails.find((e) => e.verified)
    return primary ? primary.email.toLowerCase() : null
  },
}

const GOOGLE: ProviderConfig = {
  clientId: process.env.OAUTH_GOOGLE_CLIENT_ID || '',
  clientSecret: process.env.OAUTH_GOOGLE_CLIENT_SECRET || '',
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
  scope: 'openid email profile',
  extractEmail: async (userInfo) => {
    return userInfo?.email_verified && userInfo.email
      ? String(userInfo.email).toLowerCase()
      : null
  },
}

export function getProvider(name: string): ProviderConfig | null {
  if (name === 'github') return GITHUB.clientId ? GITHUB : null
  if (name === 'google') return GOOGLE.clientId ? GOOGLE : null
  return null
}

export function getRedirectUri(provider: Provider, req: Request): string {
  // OAUTH_REDIRECT_BASE задаёт публичный origin (HTTPS), нужный для регистрации
  // в GitHub/Google. Если не задан — берём из заголовков (полезно в dev).
  const base = process.env.OAUTH_REDIRECT_BASE
    || (req.headers.get('x-forwarded-proto') || 'https') + '://' + (req.headers.get('host') || '')
  return `${base.replace(/\/$/, '')}/api/auth/oauth/${provider}/callback`
}

/** POST x-www-form-urlencoded на token endpoint, возвращает access_token. */
export async function exchangeCodeForToken(
  provider: ProviderConfig,
  code: string,
  redirectUri: string
): Promise<string | null> {
  const body = new URLSearchParams({
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  })
  const r = await fetch(provider.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  })
  if (!r.ok) return null
  const j = (await r.json()) as { access_token?: string }
  return j.access_token || null
}

export async function fetchUserEmail(
  provider: ProviderConfig,
  accessToken: string
): Promise<string | null> {
  const r = await fetch(provider.userInfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'User-Agent': 'agent-stack',
    },
  })
  if (!r.ok) return null
  const info = await r.json()
  return provider.extractEmail(info, accessToken)
}

/** Email-allowlist из .env: ALLOWED_EMAILS=a@x.com,b@y.com (пусто = деним всех). */
export function isEmailAllowed(email: string): boolean {
  const raw = process.env.ALLOWED_EMAILS || ''
  const list = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  if (list.length === 0) return false
  return list.includes(email.toLowerCase())
}

/** Криптостойкая случайная строка для OAuth state. */
export function randomState(): string {
  const buf = new Uint8Array(24)
  crypto.getRandomValues(buf)
  return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('')
}
