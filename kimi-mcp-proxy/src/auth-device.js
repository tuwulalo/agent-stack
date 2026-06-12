/**
 * OAuth 2.0 Device Authorization Grant (RFC 8628).
 *
 * Поток:
 *   1. CLI на компе → POST /v1/auth/device          → {device_code, user_code, verification_uri, expires_in, interval}
 *   2. CLI печатает code+URL → юзер открывает в браузере, логинится в UI,
 *      вводит user_code на /cli, UI делает POST /v1/auth/device/approve
 *   3. CLI поллит → POST /v1/auth/device/poll       → пока pending; после approve → {access_token, token_type:'Bearer'}
 *
 * Хранилище в памяти процесса (Map с TTL). Для single-VPS — ок. Для кластера
 * заменить на Redis. Записи живут 15 минут.
 */
import crypto from 'node:crypto';
import { signJwt } from './auth-jwt.js';

const TTL_MS = 15 * 60 * 1000;
const POLL_INTERVAL_SEC = 5;
const ACCESS_TOKEN_TTL_SEC = 90 * 24 * 60 * 60; // 90 дней

/** @type {Map<string, {userCode:string, status:'pending'|'approved'|'denied', email?:string, deviceName?:string, createdAt:number, lastPollAt:number}>} */
const codes = new Map();

function sweep() {
  const now = Date.now();
  for (const [k, v] of codes) {
    if (now - v.createdAt > TTL_MS) codes.delete(k);
  }
}
setInterval(sweep, 60 * 1000).unref?.();

/** Безопасный device_code: длинный URL-safe токен. */
function genDeviceCode() {
  return crypto.randomBytes(32).toString('base64url');
}

/** Короткий user_code в формате XXXX-XXXX. Без I, O, 0, 1 (легко спутать). */
function genUserCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pick = () => alphabet[crypto.randomInt(0, alphabet.length)];
  return `${pick()}${pick()}${pick()}${pick()}-${pick()}${pick()}${pick()}${pick()}`;
}

function findByUserCode(userCode) {
  const want = String(userCode || '').trim().toUpperCase();
  for (const [deviceCode, entry] of codes) {
    if (entry.userCode === want) return { deviceCode, entry };
  }
  return null;
}

function publicVerificationUri() {
  // База берётся из OAUTH_REDIRECT_BASE или из явного PUBLIC_BASE.
  // Это публичный URL, на котором отдаётся UI (/cli).
  const base = (process.env.PUBLIC_BASE || process.env.OAUTH_REDIRECT_BASE || '').replace(/\/$/, '');
  return base ? `${base}/cli` : '/cli';
}

export function registerAuthDeviceRoutes(app) {
  /** Шаг 1: CLI инициирует. Не требует авторизации. */
  app.post('/v1/auth/device', express_json_safe, (req, res) => {
    const deviceName = String(req.body?.deviceName || 'cli').slice(0, 64);
    const deviceCode = genDeviceCode();
    const userCode = genUserCode();
    codes.set(deviceCode, {
      userCode,
      status: 'pending',
      deviceName,
      createdAt: Date.now(),
      lastPollAt: 0,
    });
    res.json({
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: publicVerificationUri(),
      verification_uri_complete: `${publicVerificationUri()}?user_code=${encodeURIComponent(userCode)}`,
      expires_in: Math.floor(TTL_MS / 1000),
      interval: POLL_INTERVAL_SEC,
    });
  });

  /** Шаг 3: CLI поллит. Не требует авторизации (защита через device_code). */
  app.post('/v1/auth/device/poll', express_json_safe, (req, res) => {
    const deviceCode = String(req.body?.device_code || '');
    const entry = codes.get(deviceCode);
    if (!entry) return res.status(400).json({ error: 'expired_token' });

    // Throttle: чаще раза в 5 секунд — slow_down.
    const now = Date.now();
    if (now - entry.lastPollAt < POLL_INTERVAL_SEC * 1000 - 500) {
      return res.status(400).json({ error: 'slow_down' });
    }
    entry.lastPollAt = now;

    if (entry.status === 'denied') {
      codes.delete(deviceCode);
      return res.status(400).json({ error: 'access_denied' });
    }
    if (entry.status === 'pending') {
      return res.status(400).json({ error: 'authorization_pending' });
    }
    // approved
    const token = signJwt(
      { sub: entry.email || 'unknown', kind: 'device', device: entry.deviceName },
      ACCESS_TOKEN_TTL_SEC
    );
    codes.delete(deviceCode);
    return res.json({
      access_token: token,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SEC,
      scope: 'chat.completions',
    });
  });

  /**
   * Шаг 2: подтверждение из UI. Сюда обращается Next.js после того, как
   * проверил web-сессию пользователя и взял его email из cookie.
   * Защищено shared-секретом PROXY_API_KEY (UI и proxy на одной машине).
   */
  app.post('/v1/auth/device/approve', express_json_safe, (req, res) => {
    const sharedKey = req.get('x-proxy-key') || '';
    if (!process.env.PROXY_API_KEY || sharedKey !== process.env.PROXY_API_KEY) {
      return res.status(401).json({ error: 'invalid_shared_key' });
    }
    const userCode = String(req.body?.user_code || '');
    const email = String(req.body?.email || '').toLowerCase();
    if (!userCode || !email) {
      return res.status(400).json({ error: 'user_code and email required' });
    }
    const found = findByUserCode(userCode);
    if (!found) return res.status(404).json({ error: 'unknown_user_code' });
    if (found.entry.status !== 'pending') {
      return res.status(409).json({ error: 'already_resolved' });
    }
    found.entry.status = 'approved';
    found.entry.email = email;
    return res.json({ ok: true, device: found.entry.deviceName });
  });
}

/** express.json() уже глобально, но на этих эндпоинтах хочется быть точным. */
function express_json_safe(req, res, next) {
  if (typeof req.body !== 'object' || req.body === null) req.body = {};
  next();
}
