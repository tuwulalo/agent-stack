/**
 * Per-chat persistent memory: each chat has a folder under CHATS_ROOT with
 * a small set of markdown files. The proxy reads them on every /auto/run
 * call to inject context, and after every response asks Kimi to update
 * them ("digest"). User can also edit them directly via the UI.
 */
import fs from 'node:fs';
import path from 'node:path';
import { callKimiChatCompletion } from './kimi-client.js';
import { config } from './config.js';

const CHATS_ROOT = process.env.CHATS_DIR || '/opt/kimi-chats';
try { fs.mkdirSync(CHATS_ROOT, { recursive: true }); } catch { /* ignore */ }

const SAFE_ID = /^[a-zA-Z0-9_\-]{3,64}$/;
const SAFE_FILENAME = /^[a-zA-Z0-9_\-]{1,80}\.md$/;
export const SYSTEM_FILES = ['facts.md', 'decisions.md', 'summary.md'];
const SYSTEM_TITLES = {
  'facts.md':     'Chat facts',
  'decisions.md': 'Decisions made',
  'summary.md':   'Summary',
};

const NOTE_BODY_MAX = 200_000;     // 200 KB per file
const PROMPT_TRUNC_USER       =  4_000;
const PROMPT_TRUNC_ASSISTANT  =  6_000;

export function isValidChatId(id) {
  return typeof id === 'string' && SAFE_ID.test(id);
}

export function isValidFilename(name) {
  return typeof name === 'string' && SAFE_FILENAME.test(name);
}

function chatDir(chatId) {
  return path.join(CHATS_ROOT, chatId);
}

export function ensureChatDir(chatId) {
  if (!isValidChatId(chatId)) return null;
  const dir = chatDir(chatId);
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return dir;
}

export function listNotes(chatId) {
  if (!isValidChatId(chatId)) return [];
  const dir = chatDir(chatId);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (!isValidFilename(name)) continue;
    try {
      const st = fs.statSync(path.join(dir, name));
      let preview = '';
      try {
        const buf = fs.readFileSync(path.join(dir, name), 'utf-8');
        preview = buf.slice(0, 240).replace(/\s+/g, ' ').trim();
      } catch { /* ignore */ }
      out.push({
        name,
        size: st.size,
        mtime: st.mtimeMs,
        preview,
        isSystem: SYSTEM_FILES.includes(name),
      });
    } catch { /* ignore */ }
  }
  // System files first (in defined order), then alphabetical for the rest.
  return out.sort((a, b) => {
    const ai = SYSTEM_FILES.indexOf(a.name);
    const bi = SYSTEM_FILES.indexOf(b.name);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.name.localeCompare(b.name);
  });
}

export function readNote(chatId, name) {
  if (!isValidChatId(chatId) || !isValidFilename(name)) return null;
  const p = path.join(chatDir(chatId), name);
  if (!fs.existsSync(p)) return null;
  try { return fs.readFileSync(p, 'utf-8'); } catch { return null; }
}

export function writeNote(chatId, name, content) {
  if (!isValidChatId(chatId) || !isValidFilename(name)) return false;
  if (typeof content !== 'string' || content.length > NOTE_BODY_MAX) return false;
  ensureChatDir(chatId);
  try {
    fs.writeFileSync(path.join(chatDir(chatId), name), content, 'utf-8');
    return true;
  } catch { return false; }
}

export function deleteNote(chatId, name) {
  if (!isValidChatId(chatId) || !isValidFilename(name)) return false;
  if (SYSTEM_FILES.includes(name)) return false;     // system files can't be deleted
  const p = path.join(chatDir(chatId), name);
  if (!fs.existsSync(p)) return false;
  try { fs.unlinkSync(p); return true; } catch { return false; }
}

/**
 * Build a `<CHAT_MEMORY>...</CHAT_MEMORY>` block to inject into the system
 * prompt. Reads system files + first 5 user-created notes.
 */
export function buildMemoryBlock(chatId) {
  if (!isValidChatId(chatId)) return '';
  const dir = chatDir(chatId);
  if (!fs.existsSync(dir)) return '';

  const parts = [];

  for (const sys of SYSTEM_FILES) {
    const buf = readNote(chatId, sys);
    if (buf && buf.trim()) {
      parts.push(`## ${SYSTEM_TITLES[sys]}\n${buf.trim()}`);
    }
  }

  const others = listNotes(chatId).filter((n) => !n.isSystem).slice(0, 5);
  for (const n of others) {
    const buf = readNote(chatId, n.name);
    if (buf && buf.trim()) {
      const title = n.name.replace(/\.md$/, '').replace(/[_-]+/g, ' ');
      parts.push(`## ${title}\n${buf.trim()}`);
    }
  }

  if (parts.length === 0) return '';

  return [
    '<CHAT_MEMORY>',
    'This is your long-term memory for this specific chat. Use it to avoid',
    'asking the same questions again and to stay in the context of decisions',
    'made earlier. Do not quote the block verbatim — just take its contents into account.',
    '',
    ...parts,
    '</CHAT_MEMORY>',
  ].join('\n');
}

const DIGEST_SYSTEM = `You are an internal module maintaining the chat's long-term memory.
You are given:
  - the current contents of three MD files (facts.md / decisions.md / summary.md),
  - the latest exchange pair (user → assistant).

Return STRICTLY a JSON object of the following shape and nothing else:

{
  "facts_md":     "<new full contents of facts.md>",
  "decisions_md": "<new full contents of decisions.md>",
  "summary_md":   "<new full contents of summary.md>"
}

Rules:
- Each file is markdown with a "- …" list (bullets, one line per item).
- facts.md: stable facts about the user / project / environment / names / stack.
- decisions.md: concrete decisions, conclusions, agreements, accepted architectural choices.
- summary.md: ≤ 250 words, a brief overview of what this chat is about and where it is heading.
- Do NOT invent anything. Add only what directly follows from the exchange.
- Do not duplicate items — update existing ones, remove outdated ones.
- If there is nothing new on a topic — return the previous contents unchanged.
- Write nothing outside the JSON, no \`\`\`json…\`\`\` wrappers, no comments.`;

/** Strip ```json…``` fences if model wrapped the JSON despite instructions. */
function stripCodeFence(s) {
  return s
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

/**
 * Ask Kimi to update facts/decisions/summary based on the latest exchange.
 * Fire-and-forget — errors are logged but never thrown.
 */
export async function digestChat(chatId, userMessage, assistantMessage) {
  if (!isValidChatId(chatId)) return;
  if (!userMessage || !assistantMessage) return;
  ensureChatDir(chatId);

  const facts     = readNote(chatId, 'facts.md')     || '';
  const decisions = readNote(chatId, 'decisions.md') || '';
  const summary   = readNote(chatId, 'summary.md')   || '';

  const userContent =
    `# Current memory state\n\n` +
    `## facts.md\n${facts || '(empty)'}\n\n` +
    `## decisions.md\n${decisions || '(empty)'}\n\n` +
    `## summary.md\n${summary || '(empty)'}\n\n` +
    `# Latest exchange\n\n` +
    `## User:\n${String(userMessage).slice(0, PROMPT_TRUNC_USER)}\n\n` +
    `## Assistant:\n${String(assistantMessage).slice(0, PROMPT_TRUNC_ASSISTANT)}\n\n` +
    `Return JSON following the schema from the system prompt.`;

  try {
    const resp = await callKimiChatCompletion({
      model: config.kimiModel,
      stream: false,
      temperature: 0.2,
      max_tokens: 2500,
      reasoning_effort: 'low',
      messages: [
        { role: 'system', content: DIGEST_SYSTEM },
        { role: 'user',   content: userContent  },
      ],
    });

    const raw = resp?.choices?.[0]?.message?.content;
    if (typeof raw !== 'string') return;
    const cleaned = stripCodeFence(raw);
    const j = JSON.parse(cleaned);

    if (typeof j.facts_md     === 'string') writeNote(chatId, 'facts.md',     j.facts_md.trim()     + '\n');
    if (typeof j.decisions_md === 'string') writeNote(chatId, 'decisions.md', j.decisions_md.trim() + '\n');
    if (typeof j.summary_md   === 'string') writeNote(chatId, 'summary.md',   j.summary_md.trim()   + '\n');
  } catch (e) {
    console.warn('[chat-store] digest failed for', chatId, e?.message || e);
  }
}
