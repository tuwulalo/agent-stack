// Telegram bridge: lets the owner drive VPS agent sessions from their own bot.
// Each "thread" maps to a persistent agent session (same infra as the platform),
// so history syncs with the web UI. Locked to a single owner chat id.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PUBLISH_HINT } from './prompts.js';
import { createSession, getSession, touchSession } from './agent-sessions.js';

const STATE_FILE = process.env.TELEGRAM_STATE_FILE || '/opt/kimi-mcp-proxy/telegram-state.json';
const THREADS = {
  agent: 'Agent (TG)',
  zavod: 'Zavod 2 UI (TG)',
  apka:  'Apka (TG)',
};

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function saveState(s) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); } catch (e) { console.error('[tg] state save failed', e?.message); }
}

let state = loadState();
// state shape: { ownerId, active, threads: { key: sessionId }, seeds: {key:bool} }
state.threads = state.threads || {};
state.active = state.active || 'agent';

export function getTelegramState() { return state; }

// Allow the platform to pre-seed a thread with starter context + name.
export function ensureThreadSession(key) {
  const existing = state.threads[key] ? getSession(state.threads[key]) : null;
  if (existing) return existing;
  const sess = createSession({ agent: 'claude', prompt: '', name: THREADS[key] || ('TG ' + key) });
  state.threads[key] = sess.id;
  saveState(state);
  return sess;
}

export function setTelegramThreadSession(key, sessionId) {
  state.threads[key] = sessionId;
  saveState(state);
}

export function startTelegramBot({ token }) {
  if (!token) { console.log('[tg] no token, bridge disabled'); return; }
  const API = `https://api.telegram.org/bot${token}`;
  const busy = new Set(); // thread keys currently running

  async function tg(method, params) {
    try {
      const r = await fetch(`${API}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params || {}),
      });
      return await r.json();
    } catch (e) { console.error('[tg]', method, 'failed', e?.message); return null; }
  }

  async function send(chatId, text) {
    const MAX = 3900;
    const s = String(text || '').trim() || '(empty response)';
    for (let i = 0; i < s.length; i += MAX) {
      await tg('sendMessage', { chat_id: chatId, text: s.slice(i, i + MAX), disable_web_page_preview: true });
    }
  }

  function runAgent(session, text) {
    return new Promise((resolve) => {
      const sessFlag = (session.turns || 0) > 0
        ? ['--resume', session.claudeSessionId]
        : ['--session-id', session.claudeSessionId];
      const proc = spawn(process.env.CLAUDE_BIN || 'claude', [
        '-p', text, ...sessFlag,
        '--append-system-prompt', PUBLISH_HINT,
        '--output-format', 'text',
        '--dangerously-skip-permissions',
        '--disallowedTools', 'AskUserQuestion',
      ], {
        cwd: process.env.CLAUDE_CWD || '/root',
        env: { ...process.env, IS_SANDBOX: '1', KP_SESSION_ID: session.id, KP_CLAUDE_SESSION_ID: session.claudeSessionId, KP_DEPTH: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      proc.stdout.on('data', (b) => { out += b.toString('utf8'); });
      proc.stderr.on('data', () => {});
      const tmo = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 20 * 60_000);
      tmo.unref();
      proc.on('close', (code) => {
        clearTimeout(tmo);
        try { touchSession(session.id, { prompt: text, summary: out, clean: code === 0 }); } catch {}
        resolve({ out, code });
      });
      proc.on('error', (e) => { clearTimeout(tmo); resolve({ out: '', code: -1, err: String(e?.message || e) }); });
    });
  }

  async function handleText(chatId, text) {
    // Owner lock: first message ever locks the bot to that chat id.
    if (!state.ownerId) {
      state.ownerId = chatId;
      saveState(state);
      await send(chatId, `🔒 The bot is now locked to you (chat id ${chatId}).\n\nThreads: /agent · /zavod · /apka\nCurrent: ${THREADS[state.active]}\nJust type a task — it runs on the VPS in the active thread. /threads — list, /new — new thread.`);
      return;
    }
    if (chatId !== state.ownerId) {
      await send(chatId, '⛔ Access denied.');
      return;
    }

    const t = text.trim();
    if (t === '/start' || t === '/help') {
      await send(chatId, `Threads: /agent · /zavod · /apka (current: ${THREADS[state.active]}).\nType a task — it runs on the VPS. /threads — list, /new — reset the thread.`);
      return;
    }
    if (t === '/threads') {
      const lines = Object.entries(THREADS).map(([k, n]) => `${k === state.active ? '▶' : '•'} /${k} — ${n}${state.threads[k] ? ' (exists)' : ''}`);
      await send(chatId, lines.join('\n'));
      return;
    }
    if (t.startsWith('/') && THREADS[t.slice(1)]) {
      state.active = t.slice(1);
      saveState(state);
      ensureThreadSession(state.active);
      await send(chatId, `▶ Thread: ${THREADS[state.active]}`);
      return;
    }
    if (t === '/new') {
      delete state.threads[state.active];
      saveState(state);
      ensureThreadSession(state.active);
      await send(chatId, `🆕 New thread ${THREADS[state.active]}.`);
      return;
    }
    if (!t) return;

    const key = state.active;
    if (busy.has(key)) { await send(chatId, '⏳ Still processing the previous message in this thread.'); return; }
    busy.add(key);
    const session = ensureThreadSession(key);
    await tg('sendChatAction', { chat_id: chatId, action: 'typing' });
    try {
      const { out, code, err } = await runAgent(session, t);
      if (err) await send(chatId, '⚠ Launch error: ' + err);
      else await send(chatId, out || `(agent finished, exit=${code}, no text)`);
    } finally {
      busy.delete(key);
    }
  }

  let offset = 0;
  let stopped = false;
  async function loop() {
    while (!stopped) {
      const res = await tg('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] });
      if (res && res.ok && Array.isArray(res.result)) {
        for (const u of res.result) {
          offset = u.update_id + 1;
          const m = u.message;
          if (m && typeof m.text === 'string' && m.chat && m.chat.id) {
            handleText(m.chat.id, m.text).catch((e) => console.error('[tg] handle', e?.message));
          }
        }
      } else {
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }
  console.log('[tg] bridge starting (long-poll)…');
  loop().catch((e) => console.error('[tg] loop crashed', e?.message));
}
