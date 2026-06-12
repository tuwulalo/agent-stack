/**
 * OAuth 2.0 Device Authorization Grant (RFC 8628).
 *
 * Flow:
 *   1. CLI on the user's machine → POST /v1/auth/device          → {device_code, user_code, verification_uri, expires_in, interval}
 *   2. CLI prints code+URL → the user opens it in a browser, logs into the UI,
 *      enters the user_code on /cli, the UI does POST /v1/auth/device/approve
 *   3. CLI polls → POST /v1/auth/device/poll       → pending until approved; after approve → {access_token, token_type:'Bearer'}
 *
 * Storage is in process memory (Map with TTL). Fine for a single VPS. For a
 * cluster, replace with Redis. Entries live for 15 minutes.
 */
import crypto from 'node:crypto';
import { signJwt } from './auth-jwt.js';

const TTL_MS = 15 * 60 * 1000;
const POLL_INTERVAL_SEC = 5;
const ACCESS_TOKEN_TTL_SEC = 90 * 24 * 60 * 60; // 90 days

/** @type {Map<string, {userCode:string, status:'pending'|'approved'|'denied', email?:string, deviceName?:string, createdAt:number, lastPollAt:number}>} */
const codes = new Map();

function sweep() {
  const now = Date.now();
  for (const [k, v] of codes) {
    if (now - v.createdAt > TTL_MS) codes.delete(k);
  }
}
setInterval(sweep, 60 * 1000).unref?.();

/** Secure device_code: a long URL-safe token. */
function genDeviceCode() {
  return crypto.randomBytes(32).toString('base64url');
}

/** Short user_code in XXXX-XXXX format. No I, O, 0, 1 (easy to confuse). */
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
  // The base comes from OAUTH_REDIRECT_BASE or from an explicit PUBLIC_BASE.
  // This is the public URL where the UI (/cli) is served.
  const base = (process.env.PUBLIC_BASE || process.env.OAUTH_REDIRECT_BASE || '').replace(/\/$/, '');
  return base ? `${base}/cli` : '/cli';
}

export function registerAuthDeviceRoutes(app) {
  /** Step 1: the CLI initiates. No authorization required. */
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

  /** Step 3: the CLI polls. No authorization required (protected by device_code). */
  app.post('/v1/auth/device/poll', express_json_safe, (req, res) => {
    const deviceCode = String(req.body?.device_code || '');
    const entry = codes.get(deviceCode);
    if (!entry) return res.status(400).json({ error: 'expired_token' });

    // Throttle: more often than once per 5 seconds — slow_down.
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
   * Step 2: approval from the UI. Next.js calls this after verifying the
   * user's web session and taking their email from the cookie.
   * Protected by the PROXY_API_KEY shared secret (UI and proxy are on the same machine).
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

/** express.json() is already global, but on these endpoints we want to be precise. */
function express_json_safe(req, res, next) {
  if (typeof req.body !== 'object' || req.body === null) req.body = {};
  next();
}
