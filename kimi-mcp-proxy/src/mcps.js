/**
 * MCP manager — installs, connects to, and surfaces tools from MCP servers.
 *
 * Each configured MCP runs as a child process attached via stdio. We use
 * @modelcontextprotocol/sdk to do the protocol handshake, list its tools,
 * and keep the connection alive. State is persisted in `mcps.json`; runtime
 * data (status / tool list / errors) lives in-memory.
 *
 * Note: tools are surfaced over the API but NOT yet wired into the Kimi/
 * Hermes call path. Next iteration will let the user pick which MCPs are
 * exposed to which agent.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const STORE_DIR = process.env.AUTOMATIONS_DIR || '/opt/kimi-mcp-proxy';
const MCPS_FILE = path.join(STORE_DIR, 'mcps.json');
const CLAUDE_CONFIG = process.env.CLAUDE_CONFIG_FILE || `${process.env.HOME || '/root'}/.claude.json`;

const CONNECT_TIMEOUT_MS = 60_000;
const LIST_TIMEOUT_MS    = 20_000;

let configured = [];                   // persisted, see addMcp() shape
const runtime = new Map();             // id → { status, tools, error, connectedAt, client }

// ──────────────────────────────────────────────────────────────────────────
// Catalog — curated list of well-known MCPs. `argsHint` is shown in UI when
// the args usually need editing (e.g. directory path for filesystem).
// `env` is a list of REQUIRED env var names the user must fill in.
// ──────────────────────────────────────────────────────────────────────────

export const CATALOG = [
  {
    id: 'playwright',
    name: 'Playwright',
    description: 'Управление браузером: navigate / click / fill / screenshot. Идеально для веб-скрейпинга и UI-тестов.',
    command: 'npx', args: ['-y', '@playwright/mcp@latest'],
    env: [], argsHint: null,
    docs: 'https://github.com/microsoft/playwright-mcp',
  },
  {
    id: 'memory',
    name: 'Memory',
    description: 'Knowledge graph в JSON-файле. Долговременная память между диалогами.',
    command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'],
    env: [], argsHint: null,
  },
  {
    id: 'sequentialthinking',
    name: 'Sequential Thinking',
    description: 'Принуждает модель думать пошагово. Полезно для сложных задач, требующих плана.',
    command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    env: [], argsHint: null,
  },
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Read / write / list файлов под разрешёнными корнями. Аргументы — список доступных директорий.',
    command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    env: [], argsHint: 'Список разрешённых директорий (через пробел в редакторе)',
  },
  {
    id: 'fetch',
    name: 'Fetch',
    description: 'HTTP GET / POST для любого URL. Возвращает body + headers.',
    command: 'npx', args: ['-y', '@modelcontextprotocol/server-fetch'],
    env: [], argsHint: null,
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'GitHub API: репы, issues, PR, поиск кода. Нужен Personal Access Token.',
    command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'],
    env: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
    argsHint: null,
  },
  {
    id: 'sqlite',
    name: 'SQLite',
    description: 'SQL-запросы к .db файлу. Аргумент — путь к базе.',
    command: 'npx', args: ['-y', '@modelcontextprotocol/server-sqlite', '/tmp/test.db'],
    env: [], argsHint: 'Путь к .db файлу',
  },
  {
    id: 'postgres',
    name: 'PostgreSQL (RO)',
    description: 'Read-only SQL на Postgres. Аргумент — connection string.',
    command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://localhost/db'],
    env: [], argsHint: 'postgresql://user:pass@host:port/db',
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    description: 'Веб-поиск через Brave Search API. Нужен BRAVE_API_KEY.',
    command: 'npx', args: ['-y', '@modelcontextprotocol/server-brave-search'],
    env: ['BRAVE_API_KEY'], argsHint: null,
  },
];

// ──────────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────────

function newId() {
  return 'm-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
}

function isValidShape(m) {
  return m && typeof m.id === 'string' && typeof m.command === 'string' && Array.isArray(m.args);
}

function load() {
  try {
    if (fs.existsSync(MCPS_FILE)) {
      const raw = fs.readFileSync(MCPS_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) configured = parsed.filter(isValidShape);
    }
  } catch (e) {
    console.warn('[mcps] load failed:', e?.message || e);
    configured = [];
  }
}

function save() {
  try {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(MCPS_FILE, JSON.stringify(configured, null, 2));
  } catch (e) {
    console.warn('[mcps] save failed:', e?.message || e);
  }
  syncToClaudeConfig();
}

/**
 * Mirror our managed MCPs into Claude Code's ~/.claude.json `mcpServers`
 * section. Preserves any other keys the user may have set there.
 * Only ENABLED MCPs are exposed. Server name format: "kp_<id-suffix>_<name>".
 */
function syncToClaudeConfig() {
  let cfg = {};
  try {
    if (fs.existsSync(CLAUDE_CONFIG)) {
      cfg = JSON.parse(fs.readFileSync(CLAUDE_CONFIG, 'utf8')) || {};
    }
  } catch (e) {
    console.warn('[mcps] failed to read', CLAUDE_CONFIG, e?.message || e);
    cfg = {};
  }

  // Strip our previously-written servers (prefixed kp_) so renames/removals propagate.
  const cur = (cfg.mcpServers && typeof cfg.mcpServers === 'object') ? { ...cfg.mcpServers } : {};
  for (const k of Object.keys(cur)) {
    if (k.startsWith('kp_')) delete cur[k];
  }

  for (const m of configured) {
    if (!m.enabled) continue;
    const safeName = String(m.name || m.id).toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 32);
    const key = `kp_${m.id.slice(2, 8)}_${safeName}`;
    cur[key] = {
      command: m.command,
      args: [...(m.args || [])],
      ...(m.env && Object.keys(m.env).length > 0 ? { env: { ...m.env } } : {}),
    };
  }

  cfg.mcpServers = cur;
  try {
    fs.mkdirSync(path.dirname(CLAUDE_CONFIG), { recursive: true });
    fs.writeFileSync(CLAUDE_CONFIG, JSON.stringify(cfg, null, 2));
  } catch (e) {
    console.warn('[mcps] failed to write', CLAUDE_CONFIG, e?.message || e);
  }
}

function rt(id) {
  if (!runtime.has(id)) {
    runtime.set(id, { status: 'stopped', tools: [], error: null, connectedAt: null, client: null });
  }
  return runtime.get(id);
}

function sanitizeEnv(env) {
  const out = {};
  for (const [k, v] of Object.entries(env || {})) {
    if (/^[A-Z_][A-Z0-9_]*$/i.test(k) && typeof v === 'string' && v.length < 4096) {
      out[k] = v;
    }
  }
  return out;
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timeout (${ms}ms)`)), ms)),
  ]);
}

// ──────────────────────────────────────────────────────────────────────────
// lifecycle
// ──────────────────────────────────────────────────────────────────────────

async function startMcp(m) {
  const r = rt(m.id);
  r.status = 'connecting';
  r.error = null;
  r.tools = [];
  r.connectedAt = null;

  try {
    const transport = new StdioClientTransport({
      command: m.command,
      args: m.args || [],
      env: { ...process.env, ...sanitizeEnv(m.env) },
      stderr: 'pipe',
    });
    const client = new Client(
      { name: 'kimi-proxy', version: '1.0.0' },
      { capabilities: {} },
    );

    await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, 'connect');

    let tools = [];
    try {
      const result = await withTimeout(client.listTools(), LIST_TIMEOUT_MS, 'listTools');
      tools = (result?.tools || []).map((t) => ({
        name: String(t.name || ''),
        description: typeof t.description === 'string' ? t.description.slice(0, 280) : '',
      }));
    } catch (e) {
      console.warn(`[mcps] ${m.id} listTools failed:`, e?.message || e);
    }

    r.client = client;
    r.tools = tools;
    r.status = 'connected';
    r.connectedAt = Date.now();
    console.log(`[mcps] connected ${m.name} (${tools.length} tool${tools.length === 1 ? '' : 's'})`);
  } catch (e) {
    r.status = 'failed';
    r.error = String(e?.message || e).slice(0, 600);
    console.warn(`[mcps] failed to start ${m.id} (${m.name}):`, r.error);
  }
}

async function stopMcp(id) {
  const r = rt(id);
  if (r.client) {
    try { await r.client.close(); } catch { /* ignore */ }
  }
  r.client = null;
  r.status = 'stopped';
  r.tools = [];
  r.connectedAt = null;
  r.error = null;
}

// ──────────────────────────────────────────────────────────────────────────
// public API
// ──────────────────────────────────────────────────────────────────────────

export function getCatalog() {
  return CATALOG.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    command: c.command,
    args: [...c.args],
    env: [...c.env],
    argsHint: c.argsHint || null,
    docs: c.docs || null,
  }));
}

export function listConfigured() {
  return configured.map((m) => {
    const r = runtime.get(m.id) || { status: 'unknown', tools: [], error: null, connectedAt: null };
    return {
      id: m.id,
      name: m.name,
      fromCatalog: m.fromCatalog || null,
      command: m.command,
      args: [...(m.args || [])],
      envKeys: Object.keys(m.env || {}),     // expose key names only, no values
      enabled: !!m.enabled,
      createdAt: m.createdAt,
      status: r.status,
      tools: r.tools,
      toolCount: r.tools.length,
      error: r.error,
      connectedAt: r.connectedAt,
    };
  });
}

export async function addMcp(input) {
  let base;
  if (input?.catalogId) {
    const cat = CATALOG.find((c) => c.id === input.catalogId);
    if (!cat) throw new Error('unknown catalog id');
    base = {
      name: input.name || cat.name,
      command: cat.command,
      args: Array.isArray(input.args) && input.args.length > 0 ? input.args.map(String).slice(0, 20) : cat.args,
      env: sanitizeEnv(input.env || {}),
      fromCatalog: cat.id,
    };
    // Refuse if required env vars are missing
    for (const k of cat.env) {
      if (!base.env[k]) throw new Error(`required env var ${k} is missing`);
    }
  } else {
    if (!input?.name || !input?.command) throw new Error('name and command are required');
    base = {
      name: String(input.name).slice(0, 100),
      command: String(input.command).slice(0, 200),
      args: Array.isArray(input.args) ? input.args.map(String).slice(0, 20) : [],
      env: sanitizeEnv(input.env || {}),
      fromCatalog: null,
    };
  }
  const m = {
    id: newId(),
    ...base,
    enabled: input.enabled !== false,
    createdAt: Date.now(),
  };
  configured.push(m);
  save();
  if (m.enabled) {
    // fire-and-forget — UI will reflect 'connecting' state immediately
    startMcp(m).catch(() => {});
  }
  return m;
}

export function updateMcp(id, patch) {
  const idx = configured.findIndex((m) => m.id === id);
  if (idx < 0) return null;
  const cur = configured[idx];
  const next = { ...cur };
  if (typeof patch?.name === 'string')    next.name    = patch.name.slice(0, 100);
  if (Array.isArray(patch?.args))         next.args    = patch.args.map(String).slice(0, 20);
  if (typeof patch?.env === 'object' && patch.env) next.env = sanitizeEnv(patch.env);
  if (typeof patch?.enabled === 'boolean')next.enabled = patch.enabled;
  configured[idx] = next;
  save();
  // restart in background
  stopMcp(id).then(() => {
    if (next.enabled) return startMcp(next);
  }).catch(() => {});
  return next;
}

export async function deleteMcp(id) {
  await stopMcp(id);
  runtime.delete(id);
  const before = configured.length;
  configured = configured.filter((m) => m.id !== id);
  if (configured.length === before) return false;
  save();
  return true;
}

export async function restartMcp(id) {
  const m = configured.find((x) => x.id === id);
  if (!m) return null;
  await stopMcp(id);
  if (m.enabled) startMcp(m).catch(() => {});
  return m;
}

// ──────────────────────────────────────────────────────────────────────────
// boot — auto-start all enabled MCPs on import (background)
// ──────────────────────────────────────────────────────────────────────────

load();
for (const m of configured) {
  if (m.enabled) startMcp(m).catch(() => {});
}
// Ensure ~/.claude.json mcpServers reflects current state on startup
syncToClaudeConfig();
console.log(`[mcps] loaded ${configured.length} mcp(s), catalog has ${CATALOG.length} item(s)`);
