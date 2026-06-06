import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import multer from 'multer';
import { config } from './config.js';
import { callKimiChatCompletion, getModelList } from './kimi-client.js';
import {
  buildMemoryBlock,
  deleteNote,
  digestChat,
  ensureChatDir,
  isValidChatId,
  isValidFilename,
  listNotes,
  readNote,
  writeNote,
} from './chat-store.js';
import { PUBLISH_HINT } from './prompts.js';
import { startTelegramBot, getTelegramState } from './telegram.js';
import {
  buildChildrenRecoveryBlock,
  createSession as createAgentSession,
  deleteSession as deleteAgentSession,
  getChildSessions,
  getSession as getAgentSession,
  listSessions as listAgentSessions,
  MAX_DELEGATION_DEPTH,
  renameSession as renameAgentSession,
  setFeedback as setSessionFeedback,
  setJudge as setSessionJudge,
  touchSession as touchAgentSession,
} from './agent-sessions.js';
import {
  createSchedule,
  deleteSchedule,
  fireSchedule,
  getSchedule,
  listRuns,
  listSchedules,
  runAdhoc,
  updateSchedule,
} from './automations.js';
import {
  addMcp,
  deleteMcp,
  getCatalog,
  listConfigured as listMcps,
  restartMcp,
  updateMcp,
} from './mcps.js';
import { registerAuthDeviceRoutes } from './auth-device.js';
import { verifyJwt } from './auth-jwt.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, '..', 'public');
const app = express();

// Cross-Origin-Resource-Policy needs to be permissive — the chat UI is
// served from port 3002 and pulls /agent/file from 3001, which counts as a
// cross-origin <img>. Helmet's default `same-origin` blocks the load
// silently (the request succeeds but the image element gets naturalWidth=0).
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
app.use(cors());
app.use(morgan('combined'));
app.use(express.json({ limit: config.maxRequestBytes }));
app.use(express.static(publicDir));

function requiresAuth(req, res, next) {
  if (!config.proxyApiKey) {
    return next();
  }

  const authorization = req.get('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';

  // 1) Shared static key — для серверных интеграций.
  if (token && token === config.proxyApiKey) {
    return next();
  }

  // 2) JWT, выданный device-flow'ом — для CLI на компах пользователей.
  if (token && process.env.JWT_SECRET) {
    const payload = verifyJwt(token);
    if (payload && payload.kind === 'device') {
      req.tokenPayload = payload;
      return next();
    }
  }

  return res.status(401).json({ error: { message: 'Invalid proxy API key' } });
}

app.get('/health', (req, res) => {
  res.json({ ok: true, model: config.kimiModel });
});

// OAuth 2.0 Device Authorization Grant — для входа CLI на компе пользователя.
registerAuthDeviceRoutes(app);

app.get('/v1/models', requiresAuth, (req, res) => {
  res.json(getModelList());
});

app.post('/v1/chat/completions', requiresAuth, async (req, res) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  try {
    const result = await callKimiChatCompletion(req.body, { signal: controller.signal });

    if (req.body?.stream) {
      res.status(result.status);
      res.setHeader('Content-Type', result.headers.get('content-type') || 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');

      for await (const chunk of result.body) {
        res.write(chunk);
      }

      return res.end();
    }

    return res.json(result);
  } catch (error) {
    const status = error.name === 'AbortError' ? 504 : error.status || 500;
    const message = error.name === 'AbortError' ? 'Kimi API request timed out' : error.message;

    return res.status(status).json({
      error: {
        message,
        upstream: error.body || undefined
      }
    });
  } finally {
    clearTimeout(timeout);
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   File uploads for agent mode — POST /agent/uploads (multipart/form-data,
   field name "files"). Saves into /tmp/hk_uploads/<uploadId>/<safeName>
   and returns absolute paths so Hermes can read them via its shell tools.
   ──────────────────────────────────────────────────────────────────────────── */

const UPLOAD_ROOT = process.env.UPLOAD_DIR || path.join(os.tmpdir(), 'hk_uploads');
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      if (!req._uploadDir) {
        req._uploadId = crypto.randomBytes(6).toString('hex');
        req._uploadDir = path.join(UPLOAD_ROOT, req._uploadId);
        fs.mkdirSync(req._uploadDir, { recursive: true });
      }
      cb(null, req._uploadDir);
    },
    filename: (_req, file, cb) => {
      const safe = file.originalname
        .replace(/[/\\]+/g, '_')
        .replace(/[^A-Za-z0-9._\-+ а-яА-ЯёЁ()]/g, '_')
        .slice(0, 180) || 'upload';
      cb(null, safe);
    },
  }),
  limits: {
    fileSize: 50 * 1024 * 1024,   // 50 MB per file
    files: 10,
  },
});

app.post('/agent/uploads', requiresAuth, upload.array('files', 10), (req, res) => {
  const files = (req.files || []).map((f) => ({
    name: f.originalname,
    storedAs: path.basename(f.path),
    path: f.path,
    size: f.size,
    mime: f.mimetype,
  }));
  res.json({ uploadId: req._uploadId || null, dir: req._uploadDir || null, files });
});

/* ─────────────────────────────────────────────────────────────────────────────
   /agent/file — serve files Hermes produced (screenshots, generated assets).
   Strict allowlist of allowed root directories; resolved path must stay under
   one of them (no symlink escape, no `..`). Cap at 25 MB.
   ──────────────────────────────────────────────────────────────────────────── */

const FILE_ALLOWED_ROOTS = (process.env.AGENT_FILE_ROOTS || '/tmp,/root/.hermes/sessions,/opt/hermes-agent')
  .split(',')
  .map((p) => path.resolve(p.trim()))
  .filter(Boolean);

const FILE_MAX_BYTES = 25 * 1024 * 1024;

const MIME_BY_EXT = {
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.svg':  'image/svg+xml',
  '.bmp':  'image/bmp',
  '.ico':  'image/x-icon',
  '.pdf':  'application/pdf',
  '.txt':  'text/plain; charset=utf-8',
  '.md':   'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.log':  'text/plain; charset=utf-8',
};

function guessMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

app.get('/agent/file', requiresAuth, (req, res) => {
  const raw = typeof req.query.path === 'string' ? req.query.path : '';
  if (!raw) return res.status(400).json({ error: { message: 'path is required' } });

  let abs;
  try {
    abs = fs.realpathSync(path.resolve(raw));
  } catch {
    return res.status(404).json({ error: { message: 'file not found' } });
  }

  const ok = FILE_ALLOWED_ROOTS.some((root) => abs === root || abs.startsWith(root + path.sep));
  if (!ok) return res.status(403).json({ error: { message: 'path not allowed' } });

  let stat;
  try { stat = fs.statSync(abs); } catch {
    return res.status(404).json({ error: { message: 'file not found' } });
  }
  if (!stat.isFile()) return res.status(400).json({ error: { message: 'not a regular file' } });
  if (stat.size > FILE_MAX_BYTES) return res.status(413).json({ error: { message: 'file too big' } });

  res.setHeader('Content-Type', guessMime(abs));
  res.setHeader('Content-Length', String(stat.size));
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(path.basename(abs))}"`);
  fs.createReadStream(abs).pipe(res);
});

/* ─────────────────────────────────────────────────────────────────────────────
   Agent mode — spawn `hermes -z "<prompt>" --yolo` and stream stdout/stderr
   over SSE. Hermes runs autonomously: chooses tools, executes shells, edits
   files, all auto-approved. We surface live output and the exit code.
   ──────────────────────────────────────────────────────────────────────────── */

function sseWrite(res, event) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

/* ─────────────────────────────────────────────────────────────────────────────
   Custom Agents registry — per-employee/per-role agent definitions stored
   in /opt/kimi-mcp-proxy/agents.json. Each agent has its own systemPrompt,
   default mode, persona (mascot colour + name), and optional model override.
   Hot-reloaded on every read so admins can edit without restart.
   ──────────────────────────────────────────────────────────────────────────── */

const AGENTS_FILE = process.env.AGENTS_FILE || path.join(__dirname, '..', 'agents.json');

function loadAgents() {
  try {
    const raw = fs.readFileSync(AGENTS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((a) => a && a.id && a.name);
  } catch {
    /* file missing or invalid — return empty */
  }
  return [];
}

function findAgent(id) {
  if (!id) return null;
  return loadAgents().find((a) => a.id === id) || null;
}

app.get('/agents', requiresAuth, (req, res) => {
  res.json({ agents: loadAgents() });
});

/* ─────────────────────────────────────────────────────────────────────────────
   Per-chat MD memory — each chat owns a folder under /opt/kimi-chats/<id>/.
   ──────────────────────────────────────────────────────────────────────────── */

app.get('/chats/:id/notes', requiresAuth, (req, res) => {
  const id = req.params.id;
  if (!isValidChatId(id)) {
    return res.status(400).json({ error: { message: 'invalid chat id' } });
  }
  ensureChatDir(id);
  res.json({ chatId: id, notes: listNotes(id) });
});

app.get('/chats/:id/notes/:file', requiresAuth, (req, res) => {
  const { id, file } = req.params;
  if (!isValidChatId(id) || !isValidFilename(file)) {
    return res.status(400).json({ error: { message: 'invalid id or filename' } });
  }
  const content = readNote(id, file);
  if (content === null) return res.status(404).json({ error: { message: 'not found' } });
  res.json({ chatId: id, name: file, content });
});

app.put('/chats/:id/notes/:file', requiresAuth, (req, res) => {
  const { id, file } = req.params;
  const content = typeof req.body?.content === 'string' ? req.body.content : '';
  if (!isValidChatId(id) || !isValidFilename(file)) {
    return res.status(400).json({ error: { message: 'invalid id or filename' } });
  }
  if (content.length > 200_000) {
    return res.status(413).json({ error: { message: 'content too large (max 200 KB)' } });
  }
  const ok = writeNote(id, file, content);
  if (!ok) return res.status(500).json({ error: { message: 'write failed' } });
  res.json({ ok: true });
});

app.delete('/chats/:id/notes/:file', requiresAuth, (req, res) => {
  const { id, file } = req.params;
  if (!isValidChatId(id) || !isValidFilename(file)) {
    return res.status(400).json({ error: { message: 'invalid id or filename' } });
  }
  const ok = deleteNote(id, file);
  if (!ok) return res.status(400).json({ error: { message: 'cannot delete (system file or missing)' } });
  res.json({ ok: true });
});

app.post('/chats/:id/digest', requiresAuth, async (req, res) => {
  const id = req.params.id;
  if (!isValidChatId(id)) {
    return res.status(400).json({ error: { message: 'invalid chat id' } });
  }
  const { userMessage, assistantMessage } = req.body || {};
  await digestChat(id, userMessage, assistantMessage);
  res.json({ ok: true, notes: listNotes(id) });
});

/* ─────────────────────────────────────────────────────────────────────────────
   Automations — cron-scheduled tasks + persistent run history.
   ──────────────────────────────────────────────────────────────────────────── */

app.get('/automations/schedules', requiresAuth, (_req, res) => {
  res.json({ schedules: listSchedules() });
});

app.post('/automations/schedules', requiresAuth, (req, res) => {
  try {
    const s = createSchedule(req.body || {});
    res.status(201).json({ schedule: s });
  } catch (e) {
    res.status(400).json({ error: { message: e?.message || 'invalid input' } });
  }
});

app.put('/automations/schedules/:id', requiresAuth, (req, res) => {
  try {
    const s = updateSchedule(req.params.id, req.body || {});
    if (!s) return res.status(404).json({ error: { message: 'not found' } });
    res.json({ schedule: s });
  } catch (e) {
    res.status(400).json({ error: { message: e?.message || 'invalid input' } });
  }
});

app.delete('/automations/schedules/:id', requiresAuth, (req, res) => {
  const ok = deleteSchedule(req.params.id);
  if (!ok) return res.status(404).json({ error: { message: 'not found' } });
  res.json({ ok: true });
});

app.post('/automations/schedules/:id/fire', requiresAuth, async (req, res) => {
  const s = getSchedule(req.params.id);
  if (!s) return res.status(404).json({ error: { message: 'not found' } });
  // Fire async and return immediately; client polls /automations/runs for result
  fireSchedule(s.id, 'manual').catch((e) =>
    console.warn('[automations] manual fire failed:', e?.message || e),
  );
  res.json({ ok: true });
});

app.post('/automations/run', requiresAuth, async (req, res) => {
  try {
    const rec = await runAdhoc(req.body || {});
    res.json({ run: rec });
  } catch (e) {
    res.status(400).json({ error: { message: e?.message || 'invalid input' } });
  }
});

/* SSE runner — generic, used by /automations UI for Claude and Shell agents.
   Streams raw stdout/stderr line-by-line; emits 'done' with exit code.
   For Claude: tracks a resumable session per task — if body.sessionId is given,
   resumes that session (claude --resume <uuid>); otherwise mints a new UUID
   and creates a session record. */
const runningSessions = new Set();

// Async delegation registry (fire-and-poll): delegate {async:true} spawns the
// child detached and returns its id immediately; orchestrator polls
// /delegate/status + /delegate/result. Avoids the blocking-curl-in-Bash that
// got auto-backgrounded and timed out the whole orchestration.
const asyncDelegations = new Map();
const DELEGATE_RESULTS_DIR = process.env.DELEGATE_RESULTS_DIR || '/tmp/delegate-results';
try { fs.mkdirSync(DELEGATE_RESULTS_DIR, { recursive: true }); } catch { /* ignore */ }

// Per-worker memory sandbox (opt-in WORKER_SANDBOX=1): run claude inside its own
// systemd transient scope with a MemoryMax cap so a runaway worker (chromium) is
// OOM-killed in isolation, not the whole box. Named scope kpw-<id> so we can kill
// it explicitly (killing the systemd-run client alone does NOT stop the scope).
function sandboxSpawn(sessionId, claudeArgs) {
  const bin = process.env.CLAUDE_BIN || 'claude';
  if (process.env.WORKER_SANDBOX !== '1') return { bin, args: claudeArgs, scope: null };
  const mem = process.env.WORKER_MEM_MAX || '2500M';
  const swap = process.env.WORKER_MEM_SWAP || '3500M';
  const unit = `kpw-${String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return {
    bin: 'systemd-run',
    args: ['--scope', '--quiet', '--collect', '--unit', unit,
      '-p', `MemoryMax=${mem}`, '-p', `MemorySwapMax=${swap}`,
      '--', bin, ...claudeArgs],
    scope: unit + '.scope',
  };
}
function killScope(scope) {
  if (!scope) return;
  try { spawn('systemctl', ['kill', '--kill-whom=all', '--signal=SIGKILL', scope], { stdio: 'ignore' }); } catch { /* ignore */ }
}
app.post('/automations/run-stream', requiresAuth, (req, res) => {
  const agent = String(req.body?.agent || '').toLowerCase();
  let task = typeof req.body?.task === 'string' ? req.body.task : '';
  const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : null;
  const attachOnly = req.body?.attachOnly === true; // live-join: only attach to a running session, never spawn
  if (!['claude', 'shell'].includes(agent)) {
    return res.status(400).json({ error: { message: 'agent must be claude or shell' } });
  }
  if (!attachOnly && !task.trim()) {
    return res.status(400).json({ error: { message: 'task is required' } });
  }

  // Resolve session (claude only). If sessionId given → resume; else mint new.
  let session = null;
  if (agent === 'claude') {
    if (sessionId) {
      session = getAgentSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: { message: `unknown sessionId ${sessionId}` } });
      }
    } else {
      session = createAgentSession({ agent: 'claude', prompt: task });
    }
  }

  // ── Recovery boost: if this is a resume on a session whose сhildren
  // finished but the parent didn't aggregate yet (e.g. parent was SIGKILL'нут
  // mid-delegate), prepend their summaries to the task so Claude has context
  // without having to manually `curl /automations/sessions`.
  if (agent === 'claude' && session && (session.turns || 0) > 0) {
    try {
      const recovery = buildChildrenRecoveryBlock(session.id);
      if (recovery) {
        task = recovery + '\n' + task;
        console.log(`[recovery] prefixed children summary for session ${session.id} (+${recovery.length} chars)`);
      }
    } catch (e) {
      console.warn('[recovery] buildChildrenRecoveryBlock failed:', e?.message || e);
    }
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  let clientGone = false;
  const sse = (e) => { if (res.writableEnded || clientGone) return; try { res.write(`data: ${JSON.stringify(e)}\n\n`); } catch { /* client gone */ } };
  const startedAt = Date.now();

  if (agent === 'claude' && session && runningSessions.has(session.claudeSessionId)) {
    sse({ type: 'session', sessionId: session.id, claudeSessionId: session.claudeSessionId, turns: session.turns || 0 });
    sse({ type: 'meta', text: '\u21a9 ход не прерывался на сервере — переподключаюсь' });
    const projDir = path.join(process.env.HOME || '/root', '.claude', 'projects');
    const findT = () => { try { for (const sub of fs.readdirSync(projDir)) { const c = path.join(projDir, sub, session.claudeSessionId + '.jsonl'); if (fs.existsSync(c)) return c; } } catch (e) {} return null; };
    let emitted = 0;
    const tail = () => {
      const f = findT();
      if (f) {
        let raw = ''; try { raw = fs.readFileSync(f, 'utf8'); } catch (e) {}
        const objs = raw.split('\n').filter((x) => x.trim());
        for (let i = emitted; i < objs.length; i++) {
          let j; try { j = JSON.parse(objs[i]); } catch (e) { continue; }
          if (j.type === 'assistant' && j.message && Array.isArray(j.message.content)) {
            for (const b of j.message.content) {
              if (b && b.type === 'text' && b.text) sse({ type: 'stdout', data: b.text });
              else if (b && b.type === 'thinking' && b.thinking) sse({ type: 'step', kind: 'thinking', text: b.thinking });
            }
          }
        }
        emitted = objs.length;
      }
      if (!runningSessions.has(session.claudeSessionId)) {
        clearInterval(iv);
        sse({ type: 'done', code: 0, signal: null, killedByClient: false, killedByTimeout: false, ms: Date.now() - startedAt, at: Date.now() });
        if (!res.writableEnded) res.end();
      }
    };
    res.on('close', () => { clientGone = true; });
    const iv = setInterval(() => { if (clientGone) { clearInterval(iv); return; } tail(); }, 1500);
    tail();
    return;
  }

  // Live-join requested but the session is NOT currently running → don't spawn
  // a new turn; just tell the client it already finished.
  if (attachOnly) {
    if (session) sse({ type: 'session', sessionId: session.id, claudeSessionId: session.claudeSessionId, turns: session.turns || 0 });
    sse({ type: 'meta', text: '✓ сессия уже завершена — подключаться не к чему' });
    sse({ type: 'done', code: 0, signal: null, killedByClient: false, killedByTimeout: false, ms: Date.now() - startedAt, at: Date.now() });
    if (!res.writableEnded) res.end();
    return;
  }

  let child;
  try {
    if (agent === 'claude') {
      // stream-json + partial-messages = real-time events: text deltas,
      // tool_use starts, tool_results. We parse NDJSON line-by-line and
      // translate to our SSE shape (stdout / step / done).
      // Session is either fresh (--session-id <new uuid>) or resumed
      // (--resume <existing uuid>).
      const sessionFlag = (session.turns || 0) > 0
        ? ['--resume', session.claudeSessionId]
        : ['--session-id', session.claudeSessionId];
      child = spawn(
        process.env.CLAUDE_BIN || 'claude',
        [
          '-p', task,
          ...sessionFlag,
          '--append-system-prompt', PUBLISH_HINT,
          '--output-format', 'stream-json',
          '--include-partial-messages',
          '--verbose',
          '--dangerously-skip-permissions',
          '--disallowedTools', 'AskUserQuestion',
        ],
        {
          cwd: process.env.CLAUDE_CWD || '/root',
          env: {
            ...process.env,
            IS_SANDBOX: '1',
            // Expose session ids so Claude can self-orchestrate (queue-next)
            KP_SESSION_ID: session.id,
            KP_CLAUDE_SESSION_ID: session.claudeSessionId,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      // Tell the client which session this is (so UI can show it immediately).
      sse({ type: 'session', sessionId: session.id, claudeSessionId: session.claudeSessionId, turns: session.turns || 0 });
      runningSessions.add(session.claudeSessionId);
    } else {
      child = spawn('/bin/bash', ['-c', task], {
        cwd: process.env.HOME || '/tmp',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    }
  } catch (e) {
    sse({ type: 'error', message: `spawn failed: ${e?.message || e}` });
    sse({ type: 'done', code: 127, signal: null, killedByClient: false, killedByTimeout: false, at: Date.now() });
    return res.end();
  }

  let killedByClient = false;
  let killedByTimeout = false;

  const TIMEOUT = Number(process.env.AUTOMATION_TIMEOUT_MS || 600_000);
  const timer = setTimeout(() => {
    killedByTimeout = true;
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
    setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, 5_000).unref();
  }, TIMEOUT);
  timer.unref();

  // `res.on('close')` fires only when the HTTP response is torn down.
  // `writableEnded` is true after we call res.end() ourselves, so we use it
  // to tell "client disconnected" from "we finished normally".
  // (Using req.on('close') here would fire as soon as the request body is
  // fully read, which on Node 18+/Express 5 is immediate for our POST.)
  res.on('close', () => {
    // Клиент отвалился (напр. перезагрузка страницы) до завершения. НЕ убиваем
    // child — пусть доработает в фоне, чтобы работа не потерялась; stdout
    // продолжаем парсить и в child.on('close') сохраняем транскрипт/summary.
    // TIMEOUT ниже остаётся жёсткой страховкой. На реконнекте UI подтянет
    // уже готовую историю вместо резюма прерванного хода.
    if (!res.writableEnded && child.exitCode == null) {
      clientGone = true;
    }
  });

  // Accumulate assistant text (Claude only) so we can save a summary at the end.
  let assistantBuf = '';
  // Captured from the claude 'result' event so we can persist cost/tokens.
  let lastUsage = null;
  if (agent === 'claude') {
    // Claude emits NDJSON events on stdout. Parse line-by-line and translate.
    let buf = '';
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let idx;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        // Tap into stdout text-deltas to build a summary for the session record.
        if (ev?.type === 'stream_event' && ev.event?.type === 'content_block_delta'
            && ev.event.delta?.type === 'text_delta'
            && typeof ev.event.delta.text === 'string') {
          assistantBuf += ev.event.delta.text;
        }
        if (ev?.type === 'result') {
          const u = ev.usage || {};
          lastUsage = {
            costUsd: typeof ev.total_cost_usd === 'number' ? ev.total_cost_usd : 0,
            tokensIn: (Number(u.input_tokens) || 0) + (Number(u.cache_read_input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0),
            tokensOut: Number(u.output_tokens) || 0,
          };
        }
        handleClaudeEvent(ev, sse);
      }
    });
  } else {
    child.stdout.on('data', (b) => sse({ type: 'stdout', data: b.toString('utf8') }));
  }
  child.stderr.on('data', (b) => sse({ type: 'stderr', data: b.toString('utf8') }));
  child.on('close', (code, sig) => {
    clearTimeout(timer);
    if (session) runningSessions.delete(session.claudeSessionId);
    sse({
      type: 'done',
      code, signal: sig,
      killedByClient, killedByTimeout,
      ms: Date.now() - startedAt,
      at: Date.now(),
    });
    res.end();
    // Persist session usage (best-effort; never blocks response).
    // Only count a turn if the run actually did something: a clean exit, an
    // intentional kill (timeout/client — transcript exists), or any assistant
    // output. A non-zero exit with zero output is a startup crash that never
    // wrote a transcript; bumping `turns` there leaves a phantom session whose
    // /history returns {lines:[]} and looks broken in the UI.
    const didWork = code === 0 || killedByTimeout || killedByClient || assistantBuf.trim().length > 0;
    if (session && didWork) {
      try { touchAgentSession(session.id, { prompt: task, summary: assistantBuf, clean: code === 0 && !killedByTimeout && !killedByClient, usage: lastUsage }); } catch { /* ignore */ }
    } else if (session) {
      console.warn(`[session] skip turn bump for ${session.id} — startup crash (code=${code}, no output)`);
    }
  });
});

/* ── Agent sessions API ────────────────────────────────────────────────── */

app.get('/automations/telegram', requiresAuth, (req, res) => {
  let st = {};
  try { st = getTelegramState() || {}; } catch { st = {}; }
  const names = { agent: 'Агент (TG)', zavod: 'Завод 2 УИ (TG)', apka: 'Апка (TG)' };
  const threads = Object.keys(names).map((key) => {
    const sid = st.threads && st.threads[key];
    const sess = sid ? getAgentSession(sid) : null;
    return {
      key, name: names[key], active: st.active === key, sessionId: sid || null,
      turns: sess ? sess.turns : 0,
      lastSummary: sess ? sess.lastSummary : '',
      lastUsedAt: sess ? sess.lastUsedAt : null,
      running: sess ? runningSessions.has(sess.claudeSessionId) : false,
    };
  });
  res.json({ linked: !!st.ownerId, botUsername: process.env.TELEGRAM_BOT_USERNAME || 'your_bot', active: st.active || 'agent', threads });
});

app.get('/automations/sessions', requiresAuth, (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  res.json({ sessions: listAgentSessions(limit).map((x) => ({ ...x, running: runningSessions.has(x.claudeSessionId) })) });
});

// GET single session by id — convenient for agents that want to verify their
// own KP_SESSION_ID exists before delegating.
app.get('/automations/sessions/:id', requiresAuth, (req, res) => {
  const s = getAgentSession(req.params.id);
  if (!s) return res.status(404).json({ error: { message: 'session not found' } });
  res.json({ session: s });
});

// External event trigger: any webhook / cron / Telegram bot can POST here to
// kick off a fresh agent session and get back its id + a public replay link.
app.post('/automations/trigger', requiresAuth, (req, res) => {
  const task = String(req.body?.task || '').trim();
  const name = String(req.body?.name || '').trim();
  if (!task) return res.status(400).json({ error: { message: 'task is required' } });

  const child = createAgentSession({ agent: 'claude', prompt: task, name: name || undefined, parentSessionId: null });
  const startedAt = Date.now();
  asyncDelegations.set(child.id, { status: 'running', startedAt, name: child.name, parentSessionId: null, claudeSessionId: child.claudeSessionId });
  runningSessions.add(child.claudeSessionId);
  let outBuf = '';
  const tSb = sandboxSpawn(child.id, ['-p', task, '--session-id', child.claudeSessionId, '--append-system-prompt', PUBLISH_HINT,
     '--output-format', 'text', '--dangerously-skip-permissions', '--disallowedTools', 'AskUserQuestion']);
  const proc = spawn(
    tSb.bin,
    tSb.args,
    { cwd: process.env.CLAUDE_CWD || '/root',
      env: { ...process.env, IS_SANDBOX: '1', KP_SESSION_ID: child.id, KP_CLAUDE_SESSION_ID: child.claudeSessionId, KP_PARENT_SESSION_ID: '', KP_DEPTH: '0' },
      stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const tmo = Number(process.env.AUTOMATION_TIMEOUT_MS || 1800000);
  const tm = setTimeout(() => { try { proc.kill('SIGTERM'); } catch {} killScope(tSb.scope); setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} killScope(tSb.scope); }, 5000).unref(); }, tmo);
  tm.unref();
  proc.stdout.on('data', (b) => { outBuf += b.toString('utf8'); });
  proc.on('close', (code) => {
    clearTimeout(tm);
    try { fs.writeFileSync(path.join(DELEGATE_RESULTS_DIR, child.id + '.txt'), outBuf); } catch {}
    asyncDelegations.set(child.id, { status: 'done', exitCode: code, durationMs: Date.now() - startedAt, name: child.name, parentSessionId: null, claudeSessionId: child.claudeSessionId });
    runningSessions.delete(child.claudeSessionId);
    try { touchAgentSession(child.id, { prompt: task, summary: outBuf, clean: code === 0 }); } catch {}
    console.log(`[trigger] session ${child.id} done code=${code}`);
  });
  const base = process.env.PUBLIC_BASE_URL || '';
  console.log(`[trigger] spawned session=${child.id} pid=${proc.pid}`);
  res.json({ sessionId: child.id, status: 'running',
    shareUrl: `${base}/share/${child.id}`,
    statusUrl: `/automations/delegate/result/${child.id}` });
});

app.post('/automations/sessions/:id/feedback', requiresAuth, (req, res) => {
  const s = getAgentSession(req.params.id);
  if (!s) return res.status(404).json({ error: { message: 'session not found' } });
  const updated = setSessionFeedback(req.params.id, {
    rating: req.body?.rating,
    kind: req.body?.kind,
    note: req.body?.note,
  });
  res.json({ session: updated });
});

// LLM-as-judge: run `claude -p` directly as an evaluator over a session's output.
app.post('/automations/sessions/:id/judge', requiresAuth, (req, res) => {
  const s = getAgentSession(req.params.id);
  if (!s) return res.status(404).json({ error: { message: 'session not found' } });
  let answer = String(s.lastSummary || '').trim();
  if (!answer) {
    try { const fp = path.join(DELEGATE_RESULTS_DIR, s.id + '.txt'); if (fs.existsSync(fp)) answer = fs.readFileSync(fp, 'utf8').trim(); } catch { /* ignore */ }
  }
  if (!answer) return res.status(400).json({ error: { message: 'no output to judge yet' } });

  const judgePrompt = [
    'Ты — строгий и честный оценщик результата AI-агента. Ниже ЗАПРОС пользователя и ОТВЕТ агента.',
    'Оцени ОТВЕТ: полнота, точность, выполняет ли запрос, нет ли выдумок/галлюцинаций.',
    'Верни ТОЛЬКО один JSON-объект, без markdown и любых пояснений вокруг:',
    '{"score": <число 0-10>, "verdict": "good|partial|broken|hallucination", "reason": "<1-2 фразы по-русски>"}',
    '',
    '=== ЗАПРОС ===',
    String(s.lastPrompt || '').slice(0, 4000),
    '',
    '=== ОТВЕТ АГЕНТА ===',
    answer.slice(0, 12000),
  ].join(String.fromCharCode(10));

  const sb = sandboxSpawn('judge-' + s.id, ['-p', judgePrompt, '--output-format', 'text', '--dangerously-skip-permissions', '--disallowedTools', 'AskUserQuestion']);
  let out = '';
  let done = false;
  const proc = spawn(sb.bin, sb.args, {
    cwd: process.env.CLAUDE_CWD || '/root',
    env: { ...process.env, IS_SANDBOX: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const tm = setTimeout(() => { try { proc.kill('SIGTERM'); } catch {} killScope(sb.scope); }, 180_000);
  tm.unref();
  proc.stdout.on('data', (b) => { out += b.toString('utf8'); });
  proc.on('close', () => {
    if (done) return; done = true;
    clearTimeout(tm);
    let parsed = null;
    const m = out.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch { /* not json */ } }
    if (!parsed) return res.status(502).json({ error: { message: 'judge returned no parseable JSON', raw: out.slice(0, 400) } });
    const updated = setSessionJudge(s.id, { score: Number(parsed.score), verdict: parsed.verdict, reason: parsed.reason });
    console.log(`[judge] ${s.id} -> score=${parsed.score} verdict=${parsed.verdict}`);
    res.json({ session: updated, judge: updated && updated.judge });
  });
  proc.on('error', (e) => { if (done) return; done = true; clearTimeout(tm); res.status(500).json({ error: { message: 'judge spawn failed: ' + (e?.message || e) } }); });
});

app.put('/automations/sessions/:id', requiresAuth, (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name : '';
  if (!name.trim()) {
    return res.status(400).json({ error: { message: 'name is required' } });
  }
  const s = renameAgentSession(req.params.id, name);
  if (!s) return res.status(404).json({ error: { message: 'not found' } });
  res.json({ session: s });
});

app.delete('/automations/sessions/:id', requiresAuth, (req, res) => {
  const ok = deleteAgentSession(req.params.id);
  if (!ok) return res.status(404).json({ error: { message: 'not found' } });
  res.json({ ok: true });
});

/**
 * Self-orchestration: Claude can queue a follow-up prompt that fires after
 * the proxy restarts. Workflow:
 *   1. Claude curls this endpoint BEFORE triggering restart
 *   2. Triggers systemctl restart (which kills it)
 *   3. Proxy comes back, picks up pending-followups.jsonl
 *   4. Spawns detached `claude --resume <uuid>` with the queued prompt
 *   5. Claude continues in the same session, autonomously
 */
const FOLLOWUPS_FILE = path.join(
  process.env.AUTOMATIONS_DIR || '/opt/kimi-mcp-proxy',
  'pending-followups.jsonl',
);

/**
 * Delegate a sub-task to a NEW child Claude session.
 *
 * Synchronous: blocks until child finishes (up to 10 min), returns its
 * stdout. Parent agent uses this as a function call.
 *
 *   body: { parentSessionId, task, name? }
 *   resp: { childSessionId, claudeSessionId, stdout, exitCode, durationMs }
 *
 * Hierarchy: each session tracks parentSessionId + depth. Max depth 5
 * (root + 4 generations of children) to bound runaway recursion.
 */
app.post('/automations/delegate', requiresAuth, async (req, res) => {
  const parentSessionId = String(req.body?.parentSessionId || '').trim() || null;
  const task = String(req.body?.task || '').trim();
  const name = String(req.body?.name || '').trim();
  if (!task) return res.status(400).json({ error: { message: 'task is required' } });

  let depth = 0;
  if (parentSessionId) {
    // Retry up to 3× over ~600ms in case a concurrent /run-stream just
    // created the session but it hasn't fully landed in the cached
    // sessions[] yet (rare race during heavy parallel use).
    let parent = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      parent = getAgentSession(parentSessionId);
      if (parent) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!parent) {
      const available = listAgentSessions(5).map((s) => s.id);
      return res.status(404).json({
        error: {
          message: `parentSessionId "${parentSessionId}" not found in sessions store`,
          hint: 'use GET /automations/sessions to list available ids',
          recentSessionIds: available,
        },
      });
    }
    depth = (parent.depth || 0) + 1;
    if (depth > MAX_DELEGATION_DEPTH) {
      return res.status(400).json({
        error: { message: `delegation depth exceeded (max ${MAX_DELEGATION_DEPTH})` },
      });
    }
  }

  // Mint a child session
  const child = createAgentSession({
    agent: 'claude',
    prompt: task,
    name: name || undefined,
    parentSessionId,
  });

  console.log(`[delegate] depth=${depth} parent=${parentSessionId || '-'} child=${child.id}`);

  // Async mode: spawn detached, return childSessionId immediately.
  const isAsync = req.body?.async === true || req.body?.async === 'true' || req.body?.async === 1;
  if (isAsync) {
    const aStartedAt = Date.now();
    asyncDelegations.set(child.id, {
      status: 'running', startedAt: aStartedAt, name: child.name,
      parentSessionId, claudeSessionId: child.claudeSessionId,
    });
    runningSessions.add(child.claudeSessionId);
    let aStdout = '';
    let aStderr = '';
    const aSb = sandboxSpawn(child.id, [
      '-p', task,
      '--session-id', child.claudeSessionId,
      '--append-system-prompt', PUBLISH_HINT,
      '--output-format', 'text',
      '--dangerously-skip-permissions',
      '--disallowedTools', 'AskUserQuestion',
    ]);
    const aProc = spawn(
      aSb.bin,
      aSb.args,
      {
        cwd: process.env.CLAUDE_CWD || '/root',
        env: {
          ...process.env,
          IS_SANDBOX: '1',
          KP_SESSION_ID: child.id,
          KP_CLAUDE_SESSION_ID: child.claudeSessionId,
          KP_PARENT_SESSION_ID: parentSessionId || '',
          KP_DEPTH: String(depth),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const aTimeout = Number(process.env.DELEGATE_TIMEOUT_MS || 15 * 60_000);
    const aTimer = setTimeout(() => {
      try { aProc.kill('SIGTERM'); } catch { /* ignore */ }
      killScope(aSb.scope);
      setTimeout(() => { try { aProc.kill('SIGKILL'); } catch { /* ignore */ } killScope(aSb.scope); }, 5_000).unref();
    }, aTimeout);
    aTimer.unref();
    aProc.stdout.on('data', (b) => { aStdout += b.toString('utf8'); });
    aProc.stderr.on('data', (b) => { aStderr += b.toString('utf8'); });
    aProc.on('close', (code) => {
      clearTimeout(aTimer);
      const durationMs = Date.now() - aStartedAt;
      try { fs.writeFileSync(path.join(DELEGATE_RESULTS_DIR, child.id + '.txt'), aStdout); } catch { /* ignore */ }
      asyncDelegations.set(child.id, {
        status: 'done', exitCode: code, durationMs, name: child.name,
        parentSessionId, claudeSessionId: child.claudeSessionId,
      });
      runningSessions.delete(child.claudeSessionId);
      try { touchAgentSession(child.id, { prompt: task, summary: aStdout }); } catch { /* ignore */ }
      console.log(`[delegate-async] child ${child.id} done code=${code} ${durationMs}ms`);
    });
    console.log(`[delegate-async] spawned child=${child.id} pid=${aProc.pid}`);
    return res.json({
      childSessionId: child.id,
      claudeSessionId: child.claudeSessionId,
      parentSessionId, depth, name: child.name,
      status: 'running',
      poll: `/automations/delegate/result/${child.id}`,
    });
  }

  // Spawn synchronously and capture all stdout
  const startedAt = Date.now();
  const result = await new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let exitCode = null;
    let killed = false;

    const dSb = sandboxSpawn(child.id, [
      '-p', task,
      '--session-id', child.claudeSessionId,
      '--append-system-prompt', PUBLISH_HINT,
      '--output-format', 'text',
      '--dangerously-skip-permissions',
      '--disallowedTools', 'AskUserQuestion',
    ]);
    const proc = spawn(
      dSb.bin,
      dSb.args,
      {
        cwd: process.env.CLAUDE_CWD || '/root',
        env: {
          ...process.env,
          IS_SANDBOX: '1',
          KP_SESSION_ID: child.id,
          KP_CLAUDE_SESSION_ID: child.claudeSessionId,
          KP_PARENT_SESSION_ID: parentSessionId || '',
          KP_DEPTH: String(depth),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    const TIMEOUT = Number(process.env.DELEGATE_TIMEOUT_MS || 15 * 60_000);
    const timer = setTimeout(() => {
      killed = true;
      try { proc.kill('SIGTERM'); } catch { /* ignore */ }
      killScope(dSb.scope);
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* ignore */ } killScope(dSb.scope); }, 5_000).unref();
    }, TIMEOUT);
    timer.unref();

    proc.stdout.on('data', (b) => { stdout += b.toString('utf8'); });
    proc.stderr.on('data', (b) => { stderr += b.toString('utf8'); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      exitCode = code;
      resolve({ stdout, stderr, exitCode, killed });
    });
  });

  const durationMs = Date.now() - startedAt;

  // Touch session so it shows up in UI with the summary
  try {
    touchAgentSession(child.id, { prompt: task, summary: result.stdout });
  } catch { /* ignore */ }

  res.json({
    childSessionId: child.id,
    claudeSessionId: child.claudeSessionId,
    parentSessionId: parentSessionId,
    depth,
    name: child.name,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    killed: result.killed,
    durationMs,
  });
});

app.get('/automations/delegate/status', requiresAuth, (req, res) => {
  const ids = String(req.query?.ids || '').split(',').map((x) => x.trim()).filter(Boolean);
  const all = ids.map((id) => {
    const d = asyncDelegations.get(id);
    if (!d) return { childSessionId: id, status: 'unknown' };
    return { childSessionId: id, status: d.status, exitCode: d.exitCode ?? null, durationMs: d.durationMs ?? null, name: d.name };
  });
  const allDone = all.length > 0 && all.every((o) => o.status === 'done');
  res.json({ all, allDone, total: all.length, done: all.filter((o) => o.status === 'done').length });
});

app.get('/automations/delegate/result/:id', requiresAuth, (req, res) => {
  const id = req.params.id;
  const d = asyncDelegations.get(id);
  const fp = path.join(DELEGATE_RESULTS_DIR, id + '.txt');
  if (!d) {
    if (fs.existsSync(fp)) {
      let stdout = '';
      try { stdout = fs.readFileSync(fp, 'utf8'); } catch { /* ignore */ }
      return res.json({ childSessionId: id, status: 'done', stdout, note: 'from-disk' });
    }
    return res.status(404).json({ error: { message: 'no such delegation (unknown id or lost on proxy restart)' } });
  }
  if (d.status === 'running') {
    return res.json({ childSessionId: id, status: 'running', startedMsAgo: Date.now() - d.startedAt, name: d.name });
  }
  let stdout = '';
  try { stdout = fs.readFileSync(fp, 'utf8'); } catch { /* ignore */ }
  return res.json({ childSessionId: id, status: 'done', exitCode: d.exitCode, durationMs: d.durationMs, name: d.name, stdout });
});

app.post('/automations/sessions/:id/queue-next', requiresAuth, (req, res) => {
  const s = getAgentSession(req.params.id);
  if (!s) return res.status(404).json({ error: { message: 'session not found' } });
  const prompt = String(req.body?.prompt || '').slice(0, 8000);
  const reason = String(req.body?.reason || '').slice(0, 200);
  if (!prompt.trim()) {
    return res.status(400).json({ error: { message: 'prompt is required' } });
  }
  const entry = {
    sessionId: s.id,
    claudeSessionId: s.claudeSessionId,
    prompt, reason,
    queuedAt: Date.now(),
  };
  try {
    fs.appendFileSync(FOLLOWUPS_FILE, JSON.stringify(entry) + '\n');
    console.log(`[orchestration] queued follow-up for ${s.id}: ${prompt.slice(0, 80)}…`);
    res.json({ ok: true, message: 'queued — fires after next proxy restart' });
  } catch (e) {
    res.status(500).json({ error: { message: 'queue write failed: ' + (e?.message || e) } });
  }
});

/**
 * On proxy startup (after a grace period to let the network settle),
 * drain pending follow-ups: for each, spawn a detached `claude --resume`
 * that completes the queued prompt asynchronously. The transcript is
 * written by Claude itself to ~/.claude/projects/-root/<uuid>.jsonl —
 * the UI's auto-reconnect pulls it via session history.
 */
function drainPendingFollowups() {
  if (!fs.existsSync(FOLLOWUPS_FILE)) return;
  let raw;
  try {
    raw = fs.readFileSync(FOLLOWUPS_FILE, 'utf8');
  } catch (e) {
    console.warn('[orchestration] read failed:', e?.message || e);
    return;
  }
  // Delete BEFORE spawning so a crash in any follow-up doesn't infinite-loop
  try { fs.unlinkSync(FOLLOWUPS_FILE); } catch { /* ignore */ }

  const entries = raw.split('\n')
    .filter(Boolean)
    .map((ln) => { try { return JSON.parse(ln); } catch { return null; } })
    .filter((e) => e && e.claudeSessionId && e.prompt);

  if (entries.length === 0) return;
  console.log(`[orchestration] firing ${entries.length} pending follow-up(s)`);

  for (const e of entries) {
    try {
      const child = spawn(
        process.env.CLAUDE_BIN || 'claude',
        [
          '-p', e.prompt,
          '--resume', e.claudeSessionId,
          '--append-system-prompt', PUBLISH_HINT,
          '--output-format', 'text',
          '--dangerously-skip-permissions',
          '--disallowedTools', 'AskUserQuestion',
        ],
        {
          cwd: process.env.CLAUDE_CWD || '/root',
          env: {
            ...process.env,
            IS_SANDBOX: '1',
            KP_SESSION_ID: e.sessionId,
            KP_CLAUDE_SESSION_ID: e.claudeSessionId,
          },
          stdio: ['ignore', 'ignore', 'ignore'],
          detached: true,
        },
      );
      child.unref();
      console.log(`[orchestration] spawned follow-up for ${e.sessionId} (pid=${child.pid})`);
    } catch (err) {
      console.warn(`[orchestration] spawn failed for ${e.sessionId}:`, err?.message || err);
    }
  }
}

/**
 * Replay a Claude session's stored transcript as the same AutomationLine
 * events the live SSE stream emits — used by the UI to pre-fill the
 * terminal when the user clicks "↪ продолжить" on a session card.
 */
app.get('/automations/sessions/:id/history', requiresAuth, async (req, res) => {
  const s = getAgentSession(req.params.id);
  if (!s) return res.status(404).json({ error: { message: 'session not found' } });

  // Claude stores transcripts at ~/.claude/projects/<encoded-cwd>/<uuid>.jsonl
  // We don't know the cwd-subdir up front, so scan.
  const home = process.env.HOME || '/root';
  const projectsDir = path.join(home, '.claude', 'projects');
  let file = null;
  try {
    for (const sub of fs.readdirSync(projectsDir)) {
      const cand = path.join(projectsDir, sub, s.claudeSessionId + '.jsonl');
      if (fs.existsSync(cand)) { file = cand; break; }
    }
  } catch { /* projects dir missing */ }

  if (!file) {
    return res.json({ session: s, lines: [], note: 'transcript file not found', running: runningSessions.has(s.claudeSessionId) });
  }

  const lines = [];
  // Header so the UI shows context
  lines.push({ kind: 'meta', text: `↪ resume · ${s.claudeSessionId} · ${s.turns} turn(s)` });

  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (e) {
    return res.status(500).json({ error: { message: 'read failed: ' + (e?.message || e) } });
  }

  for (const ln of raw.split('\n')) {
    if (!ln.trim()) continue;
    let j;
    try { j = JSON.parse(ln); } catch { continue; }

    if (j.type === 'user' && j.message?.role === 'user') {
      const content = j.message.content;
      if (typeof content === 'string') {
        lines.push({ kind: 'prompt', text: content });
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === 'tool_result') {
            let text = '';
            const images = [];
            if (typeof block.content === 'string') {
              text = block.content;
            } else if (Array.isArray(block.content)) {
              for (const c of block.content) {
                if (c?.type === 'text' && typeof c.text === 'string') {
                  text += (text ? '\n' : '') + c.text;
                } else if (c?.type === 'tool_reference' && c.tool_name) {
                  text += (text ? '\n' : '') + `[${c.tool_name}]`;
                } else if (c?.type === 'image') {
                  const saved = saveBase64ImageBlock(c);
                  if (saved) images.push(saved);
                }
              }
            }
            if (text || images.length === 0) {
              lines.push({ kind: 'step', meta: 'result', text: text.slice(0, 8000) });
            }
            for (const img of images) {
              lines.push({ kind: 'artifact', path: img.path, name: img.name, mime: img.mime, size: img.size });
            }
          }
        }
      }
    } else if (j.type === 'assistant' && j.message?.content) {
      for (const block of j.message.content) {
        if (block?.type === 'text' && typeof block.text === 'string' && block.text) {
          lines.push({ kind: 'stdout', text: block.text });
        } else if (block?.type === 'thinking' && typeof block.thinking === 'string' && block.thinking) {
          lines.push({ kind: 'step', meta: 'thinking', text: block.thinking });
        } else if (block?.type === 'tool_use') {
          let args = '';
          try {
            args = typeof block.input === 'string' ? block.input : JSON.stringify(block.input || {});
          } catch { args = ''; }
          lines.push({
            kind: 'step', meta: 'tool',
            // 32000 chars to keep large tool args intact (e.g. AskUserQuestion
            // payload with 4 questions × multi-line descriptions ≈ 3KB+).
            text: `${block.name || 'tool'}(${args.slice(0, 32000)})`,
          });
        }
      }
    }
  }

  res.json({ session: s, lines, running: runningSessions.has(s.claudeSessionId) });
});

/**
 * Save a base64-encoded image block (as returned by MCP playwright's
 * browser_take_screenshot, etc.) to /tmp/claude-screenshots so it can be
 * served via /agent/file and rendered as an artifact in the UI. The file
 * name is content-addressed (sha1) — repeat screenshots dedupe.
 *
 * Returns {path, name, mime, size} on success, null otherwise.
 */
const SHOT_DIR = process.env.CLAUDE_SCREENSHOTS_DIR || '/tmp/claude-screenshots';
try { fs.mkdirSync(SHOT_DIR, { recursive: true }); } catch { /* ignore */ }

function saveBase64ImageBlock(block) {
  if (!block || block.type !== 'image') return null;
  const src = block.source;
  if (!src || src.type !== 'base64' || typeof src.data !== 'string' || !src.data) return null;
  const mime = String(src.media_type || 'image/png');
  const ext = mime.includes('jpeg') ? 'jpg'
    : mime.includes('webp') ? 'webp'
    : mime.includes('gif')  ? 'gif'
    : 'png';
  try {
    const buf = Buffer.from(src.data, 'base64');
    if (!buf || buf.length < 100) return null;
    const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12);
    const file = path.join(SHOT_DIR, `${hash}.${ext}`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
    return { path: file, name: `screenshot-${hash}.${ext}`, mime, size: buf.length };
  } catch (e) {
    console.warn('[claude] failed to save screenshot:', e?.message || e);
    return null;
  }
}

/**
 * Translate a single Claude Code stream-json event to one (or zero) SSE
 * events on our wire. Designed to match the shape the UI already handles
 * for Hermes (step kinds: thinking/tool_call/tool_result, stdout text).
 */
function handleClaudeEvent(ev, sse) {
  if (!ev || typeof ev !== 'object') return;

  // Partial / streaming events (with --include-partial-messages)
  if (ev.type === 'stream_event' && ev.event && typeof ev.event === 'object') {
    const e = ev.event;
    if (e.type === 'content_block_delta' && e.delta && typeof e.delta === 'object') {
      if (e.delta.type === 'text_delta' && typeof e.delta.text === 'string' && e.delta.text.length > 0) {
        sse({ type: 'stdout', data: e.delta.text });
        return;
      }
      if (e.delta.type === 'thinking_delta' && typeof e.delta.thinking === 'string' && e.delta.thinking.length > 0) {
        sse({ type: 'step', kind: 'thinking', text: e.delta.thinking });
        return;
      }
      // input_json_delta = tool args streaming in piecemeal — skip; the
      // finalized tool_call with full args comes via the assistant message.
      // content_block_stop also signals end; either way we let assistant emit it.
    }
    // Skip content_block_start (would create dup tool_call with empty args)
    // and content_block_stop / message_* events — assistant message handles them.
    return;
  }

  // Full (non-partial) assistant message — emit tool_calls with COMPLETE args
  // (text content is already streamed via text_delta above, so skip it here).
  if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
    for (const block of ev.message.content) {
      if (block?.type === 'tool_use') {
        let args = '';
        try {
          args = typeof block.input === 'string' ? block.input : JSON.stringify(block.input || {});
        } catch { args = ''; }
        sse({
          type: 'step', kind: 'tool_call',
          name: String(block.name || 'tool'),
          args: args.slice(0, 32000),
          toolCallId: block.id || null,
        });
      }
    }
    return;
  }

  // Tool results come back as user-role messages
  if (ev.type === 'user' && ev.message && Array.isArray(ev.message.content)) {
    for (const block of ev.message.content) {
      if (block?.type === 'tool_result') {
        let text = '';
        const images = [];
        if (typeof block.content === 'string') {
          text = block.content;
        } else if (Array.isArray(block.content)) {
          for (const c of block.content) {
            if (c?.type === 'text' && typeof c.text === 'string') {
              text += (text ? '\n' : '') + c.text;
            } else if (c?.type === 'image') {
              const saved = saveBase64ImageBlock(c);
              if (saved) images.push(saved);
            }
          }
        } else if (block.content) {
          try { text = JSON.stringify(block.content); } catch { text = ''; }
        }
        // Emit the textual tool_result first (may be empty for screenshot-only)
        if (text || images.length === 0) {
          sse({
            type: 'step', kind: 'tool_result',
            toolCallId: block.tool_use_id || null,
            text: text.slice(0, 8000),
          });
        }
        // Then emit each saved screenshot as an artifact (UI will render the
        // image inline + open it in the existing lightbox on click).
        for (const img of images) {
          sse({ type: 'artifact', kind: 'image', ...img });
        }
      }
    }
    return;
  }

  if (ev.type === 'system' && ev.subtype === 'init') {
    sse({ type: 'step', kind: 'note', text: `claude session · model=${ev.model || '?'} · tools=${(ev.tools || []).length}` });
    return;
  }

  if (ev.type === 'result') {
    // Final summary — emit a note with cost/duration so it shows up in the trace
    const parts = [];
    if (ev.subtype) parts.push(`subtype=${ev.subtype}`);
    if (typeof ev.duration_ms === 'number') parts.push(`${(ev.duration_ms / 1000).toFixed(1)}s`);
    if (typeof ev.total_cost_usd === 'number') parts.push(`$${ev.total_cost_usd.toFixed(4)}`);
    if (typeof ev.num_turns === 'number') parts.push(`${ev.num_turns} turns`);
    if (parts.length) sse({ type: 'step', kind: 'note', text: 'claude result · ' + parts.join(' · ') });
    return;
  }
}

app.get('/automations/runs', requiresAuth, (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const scheduleId = typeof req.query.scheduleId === 'string' ? req.query.scheduleId : null;
  res.json({ runs: listRuns(limit, scheduleId) });
});

/* ─────────────────────────────────────────────────────────────────────────────
   MCP manager — install + connect to MCP servers, surface their tool lists.
   ──────────────────────────────────────────────────────────────────────────── */

app.get('/automations/mcps', requiresAuth, (_req, res) => {
  res.json({ mcps: listMcps() });
});

app.get('/automations/mcps/catalog', requiresAuth, (_req, res) => {
  res.json({ catalog: getCatalog() });
});

app.post('/automations/mcps', requiresAuth, async (req, res) => {
  try {
    const m = await addMcp(req.body || {});
    res.status(201).json({ mcp: m });
  } catch (e) {
    res.status(400).json({ error: { message: e?.message || 'invalid input' } });
  }
});

app.put('/automations/mcps/:id', requiresAuth, (req, res) => {
  try {
    const m = updateMcp(req.params.id, req.body || {});
    if (!m) return res.status(404).json({ error: { message: 'not found' } });
    res.json({ mcp: m });
  } catch (e) {
    res.status(400).json({ error: { message: e?.message || 'invalid input' } });
  }
});

app.delete('/automations/mcps/:id', requiresAuth, async (req, res) => {
  const ok = await deleteMcp(req.params.id);
  if (!ok) return res.status(404).json({ error: { message: 'not found' } });
  res.json({ ok: true });
});

app.post('/automations/mcps/:id/restart', requiresAuth, async (req, res) => {
  const m = await restartMcp(req.params.id);
  if (!m) return res.status(404).json({ error: { message: 'not found' } });
  res.json({ ok: true });
});

/* ─────────────────────────────────────────────────────────────────────────────
   Smart router — decides whether a prompt needs Hermes (shell/files/VPS work)
   or can be answered directly by Kimi (pure Q&A, code analysis, etc).
   Used by /auto/run. Heuristic, not LLM-based, so it adds 0ms overhead.
   ──────────────────────────────────────────────────────────────────────────── */

// Strong signals that the user wants real shell/file/agent work on the VPS.
const NEEDS_HERMES_RE = new RegExp(
  [
    // Russian — actions
    'запусти', 'выполни', 'установи', 'поставь', 'скачай', 'загрузи', 'сохрани файл',
    'создай файл', 'создать файл', 'напиши файл', 'запиши в файл', 'измени файл',
    'отредактируй', 'удали файл', 'найди файл', 'прочитай файл', 'покажи содержимое',
    'сделай скриншот', 'скрин\\s+(сайт|страниц)', 'открой\\s+http', 'зайди\\s+на',
    'спарси', 'парсинг', 'найди\\s+в\\s+интернете', 'поищи\\s+в\\s+(вебе|сети|интернете)',
    'на\\s+сервере', 'в\\s+терминале', 'на\\s+vps', 'на\\s+впс', 'через\\s+ssh',
    // Russian — agent triggers (caught by subagent-bypass too, but list for clarity)
    'саб[-\\s]?агент', 'субагент', '\\d+\\s*агент',
    // English — actions
    'execute', 'install\\s', 'download', 'screenshot\\s+(of|the)', 'fetch\\s+the',
    'scrape', 'crawl', 'create\\s+file', 'write\\s+file', 'edit\\s+file',
    'read\\s+file', 'delete\\s+file', 'find\\s+file', 'on\\s+the\\s+server',
    'in\\s+the\\s+terminal', 'via\\s+ssh', 'subagent', 'sub-agent',
    // Tools / commands
    'terminal', 'shell', '\\bbash\\b', 'npx\\s', 'npm\\s+(install|run)', 'pip\\s+install',
    'curl\\s+', 'wget\\s+', 'playwright', 'chromium\\s+--', 'docker\\s', 'systemctl',
    'apt[-\\s]?get', 'sudo\\s', '\\bssh\\b', 'rsync', 'git\\s+(clone|pull|push)',
  ].join('|'),
  'i',
);

// File-path mentions (uploaded attachments handled separately by vision-bypass)
const TMP_PATH_RE = /\/tmp\/[\w./@+\-]+\.(?:txt|json|log|sh|py|js|ts|md|csv|tsv|xml|yml|yaml|html|css|sql|env)/i;

function classifyPrompt(userText) {
  const t = (userText || '').trim();
  if (!t) return { route: 'kimi', reason: 'empty' };
  if (NEEDS_HERMES_RE.test(t)) return { route: 'hermes', reason: 'keyword' };
  if (TMP_PATH_RE.test(t)) return { route: 'hermes', reason: 'file-path' };
  return { route: 'kimi', reason: 'default-qa' };
}

/* ─────────────────────────────────────────────────────────────────────────────
   /auto/run — single endpoint that routes between direct Kimi (fast Q&A)
   and Hermes (real shell/file/agent work) without the user having to choose
   a mode. Same SSE event shape as /agent/run so the UI just works.
   ──────────────────────────────────────────────────────────────────────────── */

app.post('/auto/run', requiresAuth, async (req, res) => {
  const promptRaw = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  const context = Array.isArray(req.body?.context) ? req.body.context : [];
  if (!promptRaw) return res.status(400).json({ error: { message: 'prompt is required' } });

  // Per-agent override — find by id, apply default mode + system prompt
  const agent = findAgent(req.body?.agentId);

  // Per-chat MD memory (folder per chatId). If present, gets injected into
  // the system prompt; after streaming we trigger a Kimi digest to update
  // facts.md / decisions.md / summary.md.
  const chatId = isValidChatId(req.body?.chatId) ? req.body.chatId : null;
  if (chatId) ensureChatDir(chatId);
  const memoryBlock = chatId ? buildMemoryBlock(chatId) : '';

  // Force routing if caller explicitly asked. Agent's defaultMode acts as a
  // soft default — heuristic still wins unless explicitly forced.
  const force = (req.body?.force || agent?.defaultMode || '').toLowerCase();
  let decision = force === 'hermes' || force === 'kimi'
    ? { route: force, reason: agent ? `agent:${agent.id}` : 'forced' }
    : classifyPrompt(promptRaw);

  // If user attached files via uploaded-prefix in prompt, force Hermes (files only matter on VPS)
  if (decision.route === 'kimi' && /\/tmp\/hk_uploads\//i.test(promptRaw)) {
    decision = { route: 'hermes', reason: 'attachment' };
  }

  // SSE setup
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  sseWrite(res, {
    type: 'route',
    route: decision.route,
    reason: decision.reason,
    at: Date.now(),
  });

  if (decision.route === 'hermes') {
    // Forward to /agent/run handler internally — easiest is just re-invoke the
    // same logic via internal HTTP call. Pre-pend agent's systemPrompt as a
    // role-specific preamble before the user's actual request, plus the
    // chat-memory block when available.
    const memoryPrefix = memoryBlock ? `# Память по чату\n${memoryBlock}\n\n` : '';
    const rolePrefix = agent?.systemPrompt
      ? `# Твоя роль (${agent.name})\n${agent.systemPrompt}\n\n`
      : '';
    const promptWithAgent =
      memoryPrefix + rolePrefix +
      (memoryPrefix || rolePrefix ? `# Запрос пользователя\n\n${promptRaw}` : promptRaw);
    try {
      const upstream = await fetch(`http://127.0.0.1:${config.port}/agent/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptWithAgent, context }),
      });
      if (upstream.body) {
        for await (const chunk of upstream.body) res.write(chunk);
      }
    } catch (e) {
      sseWrite(res, { type: 'error', message: `Hermes route failed: ${String(e?.message || e)}` });
      sseWrite(res, { type: 'done', code: 1, signal: null, killedByClient: false, killedByTimeout: false, at: Date.now() });
    }
    res.end();
    return;
  }

  // ── Direct Kimi: stream chat completion as stdout chunks ────────────────
  const baseSystem =
    'Ты — помощник в чате. Отвечай по делу, ёмко, на языке вопроса. ' +
    'Если нужно показать код — оборачивай в ```блоки``` с указанием языка. ' +
    'Не пиши «не могу выполнить» — просто отвечай тем что знаешь.';
  const systemContent = [
    agent?.systemPrompt || '',
    baseSystem,
    memoryBlock,
  ].filter(Boolean).join('\n\n');

  const messages = [
    { role: 'system', content: systemContent },
    ...context
      .slice(-12)
      .filter((t) => t && typeof t.role === 'string' && typeof t.content === 'string' && t.content.trim())
      .map((t) => ({ role: t.role, content: t.content })),
    { role: 'user', content: promptRaw },
  ];

  // Accumulate the assistant's full reply so we can pass it to the digest
  // call once streaming completes.
  let assistantBuf = '';

  try {
    const upstream = await callKimiChatCompletion(
      { model: config.kimiModel, stream: true, temperature: 0.7, messages, reasoning_effort: 'low' },
      { signal: undefined },
    );
    if (upstream?.body) {
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let reasoningBuf = '';
      let lastReasoningEmit = 0;
      for await (const chunk of upstream.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const j = JSON.parse(payload);
            const delta = j?.choices?.[0]?.delta?.content;
            const reasoning = j?.choices?.[0]?.delta?.reasoning_content;
            if (typeof reasoning === 'string' && reasoning.length > 0) {
              reasoningBuf += reasoning;
              const now = Date.now();
              if (reasoningBuf.length >= 60 || now - lastReasoningEmit > 250) {
                sseWrite(res, { type: 'step', kind: 'thinking', text: reasoningBuf });
                reasoningBuf = '';
                lastReasoningEmit = now;
              }
            }
            if (typeof delta === 'string' && delta.length > 0) {
              if (reasoningBuf.length > 0) {
                sseWrite(res, { type: 'step', kind: 'thinking', text: reasoningBuf });
                reasoningBuf = '';
              }
              assistantBuf += delta;
              sseWrite(res, { type: 'stdout', data: delta });
            }
          } catch { /* skip */ }
        }
      }
      if (reasoningBuf.length > 0) {
        sseWrite(res, { type: 'step', kind: 'thinking', text: reasoningBuf });
      }
    }
    sseWrite(res, { type: 'done', code: 0, signal: null, killedByClient: false, killedByTimeout: false, at: Date.now() });
  } catch (e) {
    sseWrite(res, { type: 'error', message: `Kimi route failed: ${String(e?.message || e)}` });
    sseWrite(res, { type: 'done', code: 1, signal: null, killedByClient: false, killedByTimeout: false, at: Date.now() });
  }
  res.end();

  // Fire-and-forget digest — never block the response on this.
  if (chatId && assistantBuf.trim()) {
    setImmediate(() => {
      digestChat(chatId, promptRaw, assistantBuf).catch((e) => {
        console.warn('[chat-store] background digest failed:', e?.message || e);
      });
    });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   Hermes session-file polling — surfaces the agent's intermediate reasoning
   and tool calls. Hermes writes /root/.hermes/sessions/session_*.json and
   keeps appending messages as the loop progresses. We snapshot the newest
   file created during this run and emit any new messages as 'step' events.
   ──────────────────────────────────────────────────────────────────────────── */

const SESSIONS_DIR = process.env.HERMES_SESSIONS_DIR || '/root/.hermes/sessions';

function pickActiveSessionFile(startMs) {
  let best = null;
  let bestMtime = 0;
  try {
    for (const name of fs.readdirSync(SESSIONS_DIR)) {
      if (!name.startsWith('session_') || !name.endsWith('.json')) continue;
      const full = path.join(SESSIONS_DIR, name);
      try {
        const st = fs.statSync(full);
        if (st.mtimeMs >= startMs - 1500 && st.mtimeMs > bestMtime) {
          best = full;
          bestMtime = st.mtimeMs;
        }
      } catch { /* file gone between readdir and stat */ }
    }
  } catch { /* sessions dir missing */ }
  return best;
}

/** For delegate_task / orchestrator-style calls — extract per-subagent goal + context + role */
function extractSubtasks(parsedArgs) {
  if (!parsedArgs || typeof parsedArgs !== 'object') return null;
  if (!Array.isArray(parsedArgs.tasks) || parsedArgs.tasks.length === 0) return null;
  return parsedArgs.tasks.map((t, i) => ({
    index: i,
    goal: (t?.goal || t?.task || t?.prompt || t?.description || '').toString().slice(0, 1500),
    context: typeof t?.context === 'string' ? t.context.slice(0, 2000) : null,
    role: t?.role || t?.profile || t?.agent || t?.persona || null,
    toolsets: Array.isArray(t?.toolsets) ? t.toolsets : null,
  }));
}

function summariseToolCall(call) {
  const fn = call?.function || call?.['function'] || {};
  const name = fn.name || call?.name || 'tool';
  let argText = '';
  let parsedArgs = null;
  try {
    parsedArgs = typeof fn.arguments === 'string'
      ? JSON.parse(fn.arguments)
      : fn.arguments || call?.arguments || call?.input || {};
    if (parsedArgs && typeof parsedArgs === 'object') {
      const fields = ['command', 'cmd', 'path', 'file_path', 'query', 'url', 'pattern',
                      'goal', 'task', 'prompt', 'description', 'content'];
      // delegate_task wraps the goal inside `tasks: [{goal, role, ...}]`.
      // Surface the first task's goal (or join goals if many) instead of dumping JSON.
      if (Array.isArray(parsedArgs.tasks) && parsedArgs.tasks.length > 0) {
        const goals = parsedArgs.tasks
          .map((t) => t?.goal || t?.task || t?.prompt || t?.description || '')
          .filter(Boolean);
        if (goals.length > 0) {
          argText = goals.length === 1
            ? goals[0]
            : goals.map((g, i) => `${i + 1}. ${g}`).join('  ·  ');
        }
      }
      if (!argText) {
        for (const f of fields) {
          if (typeof parsedArgs[f] === 'string') {
            argText = parsedArgs[f];
            break;
          }
        }
      }
      if (!argText) argText = JSON.stringify(parsedArgs);
    } else {
      argText = String(parsedArgs ?? '');
    }
  } catch {
    argText = '';
  }
  // Subagent detection: delegate_task / spawn_agent / orchestrate-style tools
  const lname = name.toLowerCase();
  const isSubagent =
    lname.includes('delegate') ||
    lname.includes('subagent') ||
    lname.includes('spawn_agent') ||
    lname === 'agent' ||
    lname === 'orchestrate';
  // Try to surface a subagent role/profile — top-level OR inside tasks[0]
  let subagentRole = null;
  if (isSubagent && parsedArgs && typeof parsedArgs === 'object') {
    const head =
      Array.isArray(parsedArgs.tasks) && parsedArgs.tasks[0] && typeof parsedArgs.tasks[0] === 'object'
        ? parsedArgs.tasks[0]
        : parsedArgs;
    subagentRole =
      head.role ||
      head.profile ||
      head.agent ||
      head.persona ||
      parsedArgs.role ||
      null;
  }
  // Pre-extract subtasks so the UI can render a debate card per task
  const subtasks = isSubagent ? extractSubtasks(parsedArgs) : null;

  return {
    name,
    args: argText.slice(0, 400),
    isSubagent,
    subagentRole: subagentRole ? String(subagentRole).slice(0, 60) : null,
    subtasks,
  };
}

function clipText(s, n = 320) {
  if (typeof s !== 'string') return '';
  if (s.length <= n) return s;
  return s.slice(0, n) + ` …(+${s.length - n})`;
}

function extractSteps(sessionJson, sentCount) {
  const messages = Array.isArray(sessionJson?.messages) ? sessionJson.messages : [];
  if (messages.length <= sentCount) return { steps: [], total: messages.length };
  const steps = [];
  // Helper: surface reasoning_content as a `thinking` step so the UI shows
  // what the agent is mulling over between tool calls.
  const pushThinking = (m) => {
    const rc = typeof m.reasoning_content === 'string' ? m.reasoning_content.trim() : '';
    if (!rc) return;
    steps.push({ kind: 'thinking', text: clipText(rc, 800) });
  };
  for (let i = sentCount; i < messages.length; i++) {
    const m = messages[i] || {};
    const role = m.role || 'assistant';
    const tools = Array.isArray(m.tool_calls) ? m.tool_calls : [];
    if (role === 'user') continue;            // user prompt — skip, UI already shows it
    if (role === 'system') continue;
    if (role === 'tool') {
      // Tool results often come as JSON-encoded strings; we want readable text
      // in the trace, not raw `{"...":"..\n..."}` with escaped newlines.
      const raw = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '');
      let parsed = raw;
      let subagentResults = null;
      try {
        const j = JSON.parse(raw);
        if (j && typeof j === 'object') {
          // delegate_task / multi-task tools return { results: [{ summary | output | text, status }] }
          if (Array.isArray(j.results) && j.results.length > 0) {
            // Structured per-subagent payload — UI renders a debate panel
            subagentResults = j.results.map((r, i) => {
              if (typeof r === 'string') return { index: i, status: 'completed', summary: r };
              if (r && typeof r === 'object') {
                // Hermes can also return the result already as a JSON-string
                // inside `summary` (when the inner agent failed). Try one more
                // unwrap so we expose tool_trace / exit_reason cleanly.
                let unwrapped = r;
                if (typeof r.summary === 'string' && r.summary.trim().startsWith('{')) {
                  try { unwrapped = { ...r, ...JSON.parse(r.summary) }; } catch { /* keep r */ }
                }
                return {
                  index: typeof unwrapped.task_index === 'number'
                    ? unwrapped.task_index
                    : i,
                  status: unwrapped.status || null,
                  summary:
                    (typeof unwrapped.summary === 'string' && !unwrapped.summary.trim().startsWith('{'))
                      ? unwrapped.summary
                      : unwrapped.output || unwrapped.text || unwrapped.content ||
                        unwrapped.message || unwrapped.answer || unwrapped.result ||
                        '',
                  ...(typeof unwrapped.error === 'string' ? { error: unwrapped.error } : {}),
                  ...(typeof unwrapped.exit_reason === 'string'
                    ? { exitReason: unwrapped.exit_reason }
                    : {}),
                  ...(typeof unwrapped.duration_seconds === 'number'
                    ? { durationSec: unwrapped.duration_seconds }
                    : {}),
                  ...(typeof unwrapped.api_calls === 'number'
                    ? { apiCalls: unwrapped.api_calls }
                    : {}),
                  ...(Array.isArray(unwrapped.tool_trace) && unwrapped.tool_trace.length > 0
                    ? {
                        toolTrace: unwrapped.tool_trace.map((tt) => ({
                          tool: String(tt?.tool || tt?.name || 'tool'),
                          status: tt?.status || null,
                          argsBytes: typeof tt?.args_bytes === 'number' ? tt.args_bytes : null,
                          resultBytes: typeof tt?.result_bytes === 'number' ? tt.result_bytes : null,
                        })),
                      }
                    : {}),
                };
              }
              return { index: i, status: null, summary: String(r) };
            });
            parsed = subagentResults
              .map((r) => {
                const head = subagentResults.length > 1
                  ? `### task ${r.index}${r.status ? ' · ' + r.status : ''}\n\n`
                  : '';
                return head + r.summary;
              })
              .join('\n\n---\n\n');
          } else if (typeof j.error === 'string') {
            // Hermes orchestrator error payload — surface verbatim
            parsed = `⚠ ${j.error}`;
          } else {
            const pickField = [
              'output', 'content', 'text', 'result', 'stdout', 'data',
              'summary', 'answer', 'message', 'response',
            ].find((k) => typeof j[k] === 'string' && j[k].length > 0);
            if (pickField) {
              parsed = j[pickField];
            } else {
              parsed = JSON.stringify(j, null, 2);
            }
          }
        } else if (typeof j === 'string') {
          parsed = j;
        }
      } catch {
        // Not JSON — leave as is
      }
      steps.push({
        kind: 'tool_result',
        toolCallId: m.tool_call_id || null,
        text: clipText(parsed),
        ...(subagentResults ? { subagentResults } : {}),
      });
      continue;
    }
    // assistant
    if (tools.length > 0) {
      pushThinking(m);
      for (const tc of tools) {
        const s = summariseToolCall(tc);
        steps.push({
          kind: 'tool_call',
          name: s.name,
          args: s.args,
          toolCallId: tc.id || null,
          ...(s.isSubagent
            ? {
                subagent: true,
                subagentRole: s.subagentRole,
                ...(s.subtasks ? { subtasks: s.subtasks } : {}),
              }
            : {}),
        });
      }
      // assistant message may also have textual content alongside tool calls
      if (typeof m.content === 'string' && m.content.trim()) {
        steps.push({ kind: 'note', text: clipText(m.content) });
      }
    } else if (typeof m.content === 'string' && m.content.trim()) {
      // intermediate assistant note (rare with -z, but keep for completeness)
      pushThinking(m);
      steps.push({ kind: 'note', text: clipText(m.content, 600) });
    } else {
      // assistant message with no tool calls AND no content yet — pure reasoning
      pushThinking(m);
    }
  }
  return { steps, total: messages.length };
}

/* ─────────────────────────────────────────────────────────────────────────────
   Build a context preamble out of prior chat turns so successive `hermes -z`
   calls feel continuous. (Hermes' SQLite session store isn't populated by
   oneshot mode, so --resume can't be used directly — we inject manually.)
   ──────────────────────────────────────────────────────────────────────────── */
const RENDER_HINT =
  '# Как тебя видит пользователь\n' +
  'Ты подключён к веб-чату, не к голому CLI. Любой файл, который ты создашь по абсолютному пути ' +
  'в /tmp или /root/.hermes, чат автоматически подтянет и покажет: PNG/JPG/WEBP/GIF/SVG/BMP — ' +
  'превьюхой прямо под твоим ответом, остальное — ссылкой. Поэтому **не пиши «не могу отобразить ' +
  'в CLI»**: достаточно создать файл и упомянуть путь — пользователь увидит картинку.\n\n' +
  '## Сабагенты\n' +
  'Если юзер пишет «N сабагентов / N агентов / параллельно / пусть каждый / дебаты / N мнений / ' +
  'N subagents / delegate / in parallel» — сразу:\n' +
  '1. `skill_view {"name":"orchestrator"}`\n' +
  '2. `delegate_task {"tasks":[…N задач…]}` с `"toolsets":["terminal"]` для каждой\n' +
  '3. Синтезируй финал.\n\n' +
  'Своими руками `terminal/curl` НЕ дёргай — сабагенты сделают. ' +
  '`web_search` НЕ существует — только `terminal+curl`. Лимит 5 параллельных за вызов.\n\n' +
  '## Браузер и скриншоты\n' +
  '**Используй Playwright** — он установлен глобально, работает чисто, без snap-confinement.\n' +
  'Для длинных страниц обязательно `--full-page`:\n' +
  '```bash\n' +
  'npx playwright screenshot --browser=chromium --viewport-size=1280,800 \\\n' +
  '  --full-page <URL> /tmp/имя.png\n' +
  '```\n' +
  'Для интерактива (клик, ввод, ожидание) пиши скрипт через `node -e "..."` с ' +
  '`require(\'playwright\')`. Browsers лежат в `/root/.cache/ms-playwright`.\n\n' +
  'Не используй `chromium-browser --headless --screenshot=...` — snap-версия пишет в ' +
  '`/tmp/snap-private-tmp/snap.chromium/tmp/...`, путь окажется не там, где ты его назвал.\n\n' +
  '## Где брать картинки\n' +
  '**Не скриншоть google.com / google.com/search / images.google.com** — Google блочит ' +
  'IP сервера капчей «unusual traffic», ты получишь страницу-предупреждение, а не результат. ' +
  'Если пользователь просит «картинку X», используй один из этих источников (без ключа, без капчи):\n' +
  '\n' +
  '1. **Wikimedia Commons API** — лучший вариант для конкретных тем:\n' +
  '   ```bash\n' +
  '   QUERY="cat"   # тема\n' +
  '   URL=$(curl -s "https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&generator=search&gsrnamespace=6&gsrsearch=${QUERY}&gsrlimit=1&iiprop=url" | python3 -c "import sys,json; d=json.load(sys.stdin); pages=d[\\"query\\"][\\"pages\\"]; print(list(pages.values())[0][\\"imageinfo\\"][0][\\"url\\"])")\n' +
  '   curl -sL "$URL" -o /tmp/${QUERY}.jpg\n' +
  '   ```\n' +
  '\n' +
  '2. **Тематические free-API без ключа** (когда хочется быстро):\n' +
  '   - кот:  `curl -sL "https://cataas.com/cat" -o /tmp/cat.jpg`\n' +
  '   - пёс:  `curl -sL "$(curl -s https://dog.ceo/api/breeds/image/random | python3 -c \\"import sys,json; print(json.load(sys.stdin)[\\\\\\"message\\\\\\"])\\")" -o /tmp/dog.jpg`\n' +
  '   - случайное по seed: `curl -sL "https://picsum.photos/seed/${QUERY}/1280/800" -o /tmp/${QUERY}.jpg`\n' +
  '\n' +
  '3. **DuckDuckGo Images** — если нужен поиск по тексту с превью:\n' +
  '   ```bash\n' +
  '   npx playwright screenshot --browser=chromium --viewport-size=1280,800 \\\n' +
  '     --full-page "https://duckduckgo.com/?q=${QUERY}&iax=images&ia=images" /tmp/results.png\n' +
  '   ```\n' +
  '\n' +
  'Скриншот СТРАНИЦЫ (любого сайта кроме Google) делай Playwright, как описано выше.\n\n';

/**
 * Bypass mode: instead of spawning Hermes (which can take 2-4 min for
 * delegate_task because of Kimi's reasoning_content overhead), we directly
 * fan out N parallel /v1/chat/completions calls and stream results back
 * shaped exactly like a Hermes delegate_task pair (tool_call + tool_result
 * with subagentResults). The existing UI debate panel just works.
 */
async function runSubagentBypass({ n, userPrompt, contextPreamble, res, onClose }) {
  const startedAt = Date.now();
  const subtaskGoals = Array.from({ length: n }, (_, i) =>
    `Независимо реши задачу пользователя. Это твой ${i + 1}-й из ${n} параллельных под-агентов; ` +
    'ты не знаешь ответы других. Дай ясный аргументированный ответ. Будь краток (3-7 предложений).'
  );

  // Emit a synthetic delegate_task tool_call so the UI shows a debate panel.
  const callId = 'bypass-' + Math.random().toString(36).slice(2, 10);
  const subtasks = subtaskGoals.map((goal, i) => ({
    index: i,
    goal,
    context: userPrompt,
    role: 'leaf',
    toolsets: ['kimi-direct'],
  }));
  sseWrite(res, {
    type: 'step',
    kind: 'tool_call',
    name: 'delegate_task',
    args: subtasks.map((s, i) => `${i + 1}. ${s.goal.slice(0, 80)}`).join('  ·  '),
    toolCallId: callId,
    subagent: true,
    subagentRole: 'leaf',
    subtasks,
  });

  // Fire N Kimi calls in parallel; emit a partial tool_result every time
  // ANY subagent finishes so the UI fills card-by-card.
  const subResults = subtasks.map((st) => ({
    index: st.index,
    status: 'pending',
    summary: '',
  }));

  const flushPartial = () => {
    sseWrite(res, {
      type: 'step',
      kind: 'tool_result',
      toolCallId: callId,
      text: subResults.map((r) => `### #${r.index}\n${r.summary || ''}`).join('\n\n---\n\n'),
      subagentResults: subResults.map((r) => ({ ...r })),
    });
  };

  const subPromises = subtasks.map(async (st) => {
    const t0 = Date.now();
    try {
      const body = {
        model: config.kimiModel,
        stream: false,
        messages: [
          {
            role: 'system',
            content:
              'Ты — независимый под-агент в составе команды. Отвечай ёмко и по делу. ' +
              'Не упоминай других агентов. Не извиняйся. Если запрос на русском — отвечай по-русски.',
          },
          { role: 'user', content: `Задача: ${st.goal}\n\nЗапрос пользователя: ${userPrompt}` },
        ],
      };
      const resp = await callKimiChatCompletion(body, { signal: undefined });
      const summary = resp?.choices?.[0]?.message?.content?.trim() || '_(пусто)_';
      subResults[st.index] = {
        index: st.index,
        status: 'completed',
        summary,
        durationSec: (Date.now() - t0) / 1000,
        apiCalls: 1,
      };
    } catch (e) {
      subResults[st.index] = {
        index: st.index,
        status: 'failed',
        summary: '',
        error: String(e?.message || e),
        exitReason: 'kimi_error',
        durationSec: (Date.now() - t0) / 1000,
        apiCalls: 1,
      };
    }
    flushPartial();
  });

  await Promise.all(subPromises);

  // Synthesize the final answer with one more Kimi call (so the bubble has a real assistant text)
  try {
    const synthBody = {
      model: config.kimiModel,
      stream: false,
      messages: [
        {
          role: 'system',
          content:
            'Тебе пришли N независимых ответов от под-агентов. Синтезируй короткий итоговый ответ ' +
            'для пользователя на основе их ответов: что они согласны/не согласны, ключевые выводы. ' +
            'Будь краток (5-10 предложений) и структурирован. Если запрос на русском — отвечай по-русски.',
        },
        {
          role: 'user',
          content:
            `Запрос пользователя: ${userPrompt}\n\n` +
            `Ответы под-агентов:\n` +
            subResults
              .map((r, i) => `\n### Под-агент #${i + 1} (${r.status})\n${r.summary || r.error || '_нет ответа_'}`)
              .join('\n'),
        },
      ],
    };
    const synth = await callKimiChatCompletion(synthBody, { signal: undefined });
    const finalText = synth?.choices?.[0]?.message?.content?.trim() || '';
    if (finalText) sseWrite(res, { type: 'stdout', data: finalText + '\n' });
  } catch (e) {
    sseWrite(res, { type: 'stderr', data: `synthesis failed: ${String(e?.message || e)}\n` });
  }

  sseWrite(res, {
    type: 'done',
    code: 0,
    signal: null,
    killedByClient: false,
    killedByTimeout: false,
    sessionFile: null,
    bypass: true,
    at: Date.now(),
  });
  onClose?.();
}

/**
 * Vision-only bypass: if the user attached image(s) and the typed prompt
 * is just "what's on the photo / describe / who is this" without any
 * shell-execution intent, skip Hermes entirely and call Kimi vision once.
 *
 * Saves the 25-40 s Python startup + plugin discovery + Hermes reasoning
 * overhead for a task that doesn't need any tools beyond the LLM seeing
 * the image.
 */
// Match any image path under /tmp (covers /tmp/hk_uploads/ uploads AND
// /tmp/<name>.png from previous agent runs that user references).
const VISION_IMG_RE = /(\/tmp\/[\w./@+\- ()а-яА-ЯёЁ]+?\.(?:png|jpe?g|webp|gif|bmp))/gi;
const EXEC_KEYWORDS_RE = /(?:запусти|выполни|сделай|создай|создать|поставь|установи|скачай|загрузи|сохрани|открой|run\s|execute|create\s|install\s|download\s|playwright|chromium|curl|wget|npm|npx|python|node\s|bash|shell|terminal|скриншот\s+сайт|screenshot)/i;

/**
 * Extract just the user-typed text from a prompt that may have been wrapped
 * by buildAgentPrefix (which puts attachment metadata + `---` separator
 * before the actual user text). The user text is everything after the LAST
 * `---` line, or the full prompt if there's no separator.
 */
function extractUserText(promptOrPrefixed) {
  const s = (promptOrPrefixed || '').trim();
  if (!s) return '';
  const idx = s.lastIndexOf('\n---\n');
  if (idx === -1) {
    // also try without leading newline
    const idx2 = s.lastIndexOf('---\n');
    if (idx2 === -1) return s;
    return s.slice(idx2 + 4).trim();
  }
  return s.slice(idx + 5).trim();
}

function shouldVisionBypass(prompt, userPrompt) {
  if (!VISION_IMG_RE.test(prompt)) {
    VISION_IMG_RE.lastIndex = 0;
    return false;
  }
  VISION_IMG_RE.lastIndex = 0;
  // The "user prompt" we get is often the FULL prefixed prompt — strip
  // attachment metadata to check just what the user actually typed.
  const justUser = extractUserText(userPrompt);
  if (EXEC_KEYWORDS_RE.test(justUser)) return false;
  if (justUser.length > 400) return false;
  return true;
}

async function runVisionBypass({ prompt, userPrompt, res, onClose }) {
  const t0 = Date.now();
  // Extract all image paths and read them as base64
  const paths = [];
  let m;
  while ((m = VISION_IMG_RE.exec(prompt)) !== null) {
    if (!paths.includes(m[1])) paths.push(m[1]);
  }
  VISION_IMG_RE.lastIndex = 0;

  const imageBlocks = [];
  for (const p of paths.slice(0, 6)) {            // cap at 6 images
    try {
      const abs = fs.realpathSync(p);
      if (!abs.startsWith('/tmp/')) continue;
      const buf = fs.readFileSync(abs);
      const ext = (path.extname(abs).slice(1) || 'png').toLowerCase();
      const mime = MIME_BY_EXT['.' + ext] || 'image/png';
      const b64 = buf.toString('base64');
      imageBlocks.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } });
    } catch { /* missing file — skip */ }
  }

  if (imageBlocks.length === 0) {
    sseWrite(res, { type: 'error', message: 'Vision bypass: no readable images' });
    sseWrite(res, { type: 'done', code: 1, signal: null, killedByClient: false, killedByTimeout: false, at: Date.now() });
    onClose?.();
    return;
  }

  const userText = extractUserText(userPrompt) || 'Опиши подробно что на изображении.';
  const visionBody = {
    model: config.kimiModel,
    stream: true,
    temperature: 0.4,
    reasoning_effort: 'low',
    messages: [
      {
        role: 'system',
        content:
          'Идентифицируй что/кто на фото. Сначала отметь стиль рендера (3D-модель из игры / ' +
          'реальное фото / аниме / 2D-арт). Дай **3 кандидата ранжировано** в формате: ' +
          '«**Имя** (источник) — 2-3 совпадающих признака». В конце одно предложение: ' +
          '«Скорее всего это X». Отвечай кратко на языке вопроса.',
      },
      { role: 'user', content: [{ type: 'text', text: userText }, ...imageBlocks] },
    ],
  };

  try {
    const result = await callKimiChatCompletion(visionBody, { signal: undefined });
    // Streaming response: pipe SSE chunks → parse delta.content → emit stdout
    if (result?.body) {
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let totalChars = 0;
      let reasoningBuf = '';
      let lastReasoningEmit = 0;
      for await (const chunk of result.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const j = JSON.parse(payload);
            const delta = j?.choices?.[0]?.delta?.content;
            const reasoning = j?.choices?.[0]?.delta?.reasoning_content;
            if (typeof reasoning === 'string' && reasoning.length > 0) {
              reasoningBuf += reasoning;
              // throttle: emit accumulated reasoning every ~250ms or 60 chars
              const now = Date.now();
              if (reasoningBuf.length >= 60 || now - lastReasoningEmit > 250) {
                sseWrite(res, { type: 'step', kind: 'thinking', text: reasoningBuf });
                reasoningBuf = '';
                lastReasoningEmit = now;
              }
            }
            if (typeof delta === 'string' && delta.length > 0) {
              // flush any pending reasoning before answer starts
              if (reasoningBuf.length > 0) {
                sseWrite(res, { type: 'step', kind: 'thinking', text: reasoningBuf });
                reasoningBuf = '';
              }
              totalChars += delta.length;
              sseWrite(res, { type: 'stdout', data: delta });
            }
          } catch { /* skip malformed sse line */ }
        }
      }
      buffer += decoder.decode();
      if (reasoningBuf.length > 0) {
        sseWrite(res, { type: 'step', kind: 'thinking', text: reasoningBuf });
      }
      if (totalChars === 0) {
        sseWrite(res, { type: 'stderr', data: `vision-bypass: empty stream, last buffer: ${buffer.slice(-300)}\n` });
      }
    } else {
      // Non-streaming fallback (callKimiChatCompletion returned parsed JSON)
      const answer = result?.choices?.[0]?.message?.content?.trim() || '_(пустой ответ)_';
      sseWrite(res, { type: 'stdout', data: answer + '\n' });
    }
  } catch (e) {
    sseWrite(res, { type: 'error', message: `Vision bypass failed: ${String(e?.message || e)}` });
  }

  sseWrite(res, {
    type: 'done',
    code: 0,
    signal: null,
    killedByClient: false,
    killedByTimeout: false,
    sessionFile: null,
    bypass: 'vision',
    at: Date.now(),
  });
  onClose?.();
}

function buildContextPreamble(context) {
  const lines = [RENDER_HINT, '', PUBLISH_HINT];
  if (Array.isArray(context) && context.length > 0) {
    lines.push('# Контекст предыдущего диалога');
    lines.push('');
    for (const turn of context.slice(-12)) {
      if (!turn || typeof turn.role !== 'string' || typeof turn.content !== 'string') continue;
      const role = turn.role === 'user' ? 'Пользователь' : turn.role === 'assistant' ? 'Ты' : 'Система';
      const body = turn.content.trim();
      if (!body) continue;
      lines.push(`### ${role}:`);
      lines.push(body.length > 1500 ? body.slice(0, 1500) + ' …(обрезано)' : body);
      lines.push('');
    }
    lines.push('---');
    lines.push('');
    lines.push('# Новая задача');
    lines.push('');
  }
  return lines.join('\n');
}

/* Walk text and pick image paths that resolve into the allowlist. */
const IMG_PATH_RE = /(\/[\w./@+\- ()а-яА-ЯёЁ]+?\.(?:png|jpe?g|webp|gif|svg|bmp))/gi;

function findArtifactsInText(text, allowedRoots, seenAbs) {
  if (typeof text !== 'string' || !text) return [];
  const out = [];
  for (const m of text.matchAll(IMG_PATH_RE)) {
    const candidate = m[1];
    let abs;
    try { abs = fs.realpathSync(path.resolve(candidate)); } catch { continue; }
    if (seenAbs.has(abs)) continue;
    const ok = allowedRoots.some((r) => abs === r || abs.startsWith(r + path.sep));
    if (!ok) continue;
    let st;
    try { st = fs.statSync(abs); } catch { continue; }
    if (!st.isFile()) continue;
    seenAbs.add(abs);
    out.push({
      path: abs,
      name: path.basename(abs),
      size: st.size,
      mime: guessMime(abs),
    });
  }
  return out;
}

function stepText(s) {
  if (!s) return '';
  if (s.kind === 'tool_call') return s.args || '';
  if (s.kind === 'tool_result') return s.text || '';
  if (s.kind === 'note') return s.text || '';
  return '';
}

/**
 * Scan disk for image files freshly created during this run. This catches
 * artifacts the agent created but mentioned at a wrong path (e.g. snap's
 * confinement maps `/tmp/x.png` to `/tmp/snap-private-tmp/snap.chromium/tmp/x.png`).
 */
const IMG_EXTS_SCAN = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp'];

function scanRecentImages(sinceMs, allowedRoots, seenAbs) {
  const since = new Date(Math.max(0, sinceMs - 500)).toISOString();
  const findArgs = [
    ...allowedRoots,
    '-maxdepth', '6',
    '-type', 'f',
    '(',
    ...IMG_EXTS_SCAN.flatMap((e, i) => (i === 0 ? ['-iname', `*.${e}`] : ['-o', '-iname', `*.${e}`])),
    ')',
    '-newermt', since,
    '-print',
  ];
  let stdout = '';
  try {
    const r = spawnSync('find', findArgs, {
      encoding: 'utf8',
      timeout: 4000,
      maxBuffer: 256 * 1024,
    });
    stdout = r.stdout || '';
  } catch {
    return [];
  }
  const out = [];
  for (const candidate of stdout.split('\n')) {
    const p = candidate.trim();
    if (!p) continue;
    let abs;
    try { abs = fs.realpathSync(p); } catch { continue; }
    if (seenAbs.has(abs)) continue;
    const ok = allowedRoots.some((r) => abs === r || abs.startsWith(r + path.sep));
    if (!ok) continue;
    let st;
    try { st = fs.statSync(abs); } catch { continue; }
    if (!st.isFile()) continue;
    seenAbs.add(abs);
    out.push({
      path: abs,
      name: path.basename(abs),
      size: st.size,
      mime: guessMime(abs),
    });
    if (out.length >= 8) break;
  }
  return out;
}

app.post('/agent/run', requiresAuth, (req, res) => {
  const promptRaw = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  const context = Array.isArray(req.body?.context) ? req.body.context : [];
  if (!promptRaw) {
    return res.status(400).json({ error: { message: 'prompt is required' } });
  }
  if (promptRaw.length > 32_000) {
    return res.status(400).json({ error: { message: 'prompt too long (max 32k chars)' } });
  }
  const preamble = buildContextPreamble(context);
  const prompt = preamble + promptRaw;

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const startedAt = Date.now();
  sseWrite(res, { type: 'started', prompt: prompt.slice(0, 200), at: startedAt });

  // Scrub env vars that the proxy needs but Hermes interprets differently.
  // KIMI_BASE_URL on the proxy points at `…/coding/v1`; Hermes builds the
  // right path itself given just `api.kimi.com/coding`, so a raw `/v1`
  // suffix in env causes 404.
  const childEnv = { ...process.env, HERMES_NO_BANNER: '1', NO_COLOR: '1' };
  delete childEnv.KIMI_BASE_URL;
  delete childEnv.OPENAI_BASE_URL;
  delete childEnv.OPENAI_API_KEY;

  // Auto-detect "N subagents / N агентов" — when matched, BYPASS Hermes
  // entirely and run N parallel Kimi chat-completions ourselves. This avoids
  // the 2-4 minute reasoning_content overhead of Hermes oneshot mode.
  const RU_NUM = { 'один':1,'одного':1,'два':2,'двух':2,'три':3,'трёх':3,'трем':3,'трём':3,'трое':3,'четыре':4,'четырёх':4,'пять':5,'пяти':5,'шесть':6,'семь':7,'восемь':8,'девять':9,'десять':10 };
  function detectSubagentCount(p) {
    const m1 = p.match(/(\d{1,2})\s*(?:саб[-\s]?агент|субагент|sub[-\s]?agent|agent)/i);
    if (m1) return Math.min(5, Math.max(2, parseInt(m1[1], 10)));
    const m2 = p.match(/(один|одного|два|двух|три|трёх|трех|трое|четыре|четырёх|пять|пяти|шесть|семь|восемь|девять|десять)\s+(?:саб[-\s]?агент|субагент|агент)/i);
    if (m2) {
      const n = RU_NUM[m2[1].toLowerCase()];
      if (n) return Math.min(5, Math.max(2, n));
    }
    return 0;
  }
  const subagentN = detectSubagentCount(promptRaw);

  if (subagentN >= 2) {
    // ── Bypass mode: skip Hermes, run N parallel Kimi chats ───────────────
    runSubagentBypass({
      n: subagentN,
      userPrompt: promptRaw,
      contextPreamble: preamble,
      res,
      onClose: () => { if (!res.writableEnded) res.end(); },
    });
    return;
  }

  // ── Vision-only bypass: image attachments + short descriptive prompt ──
  // Hermes adds 25-40 s of pure overhead for what is just a Kimi vision call.
  if (shouldVisionBypass(prompt, promptRaw)) {
    runVisionBypass({
      prompt,
      userPrompt: promptRaw,
      res,
      onClose: () => { if (!res.writableEnded) res.end(); },
    });
    return;
  }

  // ── Normal Hermes path ────────────────────────────────────────────────
  const args = ['-z', prompt, '--yolo'];
  const child = spawn(config.hermesBin, args, {
    cwd: config.hermesCwd,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let killedByClient = false;
  let killedByTimeout = false;

  // session-file polling state + artifact discovery
  let sentCount = 0;
  let sessionFile = null;
  let stdoutAccum = '';
  const seenArtifacts = new Set();        // absolute paths already emitted
  const recentSignatures = [];            // for loop detection — last N tool_call sigs
  let loopWarningEmitted = false;

  const flushArtifactsFromText = (text) => {
    const found = findArtifactsInText(text, FILE_ALLOWED_ROOTS, seenArtifacts);
    for (const a of found) sseWrite(res, { type: 'artifact', kind: 'image', ...a });
  };

  const pollSession = () => {
    if (!sessionFile) sessionFile = pickActiveSessionFile(startedAt);
    if (!sessionFile) return;
    try {
      const raw = fs.readFileSync(sessionFile, 'utf8');
      const json = JSON.parse(raw);
      const { steps, total } = extractSteps(json, sentCount);
      if (steps.length > 0) {
        for (const s of steps) {
          sseWrite(res, { type: 'step', ...s });
          flushArtifactsFromText(stepText(s));

          // Loop detection — 4+ identical tool_calls in the last 6 = stuck
          if (s.kind === 'tool_call') {
            const sig = `${s.name}::${(s.args || '').slice(0, 200)}`;
            recentSignatures.push(sig);
            if (recentSignatures.length > 6) recentSignatures.shift();
            const sameCount = recentSignatures.filter((x) => x === sig).length;
            if (sameCount >= 4 && !loopWarningEmitted) {
              loopWarningEmitted = true;
              sseWrite(res, {
                type: 'loop_detected',
                tool: s.name,
                count: sameCount,
                message: `Агент повторил инструмент "${s.name}" ${sameCount} раз подряд — похоже на цикл, останавливаю.`,
              });
              try { child.kill('SIGTERM'); } catch {}
              setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 2000);
            }
          }
        }
        sentCount = total;
      }
    } catch {
      /* file mid-write or bad JSON — ignore, try next tick */
    }
  };
  const pollTimer = setInterval(pollSession, 700);

  const timer = setTimeout(() => {
    killedByTimeout = true;
    try { child.kill('SIGKILL'); } catch {}
  }, config.agentTimeoutMs);

  const onClose = () => {
    if (res.writableEnded) return;
    if (child.killed || child.exitCode !== null) return;
    killedByClient = true;
    try { child.kill('SIGTERM'); } catch {}
    setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 3_000);
  };
  res.on('close', onClose);

  child.stdout.on('data', (buf) => {
    const s = buf.toString('utf8');
    stdoutAccum += s;
    sseWrite(res, { type: 'stdout', data: s });
    // try to surface any image path the moment it appears in the answer
    flushArtifactsFromText(s);
  });
  child.stderr.on('data', (buf) => {
    sseWrite(res, { type: 'stderr', data: buf.toString('utf8') });
  });
  child.on('error', (err) => {
    sseWrite(res, { type: 'error', message: String(err?.message || err) });
  });
  child.on('close', (code, signal) => {
    clearTimeout(timer);
    clearInterval(pollTimer);
    pollSession();                          // final session.json flush
    flushArtifactsFromText(stdoutAccum);    // belt-and-braces — scan whole stdout
    // Disk fallback: catches files the agent created but mentioned at a wrong
    // path (snap confinement maps /tmp/x to /tmp/snap-private-tmp/.../x).
    try {
      const fresh = scanRecentImages(startedAt, FILE_ALLOWED_ROOTS, seenArtifacts);
      for (const a of fresh) sseWrite(res, { type: 'artifact', kind: 'image', ...a });
    } catch { /* non-fatal */ }
    sseWrite(res, {
      type: 'done',
      code,
      signal,
      killedByClient,
      killedByTimeout,
      sessionFile: sessionFile ? path.basename(sessionFile) : null,
      at: Date.now(),
    });
    res.end();
  });
});

app.use((req, res) => {
  res.status(404).json({ error: { message: 'Not found' } });
});

app.listen(config.port, config.host, () => {
  console.log(`Kimi proxy listening on http://${config.host}:${config.port}`);
  console.log(`Agent mode: ${config.hermesBin} (timeout ${config.agentTimeoutMs} ms)`);
  // 8-second grace so Caddy / network settles before we fire follow-ups
  setTimeout(() => {
    try { drainPendingFollowups(); }
    catch (e) { console.warn('[orchestration] drain failed:', e?.message || e); }
  }, 8_000);
  try {
    let tgToken = process.env.TELEGRAM_BOT_TOKEN || '';
    if (!tgToken) { try { tgToken = fs.readFileSync('/opt/kimi-mcp-proxy/.tg_token', 'utf8').trim(); } catch {} }
    if (tgToken) startTelegramBot({ token: tgToken });
  } catch (e) { console.warn('[tg] start failed:', e?.message || e); }
});
