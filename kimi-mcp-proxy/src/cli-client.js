import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { config } from './config.js';

// Drives a LOCAL CLI tool (claude / codex / gemini) instead of a remote API.
// The CLI is authenticated by the user's flat-rate subscription, so requests
// run "for free" against an already-paid plan rather than per-token API billing.
// We translate an OpenAI chat-completion request into a single text prompt,
// run the CLI in one-shot mode, then wrap stdout back into the OpenAI shape.

function providerModel() {
  if (config.cliModel) return config.cliModel;
  return `${config.cliProvider}-cli`;
}

// Flatten OpenAI messages[] into one prompt the CLI can consume in -p mode.
function messagesToPrompt(messages) {
  if (!Array.isArray(messages)) return '';
  const systemParts = [];
  const turns = [];

  for (const msg of messages) {
    const role = msg?.role || 'user';
    const content = normalizeContent(msg?.content);
    if (!content) continue;
    if (role === 'system') {
      systemParts.push(content);
    } else if (role === 'assistant') {
      turns.push(`Assistant: ${content}`);
    } else if (role === 'tool') {
      turns.push(`Tool result: ${content}`);
    } else {
      turns.push(`User: ${content}`);
    }
  }

  const head = systemParts.length ? systemParts.join('\n\n') + '\n\n' : '';
  // End with an explicit Assistant cue so the model continues the turn.
  return `${head}${turns.join('\n\n')}\n\nAssistant:`;
}

// OpenAI content can be a string or an array of parts ({type:'text',text}).
function normalizeContent(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === 'string' ? p : p?.text || ''))
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  return '';
}

function buildCommand(prompt) {
  const provider = config.cliProvider;

  if (config.cliCustomCmd) {
    // CLI_CUSTOM_CMD is a shell template with {prompt} placeholder.
    return {
      bin: 'sh',
      args: ['-c', config.cliCustomCmd.replace('{prompt}', '"$AGENT_PROMPT"')],
      env: { AGENT_PROMPT: prompt },
    };
  }

  if (provider === 'claude') {
    const args = ['-p', prompt, '--dangerously-skip-permissions'];
    if (config.cliModel) args.push('--model', config.cliModel);
    // IS_SANDBOX lets --dangerously-skip-permissions run under root (systemd).
    return { bin: config.claudeBin, args, env: { IS_SANDBOX: '1' } };
  }

  if (provider === 'codex') {
    const args = ['exec', '--skip-git-repo-check'];
    if (config.cliModel) args.push('--model', config.cliModel);
    args.push(prompt);
    return { bin: config.codexBin, args, env: {} };
  }

  if (provider === 'gemini') {
    const args = ['-p', prompt];
    if (config.cliModel) args.push('-m', config.cliModel);
    return { bin: config.geminiBin, args, env: {} };
  }

  throw Object.assign(new Error(`Unknown CLI_PROVIDER "${provider}" (use claude|codex|gemini or set CLI_CUSTOM_CMD)`), { status: 500 });
}

function runCli(prompt, { signal } = {}) {
  const { bin, args, env } = buildCommand(prompt);

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const child = spawn(bin, args, {
      cwd: '/tmp',
      env: { ...process.env, HOME: process.env.HOME || '/root', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
        reject(Object.assign(new Error('CLI request timed out'), { status: 504 }));
      }
    }, config.cliTimeoutMs);

    const onAbort = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
        reject(Object.assign(new Error('aborted'), { name: 'AbortError', status: 504 }));
      }
    };
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(Object.assign(new Error(`failed to start CLI "${bin}": ${err.message}`), { status: 500 }));
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (code !== 0) {
        return reject(Object.assign(
          new Error(`CLI "${bin}" exited ${code}: ${(stderr || stdout || '').slice(0, 400)}`),
          { status: 502 },
        ));
      }
      resolve(stdout.trim());
    });
  });
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil((text || '').length / 4));
}

function buildCompletion(text, promptText) {
  const id = 'chatcmpl-' + crypto.randomBytes(12).toString('hex');
  const promptTokens = estimateTokens(promptText);
  const completionTokens = estimateTokens(text);
  return {
    id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: providerModel(),
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

// Non-stream path: returns an OpenAI chat.completion object.
export async function callCliChatCompletion(payload, { signal } = {}) {
  const prompt = messagesToPrompt(payload?.messages);
  if (!prompt.trim()) {
    throw Object.assign(new Error('messages[] is required'), { status: 400 });
  }
  const text = await runCli(prompt, { signal });
  return buildCompletion(text, prompt);
}

// Stream path: the CLI runs one-shot, so we emit the full answer as a single
// SSE delta chunk followed by [DONE]. `res` is the express response.
export async function streamCliChatCompletion(payload, res, { signal } = {}) {
  const prompt = messagesToPrompt(payload?.messages);
  if (!prompt.trim()) {
    throw Object.assign(new Error('messages[] is required'), { status: 400 });
  }
  const text = await runCli(prompt, { signal });
  const id = 'chatcmpl-' + crypto.randomBytes(12).toString('hex');
  const created = Math.floor(Date.now() / 1000);
  const model = providerModel();

  const head = {
    id, object: 'chat.completion.chunk', created, model,
    choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
  };
  res.write(`data: ${JSON.stringify(head)}\n\n`);

  const body = {
    id, object: 'chat.completion.chunk', created, model,
    choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
  };
  res.write(`data: ${JSON.stringify(body)}\n\n`);

  const tail = {
    id, object: 'chat.completion.chunk', created, model,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  };
  res.write(`data: ${JSON.stringify(tail)}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

export function getCliModelList() {
  return {
    object: 'list',
    data: [
      {
        id: providerModel(),
        object: 'model',
        created: 0,
        owned_by: config.cliProvider,
      },
    ],
  };
}
