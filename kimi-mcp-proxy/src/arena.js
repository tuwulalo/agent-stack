import { config } from './config.js';

// ---------------------------------------------------------------------------
//  Model Arena — run one prompt across several providers and compare.
//
//  Every provider is reached over an OpenAI-compatible /chat/completions
//  endpoint, so one transport covers all of them — only base URL, key and
//  model id differ. A provider is "available" only when its API key is set;
//  Kimi reuses the proxy's own upstream config, so it works out of the box.
//
//  Add or retune providers by editing PROVIDER_DEFS or the ARENA_* env vars.
// ---------------------------------------------------------------------------

function providerDefs() {
  return [
    {
      id: 'kimi',
      label: 'Kimi (Moonshot)',
      baseUrl: (process.env.ARENA_KIMI_BASE_URL || config.kimiBaseUrl).replace(/\/$/, ''),
      apiKey: process.env.ARENA_KIMI_API_KEY || config.kimiApiKey,
      model: process.env.ARENA_KIMI_MODEL || config.kimiModel,
    },
    {
      id: 'claude',
      label: 'Claude (Anthropic)',
      // Anthropic ships an OpenAI-compatible layer at /v1/chat/completions.
      baseUrl: (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1').replace(/\/$/, ''),
      apiKey: process.env.ANTHROPIC_API_KEY || '',
      model: process.env.ARENA_CLAUDE_MODEL || 'claude-opus-4-8',
    },
    {
      id: 'glm',
      label: 'GLM (Zhipu)',
      baseUrl: (process.env.ZHIPU_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/$/, ''),
      apiKey: process.env.ZHIPU_API_KEY || '',
      model: process.env.ARENA_GLM_MODEL || 'glm-4.6',
    },
  ];
}

export function listArenaProviders() {
  return providerDefs().map((p) => ({
    id: p.id,
    label: p.label,
    model: p.model,
    available: Boolean(p.apiKey),
  }));
}

export async function runArenaPrompt({ providerId, prompt, system, maxTokens, signal }) {
  const provider = providerDefs().find((p) => p.id === providerId);
  if (!provider) {
    const err = new Error(`unknown provider ${providerId}`);
    err.status = 400;
    throw err;
  }
  if (!provider.apiKey) {
    const err = new Error(`provider ${providerId} has no API key configured`);
    err.status = 400;
    throw err;
  }

  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });

  const startedAt = Date.now();
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: provider.model,
      messages,
      // Anthropic requires max_tokens; the others accept and cap on it.
      max_tokens: maxTokens || 4096,
      stream: false,
    }),
    signal,
  });
  const ms = Date.now() - startedAt;

  const raw = await response.text();
  let json = null;
  try { json = JSON.parse(raw); } catch { /* non-JSON error body */ }

  if (!response.ok) {
    const message = json?.error?.message || raw || `HTTP ${response.status}`;
    return { providerId, model: provider.model, ms, error: String(message).slice(0, 400) };
  }

  const content = json?.choices?.[0]?.message?.content ?? '';
  return {
    providerId,
    model: provider.model,
    ms,
    text: typeof content === 'string' ? content : JSON.stringify(content),
    usage: json?.usage ?? null,
  };
}
