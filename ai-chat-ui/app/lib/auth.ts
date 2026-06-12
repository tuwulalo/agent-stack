/**
 * Lightweight HMAC-SHA256 cookie session, Edge-runtime compatible.
 * Format: <base64url(payload-json)>.<base64url(hmac)>
 *
 * The token is verified inside `middleware.ts` (Edge runtime — `jsonwebtoken`
 * etc. are unavailable, so we use Web Crypto directly).
 */

const enc = new TextEncoder()
const dec = new TextDecoder()

export const SESSION_COOKIE = 'hk_session'

function b64urlEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): Uint8Array {
  let t = s.replace(/-/g, '+').replace(/_/g, '/')
  while (t.length % 4) t += '='
  const bin = atob(t)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
}

export interface SessionPayload {
  u: string
  exp: number
}

export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  const body = JSON.stringify(payload)
  const bodyB64 = b64urlEncode(enc.encode(body))
  const key = await importKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(bodyB64))
  return `${bodyB64}.${b64urlEncode(sig)}`
}

export async function verifySession(token: string, secret: string): Promise<SessionPayload | null> {
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const bodyB64 = token.slice(0, dot)
  const sigB64 = token.slice(dot + 1)
  const key = await importKey(secret)
  let ok = false
  try {
    ok = await crypto.subtle.verify('HMAC', key, b64urlDecode(sigB64), enc.encode(bodyB64))
  } catch {
    return null
  }
  if (!ok) return null
  try {
    const payload = JSON.parse(dec.decode(b64urlDecode(bodyB64))) as SessionPayload
    if (!payload || typeof payload.u !== 'string' || typeof payload.exp !== 'number') return null
    if (Date.now() > payload.exp) return null
    return payload
  } catch {
    return null
  }
}

/** Constant-time string compare for secrets. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const aa = enc.encode(a)
  const bb = enc.encode(b)
  // Always run the full loop to avoid leaking length via timing alone.
  const len = Math.max(aa.length, bb.length)
  let diff = aa.length ^ bb.length
  for (let i = 0; i < len; i++) diff |= (aa[i] ?? 0) ^ (bb[i] ?? 0)
  return diff === 0
}
