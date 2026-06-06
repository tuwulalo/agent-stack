import { config, assertKimiConfigured } from './config.js';

function withDefaultModel(payload) {
  return {
    ...payload,
    model: payload.model || config.kimiModel
  };
}

async function readError(response) {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: text || response.statusText } };
  }
}

export async function callKimiChatCompletion(payload, { signal } = {}) {
  assertKimiConfigured();

  if (!/^[\x00-\x7F]+$/.test(config.kimiApiKey)) {
    throw Object.assign(new Error('KIMI_API_KEY contains non-ASCII characters — check your .env file'), { status: 500 });
  }

  const response = await fetch(`${config.kimiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.kimiApiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'RooCode/3.46.1',
      'HTTP-Referer': 'https://github.com/RooVetGit/Roo-Cline',
      'X-Title': 'Roo Code'
    },
    body: JSON.stringify(withDefaultModel(payload)),
    signal
  });

  if (!response.ok) {
    const errorBody = await readError(response);
    const message = errorBody?.error?.message || `Kimi API returned ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.body = errorBody;
    throw error;
  }

  if (payload.stream) {
    return response;
  }

  return response.json();
}

export function getModelList() {
  return {
    object: 'list',
    data: [
      {
        id: config.kimiModel,
        object: 'model',
        created: 0,
        owned_by: 'moonshot'
      }
    ]
  };
}
