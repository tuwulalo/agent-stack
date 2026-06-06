/**
 * Persistent store for resumable agent sessions (currently Claude only —
 * Hermes oneshot mode doesn't have a clean resume hook).
 *
 * One file: /opt/kimi-mcp-proxy/agent-sessions.json
 *
 * Each record:
 *   {
 *     id,                  // our short id, e.g. "as-abc123def"
 *     agent,               // 'claude'
 *     claudeSessionId,     // the UUID we pass to claude --session-id / --resume
 *     name,                // derived from first prompt (user can rename later)
 *     createdAt,           // ms
 *     lastUsedAt,          // ms
 *     turns,               // number of run-stream invocations
 *     lastPrompt,          // last task text (truncated)
 *     lastSummary,         // first ~200 chars of last assistant reply
 *     parentSessionId,     // null for root, our short id of parent agent
 *     depth,               // 0 for root, parent.depth + 1
 *   }
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const STORE_DIR = process.env.AUTOMATIONS_DIR || '/opt/kimi-mcp-proxy';
const FILE = path.join(STORE_DIR, 'agent-sessions.json');
const MAX_SESSIONS = 200;

let sessions = [];

function load() {
  try {
    if (fs.existsSync(FILE)) {
      const raw = fs.readFileSync(FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) sessions = parsed.filter(isValid);
    }
  } catch (e) {
    console.warn('[sessions] load failed:', e?.message || e);
    sessions = [];
  }
}
function save() {
  try {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    // cap by lastUsedAt to keep file bounded
    const ranked = [...sessions].sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0));
    sessions = ranked.slice(0, MAX_SESSIONS);
    fs.writeFileSync(FILE, JSON.stringify(sessions, null, 2));
  } catch (e) {
    console.warn('[sessions] save failed:', e?.message || e);
  }
}

function isValid(s) {
  return s && typeof s.id === 'string'
    && typeof s.agent === 'string'
    && typeof s.claudeSessionId === 'string';
}

function newId() {
  return 'as-' + crypto.randomBytes(5).toString('hex');
}

function deriveName(prompt) {
  const t = String(prompt || '').replace(/\s+/g, ' ').trim();
  if (!t) return 'Без названия';
  return t.length > 60 ? t.slice(0, 60) + '…' : t;
}

// ──────────────────────────────────────────────────────────────────────────
// public API
// ──────────────────────────────────────────────────────────────────────────

/** Create a brand-new session record and return it. */
export function createSession({ agent, prompt, claudeSessionId, name, parentSessionId = null }) {
  const now = Date.now();
  let depth = 0;
  if (parentSessionId) {
    const parent = sessions.find((s) => s.id === parentSessionId);
    if (parent) depth = (parent.depth || 0) + 1;
  }
  const rec = {
    id: newId(),
    agent: agent === 'claude' ? 'claude' : 'claude',
    claudeSessionId: claudeSessionId || crypto.randomUUID(),
    name: name || deriveName(prompt),
    createdAt: now,
    lastUsedAt: now,
    turns: 0,             // bumped to 1 by touchSession after the first run completes
    lastPrompt: String(prompt || '').slice(0, 800),
    lastSummary: '',
    parentSessionId: parentSessionId || null,
    depth,
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
  };
  sessions.push(rec);
  save();
  return rec;
}

export const MAX_DELEGATION_DEPTH = 5;

export function getSession(id) {
  return sessions.find((s) => s.id === id) || null;
}

export function listSessions(limit = 50) {
  return [...sessions]
    .sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0))
    .slice(0, limit);
}

/** Update lastUsedAt, bump turns, store new prompt + summary. */
export function touchSession(id, { prompt, summary, clean, usage }) {
  const idx = sessions.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  const cur = sessions[idx];
  sessions[idx] = {
    ...cur,
    lastUsedAt: Date.now(),
    turns: (cur.turns || 0) + 1,
    lastClean: typeof clean === 'boolean' ? clean : cur.lastClean,
    costUsd: (cur.costUsd || 0) + (usage && Number(usage.costUsd) > 0 ? Number(usage.costUsd) : 0),
    tokensIn: (cur.tokensIn || 0) + (usage && Number(usage.tokensIn) > 0 ? Number(usage.tokensIn) : 0),
    tokensOut: (cur.tokensOut || 0) + (usage && Number(usage.tokensOut) > 0 ? Number(usage.tokensOut) : 0),
    lastPrompt: typeof prompt === 'string' ? prompt.slice(0, 800) : cur.lastPrompt,
    lastSummary: typeof summary === 'string'
      ? summary.replace(/\s+/g, ' ').trim().slice(0, 240)
      : cur.lastSummary,
  };
  save();
  return sessions[idx];
}

export function setFeedback(id, { rating, kind, note }) {
  const idx = sessions.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  sessions[idx] = {
    ...sessions[idx],
    feedback: {
      rating: rating === 'up' || rating === 'down' ? rating : null,
      kind: ['good', 'partial', 'broken', 'hallucination'].includes(kind) ? kind : null,
      note: typeof note === 'string' ? note.slice(0, 500) : '',
      at: Date.now(),
    },
  };
  save();
  return sessions[idx];
}

export function setJudge(id, { score, verdict, reason }) {
  const idx = sessions.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  sessions[idx] = {
    ...sessions[idx],
    judge: {
      score: typeof score === 'number' ? Math.max(0, Math.min(10, score)) : null,
      verdict: ['good', 'partial', 'broken', 'hallucination'].includes(verdict) ? verdict : null,
      reason: typeof reason === 'string' ? reason.slice(0, 600) : '',
      at: Date.now(),
    },
  };
  save();
  return sessions[idx];
}

export function renameSession(id, name) {
  const idx = sessions.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  sessions[idx] = { ...sessions[idx], name: String(name || '').trim().slice(0, 120) || sessions[idx].name };
  save();
  return sessions[idx];
}

export function deleteSession(id) {
  const before = sessions.length;
  sessions = sessions.filter((s) => s.id !== id);
  if (sessions.length === before) return false;
  save();
  return true;
}

/** Прямые потомки сессии (один уровень вниз). */
export function getChildSessions(parentId) {
  return sessions.filter((s) => s.parentSessionId === parentId);
}

/**
 * Собрать markdown-сводку «вот что успели сделать твои саб-агенты пока
 * тебя SIGKILL'нуло». Используется при resume оркестратора:
 *   • если у сессии есть дети с непустыми lastSummary
 *   • и все дети уже неактивны (lastUsedAt > 30с назад)
 * → возвращаем блок текста чтобы префиксить им следующий prompt.
 *
 * Если оркестратор уже их «видел» (его собственный lastUsedAt свежее любого
 * ребёнка) — ничего не возвращаем чтоб не дублировать.
 */
export function buildChildrenRecoveryBlock(parentId) {
  const parent = sessions.find((s) => s.id === parentId);
  if (!parent) return null;
  const kids = getChildSessions(parentId).filter((k) => k.lastSummary && k.turns > 0);
  if (kids.length === 0) return null;
  const now = Date.now();
  const STALE_MS = 30_000;
  const allIdle = kids.every((k) => now - (k.lastUsedAt || 0) > STALE_MS);
  if (!allIdle) return null; // дети ещё работают — пусть оркестратор подождёт
  // оркестратор уже отвечал ПОСЛЕ того как последний ребёнок закончил?
  const latestKid = Math.max(...kids.map((k) => k.lastUsedAt || 0));
  if ((parent.lastUsedAt || 0) > latestKid + 5_000) return null; // уже подхватил
  // собираем блок
  const lines = [];
  lines.push('--- recovery context: твои саб-агенты УЖЕ закончили работу ---');
  lines.push(`(оркестратор #${parent.id} был прерван SIGKILL/timeout, но ${kids.length} саб-агента отчитались)`);
  lines.push('');
  for (const k of kids) {
    lines.push(`## ${k.name} (${k.id}, ${k.turns} ход${k.turns === 1 ? '' : 'а'})`);
    lines.push(k.lastSummary);
    lines.push('');
  }
  lines.push('--- /recovery context ---');
  lines.push('');
  return lines.join('\n');
}

load();
console.log(`[sessions] loaded ${sessions.length} agent session(s)`);
