#!/usr/bin/env node
/**
 * agent-stack — десктопный CLI для self-hosted agent-stack.
 *
 *   agent-stack login [--server https://your-domain.tld]
 *       Авторизуется через OAuth Device Flow на VPS.
 *       Сохраняет токен в ~/.config/agent-stack/token.json.
 *
 *   agent-stack whoami
 *       Показывает текущий сервер и токен (без секрета).
 *
 *   agent-stack logout
 *       Удаляет локальный токен.
 *
 *   agent-stack curl <path> [...args]
 *       curl-обёртка, подставляет Authorization из конфига.
 *       Пример: agent-stack curl /v1/models
 *
 *   agent-stack env
 *       Печатает export OPENAI_API_KEY=... OPENAI_BASE_URL=...
 *       Eval'ишь в шелле — IDE/SDK сразу видят твой сервер как OpenAI-совместимый.
 *       Пример:   eval "$(agent-stack env)"
 *
 * Зависимостей нет — чистый Node 18+ с встроенным fetch.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { spawn } from 'node:child_process';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'agent-stack');
const CONFIG_FILE = path.join(CONFIG_DIR, 'token.json');

function ensureDir() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveConfig(obj) {
  ensureDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(obj, null, 2), { mode: 0o600 });
  try { fs.chmodSync(CONFIG_FILE, 0o600); } catch {}
}

function parseArgs(argv) {
  const out = { _: [], opts: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out.opts[k] = v;
    } else {
      out._.push(a);
    }
  }
  return out;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function readLine(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, (ans) => { rl.close(); resolve(ans.trim()); }));
}

function deviceUrlBase(server) {
  // server указывает на корень UI. Прокси висит за /_kp/ (Caddy snippet).
  // Если юзер указал прямой адрес прокси — поддерживаем и его.
  const trimmed = server.replace(/\/$/, '');
  if (trimmed.endsWith('/_kp')) return trimmed;
  // По умолчанию ходим через /_kp/.
  return `${trimmed}/_kp`;
}

async function cmdLogin(opts) {
  const server = (opts.server || process.env.AGENT_STACK_SERVER || '').trim();
  if (!server) {
    console.error('Укажи сервер: agent-stack login --server https://your-domain.tld');
    process.exit(1);
  }
  const base = deviceUrlBase(server);
  const deviceName = opts.name || `${os.hostname()} / ${os.userInfo().username}`;

  process.stdout.write('→ запрашиваю device code… ');
  const r = await fetch(`${base}/v1/auth/device`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceName }),
  });
  if (!r.ok) {
    console.error(`\n✗ HTTP ${r.status}: ${await r.text()}`);
    process.exit(1);
  }
  const d = await r.json();
  console.log('OK');

  console.log('');
  console.log('  ┌────────────────────────────────────────────────┐');
  console.log(`  │  Код:    \x1b[1;38;5;213m${d.user_code}\x1b[0m`.padEnd(64) + '│');
  console.log(`  │  URL:    \x1b[36m${d.verification_uri}\x1b[0m`.padEnd(64) + '│');
  console.log('  └────────────────────────────────────────────────┘');
  console.log('');
  console.log(`Открой URL в браузере, залогинься (GitHub/Google/пароль)`);
  console.log(`и введи код. Ждём подтверждения…`);
  console.log('');

  const interval = (d.interval || 5) * 1000;
  const deadline = Date.now() + (d.expires_in || 900) * 1000;
  while (Date.now() < deadline) {
    await sleep(interval);
    const p = await fetch(`${base}/v1/auth/device/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: d.device_code }),
    });
    if (p.ok) {
      const tok = await p.json();
      saveConfig({
        server,
        proxyBase: base,
        accessToken: tok.access_token,
        tokenType: tok.token_type || 'Bearer',
        expiresAt: Date.now() + (tok.expires_in || 0) * 1000,
        device: deviceName,
        savedAt: new Date().toISOString(),
      });
      console.log(`\x1b[32m✓ Залогинен. Токен сохранён в ${CONFIG_FILE}\x1b[0m`);
      console.log(`  device: ${deviceName}`);
      console.log(`  exp:    ${new Date(Date.now() + (tok.expires_in || 0) * 1000).toISOString()}`);
      return;
    }
    const err = await p.json().catch(() => ({}));
    if (err.error === 'authorization_pending' || err.error === 'slow_down') {
      process.stdout.write('.');
      continue;
    }
    if (err.error === 'access_denied') {
      console.error('\n✗ Отказано');
      process.exit(1);
    }
    if (err.error === 'expired_token') {
      console.error('\n✗ Код истёк, запусти login заново');
      process.exit(1);
    }
    console.error(`\n✗ Неожиданный ответ: ${JSON.stringify(err)}`);
    process.exit(1);
  }
  console.error('\n✗ Таймаут ожидания подтверждения');
  process.exit(1);
}

function cmdWhoami() {
  const c = loadConfig();
  if (!c) {
    console.log('Не залогинен. Запусти: agent-stack login --server https://...');
    return;
  }
  const masked = c.accessToken.slice(0, 12) + '…' + c.accessToken.slice(-6);
  console.log(`server:  ${c.server}`);
  console.log(`device:  ${c.device}`);
  console.log(`token:   ${masked}`);
  console.log(`expires: ${c.expiresAt ? new Date(c.expiresAt).toISOString() : 'never'}`);
}

function cmdLogout() {
  if (fs.existsSync(CONFIG_FILE)) fs.unlinkSync(CONFIG_FILE);
  console.log('Токен удалён.');
}

async function cmdCurl(args) {
  const c = loadConfig();
  if (!c) { console.error('Не залогинен'); process.exit(1); }
  const [pathArg, ...rest] = args;
  if (!pathArg) { console.error('agent-stack curl <path> [...curl-args]'); process.exit(1); }
  const url = pathArg.startsWith('http') ? pathArg : `${c.proxyBase}${pathArg}`;
  const curlArgs = ['-sS', '-H', `Authorization: Bearer ${c.accessToken}`, ...rest, url];
  const p = spawn('curl', curlArgs, { stdio: 'inherit' });
  p.on('exit', (code) => process.exit(code || 0));
}

function cmdEnv() {
  const c = loadConfig();
  if (!c) { console.error('# Не залогинен. Сначала: agent-stack login --server ...'); process.exit(1); }
  console.log(`export OPENAI_BASE_URL="${c.proxyBase}/v1"`);
  console.log(`export OPENAI_API_KEY="${c.accessToken}"`);
  console.log(`# Использование:  eval "$(agent-stack env)"`);
}

function help() {
  console.log(`agent-stack — CLI для self-hosted agent-stack

Команды:
  login --server <url>     войти через OAuth Device Flow
  whoami                   показать текущий аккаунт и сервер
  logout                   удалить локальный токен
  curl <path> [args...]    curl-обёртка с подставленным Bearer
  env                      печатает export OPENAI_BASE_URL/OPENAI_API_KEY

Конфиг хранится в:  ${CONFIG_FILE}
`);
}

const { _, opts } = parseArgs(process.argv.slice(2));
const cmd = _[0];

try {
  if (cmd === 'login') await cmdLogin(opts);
  else if (cmd === 'whoami') cmdWhoami();
  else if (cmd === 'logout') cmdLogout();
  else if (cmd === 'curl') await cmdCurl(_.slice(1));
  else if (cmd === 'env') cmdEnv();
  else help();
} catch (e) {
  console.error('Ошибка:', e.message || e);
  process.exit(1);
}
