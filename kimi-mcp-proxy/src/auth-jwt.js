/**
 * Минимальная реализация JWT HS256 без зависимостей.
 * Используется для долгоживущих access-токенов, выданных через device-flow.
 *
 * Алгоритм фиксирован: HS256 (HMAC-SHA256). Никаких alg:none, никакой
 * поддержки RS256/ES256 — это сокращает атакующую поверхность.
 */
import crypto from 'node:crypto';

function b64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function b64urlJSON(obj) {
  return b64url(JSON.stringify(obj));
}

function fromB64url(s) {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = t.length % 4 ? '='.repeat(4 - (t.length % 4)) : '';
  return Buffer.from(t + pad, 'base64');
}

function getSecret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) {
    throw new Error('JWT_SECRET must be set (min 16 chars) for token issuance');
  }
  return s;
}

/**
 * Подписать токен. payload должен быть JSON-сериализуемым объектом.
 * Опционально expiresInSec — добавит exp.
 */
export function signJwt(payload, expiresInSec) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = {
    ...payload,
    iat: now,
    ...(expiresInSec ? { exp: now + expiresInSec } : {}),
  };
  const signingInput = `${b64urlJSON(header)}.${b64urlJSON(body)}`;
  const sig = crypto.createHmac('sha256', getSecret()).update(signingInput).digest();
  return `${signingInput}.${b64url(sig)}`;
}

/**
 * Проверить токен. Возвращает payload или null.
 */
export function verifyJwt(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, bodyB64, sigB64] = parts;
  let header;
  try {
    header = JSON.parse(fromB64url(headerB64).toString('utf8'));
  } catch {
    return null;
  }
  if (header.alg !== 'HS256') return null;

  const expected = crypto.createHmac('sha256', getSecret())
    .update(`${headerB64}.${bodyB64}`)
    .digest();
  const got = fromB64url(sigB64);
  if (expected.length !== got.length) return null;
  if (!crypto.timingSafeEqual(expected, got)) return null;

  let payload;
  try {
    payload = JSON.parse(fromB64url(bodyB64).toString('utf8'));
  } catch {
    return null;
  }
  if (payload.exp && Math.floor(Date.now() / 1000) >= payload.exp) return null;
  return payload;
}
