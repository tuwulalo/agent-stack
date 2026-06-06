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
