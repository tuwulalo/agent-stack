import 'dotenv/config';

function readInteger(name, fallback) {
  const value = process.env[name];

  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed)) {
    throw new Error(`${name} must be an integer`);
  }

  return parsed;
}

// Refuse to boot with no key or the publicly known placeholder from
// .env.example — otherwise the proxy is open to the whole internet.
// Conscious opt-out for local experiments: ALLOW_NO_AUTH=1.
const PLACEHOLDER_PROXY_KEYS = new Set(['', 'replace-with-a-long-random-string', 'change-me']);
if (PLACEHOLDER_PROXY_KEYS.has(process.env.PROXY_API_KEY || '') && process.env.ALLOW_NO_AUTH !== '1') {
  console.error(
    'PROXY_API_KEY is empty or still the placeholder from .env.example.\n' +
    'Set a long random value (e.g. `openssl rand -hex 32`) in kimi-mcp-proxy/.env,\n' +
    'or set ALLOW_NO_AUTH=1 to run without auth (local experiments only).'
  );
  process.exit(1);
}

if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET must be at least 32 characters.');
  process.exit(1);
}

export const config = {
  host: process.env.HOST || '0.0.0.0',
  port: readInteger('PORT', 3000),
  kimiApiKey: process.env.KIMI_API_KEY || '',
  kimiBaseUrl: (process.env.KIMI_BASE_URL || 'https://api.kimi.com/coding/v1').replace(/\/$/, ''),
  kimiModel: process.env.KIMI_MODEL || 'kimi-for-coding',
  proxyApiKey: process.env.PROXY_API_KEY || '',
  requestTimeoutMs: readInteger('REQUEST_TIMEOUT_MS', 120000),
  maxRequestBytes: process.env.MAX_REQUEST_BYTES || '50mb',
  hermesBin: process.env.HERMES_BIN || '/opt/hermes-agent/venv/bin/hermes',
  hermesCwd: process.env.HERMES_CWD || '/root',
  agentTimeoutMs: readInteger('AGENT_TIMEOUT_MS', 600000),
};

export function assertKimiConfigured() {
  if (!config.kimiApiKey) {
    throw new Error('KIMI_API_KEY is required');
  }
}
