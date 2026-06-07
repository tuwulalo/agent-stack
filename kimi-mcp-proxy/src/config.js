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
  // Backend selector: 'cli' drives a local CLI authenticated by a flat-rate
  // subscription (claude/codex/gemini); 'api' calls a remote OpenAI-compatible
  // endpoint via KIMI_BASE_URL/KIMI_API_KEY.
  llmBackend: (process.env.LLM_BACKEND || 'api').toLowerCase(),
  kimiApiKey: process.env.KIMI_API_KEY || '',
  kimiBaseUrl: (process.env.KIMI_BASE_URL || 'https://api.kimi.com/coding/v1').replace(/\/$/, ''),
  kimiModel: process.env.KIMI_MODEL || 'kimi-for-coding',
  // CLI backend config.
  cliProvider: (process.env.CLI_PROVIDER || 'claude').toLowerCase(),
  cliModel: process.env.CLI_MODEL || '',
  cliCustomCmd: process.env.CLI_CUSTOM_CMD || '',
  cliTimeoutMs: readInteger('CLI_TIMEOUT_MS', 120000),
  claudeBin: process.env.CLAUDE_BIN || 'claude',
  codexBin: process.env.CODEX_BIN || 'codex',
  geminiBin: process.env.GEMINI_BIN || 'gemini',
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
