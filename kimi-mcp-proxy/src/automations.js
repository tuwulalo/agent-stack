/**
 * Automations: cron-scheduled tasks + persistent run history.
 *
 *   schedules.json  →  array of {id, name, cron, agent: 'hermes'|'shell',
 *                      task, enabled, createdAt, lastFireAt, lastFireOk}
 *   runs.jsonl      →  one JSON-line per run (newest at end). Capped at MAX_RUNS.
 *
 * On import the store loads schedules and starts cron tasks for all enabled
 * ones. Edits stop/restart the underlying cron.ScheduledTask in-place.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import cron from 'node-cron';
import { PUBLISH_HINT } from './prompts.js';

const STORE_DIR = process.env.AUTOMATIONS_DIR || '/opt/kimi-mcp-proxy';
const SCHED_FILE = path.join(STORE_DIR, 'automations-schedules.json');
const RUNS_FILE  = path.join(STORE_DIR, 'automations-runs.jsonl');
const MAX_RUNS = 500;
const MAX_OUTPUT_BYTES = 32_000;
const RUN_TIMEOUT_MS = Number(process.env.AUTOMATION_TIMEOUT_MS || 600_000);

const HERMES_BIN = process.env.HERMES_BIN || '/opt/hermes-agent/venv/bin/hermes';
const HERMES_CWD = process.env.HERMES_CWD || '/root';
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const CLAUDE_CWD = process.env.CLAUDE_CWD || '/root';

const VALID_AGENT = new Set(['hermes', 'shell', 'claude']);

let schedules = [];
const active = new Map();           // scheduleId -> cron.ScheduledTask

// ──────────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────────

function newId(prefix) {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
}

function clip(s, max = MAX_OUTPUT_BYTES) {
  s = String(s ?? '');
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n…(+${s.length - max} bytes truncated)`;
}

function loadSchedules() {
  try {
    if (fs.existsSync(SCHED_FILE)) {
      const raw = fs.readFileSync(SCHED_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) schedules = parsed.filter(isPersistedShape);
    }
  } catch (e) {
    console.warn('[automations] failed to load schedules:', e?.message || e);
    schedules = [];
  }
}

function isPersistedShape(s) {
  return s && typeof s.id === 'string' && typeof s.cron === 'string' && typeof s.task === 'string';
}

function saveSchedules() {
  try {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(SCHED_FILE, JSON.stringify(schedules, null, 2));
  } catch (e) {
    console.warn('[automations] failed to persist schedules:', e?.message || e);
  }
}

function appendRun(rec) {
  try {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.appendFileSync(RUNS_FILE, JSON.stringify(rec) + '\n');
    // Rotate every ~MAX_RUNS lines so the file doesn't grow unbounded
    const st = fs.statSync(RUNS_FILE);
    if (st.size > 8 * 1024 * 1024) {
      const lines = fs.readFileSync(RUNS_FILE, 'utf8').split('\n').filter(Boolean);
      const tail = lines.slice(-MAX_RUNS);
      fs.writeFileSync(RUNS_FILE, tail.join('\n') + '\n');
    }
  } catch (e) {
    console.warn('[automations] failed to append run:', e?.message || e);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// cron lifecycle
// ──────────────────────────────────────────────────────────────────────────

function startCronFor(s) {
  if (!cron.validate(s.cron)) {
    console.warn('[automations] invalid cron for', s.id, s.cron);
    return;
  }
  try {
    const task = cron.schedule(s.cron, () => {
      // fire asynchronously, never block the cron tick
      fireSchedule(s.id, 'cron').catch((e) =>
        console.warn('[automations] fire failed:', s.id, e?.message || e),
      );
    });
    active.set(s.id, task);
  } catch (e) {
    console.warn('[automations] cron.schedule failed:', s.id, e?.message || e);
  }
}

function stopCronFor(id) {
  const t = active.get(id);
  if (!t) return;
  try { t.stop(); } catch { /* ignore */ }
  active.delete(id);
}

// ──────────────────────────────────────────────────────────────────────────
// fire (run a schedule's command and persist a run record)
// ──────────────────────────────────────────────────────────────────────────

export async function fireSchedule(scheduleId, source = 'manual') {
  const s = schedules.find((x) => x.id === scheduleId);
  if (!s) throw new Error('schedule not found');
  return await runJob({
    scheduleId: s.id,
    name: s.name,
    agent: s.agent,
    task: s.task,
    source,
  });
}

/** Run an ad-hoc job (not tied to a schedule). */
export async function runAdhoc({ agent, task, name }) {
  if (!VALID_AGENT.has(agent)) throw new Error('invalid agent');
  return await runJob({ scheduleId: null, name: name || '(ad-hoc)', agent, task, source: 'adhoc' });
}

function runJob({ scheduleId, name, agent, task, source }) {
  return new Promise((resolve) => {
    const id = newId('r-');
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let exitCode = null;
    let killed = false;

    const finalize = () => {
      const endedAt = Date.now();
      const rec = {
        id,
        scheduleId,
        agent,
        name,
        task: task.length > 1200 ? task.slice(0, 1200) + ` …(+${task.length - 1200} chars)` : task,
        source,
        startedAt,
        endedAt,
        durationMs: endedAt - startedAt,
        exitCode,
        killed,
        stdout: clip(stdout),
        stderr: clip(stderr),
      };
      appendRun(rec);
      if (scheduleId) {
        const s = schedules.find((x) => x.id === scheduleId);
        if (s) {
          s.lastFireAt = endedAt;
          s.lastFireOk = exitCode === 0;
          saveSchedules();
        }
      }
      resolve(rec);
    };

    let child;
    try {
      if (agent === 'hermes') {
        child = spawn(HERMES_BIN, ['-z', task, '--yolo'], {
          cwd: HERMES_CWD,
          env: { ...process.env, HERMES_NO_INTERACTIVE: '1' },
        });
      } else if (agent === 'claude') {
        // Claude Code in -p mode with FULL bypass. PUBLISH_HINT teaches it
        // where to put HTML artifacts so they get a public URL.
        child = spawn(
          CLAUDE_BIN,
          [
            '-p', task,
            '--append-system-prompt', PUBLISH_HINT,
            '--output-format', 'text',
            '--dangerously-skip-permissions',
          ],
          {
            cwd: CLAUDE_CWD,
            env: { ...process.env, IS_SANDBOX: '1' },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
      } else {
        // 'shell' — run via bash -c
        child = spawn('/bin/bash', ['-c', task], { cwd: process.env.HOME || '/tmp' });
      }
    } catch (e) {
      stderr = `spawn failed: ${e?.message || e}`;
      exitCode = 127;
      finalize();
      return;
    }

    const timer = setTimeout(() => {
      killed = true;
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, 5_000).unref();
    }, RUN_TIMEOUT_MS);
    timer.unref();

    child.stdout.on('data', (b) => { stdout += b.toString('utf8'); });
    child.stderr.on('data', (b) => { stderr += b.toString('utf8'); });
    child.on('error', (e) => {
      stderr += `\nspawn error: ${e?.message || e}`;
    });
    child.on('close', (code, sig) => {
      clearTimeout(timer);
      exitCode = code;
      if (killed && code === null) exitCode = -1;
      if (sig && exitCode === null) exitCode = -1;
      finalize();
    });
  });
}

// ──────────────────────────────────────────────────────────────────────────
// public API
// ──────────────────────────────────────────────────────────────────────────

export function listSchedules() {
  return schedules.map((s) => ({ ...s }));
}

export function getSchedule(id) {
  return schedules.find((s) => s.id === id) || null;
}

export function createSchedule(input) {
  const s = {
    id: newId('s-'),
    name: String(input?.name || 'Untitled').slice(0, 200).trim() || 'Untitled',
    cron: String(input?.cron || '0 9 * * *').trim(),
    agent: VALID_AGENT.has(input?.agent) ? input.agent : 'hermes',
    task: String(input?.task || '').slice(0, 8000),
    enabled: input?.enabled !== false,
    createdAt: Date.now(),
    lastFireAt: null,
    lastFireOk: null,
  };
  if (!s.task.trim()) throw new Error('task is required');
  if (!cron.validate(s.cron)) throw new Error('invalid cron expression');
  schedules.push(s);
  saveSchedules();
  if (s.enabled) startCronFor(s);
  return s;
}

export function updateSchedule(id, patch) {
  const idx = schedules.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  const cur = schedules[idx];
  const next = { ...cur };
  if (typeof patch?.name === 'string')    next.name    = patch.name.slice(0, 200);
  if (typeof patch?.cron === 'string') {
    if (!cron.validate(patch.cron)) throw new Error('invalid cron expression');
    next.cron = patch.cron;
  }
  if (typeof patch?.agent === 'string' && VALID_AGENT.has(patch.agent)) next.agent = patch.agent;
  if (typeof patch?.task === 'string')    next.task    = patch.task.slice(0, 8000);
  if (typeof patch?.enabled === 'boolean')next.enabled = patch.enabled;
  schedules[idx] = next;
  saveSchedules();
  stopCronFor(id);
  if (next.enabled) startCronFor(next);
  return next;
}

export function deleteSchedule(id) {
  stopCronFor(id);
  const before = schedules.length;
  schedules = schedules.filter((s) => s.id !== id);
  if (schedules.length === before) return false;
  saveSchedules();
  return true;
}

export function listRuns(limit = 50, scheduleId = null) {
  if (!fs.existsSync(RUNS_FILE)) return [];
  let lines;
  try { lines = fs.readFileSync(RUNS_FILE, 'utf8').split('\n').filter(Boolean); }
  catch { return []; }
  const out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    try {
      const j = JSON.parse(lines[i]);
      if (scheduleId && j.scheduleId !== scheduleId) continue;
      out.push(j);
    } catch { /* skip malformed */ }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// boot
// ──────────────────────────────────────────────────────────────────────────

loadSchedules();
for (const s of schedules) if (s.enabled) startCronFor(s);
console.log(`[automations] loaded ${schedules.length} schedule(s), ${active.size} active cron(s)`);
