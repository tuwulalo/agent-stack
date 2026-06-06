'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, Calendar, Check, ChevronRight, Cog, Cpu, Link2, Loader2, LogOut, Network, Pause, Pencil,
  Play, Plug, Send, Sparkles, Square, Terminal, Trash2, Zap,
} from 'lucide-react'
import { runAutomation, type AutomationLine, type AskUserPayload } from '../lib/automation'
import { AskUserBlock } from '../components/AskUserBlock'
import { JsonOrText } from '../components/JsonView'
import { AutomationsSchedules } from '../components/AutomationsSchedules'
import { AutomationsMcps } from '../components/AutomationsMcps'
import { TelegramTab } from '../components/TelegramTab'
import { AgentGraph } from '../components/AgentGraph'
import { Mascot, guessMascot, ROSTER_IDENTITY, type MascotId } from '../components/Mascot'
import { TweaksPanel } from '../components/TweaksPanel'
import { agentFileUrl, KIMI_API } from '../lib/config'
import { ImageLightbox, type LightboxImage } from '../components/ImageLightbox'
import {
  type AgentSession,
  deleteAgentSession,
  formatRel as formatSessionRel,
  getSessionHistory,
  listAgentSessions,
  renameAgentSession,
  setSessionFeedback,
  judgeSession,
} from '../lib/agent-sessions'
import {
  type AttachedFile,
  fileToAttachment,
  uploadAttachments,
} from '../lib/attachments'

type Tab = 'run' | 'schedule' | 'mcp' | 'telegram'

type AgentId = 'hermes' | 'claude' | 'shell'

interface AgentDef {
  id: AgentId
  name: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  badge?: string
  disabled?: boolean
}

const AGENTS: AgentDef[] = [
  {
    id: 'hermes',
    name: 'Hermes Agent',
    description: 'hermes -z "…" --yolo · Kimi for Coding · все MCP подключены',
    icon: Sparkles,
    badge: 'готов',
  },
  {
    id: 'claude',
    name: 'Claude Code',
    description: 'claude -p · Anthropic Max-подписка · все встроенные tools (Read/Edit/Bash/...)',
    icon: Cpu,
    badge: 'готов',
  },
  {
    id: 'shell',
    name: 'Shell',
    description: 'bash -c "<command>" · быстрые системные команды без LLM',
    icon: Terminal,
    badge: 'готов',
  },
]

interface Scenario {
  id: string
  title: string
  prompt: string
  agent?: AgentId
  createdAt: number
}
const SCENARIOS_LS_KEY = 'hk:automations:scenarios:v1'
const AUTONOMY_LEVELS: Array<{ id: 'L1' | 'L2' | 'L3' | 'L4'; label: string; directive: string }> = [
  { id: 'L1', label: 'L1·ассист', directive: 'Режим автономии L1 (ассистент): работай пошагово, СНАЧАЛА покажи короткий план и спрашивай подтверждение через [[ASK_USER]] перед каждым значимым/необратимым действием.' },
  { id: 'L2', label: 'L2·копилот', directive: 'Режим автономии L2 (копилот): рутину делай сам, но спрашивай подтверждение через [[ASK_USER]] на рискованных или необратимых шагах.' },
  { id: 'L3', label: 'L3·автопилот', directive: 'Режим автономии L3 (автопилот): действуй автономно, спрашивай только при реальной неоднозначности ТЗ.' },
  { id: 'L4', label: 'L4·полная', directive: 'Режим автономии L4 (полная автономия): вопросов не задавай, прими все решения сам и доведи задачу до результата.' },
]
const STATE_LS_KEY    = 'hk:automations:state:v1'

// Hard caps so localStorage stays under quota
const PERSIST_MAX_RUNS  = 12
const PERSIST_MAX_LINES = 300

function loadScenarios(): Scenario[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(SCENARIOS_LS_KEY)
    if (!raw) return []
    const j = JSON.parse(raw)
    return Array.isArray(j) ? j.filter((x) => x?.id && x?.prompt) : []
  } catch { return [] }
}
function saveScenarios(list: Scenario[]) {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(SCENARIOS_LS_KEY, JSON.stringify(list)) } catch { /* ignore */ }
}

interface RunRecord {
  id: string
  agent: AgentId
  task: string
  lines: AutomationLine[]
  startedAt: number
  status: 'running' | 'done' | 'failed' | 'stopped'
  exitCode?: number | null
  durationMs?: number
  /** Server-issued session id this run is tied to (Claude only) */
  sessionId?: string | null
}

const MAX_LINES_PER_RUN = 600

function newRunId(): string {
  return 'r-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3)
}

/** Walk forward from `text[startBrace]` (must be '{') and return index of
    matching '}' (inclusive), or -1. Respects strings + escapes. */
function findMatchingCloseBrace(text: string, startBrace: number): number {
  if (text[startBrace] !== '{') return -1
  let depth = 0
  let inStr: string | null = null
  let esc = false
  for (let i = startBrace; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === inStr) inStr = null
    } else {
      if (ch === '"' || ch === "'") inStr = ch
      else if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) return i
      }
    }
  }
  return -1
}

/** Find all matches of AskUser payload in a text. Returns [{start, end, jsonText}].
    Supports THREE formats:
      1) [[ASK_USER]]...[[/ASK_USER]]              — explicit marker (preferred)
      2) AskUserQuestion({...})                    — function-call mimicry
      3) bare {..."questions":[...]...}            — raw JSON object literal
    Mode #3 uses brace-balancing — handles JSON anywhere in stdout text. */
function findAskUserMatches(text: string): Array<{ start: number; end: number; jsonText: string }> {
  const out: Array<{ start: number; end: number; jsonText: string }> = []

  // 1) Explicit markers
  const re1 = /\[\[ASK_USER\]\]([\s\S]*?)\[\[\/ASK_USER\]\]/g
  let m: RegExpExecArray | null
  while ((m = re1.exec(text)) !== null) {
    out.push({ start: m.index, end: m.index + m[0].length, jsonText: m[1].trim() })
  }

  // 2) AskUserQuestion(...) — balanced parens
  const callRe = /AskUserQuestion\s*\(/g
  while ((m = callRe.exec(text)) !== null) {
    let i = m.index + m[0].length
    let depth = 1
    let inStr: string | null = null
    let esc = false
    while (i < text.length && depth > 0) {
      const ch = text[i]
      if (inStr) {
        if (esc) esc = false
        else if (ch === '\\') esc = true
        else if (ch === inStr) inStr = null
      } else {
        if (ch === '"' || ch === "'") inStr = ch
        else if (ch === '(') depth++
        else if (ch === ')') depth--
      }
      i++
    }
    if (depth === 0) {
      out.push({ start: m.index, end: i, jsonText: text.slice(m.index + m[0].length, i - 1).trim() })
    }
  }

  // 3) Bare {..."questions":[...]...}
  // Look for every "questions" occurrence, find the enclosing '{...}' object.
  let qIdx = -1
  while ((qIdx = text.indexOf('"questions"', qIdx + 1)) !== -1) {
    // Walk backward (skipping strings) to find the OUTERMOST '{' that encloses it
    let candidateOpen = -1
    {
      let depth = 0          // brace depth from our position going backward
      let i = qIdx
      while (i >= 0) {
        const ch = text[i]
        if (ch === '}') depth++
        else if (ch === '{') {
          if (depth === 0) { candidateOpen = i; break }
          depth--
        }
        i--
      }
    }
    if (candidateOpen < 0) continue
    const closeIdx = findMatchingCloseBrace(text, candidateOpen)
    if (closeIdx < 0) continue
    out.push({ start: candidateOpen, end: closeIdx + 1, jsonText: text.slice(candidateOpen, closeIdx + 1) })
    // Skip ahead past this match to avoid re-detecting same object
    qIdx = closeIdx
  }

  // Dedupe overlaps — keep earliest, drop nested/duplicate hits
  out.sort((a, b) => a.start - b.start)
  const dedupe: typeof out = []
  for (const m of out) {
    if (dedupe.some((d) => m.start < d.end && m.end > d.start)) continue
    dedupe.push(m)
  }
  return dedupe
}

/** Try to parse JSON text as AskUserPayload. */
function parseAskUserPayload(jsonText: string): AskUserPayload | null {
  try {
    const j = JSON.parse(jsonText)
    if (j && Array.isArray(j.questions) && j.questions.length > 0
        && j.questions.every((q: any) => q?.question && Array.isArray(q?.options) && q.options.length > 0)) {
      return j as AskUserPayload
    }
  } catch { /* ignore */ }
  return null
}

/** Extract any AskUser blocks from stdout text — returns mixed array. */
function extractAskUserBlocks(text: string): AutomationLine[] {
  const matches = findAskUserMatches(text)
  if (matches.length === 0) return [{ kind: 'stdout', text }]
  const out: AutomationLine[] = []
  let cursor = 0
  for (const m of matches) {
    const before = text.slice(cursor, m.start)
    if (before.length > 0) out.push({ kind: 'stdout', text: before })
    const payload = parseAskUserPayload(m.jsonText)
    if (payload) {
      out.push({ kind: 'ask_user', payload })
    } else {
      // keep the original marker text as stdout (malformed JSON)
      out.push({ kind: 'stdout', text: text.slice(m.start, m.end) })
    }
    cursor = m.end
  }
  const tail = text.slice(cursor)
  if (tail.length > 0) out.push({ kind: 'stdout', text: tail })
  return out
}

/** Walk an array of lines and split any stdout-like lines that contain
    AskUser markers. Used when bulk-loading history or hydrating from LS. */
function applyAskUserExtraction(lines: AutomationLine[]): AutomationLine[] {
  const out: AutomationLine[] = []
  for (const l of lines) {
    // Consider all text-bearing line kinds where a question MIGHT appear,
    // INCLUDING tool_call steps (Claude's built-in AskUserQuestion tool
    // renders here as `step.meta='tool'` with text `AskUserQuestion({...})`).
    const text = (
      l.kind === 'stdout' || l.kind === 'meta' || l.kind === 'prompt'
      || (l.kind === 'step' && (l.meta === 'result' || l.meta === 'note' || l.meta === 'tool'))
    )
      ? (l as any).text as string
      : null
    // Quick filter — only attempt if the text contains tell-tale substrings
    if (typeof text === 'string'
        && (text.includes('[[ASK_USER]]')
            || text.includes('AskUserQuestion')
            || text.includes('"questions"'))) {
      const split = extractAskUserBlocks(text)
      if (split.some((s) => s.kind === 'ask_user')) {
        // For 'prompt' kind, we still want the user's original prompt visible.
        // Wrap into a stub: emit the prompt as-is THEN emit the ask_user lines.
        // For 'stdout'/'meta'/'step' — the split already represents the same text.
        if (l.kind === 'prompt') {
          out.push(l)
          out.push(...split.filter((s) => s.kind === 'ask_user'))
        } else {
          out.push(...split)
        }
        continue
      }
    }
    out.push(l)
  }
  return out
}

export default function AutomationsPage() {
  const [tab, setTab] = useState<Tab>('run')
  const [agent, setAgent] = useState<AgentId>('claude')
  const [agentPickerOpen, setAgentPickerOpen] = useState(false)
  const [task, setTask] = useState('')
  const [autonomy, setAutonomy] = useState<'L1' | 'L2' | 'L3' | 'L4'>('L3')
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [editScenario, setEditScenario] = useState<Scenario | null>(null)
  const agentPickerRef = useRef<HTMLDivElement>(null)

  /** Becomes true after we hydrate from localStorage. Using STATE (not ref)
      so the persist effect re-runs once the hydrated values land in the
      same render — otherwise effect 2 sees stale `runs=[]` from initial
      render's closure and would overwrite saved state with empties. */
  const [hydrated, setHydrated] = useState(false)

  // ── All useState/useRef declarations FIRST (TDZ-safe order) ────────────
  const [runs, setRuns] = useState<RunRecord[]>([])
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<LightboxImage | null>(null)
  /** Claude session to resume on next run (null = fresh session). */
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<AgentSession[]>([])
  /** Pasted/dropped images attached to the next task submission */
  const [attachments, setAttachments] = useState<AttachedFile[]>([])
  /** Graph modal — shows only the current session's tree */
  const [graphOpen, setGraphOpen] = useState(false)
  /** Brief "✓ скопировано" flash on the link-copy button */
  const [copiedLink, setCopiedLink] = useState(false)
  /** Свернутые группы сессий по маскотам — Set<MascotId>. Дефолт: всё
      свернуто кроме маскота с самой свежей сессией. Persist в LS. */
  const [collapsedMascots, setCollapsedMascots] = useState<Set<string>>(new Set())
  /** Scope сайдбара сессий: 'thisRun' (только активная сессия + её дерево)
      или 'all' (все 32). Дефолт: thisRun если активная сессия есть. */
  const [sidebarScope, setSidebarScope] = useState<'thisRun' | 'all'>('thisRun')
  const abortRef = useRef<AbortController | null>(null)
  const termRef = useRef<HTMLDivElement>(null)
  /** Session id queued for auto-finish (interrupted run we should resume). */
  const [pendingResume, setPendingResume] = useState<string | null>(null)
  /** Sessions we already auto-resumed this mount — never auto-fire twice. */
  const autoResumedRef = useRef<Set<string>>(new Set())

  // ── Hydrate scenarios + persisted run state on mount ───────────────────
  useEffect(() => {
    setScenarios(loadScenarios())
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem(STATE_LS_KEY) : null
      if (raw) {
        const s = JSON.parse(raw) as {
          runs?: RunRecord[]
          activeRunId?: string | null
          activeSessionId?: string | null
          agent?: AgentId
        }
        if (Array.isArray(s.runs) && s.runs.length > 0) {
          const restored = s.runs.slice(0, PERSIST_MAX_RUNS).map((r) =>
            r.status === 'running'
              ? {
                  ...r,
                  status: 'stopped' as const,
                  lines: [
                    ...r.lines,
                    { kind: 'meta' as const, text: '⏸ страница перезагружена — стрим прерван, тяну свежую историю…' },
                  ],
                }
              : r,
          )
          setRuns(restored)
          for (const r of restored) {
            if (r.sessionId && r.agent === 'claude') {
              getSessionHistory(r.sessionId)
                .then(({ lines, note }) => {
                  const processed = applyAskUserExtraction(lines as AutomationLine[])
                  // Honest footer: a missing/empty transcript must NOT look like
                  // a successful load. Surface the server `note` (e.g.
                  // "transcript file not found") instead of a fake "✓".
                  const footer: AutomationLine = note
                    ? { kind: 'meta', text: '⚠ ' + note }
                    : processed.length === 0
                      ? { kind: 'meta', text: '⚠ история пуста (транскрипт не найден)' }
                      : { kind: 'meta', text: '✓ история подтянута' }
                  setRuns((prev) => prev.map((x) =>
                    x.id === r.id
                      ? {
                          ...x,
                          lines: [...processed, footer],
                          status: 'done',
                          exitCode: 0,
                        }
                      : x,
                  ))
                })
                .catch(() => { /* leave the stopped banner — user can re-run */ })
            }
          }
        }
        if (s.activeRunId) setActiveRunId(s.activeRunId)
        if (s.activeSessionId) setActiveSessionId(s.activeSessionId)
        if (s.agent === 'claude' || s.agent === 'hermes' || s.agent === 'shell') {
          setAgent(s.agent)
        }
      }
    } catch { /* ignore corrupt state */ }
    setHydrated(true)
  }, [])

  // Persist state on any change (gated by hydrated state so we don't
  // overwrite saved data with empty defaults on the initial mount)
  useEffect(() => {
    if (!hydrated) return
    try {
      const trimmedRuns = runs.slice(0, PERSIST_MAX_RUNS).map((r) => ({
        ...r,
        lines: r.lines.length > PERSIST_MAX_LINES
          ? r.lines.slice(-PERSIST_MAX_LINES)
          : r.lines,
      }))
      localStorage.setItem(STATE_LS_KEY, JSON.stringify({
        runs: trimmedRuns,
        activeRunId,
        activeSessionId,
        agent,
      }))
    } catch { /* quota — ignore */ }
  }, [hydrated, runs, activeRunId, activeSessionId, agent])

  // Close agent dropdown on outside click
  useEffect(() => {
    if (!agentPickerOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!agentPickerRef.current?.contains(e.target as Node)) setAgentPickerOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [agentPickerOpen])

  const refreshSessions = useCallback(() => {
    listAgentSessions(50).then(setSessions).catch(() => {})
  }, [])

  useEffect(() => { void refreshSessions() }, [refreshSessions])

  // Hydrate + persist collapsed mascot groups
  const COLLAPSE_LS_KEY = 'kimi.automations.collapsedMascots.v1'
  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return
    try {
      const raw = localStorage.getItem(COLLAPSE_LS_KEY)
      if (raw) {
        const arr = JSON.parse(raw) as string[]
        if (Array.isArray(arr)) setCollapsedMascots(new Set(arr))
      } else {
        // Дефолт: всё свернуто. Маскот с самой свежей сессией развернётся
        // автоматом ниже после первого рендера (см. useEffect ниже).
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated])
  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return
    try { localStorage.setItem(COLLAPSE_LS_KEY, JSON.stringify([...collapsedMascots])) }
    catch { /* quota */ }
  }, [hydrated, collapsedMascots])

  /** Дерево активной сессии (root + все BFS-потомки). Используется когда
      sidebarScope='thisRun' — отфильтровать сайдбар до только этого run'а. */
  const activeRunTreeIds = useMemo(() => {
    if (!activeSessionId) return null
    // Найти root сессии — если активная сама root, она root. Иначе climb to root.
    const sessById = new Map(sessions.map((s) => [s.id, s]))
    let rootId = activeSessionId
    let safety = 10
    while (safety-- > 0) {
      const cur = sessById.get(rootId)
      if (!cur || !cur.parentSessionId) break
      rootId = cur.parentSessionId
    }
    // BFS down
    const ids = new Set<string>([rootId])
    let grew = true
    while (grew) {
      grew = false
      for (const s of sessions) {
        if (s.parentSessionId && ids.has(s.parentSessionId) && !ids.has(s.id)) {
          ids.add(s.id)
          grew = true
        }
      }
    }
    return ids
  }, [sessions, activeSessionId])

  // авто-переключение sidebarScope: если есть активная сессия → thisRun,
  // ИНАЧЕ оставляем что было (не сбрасываем на 'all' автоматом — иначе после
  // «+ Новая» опять выпадут все 32 сессии).
  useEffect(() => {
    if (activeSessionId) setSidebarScope('thisRun')
  }, [activeSessionId])

  /** Сгруппировать сессии по маскотам. С учётом sidebarScope:
      • 'thisRun' + activeRunTreeIds   → дерево активного run'а
      • 'thisRun' БЕЗ activeSession    → ПУСТО (свежая сессия не стартовала)
      • 'all'                          → все сессии (классика)
   */
  const { orchestratorGroups, workerGroups } = useMemo(() => {
    let scopedSessions: AgentSession[]
    if (sidebarScope === 'thisRun') {
      scopedSessions = activeRunTreeIds
        ? sessions.filter((s) => activeRunTreeIds.has(s.id))
        : [] // нет активной — пусто (юзер только что нажал «+ Новая»)
    } else {
      scopedSessions = sessions
    }
    const orchSessions = scopedSessions.filter((s) => !s.parentSessionId)
    const wrkSessions  = scopedSessions.filter((s) => !!s.parentSessionId)
    const groupByMascot = (list: AgentSession[]) => {
      const buckets = new Map<MascotId, AgentSession[]>()
      for (const m of ROSTER_IDENTITY) buckets.set(m.id, [])
      for (const s of list) {
        const m = guessMascot((s.name || '') + ' ' + (s.lastPrompt || ''))
        buckets.get(m)!.push(s)
      }
      return [...buckets.entries()]
        .map(([mid, ls]) => {
          ls.sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0))
          const latestUsed = ls[0]?.lastUsedAt || 0
          const hasLive = ls.some((s) => Date.now() - (s.lastUsedAt || 0) < 60_000 && s.turns > 0)
          return { mid, list: ls, latestUsed, hasLive }
        })
        .filter((g) => g.list.length > 0)
        .sort((a, b) => b.latestUsed - a.latestUsed)
    }
    return {
      orchestratorGroups: groupByMascot(orchSessions),
      workerGroups: groupByMascot(wrkSessions),
    }
  }, [sessions, sidebarScope, activeRunTreeIds])
  /** Объединённый список для авто-разворота самой свежей группы. */
  const sessionGroups = useMemo(() => [...orchestratorGroups, ...workerGroups], [orchestratorGroups, workerGroups])

  /** Авто-разворот самой свежей группы при первом рендере, если ничего
      не было в LS (т.е. дефолтное состояние). */
  useEffect(() => {
    if (!hydrated) return
    if (sessionGroups.length === 0) return
    if (collapsedMascots.size > 0) return // юзер уже что-то выбирал
    const expanded: Set<string> = new Set(ROSTER_IDENTITY.map((m) => m.id))
    expanded.delete(sessionGroups[0].mid) // самую свежую — развернуть
    setCollapsedMascots(expanded)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, sessionGroups.length])

  const toggleMascotGroup = useCallback((mid: MascotId) => {
    setCollapsedMascots((prev) => {
      const next = new Set(prev)
      if (next.has(mid)) next.delete(mid)
      else next.add(mid)
      return next
    })
  }, [])

  /** Pull a session's transcript from the server and drop it into the
      terminal as a synthetic, read-only "history" run. Reused by both the
      sidebar "↪ продолжить" button AND the deep-link `?session=<id>` URL
      handler. Returns the new run id (or null on failure). */
  const loadSessionAsRun = useCallback(async (sessionId: string): Promise<string | null> => {
    // A LIVE run for this session? Just focus it — never disturb a stream.
    const existing = runs.find((r) => r.sessionId === sessionId)
    if (existing && existing.status === 'running') {
      setActiveRunId(existing.id)
      setActiveSessionId(sessionId)
      setAgent('claude')
      return existing.id
    }
    // Fix #1: validate against the server. A stale browser-cached corpse must
    // never be shown — a 404 means the session was deleted/killed server-side.
    let data: Awaited<ReturnType<typeof getSessionHistory>>
    try {
      data = await getSessionHistory(sessionId)
    } catch (e: any) {
      const gone = /HTTP 404|not found/i.test(String(e?.message || e))
      const noticeId = existing?.id || newRunId()
      const meta = sessions.find((s) => s.id === sessionId)
      const notice: RunRecord = {
        id: noticeId,
        agent: 'claude',
        task: `📜 ${meta?.name || sessionId}`,
        lines: [{ kind: 'error', text: gone
          ? '⚠ Сессия прервана или удалена — её больше нет на сервере. Старое содержимое из кэша браузера очищено.'
          : 'не удалось загрузить сессию: ' + String(e?.message || e) }],
        startedAt: meta?.createdAt || Date.now(),
        status: 'failed',
        exitCode: null,
        durationMs: 0,
        sessionId,
      }
      setRuns((prev) => [notice, ...prev.filter((r) => r.id !== noticeId && r.sessionId !== sessionId)].slice(0, 20))
      setActiveRunId(noticeId)
      setActiveSessionId(sessionId)
      setAgent('claude')
      return noticeId
    }

    const { lines, note, session: sess, running } = data
    const id = existing?.id || newRunId()
    const meta = sessions.find((s) => s.id === sessionId) || sess
    const interrupted = sess?.lastClean === false && !running
    const histRec: RunRecord = {
      id,
      agent: 'claude',
      task: `📜 ${meta?.name || sessionId}`,
      lines: applyAskUserExtraction(lines as AutomationLine[]),
      startedAt: meta?.createdAt || Date.now(),
      status: interrupted ? 'stopped' : 'done',
      exitCode: interrupted ? null : 0,
      durationMs: meta ? Math.max(0, (meta.lastUsedAt || Date.now()) - (meta.createdAt || Date.now())) : 0,
      sessionId,
    }
    if (interrupted) histRec.lines.push({ kind: 'meta', text: '⚠ ответ был прерван — доделываю автоматически…' })
    if (note) histRec.lines.unshift({ kind: 'meta', text: '⚠ ' + note })
    // Replace any stale cached run for this session with server truth.
    setRuns((prev) => [histRec, ...prev.filter((r) => r.id !== id && r.sessionId !== sessionId)].slice(0, 20))
    setActiveRunId(id)
    setActiveSessionId(sessionId)
    setAgent('claude')
    // Fix #2: queue auto-finish for an interrupted orchestration that never
    // produced a clean final answer (kill/OOM/disconnect). Once per session.
    if (interrupted && !autoResumedRef.current.has(sessionId)) {
      setPendingResume(sessionId)
    }
    return id
  }, [runs, sessions])

  /** Deep-link: parse `?run=<id>&session=<sid>` on initial mount AFTER
      hydration so URL takes precedence over localStorage. If only session
      is present, load it as a synthetic history run. */
  useEffect(() => {
    if (!hydrated) return
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const urlRun = params.get('run')
    const urlSess = params.get('session')
    const urlPrefill = params.get('prefill')
    const urlMascot = params.get('mascot') // info-only — для будущего

    // Prefill (от /automations/squad → «позвать в автомат») — подставляем в
    // textarea и переключаемся на claude, чтобы юзер просто нажал «Запустить».
    if (urlPrefill) {
      try {
        const text = decodeURIComponent(urlPrefill)
        setTask(text)
        setAgent('claude')
        // не делаем new session, юзер сам решит и нажмёт запуск
        // убираем prefill из URL чтобы при F5 не пере-подставлять
        params.delete('prefill')
        params.delete('mascot')
        const qs = params.toString()
        window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''))
      } catch { /* invalid encoding — ignore */ }
    }

    if (urlRun) {
      // Existing in-memory run? Focus it.
      const exists = runs.find((r) => r.id === urlRun)
      if (exists) {
        setActiveRunId(urlRun)
        if (exists.sessionId) setActiveSessionId(exists.sessionId)
        return
      }
    }
    if (urlSess) {
      void loadSessionAsRun(urlSess)
    }
    // info-only: записать какой маскот выбран (для UX-логов / в будущем — badge)
    void urlMascot
    // Only run once after hydration — subsequent URL changes are driven BY
    // us (via replaceState), so re-firing this would create loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated])

  /** Keep the URL in sync with the active run + session so the user can
      bookmark / share / restore via Ctrl+L → Enter. Uses replaceState so
      it doesn't add history entries on every selection. */
  useEffect(() => {
    if (!hydrated) return
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (activeRunId) params.set('run', activeRunId)
    else params.delete('run')
    if (activeSessionId) params.set('session', activeSessionId)
    else params.delete('session')
    const qs = params.toString()
    const next = window.location.pathname + (qs ? `?${qs}` : '')
    if (next !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, '', next)
    }
  }, [hydrated, activeRunId, activeSessionId])

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  )

  // Switching to non-Claude agent clears the session pin (resume is claude-only)
  useEffect(() => {
    if (agent !== 'claude' && activeSessionId) setActiveSessionId(null)
  }, [agent, activeSessionId])

  const active = useMemo(() => runs.find((r) => r.id === activeRunId) ?? null, [runs, activeRunId])

  /** Render одной collapsed-группы маскота (используется и для orchestrators
      и для workers секций — DRY). */
  const renderGroupCard = useCallback((g: { mid: MascotId; list: AgentSession[]; latestUsed: number; hasLive: boolean }) => {
    const ident = ROSTER_IDENTITY.find((m) => m.id === g.mid)!
    const collapsed = collapsedMascots.has(g.mid)
    const totalTurns = g.list.reduce((acc, s) => acc + (s.turns || 0), 0)
    return (
      <div key={g.mid} className="border border-white/[0.05] rounded-md overflow-hidden bg-black/15">
        <button
          onClick={() => toggleMascotGroup(g.mid)}
          className={
            'w-full flex items-center gap-2 px-2 py-1.5 transition text-left ' +
            (g.hasLive ? 'bg-violet-500/10 hover:bg-violet-500/15' : 'hover:bg-white/[0.04]')
          }
        >
          <span style={{ width: 22, height: 22 }} className="flex-shrink-0">
            <Mascot id={g.mid} size={22} live={g.hasLive} />
          </span>
          <span className="flex-1 min-w-0">
            <span className="text-[12px] text-white/90 font-medium">{ident.name}</span>
            <span className="text-[10px] text-white/40 ml-1.5 font-mono">{ident.domain}</span>
          </span>
          <span className="text-[10px] text-white/40 font-mono tabular-nums">
            {g.list.length}
            {totalTurns > 0 ? <span className="text-white/25"> · {totalTurns}t</span> : null}
          </span>
          <ChevronRight className={'w-3 h-3 text-white/40 transition-transform ' + (collapsed ? '' : 'rotate-90')} />
        </button>
        {!collapsed && (
          <div className="px-1.5 pb-1.5 pt-1 space-y-1">
            {g.list.map((s) => {
              const isActiveSess = activeSessionId === s.id
              const isLive = Date.now() - (s.lastUsedAt || 0) < 60_000 && s.turns > 0
              return (
                <div
                  key={s.id}
                  className={
                    'group relative px-2.5 py-1.5 rounded border transition ' +
                    (isActiveSess
                      ? 'border-violet-400/40 bg-violet-500/12'
                      : 'border-white/[0.04] bg-white/[0.015] hover:bg-white/[0.04]')
                  }
                >
                  {isLive && (
                    <span aria-hidden className="absolute left-0 top-0 bottom-0 w-0.5 bg-gradient-to-b from-violet-400 to-fuchsia-400 animate-pulse rounded-l" />
                  )}
                  <div className="flex items-center gap-1.5">
                    {s.parentSessionId && (
                      <span className="text-violet-300/70 text-[10px] flex-shrink-0" title="саб-агент">↳</span>
                    )}
                    <span className="text-[12px] text-white/90 truncate flex-1" title={s.name}>{s.name}</span>
                    <button
                      onClick={async () => {
                        const n = prompt('Новое имя сессии:', s.name)?.trim()
                        if (!n) return
                        await renameAgentSession(s.id, n).catch(() => {})
                        void refreshSessions()
                      }}
                      className="opacity-0 group-hover:opacity-100 text-white/35 hover:text-white transition"
                      title="Переименовать"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation()
                        if (!confirm(`Удалить сессию «${s.name}»?`)) return
                        await deleteAgentSession(s.id).catch(() => {})
                        if (activeSessionId === s.id) setActiveSessionId(null)
                        void refreshSessions()
                      }}
                      className="opacity-0 group-hover:opacity-100 text-white/35 hover:text-red-300 transition"
                      title="Удалить"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="text-[10px] text-white/35 flex items-center gap-1.5 mt-0.5 font-mono">
                    <span>{s.turns}t</span>
                    <span>·</span>
                    <span>{formatSessionRel(s.lastUsedAt)}</span>
                    {typeof s.costUsd === 'number' && s.costUsd > 0 && (
                      <>
                        <span>·</span>
                        <span
                          className="text-emerald-300/75"
                          title={`${((s.tokensIn || 0) + (s.tokensOut || 0)).toLocaleString('ru-RU')} токенов (in ${(s.tokensIn || 0).toLocaleString('ru-RU')} / out ${(s.tokensOut || 0).toLocaleString('ru-RU')})`}
                        >
                          ${s.costUsd.toFixed(s.costUsd < 1 ? 3 : 2)}
                        </span>
                      </>
                    )}
                  </div>
                  {s.running && (
                    <button
                      onClick={() => { void joinSession(s.id) }}
                      className="mt-1 w-full px-2 py-0.5 rounded text-[10.5px] bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 border border-emerald-400/25 transition flex items-center justify-center gap-1"
                      title="Подключиться к живому потоку этой сессии (она сейчас выполняется)"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" /> смотреть live
                    </button>
                  )}
                  <button
                    onClick={() => { void loadSessionAsRun(s.id) }}
                    disabled={isActiveSess}
                    className={
                      'mt-1 w-full px-2 py-0.5 rounded text-[10.5px] transition ' +
                      (isActiveSess
                        ? 'bg-violet-500/15 text-violet-200 cursor-default'
                        : 'bg-white/[0.04] hover:bg-violet-500/15 text-white/65 hover:text-violet-100')
                    }
                  >
                    {isActiveSess ? '✓ открыто' : '↪ продолжить'}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }, [activeSessionId, collapsedMascots, toggleMascotGroup, loadSessionAsRun, refreshSessions])
  const isRunning = active?.status === 'running'

  // Live-refresh сессий пока идёт прогон — делегированные воркеры
  // появляются в сайдбаре по одному, по мере их вызова оркестратором.
  useEffect(() => {
    if (!isRunning) return
    const tmr = setInterval(() => { void refreshSessions() }, 2500)
    return () => clearInterval(tmr)
  }, [isRunning, refreshSessions])

  // autoscroll terminal
  useEffect(() => {
    const el = termRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [active?.lines.length])

  const appendLine = useCallback((runId: string, line: AutomationLine) => {
    setRuns((prev) => prev.map((r) => {
      if (r.id !== runId) return r
      // Merge consecutive streamed text chunks into ONE line so text flows
      // as a continuous block. Claude's stream-json fires text_delta events
      // with 1-5 characters each; without this merge each chunk renders as
      // its own <pre> block, producing the "Н\nе тро\nгаю" visual.
      const last = r.lines[r.lines.length - 1]
      let lines: AutomationLine[]
      if (last && last.kind === 'stdout' && line.kind === 'stdout') {
        lines = [...r.lines.slice(0, -1), { kind: 'stdout', text: last.text + line.text }]
      } else if (last && last.kind === 'stderr' && line.kind === 'stderr') {
        lines = [...r.lines.slice(0, -1), { kind: 'stderr', text: last.text + line.text }]
      } else if (
        last && last.kind === 'step' && line.kind === 'step'
        && last.meta === 'thinking' && line.meta === 'thinking'
      ) {
        lines = [...r.lines.slice(0, -1), { kind: 'step', meta: 'thinking', text: last.text + line.text }]
      } else {
        lines = [...r.lines, line]
      }
      // Extract AskUser blocks from the tail. Three places to look:
      //   • stdout text containing [[ASK_USER]] markers
      //   • stdout text containing inline AskUserQuestion(...) or bare {"questions":...}
      //   • a tool_call step (meta='tool') from Claude's NATIVE AskUserQuestion tool —
      //     this is the common case for `claude -p` runs; the JSON arrives as the
      //     tool's arguments, not as stdout text.
      const tail = lines[lines.length - 1]
      const tailText: string | null = tail && (
        tail.kind === 'stdout' ? tail.text
        : (tail.kind === 'step' && (tail.meta === 'result' || tail.meta === 'note' || tail.meta === 'tool')) ? tail.text
        : null
      )
      if (tailText
          && (tailText.includes('[[ASK_USER]]')
              || tailText.includes('AskUserQuestion')
              || tailText.includes('"questions"'))) {
        const split = extractAskUserBlocks(tailText)
        if (split.some((s) => s.kind === 'ask_user')) {
          // Preserve the original step.meta='tool' line so the user still
          // sees `AskUserQuestion(...)` rendered as a tool call, AND we append
          // the rendered widget right after. For stdout we replace inline.
          if (tail.kind === 'stdout') {
            lines = [...lines.slice(0, -1), ...split]
          } else {
            lines = [...lines, ...split.filter((s) => s.kind === 'ask_user')]
          }
        }
      }
      if (lines.length > MAX_LINES_PER_RUN) lines.splice(0, lines.length - MAX_LINES_PER_RUN)
      return { ...r, lines }
    }))
  }, [])

  /** Format the user's chosen answers and pipe them as the next run.
      Reuses the active session via the existing continue-in-place path. */
  const submitAskUserAnswer = useCallback((runId: string, lineIndex: number, formatted: string, byQuestion: string[][]) => {
    // 1) mark the question line as answered (so it locks + visualises)
    setRuns((prev) => prev.map((r) => {
      if (r.id !== runId) return r
      const lines = [...r.lines]
      const ln = lines[lineIndex]
      if (ln && ln.kind === 'ask_user') {
        lines[lineIndex] = { ...ln, answered: byQuestion }
      }
      return { ...r, lines }
    }))
    // 2) fill textarea + fire run in the same session (continue-in-place handles it)
    setTask(formatted)
    setTimeout(() => { void runTask(formatted) }, 50)
  }, [])

  /** Wait until the proxy /health endpoint is reachable. Returns true on success. */
  const waitForServer = useCallback(async (maxMs = 60_000, signal?: AbortSignal): Promise<boolean> => {
    const start = Date.now()
    const url = `${KIMI_API}/health`
    while (Date.now() - start < maxMs) {
      if (signal?.aborted) return false
      try {
        const ac = new AbortController()
        const t = setTimeout(() => ac.abort(), 2500)
        const r = await fetch(url, { signal: ac.signal, cache: 'no-store' })
        clearTimeout(t)
        if (r.ok) return true
      } catch { /* still down */ }
      await new Promise((r) => setTimeout(r, 1500))
    }
    return false
  }, [])

  /** Capture Ctrl+V image paste in the task textarea — upload happens at runTask time. */
  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items
    if (!items || items.length === 0) return
    const files: File[] = []
    for (const item of Array.from(items)) {
      if (item.kind !== 'file') continue
      if (!item.type.startsWith('image/')) continue
      const f = item.getAsFile()
      if (!f) continue
      const ext = (item.type.split('/')[1] || 'png').split('+')[0]
      const looksGeneric = !f.name || /^(image|file)\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name)
      const name = looksGeneric
        ? `pasted-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${ext}`
        : f.name
      files.push(new File([f], name, { type: f.type }))
    }
    if (files.length === 0) return
    e.preventDefault()
    const loaded = await Promise.all(files.map(fileToAttachment))
    setAttachments((prev) => [...prev, ...loaded])
  }, [])

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }, [])

  const joinSession = useCallback(async (sessionId: string) => {
    let runId = runs.find((r) => r.sessionId === sessionId)?.id || null
    const meta = sessions.find((x) => x.id === sessionId)
    if (!runId) {
      runId = newRunId()
      const rec: RunRecord = {
        id: runId, agent: 'claude', task: `👁 live · ${meta?.name || sessionId}`,
        lines: [{ kind: 'meta', text: 'подключаюсь к живой сессии…' }],
        startedAt: Date.now(), status: 'running', sessionId,
      }
      setRuns((prev) => [rec, ...prev.filter((r) => r.id !== runId)].slice(0, 20))
    } else {
      const rid = runId
      setRuns((prev) => prev.map((r) => (r.id === rid ? { ...r, status: 'running' } : r)))
    }
    setActiveRunId(runId)
    setActiveSessionId(sessionId)
    setAgent('claude')
    const rid = runId
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      await runAutomation({
        agent: 'claude', task: '', sessionId, attachOnly: true, signal: ctrl.signal,
        onLine: (line) => {
          appendLine(rid, line)
          if (line.kind === 'done') {
            setRuns((prev) => prev.map((r) => (r.id === rid ? { ...r, status: 'done', exitCode: 0 } : r)))
            void refreshSessions()
          }
        },
      })
    } catch (e: any) {
      const stopped = e?.name === 'AbortError'
      appendLine(rid, { kind: stopped ? 'meta' : 'error', text: stopped ? '— отключился от просмотра' : String(e?.message || e) })
      setRuns((prev) => prev.map((r) => (r.id === rid ? { ...r, status: 'stopped' } : r)))
    } finally {
      abortRef.current = null
    }
  }, [runs, sessions, appendLine, refreshSessions])

  const runTask = async (taskOverride?: string) => {
    const t = (taskOverride ?? task).trim()
    if (!t || isRunning) return

    // Continue-in-place: if there's an active Claude session AND a current run
    // tied to it (or a freshly-loaded history view), append the new turn to
    // that same RunRecord instead of opening a new "window".
    const existing = activeRunId ? runs.find((r) => r.id === activeRunId) : null
    const continueInPlace = !!(
      agent === 'claude'
      && activeSessionId
      && existing
      && existing.status !== 'running'
      && (existing.sessionId === activeSessionId || existing.task.startsWith('📜'))
    )

    let id: string
    if (continueInPlace && existing) {
      id = existing.id
      setRuns((prev) => prev.map((r) =>
        r.id === id
          ? {
              ...r,
              status: 'running',
              startedAt: Date.now(),
              sessionId: activeSessionId,
              lines: [...r.lines, { kind: 'meta', text: '──── новый ход ────' }],
            }
          : r
      ))
    } else {
      id = newRunId()
      const rec: RunRecord = {
        id, agent, task: t, lines: [], startedAt: Date.now(), status: 'running',
        sessionId: agent === 'claude' ? activeSessionId : null,
      }
      setRuns((prev) => [rec, ...prev].slice(0, 20))
      setActiveRunId(id)
    }
    setTask('')

    // Auto-open «Эфир» в отдельной вкладке/окне чтоб видеть live-передачу
    // данных между маскотами в реальном времени. Окно переиспользуется
    // через window.name='zek-ether' — повторный запуск его focus'ит, а не
    // плодит копии. Если popup-blocker зарубил — игнорим, у юзера есть
    // ссылка в шапке.
    // Открываем Эфир СИНХРОННО (popup-safe — мы в обработчике клика). На СВЕЖЕМ
    // запуске id сессии ещё неизвестен, поэтому стартуем на "pending"-фокусе →
    // пустой граф (НЕ вся история). Когда ниже прилетит SSE-событие 'session',
    // перенаправим это же окно на реальную сессию — и агенты будут появляться
    // по одному, по мере делегирования. Для continue-in-place id уже известен.
    let etherWin: Window | null = null
    const etherNeedsFocus = !(agent === 'claude' && activeSessionId)
    if (typeof window !== 'undefined' && agent === 'claude') {
      try {
        const initialFocus = activeSessionId || '__pending__'
        etherWin = window.open(`/automations/ether?focus=${initialFocus}`, 'zek-ether')
        if (etherWin && !etherWin.closed) {
          try { etherWin.focus() } catch { /* cross-origin focus throw — игнор */ }
        }
      } catch { /* popup blocked — skip */ }
    }

    // Upload pasted images (if any) and prepend their paths to the prompt so
    // Claude knows where to find them — its Read tool can open image files.
    const autoDir = agent === 'claude' ? (AUTONOMY_LEVELS.find((a) => a.id === autonomy)?.directive || '') : ''
    let promptForAgent = autoDir ? `[${autoDir}]

${t}` : t
    const pendingAttachments = attachments
    if (pendingAttachments.length > 0 && (agent === 'claude' || agent === 'hermes')) {
      setAttachments([])
      try {
        const uploaded = await uploadAttachments(pendingAttachments)
        const files = uploaded?.files ?? []
        if (files.length > 0) {
          const lines = files.map((f) => `- ${f.path}  (${f.name}, ${f.mime})`).join('\n')
          promptForAgent =
            `[Прикреплены ${files.length === 1 ? 'файл' : 'файлы'} (открой через Read tool, это картинк${files.length === 1 ? 'а' : 'и'}):\n${lines}]\n\n` +
            t
          appendLine(id, { kind: 'prompt', text: t })
          for (const f of files) {
            if (f.mime.startsWith('image/')) {
              appendLine(id, {
                kind: 'artifact', path: f.path, name: f.name, mime: f.mime, size: f.size,
              })
            } else {
              appendLine(id, { kind: 'meta', text: `📎 прикреплён: ${f.path}` })
            }
          }
        } else {
          appendLine(id, { kind: 'prompt', text: t })
        }
      } catch (e: any) {
        appendLine(id, { kind: 'error', text: 'Не удалось загрузить прикрепления: ' + String(e?.message || e) })
        appendLine(id, { kind: 'prompt', text: t })
      }
    } else {
      appendLine(id, { kind: 'prompt', text: t })
    }

    const ctrl = new AbortController()
    abortRef.current = ctrl

    let sawDone = false
    try {
      await runAutomation({
        agent,
        task: promptForAgent,
        sessionId: agent === 'claude' ? activeSessionId : undefined,
        signal: ctrl.signal,
        onLine: (line) => {
          appendLine(id, line)
          if (line.kind === 'session') {
            setRuns((prev) => prev.map((r) =>
              r.id === id ? { ...r, sessionId: line.sessionId } : r
            ))
            if (agent === 'claude') setActiveSessionId(line.sessionId)
            // Навести окно Эфира на текущую сессию (на свежем запуске оно
            // стартовало на пустом pending-фокусе).
            if (etherNeedsFocus && etherWin && !etherWin.closed) {
              try { etherWin.location.href = `/automations/ether?focus=${line.sessionId}` } catch { /* cross-origin — игнор */ }
            }
          }
          if (line.kind === 'done') {
            sawDone = true
            setRuns((prev) => prev.map((r) =>
              r.id === id
                ? { ...r, status: line.code === 0 ? 'done' : 'failed', exitCode: line.code, durationMs: line.ms }
                : r
            ))
            void refreshSessions()
          }
        },
      })
      // If the SSE stream finished cleanly but server never sent us a 'done'
      // event, the connection was probably killed mid-stream (e.g., proxy
      // restart). Treat it as a network drop and run the recovery flow.
      if (!sawDone) {
        throw new Error('Failed to fetch (stream closed without completion event)')
      }
    } catch (e: any) {
      const stopped = e?.name === 'AbortError'
      const errMsg = String(e?.message || e)
      // Detect network-style failures (server restarted, lost connection, etc.)
      const isNetwork = !stopped && /failed to fetch|networkerror|load failed|fetch failed|network|connection/i.test(errMsg)

      if (isNetwork && agent === 'claude') {
        appendLine(id, { kind: 'meta', text: `⏳ соединение с сервером оборвалось (${errMsg}) — жду рестарта до 60с…` })
        setRuns((prev) => prev.map((r) =>
          r.id === id ? { ...r, status: 'stopped' } : r
        ))
        const back = await waitForServer(60_000)
        if (back) {
          appendLine(id, { kind: 'meta', text: '✓ сервер вернулся — подтягиваю историю сессии' })
          // Brief wait so Anthropic-side transcript is flushed
          await new Promise((r) => setTimeout(r, 1500))
          await refreshSessions()
          const sid = runs.find((r) => r.id === id)?.sessionId ?? activeSessionId
          if (sid) {
            try {
              const { lines: hist } = await getSessionHistory(sid)
              // Replace the run's lines with the full transcript, but DON'T
              // pretend the task completed — Claude was killed mid-work by
              // a proxy restart. Status stays 'stopped' (orange dot), exit
              // code is null, and we add an explicit warning banner so the
              // user knows to manually continue if they need a finalization.
              const processedHist = applyAskUserExtraction(hist as AutomationLine[])
              setRuns((prev) => prev.map((r) =>
                r.id === id
                  ? {
                      ...r,
                      status: 'stopped',
                      exitCode: null,
                      durationMs: Date.now() - r.startedAt,
                      lines: [
                        ...processedHist,
                        { kind: 'meta', text: '──── история подтянута после рестарта ────' },
                        { kind: 'error', text: '⚠ задача НЕ завершена — Claude была убита рестартом прокси. Чтобы доделать: напиши сюда «продолжи с того места» — в той же сессии она увидит полный контекст и доработает.' },
                      ],
                    }
                  : r
              ))
            } catch (refetchErr: any) {
              appendLine(id, { kind: 'error', text: 'не удалось подтянуть историю: ' + String(refetchErr?.message || refetchErr) })
              setRuns((prev) => prev.map((r) => r.id === id ? { ...r, status: 'failed' } : r))
            }
          }
        } else {
          appendLine(id, { kind: 'error', text: 'сервер не поднялся за 60с — попробуй ещё раз позже' })
          setRuns((prev) => prev.map((r) => r.id === id ? { ...r, status: 'failed' } : r))
        }
      } else {
        appendLine(id, { kind: 'error', text: stopped ? '— остановлено пользователем' : errMsg })
        setRuns((prev) => prev.map((r) =>
          r.id === id
            ? { ...r, status: stopped ? 'stopped' : 'failed', durationMs: Date.now() - r.startedAt }
            : r
        ))
      }
    } finally {
      abortRef.current = null
    }
  }

  // Fix #2: auto-finish a queued interrupted session once it's focused and
  // nothing else is streaming. Reuses runTask's continue-in-place path.
  useEffect(() => {
    if (!pendingResume || isRunning) return
    if (activeSessionId !== pendingResume) return
    const sid = pendingResume
    if (autoResumedRef.current.has(sid)) { setPendingResume(null); return }
    autoResumedRef.current.add(sid)
    setPendingResume(null)
    void runTask('Продолжи с того места, где тебя прервали — доделай задачу полностью и дай финальный ответ пользователю.')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingResume, isRunning, activeSessionId])

  const stop = () => abortRef.current?.abort()

  const [judgeBusy, setJudgeBusy] = useState<string | null>(null)
  const runJudge = useCallback(async (sessionId: string) => {
    setJudgeBusy(sessionId)
    try { await judgeSession(sessionId); await refreshSessions() }
    catch { /* ignore */ }
    finally { setJudgeBusy(null) }
  }, [refreshSessions])

  const submitFeedback = useCallback(async (sessionId: string, rating: 'up' | 'down', kind: 'good' | 'partial' | 'broken' | 'hallucination') => {
    try {
      await setSessionFeedback(sessionId, { rating, kind })
      await refreshSessions()
    } catch { /* ignore */ }
  }, [refreshSessions])

  const clearActive = () => {
    if (!active) return
    setRuns((prev) => prev.map((r) => r.id === active.id ? { ...r, lines: [] } : r))
  }
  const removeRun = (id: string) => {
    setRuns((prev) => prev.filter((r) => r.id !== id))
    if (activeRunId === id) setActiveRunId(null)
  }

  return (
    <div className="min-h-screen bg-[#08080c] text-white">
      {/* Top bar */}
      <header className="border-b border-white/[0.06] bg-black/30 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-2 text-[13px] text-white/65 hover:text-white transition"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">К чату</span>
          </Link>
          <div className="w-px h-5 bg-white/10" />
          <Play className="w-4 h-4 text-violet-300" />
          <h1 className="text-[14px] font-semibold text-white/95">Автоматизации</h1>
          <span className="px-2 py-0.5 rounded bg-white/[0.04] border border-white/10 text-[10px] uppercase tracking-wider text-white/45">
            beta
          </span>

          <div className="ml-3 flex gap-0.5 bg-white/[0.03] border border-white/[0.06] rounded-md p-0.5">
            {/* Эфир — единственная full-page визуализация, открывается
                автоматом при запуске (см. runTask → window.open). */}
            <Link
              href="/automations/ether"
              className="px-2.5 py-1 rounded text-[11.5px] transition flex items-center gap-1.5 text-amber-300 hover:text-amber-200 hover:bg-amber-500/10"
              title="Эфир — граф диалогов между маскотами (live, real-time)"
            >
              <Zap className="w-3 h-3" />
              Эфир
            </Link>
            <div className="w-px self-stretch bg-white/[0.06] mx-0.5" />
            {([
              { id: 'run',      label: 'Запуск',     icon: Play },
              { id: 'schedule', label: 'Расписание', icon: Calendar },
              { id: 'mcp',      label: 'MCP',        icon: Plug },
              { id: 'telegram', label: 'Telegram',   icon: Send },
            ] as const).map((t) => {
              const Icon = t.icon
              const active = tab === t.id
              // Show a pulse on "Запуск" tab when a stream is running and
              // user is looking at another tab — proves console didn't die.
              const showPulse = t.id === 'run' && isRunning && tab !== 'run'
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={
                    'relative px-2.5 py-1 rounded text-[11.5px] transition flex items-center gap-1.5 ' +
                    (active
                      ? 'bg-white/[0.08] text-white'
                      : 'text-white/55 hover:text-white/85 hover:bg-white/[0.04]')
                  }
                >
                  <Icon className="w-3 h-3" />
                  {t.label}
                  {showPulse && (
                    <span className="relative flex h-1.5 w-1.5 ml-0.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-violet-400" />
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          <span className="flex-1" />
          <button
            onClick={async () => {
              try { await fetch('/api/auth/logout', { method: 'POST' }) } catch { /* ignore */ }
              window.location.href = '/login'
            }}
            className="px-2.5 py-1.5 rounded-md bg-white/[0.04] hover:bg-white/[0.09] border border-white/10 text-xs text-white/70 hover:text-white transition flex items-center gap-1.5"
            title="Выйти"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Выйти</span>
          </button>
        </div>
      </header>

      {tab === 'schedule' && (
        <div className="max-w-7xl mx-auto px-4 py-5">
          <AutomationsSchedules />
        </div>
      )}

      {tab === 'mcp' && (
        <div className="max-w-7xl mx-auto px-4 py-5">
          <AutomationsMcps />
        </div>
      )}

      {tab === 'telegram' && (
        <TelegramTab onOpen={(sid) => { setTab('run'); void loadSessionAsRun(sid) }} />
      )}


      {tab === 'run' && (
      <div className="max-w-7xl mx-auto px-4 py-5 grid grid-cols-12 gap-4">
        {/* Left: compact agent dropdown + user-defined scenarios */}
        <aside className="col-span-12 lg:col-span-3 space-y-4">
          {/* Agent picker — single dropdown instead of 3 cards */}
          <section ref={agentPickerRef} className="relative">
            <div className="text-[10px] uppercase tracking-[0.14em] text-white/40 mb-1.5 px-1">Агент</div>
            <button
              onClick={() => setAgentPickerOpen((o) => !o)}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] transition"
            >
              {(() => {
                const a = AGENTS.find((x) => x.id === agent)!
                const Icon = a.icon
                return <>
                  <Icon className="w-4 h-4 text-violet-300 flex-shrink-0" />
                  <div className="flex-1 min-w-0 text-left">
                    <div className="text-[13px] font-medium text-white truncate">{a.name}</div>
                    <div className="text-[10.5px] text-white/45 truncate">{a.description}</div>
                  </div>
                  <ChevronRight className={'w-3.5 h-3.5 text-white/40 transition-transform ' + (agentPickerOpen ? 'rotate-90' : '')} />
                </>
              })()}
            </button>
            <AnimatePresence>
              {agentPickerOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.12 }}
                  className="absolute z-30 mt-1 w-full rounded-lg border border-white/10 bg-[#0b0a14]/96 backdrop-blur-xl shadow-2xl overflow-hidden"
                >
                  {AGENTS.map((a) => {
                    const Icon = a.icon
                    const active = agent === a.id
                    return (
                      <button
                        key={a.id}
                        onClick={() => { setAgent(a.id); setAgentPickerOpen(false) }}
                        className={
                          'w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition ' +
                          (active ? 'bg-violet-500/12' : 'hover:bg-white/[0.05]')
                        }
                      >
                        <Icon className={'w-4 h-4 mt-0.5 flex-shrink-0 ' + (active ? 'text-violet-300' : 'text-white/55')} />
                        <div className="flex-1 min-w-0">
                          <div className={'text-[12.5px] font-medium ' + (active ? 'text-white' : 'text-white/85')}>{a.name}</div>
                          <div className="text-[10.5px] text-white/45 leading-snug">{a.description}</div>
                        </div>
                        {active && <span className="text-emerald-300 text-[12px]">✓</span>}
                      </button>
                    )
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </section>

          {/* User-defined scenarios */}
          <section>
            <div className="flex items-center gap-2 mb-1.5 px-1">
              <span className="text-[10px] uppercase tracking-[0.14em] text-white/40 flex-1">
                Сценарии · {scenarios.length}
              </span>
              <button
                onClick={() =>
                  setEditScenario({
                    id: 'sc-' + Math.random().toString(36).slice(2, 9),
                    title: '',
                    prompt: '',
                    createdAt: Date.now(),
                  })
                }
                className="text-[11px] text-violet-300/85 hover:text-violet-100 px-1.5 py-0.5 rounded hover:bg-violet-500/10 transition flex items-center gap-0.5"
                title="Добавить сценарий"
              >
                <span className="text-[13px] leading-none">＋</span> Сценарий
              </button>
            </div>
            {scenarios.length === 0 ? (
              <div className="px-3 py-3 rounded-md border border-dashed border-white/[0.08] text-[11px] text-white/40 leading-relaxed">
                Сценарий = заготовленный промпт. Один клик подставит его в поле задачи (можно отредактировать перед запуском).
              </div>
            ) : (
              <div className="space-y-1">
                {scenarios.map((s) => (
                  <div key={s.id} className="group relative">
                    <button
                      onClick={() => {
                        setTask(s.prompt)
                        if (s.agent) setAgent(s.agent)
                      }}
                      className="w-full text-left px-3 py-2 rounded-md border border-white/[0.05] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/10 transition"
                    >
                      <div className="text-[12.5px] text-white/85 group-hover:text-white flex items-center gap-1.5">
                        <ChevronRight className="w-3 h-3 text-white/35" />
                        {s.title || '(без названия)'}
                        {s.agent && (
                          <span className="ml-auto text-[9.5px] text-white/40 px-1 py-0.5 rounded bg-white/[0.04] border border-white/[0.06]">
                            {s.agent}
                          </span>
                        )}
                      </div>
                      <div className="text-[10.5px] text-white/40 line-clamp-2 mt-0.5 pl-4">{s.prompt}</div>
                    </button>
                    <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 flex gap-0.5 transition">
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditScenario(s) }}
                        className="p-1 rounded text-white/40 hover:text-white hover:bg-white/[0.08] transition"
                        title="Редактировать"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          if (!confirm(`Удалить сценарий «${s.title || s.id}»?`)) return
                          const next = scenarios.filter((x) => x.id !== s.id)
                          setScenarios(next); saveScenarios(next)
                        }}
                        className="p-1 rounded text-white/40 hover:text-red-300 hover:bg-red-500/10 transition"
                        title="Удалить"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </aside>

        {/* Center: terminal */}
        <section className="col-span-12 lg:col-span-6 flex flex-col h-[calc(100vh-130px)]">
          <div className="flex items-center gap-2 px-3 py-2 bg-white/[0.03] border border-white/[0.06] rounded-t-lg">
            <Terminal className="w-3.5 h-3.5 text-violet-300" />
            <span className="text-[11.5px] text-white/70">
              {active ? `${active.agent} · ${active.task.slice(0, 60)}${active.task.length > 60 ? '…' : ''}` : 'Терминал'}
            </span>
            {active && (
              <span className={
                'ml-2 text-[10px] px-1.5 py-0.5 rounded border ' + statusClass(active.status)
              }>{statusLabel(active.status, active.exitCode)}</span>
            )}
            <span className="flex-1" />
            {active && (
              <button
                onClick={async () => {
                  if (typeof window === 'undefined') return
                  const url = window.location.href
                  try { await navigator.clipboard.writeText(url) }
                  catch { /* fall back: show URL in prompt */ window.prompt('Скопируй ссылку:', url) }
                  setCopiedLink(true)
                  setTimeout(() => setCopiedLink(false), 1600)
                }}
                className="text-[10.5px] text-white/55 hover:text-violet-100 px-1.5 py-0.5 rounded hover:bg-violet-500/10 transition flex items-center gap-1"
                title="Скопировать ссылку на этот ран (можно сохранить/расшарить)"
              >
                {copiedLink
                  ? (<><Check className="w-3 h-3 text-emerald-300" /><span className="text-emerald-300">скопировано</span></>)
                  : (<><Link2 className="w-3 h-3" />ссылка</>)}
              </button>
            )}
            {active?.sessionId && (
              <button
                onClick={() => setGraphOpen(true)}
                className="text-[10.5px] text-violet-300/85 hover:text-violet-100 px-1.5 py-0.5 rounded hover:bg-violet-500/10 transition flex items-center gap-1"
                title="Граф агентов этой сессии (root + все саб-агенты)"
              >
                <Network className="w-3 h-3" />
                граф
              </button>
            )}
            {active?.sessionId && (
              <button
                onClick={async () => {
                  if (typeof window === 'undefined' || !active.sessionId) return
                  const url = `${window.location.origin}/share/${active.sessionId}`
                  try { await navigator.clipboard.writeText(url) }
                  catch { window.prompt('Публичная ссылка (без логина):', url) }
                  setCopiedLink(true)
                  setTimeout(() => setCopiedLink(false), 1600)
                }}
                className="text-[10.5px] text-emerald-300/85 hover:text-emerald-100 px-1.5 py-0.5 rounded hover:bg-emerald-500/10 transition flex items-center gap-1"
                title="Публичный read-only реплей (без логина) — можно показать заказчику/донору"
              >
                🔗 реплей
              </button>
            )}
            {active && (
              <button
                onClick={clearActive}
                className="text-[10.5px] text-white/40 hover:text-white/85 transition"
                title="Очистить вывод этого прогона"
              >
                clear
              </button>
            )}
          </div>

          {active?.sessionId && active.status !== 'running' && (() => {
            const fbSess = sessions.find((x) => x.id === active.sessionId)
            const cur = fbSess?.feedback
            const KINDS: Array<{ k: 'good' | 'partial' | 'broken' | 'hallucination'; label: string; rating: 'up' | 'down' }> = [
              { k: 'good', label: '👍 хорошо', rating: 'up' },
              { k: 'partial', label: '◑ частично', rating: 'down' },
              { k: 'broken', label: '✗ сломано', rating: 'down' },
              { k: 'hallucination', label: '⚠ галлюцинация', rating: 'down' },
            ]
            return (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.02] border-x border-white/[0.06] text-[10.5px] flex-wrap">
                <span className="text-white/40 font-mono">оценка:</span>
                {KINDS.map(({ k, label, rating }) => (
                  <button
                    key={k}
                    onClick={() => active.sessionId && submitFeedback(active.sessionId, rating, k)}
                    className={
                      'px-1.5 py-0.5 rounded border transition ' +
                      (cur?.kind === k
                        ? (rating === 'up' ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-200' : 'border-amber-400/40 bg-amber-500/12 text-amber-200')
                        : 'border-white/[0.06] text-white/45 hover:text-white/85 hover:bg-white/[0.05]')
                    }
                  >
                    {label}
                  </button>
                ))}
                <span className="flex-1" />
                <button
                  onClick={() => active.sessionId && runJudge(active.sessionId)}
                  disabled={judgeBusy === active.sessionId}
                  className="px-1.5 py-0.5 rounded border border-violet-400/30 text-violet-200/85 hover:bg-violet-500/15 disabled:opacity-50 transition"
                  title="Оценить результат другим ИИ (LLM-as-judge, claude -p)"
                >
                  {judgeBusy === active.sessionId ? '⚖ оцениваю…' : '⚖ оценить ИИ'}
                </button>
                {fbSess?.judge?.verdict && (
                  <span
                    className={
                      'px-1.5 py-0.5 rounded font-mono ' +
                      (fbSess.judge.verdict === 'good' ? 'text-emerald-300' : fbSess.judge.verdict === 'partial' ? 'text-amber-300' : 'text-red-300')
                    }
                    title={fbSess.judge.reason || ''}
                  >
                    ИИ: {fbSess.judge.score}/10 · {fbSess.judge.verdict}
                  </span>
                )}
              </div>
            )
          })()}

          <div
            ref={termRef}
            className="flex-1 min-h-0 overflow-y-auto bg-black/40 border-x border-white/[0.06] px-4 py-3 font-mono text-[12px] leading-relaxed"
            style={{ fontFamily: 'var(--font-mono-loaded), ui-monospace, monospace' }}
          >
            {!active ? (
              <div className="h-full grid place-items-center text-center">
                <div>
                  <Terminal className="w-10 h-10 text-white/15 mx-auto mb-3" />
                  <div className="text-[13px] text-white/55 mb-1">Терминал пуст</div>
                  <div className="text-[11.5px] text-white/35 max-w-[280px] mx-auto leading-relaxed">
                    Выбери сценарий слева или напиши задачу внизу. Stdout / stderr / шаги Hermes придут сюда в реальном времени.
                  </div>
                </div>
              </div>
            ) : active.lines.length === 0 ? (
              <div className="text-white/35 flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ожидание вывода…
              </div>
            ) : (
              <div className="space-y-0.5">
                {active.lines.map((l, i) => (
                  l.kind === 'ask_user'
                    ? <AskUserBlock
                        key={i}
                        payload={l.payload}
                        answered={l.answered}
                        onSubmit={(text, byQ) => submitAskUserAnswer(active.id, i, text, byQ)}
                      />
                    : <LineView key={i} line={l} onOpenImage={setLightbox} />
                ))}
                {isRunning && (
                  <div className="text-white/30 flex items-center gap-1.5 mt-2 text-[11px]">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    стрим…
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="border border-white/[0.06] border-t-0 rounded-b-lg bg-white/[0.02]">
            {/* Active session pin — shows when next run will --resume a saved Claude conversation */}
            {agent === 'claude' && activeSession && (
              <div className="px-3 pt-2.5 pb-1 border-b border-white/[0.04] flex items-center gap-2">
                <span className="text-[10.5px] uppercase tracking-wider text-violet-300/85">↪ продолжаешь</span>
                <span className="text-[12px] text-white/85 truncate flex-1">{activeSession.name}</span>
                <span className="text-[10.5px] text-white/40">{activeSession.turns} ход{activeSession.turns === 1 ? '' : activeSession.turns < 5 ? 'а' : 'ов'}</span>
                <button
                  onClick={() => setActiveSessionId(null)}
                  className="text-[10.5px] text-white/40 hover:text-white/85 px-1.5 py-0.5 rounded hover:bg-white/[0.06] transition"
                  title="Новая сессия (не resume)"
                >
                  ✕ новая
                </button>
              </div>
            )}
            {/* Pasted attachment thumbnails — uploaded only at submit time */}
            {attachments.length > 0 && (
              <div className="px-3 pt-2.5 pb-1 border-b border-white/[0.04] flex flex-wrap gap-2">
                {attachments.map((a) => {
                  const isImg = a.mime.startsWith('image/')
                  const url = isImg ? URL.createObjectURL(a.raw) : null
                  return (
                    <div
                      key={a.id}
                      className="group relative flex items-center gap-1.5 pl-1 pr-1.5 py-1 rounded-md border border-white/[0.08] bg-white/[0.03]"
                    >
                      {isImg && url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={url} alt={a.name} className="w-7 h-7 object-cover rounded" />
                      ) : (
                        <span className="w-7 h-7 grid place-items-center bg-white/[0.04] rounded text-[10px] text-white/45">📎</span>
                      )}
                      <span className="text-[11px] text-white/80 max-w-[160px] truncate">{a.name}</span>
                      <span className="text-[10px] text-white/35 tabular-nums">{(a.size / 1024).toFixed(0)}КБ</span>
                      <button
                        onClick={() => removeAttachment(a.id)}
                        className="ml-0.5 w-4 h-4 grid place-items-center rounded text-white/40 hover:text-red-300 hover:bg-red-500/10 transition"
                        title="Убрать"
                      >×</button>
                    </div>
                  )
                })}
                <span className="text-[10px] text-white/35 self-center ml-1">
                  пойдут в задачу после «Запустить» — Claude прочтёт их через Read tool
                </span>
              </div>
            )}
            <textarea
              value={task}
              onChange={(e) => setTask(e.target.value)}
              onPaste={handlePaste}
              placeholder={
                agent === 'hermes'
                  ? 'Опиши задачу для Hermes. Enter — запуск, Shift+Enter — перенос строки.'
                  : agent === 'claude'
                    ? 'Опиши задачу для Claude — может всё: править файлы в /opt, /etc, гонять bash, и т.д.'
                    : 'Bash-команда. Пример: uptime && df -h | head -5'
              }
              rows={3}
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void runTask()
                }
              }}
              className="w-full px-3.5 py-3 bg-transparent text-[13px] text-white/95 outline-none resize-none placeholder:text-white/30"
            />
            <div className="flex items-center gap-2 px-3 pb-3">
              <span className="text-[10.5px] text-white/35 font-mono">
                {agent === 'hermes'
                  ? 'hermes -z "<task>" --yolo'
                  : agent === 'claude'
                    ? 'claude -p "<task>" --dangerously-skip-permissions (IS_SANDBOX=1)'
                    : 'bash -c "<task>"'}
              </span>
              {agent === 'claude' && (
                <select
                  value={autonomy}
                  onChange={(e) => setAutonomy(e.target.value as 'L1' | 'L2' | 'L3' | 'L4')}
                  title="Уровень автономии агента"
                  className="text-[10.5px] bg-black/30 border border-white/[0.08] rounded px-1.5 py-0.5 text-white/65 outline-none hover:border-violet-400/40 transition font-mono"
                >
                  {AUTONOMY_LEVELS.map((a) => (
                    <option key={a.id} value={a.id} className="bg-[#12121a]">{a.label}</option>
                  ))}
                </select>
              )}
              <span className="flex-1" />
              {isRunning ? (
                <button
                  onClick={stop}
                  className="px-3 py-1.5 rounded-md text-[12px] bg-red-500/15 hover:bg-red-500/25 text-red-200 border border-red-400/25 transition flex items-center gap-1.5"
                >
                  <Square className="w-3.5 h-3.5" />
                  Остановить
                </button>
              ) : (
                <button
                  onClick={() => void runTask()}
                  disabled={!task.trim() || AGENTS.find(a => a.id === agent)?.disabled}
                  className="px-3.5 py-1.5 rounded-md text-[12px] bg-gradient-to-b from-violet-500 to-indigo-600 text-white hover:from-violet-400 hover:to-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center gap-1.5"
                >
                  <Play className="w-3.5 h-3.5" />
                  Запустить
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Right: Claude sessions (persistent, resumable) + this-tab run history */}
        <aside className="col-span-12 lg:col-span-3 space-y-4">
          <section>
            <div className="text-[10px] uppercase tracking-[0.14em] text-white/40 px-1 flex items-center gap-1.5">
              <Cpu className="w-3 h-3" />
              Сессии Claude · {sidebarScope === 'thisRun' ? (activeRunTreeIds?.size ?? 0) : sessions.length}
              <span className="flex-1" />
              {/* Scope toggle — только этот run vs все. Показываем только если есть активная сессия. */}
              {activeSessionId && activeRunTreeIds && (
                <div className="inline-flex rounded border border-white/[0.08] bg-black/30 p-0.5 mr-1 font-mono text-[9px]">
                  <button
                    onClick={() => setSidebarScope('thisRun')}
                    className={
                      'px-1.5 py-0.5 rounded transition ' +
                      (sidebarScope === 'thisRun'
                        ? 'bg-amber-500/30 text-amber-200'
                        : 'text-white/45 hover:text-white/80')
                    }
                    title={`Только текущий ран (${activeRunTreeIds.size} сессий)`}
                  >
                    этот
                  </button>
                  <button
                    onClick={() => setSidebarScope('all')}
                    className={
                      'px-1.5 py-0.5 rounded transition ' +
                      (sidebarScope === 'all'
                        ? 'bg-violet-500/30 text-violet-200'
                        : 'text-white/45 hover:text-white/80')
                    }
                    title={`Все сессии (${sessions.length})`}
                  >
                    все
                  </button>
                </div>
              )}
              <button
                onClick={() => {
                  setActiveSessionId(null)
                  setActiveRunId(null)
                  setTask('')
                  // ВАЖНО: scope='thisRun' оставляем — сайдбар станет пустым
                  // и не покажет 32 старых сессии. Появятся только новые.
                  setSidebarScope('thisRun')
                }}
                title="Новая чистая сессия (сайдбар тоже очищается)"
                className="text-[11px] text-violet-300/85 hover:text-violet-100 px-1.5 py-0.5 rounded hover:bg-violet-500/10 transition flex items-center gap-0.5"
              >
                <span className="text-[13px] leading-none">＋</span> Новая
              </button>
            </div>
            {sessions.length === 0 ? (
              <div className="text-[11.5px] text-white/35 px-1 py-3">
                Сохранённых нет. После первого запуска Claude появится тут — нажмёшь «↪» и продолжишь.
              </div>
            ) : sidebarScope === 'thisRun' && !activeSessionId ? (
              <div className="mt-2 p-3 rounded-md border border-dashed border-white/[0.08] bg-black/20 text-center space-y-2">
                <div className="inline-flex w-9 h-9 rounded-full border border-violet-400/30 grid place-items-center text-violet-300/70 mx-auto">
                  <span className="text-base font-mono">·</span>
                </div>
                <div className="text-[11.5px] text-white/55 leading-snug">
                  чисто. напиши задачу слева и жми «Запустить»
                </div>
                <div className="text-[10px] text-white/30 font-mono">
                  как только оркестратор стартанёт — появится здесь, а вместе с ним и саб-агенты по мере вызовов
                </div>
                <button
                  onClick={() => setSidebarScope('all')}
                  className="text-[10px] text-violet-300/70 hover:text-violet-200 font-mono transition pt-1"
                >
                  ← всё-таки показать все ({sessions.length})
                </button>
              </div>
            ) : (
              <div className="space-y-3 mt-1.5 max-h-[60vh] overflow-y-auto pr-1">
                {/* === ORCHESTRATORS (root-сессии) === */}
                {orchestratorGroups.length > 0 && (
                  <div>
                    <div className="text-[9.5px] uppercase tracking-[0.14em] text-emerald-300/70 px-1 pb-1 flex items-center gap-1.5">
                      <span className="w-1 h-1 rounded-full bg-emerald-400" />
                      Оркестраторы · {orchestratorGroups.reduce((a, g) => a + g.list.length, 0)}
                    </div>
                    <div className="space-y-1">
                      {orchestratorGroups.map((g) => renderGroupCard(g))}
                    </div>
                  </div>
                )}
                {/* === WORKERS (саб-агенты) === */}
                {workerGroups.length > 0 && (
                  <div>
                    <div className="text-[9.5px] uppercase tracking-[0.14em] text-violet-300/70 px-1 pb-1 flex items-center gap-1.5">
                      <span className="w-1 h-1 rounded-full bg-violet-400" />
                      Воркеры · {workerGroups.reduce((a, g) => a + g.list.length, 0)}
                    </div>
                    <div className="space-y-1">
                      {workerGroups.map((g) => renderGroupCard(g))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          <section>
            <div className="text-[10px] uppercase tracking-[0.14em] text-white/40 px-1 flex items-center gap-1.5">
              <Cog className="w-3 h-3" />
              Этот сеанс · {runs.length}
            </div>
            {runs.length === 0 ? (
              <div className="text-[11.5px] text-white/35 px-1 py-3">Запусков пока нет.</div>
            ) : (
              <div className="space-y-1 mt-1.5">
                <AnimatePresence>
                  {runs.map((r) => {
                    const active = activeRunId === r.id
                    return (
                      <motion.div
                        key={r.id}
                        layout
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, x: 10 }}
                        onClick={() => setActiveRunId(r.id)}
                        className={
                          'group cursor-pointer px-3 py-2 rounded-md border transition ' +
                          (active
                            ? 'border-violet-400/35 bg-violet-500/10'
                            : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]')
                        }
                      >
                        <div className="flex items-center gap-2">
                          {r.status === 'running' ? (
                            <Loader2 className="w-3 h-3 text-violet-300 animate-spin flex-shrink-0" />
                          ) : (
                            <span className={'w-2 h-2 rounded-full flex-shrink-0 ' + statusDot(r.status)} />
                          )}
                          <span className="text-[11.5px] text-white/40">{r.agent}</span>
                          <span className="text-[10px] text-white/30 ml-auto">
                            {r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : '…'}
                          </span>
                          <button
                            onClick={(e) => { e.stopPropagation(); removeRun(r.id) }}
                            className="opacity-0 group-hover:opacity-100 text-white/35 hover:text-red-300 transition"
                            title="Убрать из списка"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                        <div className="text-[12px] text-white/85 line-clamp-2 mt-0.5">{r.task}</div>
                      </motion.div>
                    )
                  })}
                </AnimatePresence>
              </div>
            )}
          </section>
        </aside>
      </div>
      )}

      <ImageLightbox image={lightbox} onClose={() => setLightbox(null)} />

      {/* Tweaks (zek) — floating gear-кнопка в правом нижнем углу */}
      <TweaksPanel />

      {/* Graph modal — focused on current session's subtree */}
      <AnimatePresence>
        {graphOpen && active?.sessionId && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onMouseDown={(e) => { if (e.target === e.currentTarget) setGraphOpen(false) }}
            className="fixed inset-0 z-[80] grid place-items-center bg-black/65 backdrop-blur-sm"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 240, damping: 24 }}
              className="w-[min(1400px,96vw)] h-[min(820px,90vh)] rounded-xl border border-white/10 bg-[#0c0b16]/95 backdrop-blur-xl shadow-2xl overflow-hidden flex flex-col"
            >
              <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
                <Network className="w-4 h-4 text-violet-300" />
                <div className="text-[14px] font-medium text-white/95 flex-1">Граф этой сессии</div>
                <button
                  onClick={() => setGraphOpen(false)}
                  className="text-white/55 hover:text-white px-2.5 py-1 rounded hover:bg-white/[0.06] transition text-[12px]"
                  title="Закрыть"
                >
                  ✕
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-auto">
                <AgentGraph
                  activeSessionId={activeSessionId}
                  focusSessionId={active.sessionId}
                  onPickSession={(sid) => {
                    setAgent('claude')
                    setActiveSessionId(sid)
                    setGraphOpen(false)
                  }}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Scenario editor modal */}
      <AnimatePresence>
        {editScenario && (
          <ScenarioEditor
            value={editScenario}
            isNew={!scenarios.some((x) => x.id === editScenario.id)}
            onClose={() => setEditScenario(null)}
            onSave={(s) => {
              const exists = scenarios.some((x) => x.id === s.id)
              const next = exists
                ? scenarios.map((x) => (x.id === s.id ? s : x))
                : [...scenarios, s]
              setScenarios(next); saveScenarios(next)
              setEditScenario(null)
            }}
            onDelete={(id) => {
              const next = scenarios.filter((x) => x.id !== id)
              setScenarios(next); saveScenarios(next)
              setEditScenario(null)
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function ScenarioEditor({
  value, isNew, onClose, onSave, onDelete,
}: {
  value: Scenario
  isNew: boolean
  onClose: () => void
  onSave: (s: Scenario) => void
  onDelete: (id: string) => void
}) {
  const [title, setTitle] = useState(value.title)
  const [prompt, setPrompt] = useState(value.prompt)
  const [agent, setAgent] = useState<AgentId | ''>(value.agent ?? '')

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
      className="fixed inset-0 z-[80] grid place-items-center bg-black/55 backdrop-blur-sm"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 240, damping: 24 }}
        className="w-[min(560px,92vw)] rounded-xl border border-white/10 bg-[#0c0b16]/95 backdrop-blur-xl shadow-2xl overflow-hidden"
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
          <Play className="w-4 h-4 text-violet-300" />
          <div className="text-[14px] font-medium text-white/95 flex-1">
            {isNew ? 'Новый сценарий' : 'Редактировать сценарий'}
          </div>
        </div>
        <div className="px-4 py-4 space-y-3">
          <div>
            <div className="text-[10.5px] uppercase tracking-wider text-white/45 mb-1">Название</div>
            <input
              autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="Например: Скриншот example.com"
              className="w-full px-3 py-2 rounded-md bg-black/40 border border-white/10 text-[13px] text-white outline-none focus:border-violet-400/60 transition"
            />
          </div>
          <div>
            <div className="text-[10.5px] uppercase tracking-wider text-white/45 mb-1">Промпт</div>
            <textarea
              value={prompt} onChange={(e) => setPrompt(e.target.value)}
              rows={6} spellCheck={false}
              placeholder="Опиши что должен сделать агент…"
              className="w-full px-3 py-2 rounded-md bg-black/40 border border-white/10 text-[13px] text-white outline-none focus:border-violet-400/60 transition resize-y min-h-[120px] font-mono"
            />
          </div>
          <div>
            <div className="text-[10.5px] uppercase tracking-wider text-white/45 mb-1">Агент (опц.)</div>
            <div className="flex gap-1.5">
              {(['', 'claude', 'hermes', 'shell'] as const).map((a) => (
                <button
                  key={a || 'any'}
                  onClick={() => setAgent(a as AgentId | '')}
                  className={
                    'px-2.5 py-1 rounded text-[11.5px] border transition ' +
                    (agent === a
                      ? 'border-violet-400/40 bg-violet-500/15 text-violet-100'
                      : 'border-white/[0.08] bg-white/[0.02] text-white/55 hover:bg-white/[0.05] hover:text-white')
                  }
                >
                  {a === '' ? 'любой' : a}
                </button>
              ))}
            </div>
            <div className="text-[10px] text-white/35 mt-1">
              Если задан — при клике на сценарий автоматически переключит агента.
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 px-4 py-3 border-t border-white/[0.06] bg-black/20">
          {!isNew && (
            <button
              onClick={() => { if (confirm('Удалить?')) onDelete(value.id) }}
              className="px-2.5 py-1.5 rounded-md text-[11.5px] text-red-300/85 hover:text-red-200 hover:bg-red-500/10 transition flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" />
              Удалить
            </button>
          )}
          <span className="flex-1" />
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-[12px] text-white/65 hover:text-white hover:bg-white/[0.06] transition"
          >
            Отмена
          </button>
          <button
            onClick={() =>
              onSave({
                ...value,
                title: title.trim() || 'Без названия',
                prompt: prompt.trim(),
                ...(agent ? { agent: agent as AgentId } : { agent: undefined }),
              })
            }
            disabled={!prompt.trim()}
            className="px-3.5 py-1.5 rounded-md text-[12px] bg-gradient-to-b from-violet-500 to-indigo-600 text-white hover:from-violet-400 hover:to-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            Сохранить
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

function LineView({ line, onOpenImage }: { line: AutomationLine; onOpenImage: (img: LightboxImage) => void }) {
  // Click-to-copy was removed — native text selection + Ctrl+C is enough
  // and doesn't fight with selecting fragments.
  if (line.kind === 'prompt') {
    return (
      <div className="my-2 rounded-md border border-violet-400/20 bg-violet-500/[0.06] px-3 py-2">
        <div className="text-[10px] uppercase tracking-wider text-violet-300/85 mb-1">Запрос</div>
        <div className="text-[12.5px] text-white/95 whitespace-pre-wrap break-words selection:bg-violet-400/30">{line.text}</div>
      </div>
    )
  }
  if (line.kind === 'meta') {
    return <div className="text-violet-300/70 text-[11px] whitespace-pre-wrap break-words">$ {line.text}</div>
  }
  if (line.kind === 'artifact') {
    const url = agentFileUrl(line.path)
    const kb = line.size > 0 ? ` · ${(line.size / 1024).toFixed(0)} КБ` : ''
    return (
      <div className="my-2">
        <button
          onClick={() =>
            onOpenImage({ url, name: line.name, size: line.size, layoutId: `auto-art-${line.path}` })
          }
          className="block rounded-md overflow-hidden border border-white/[0.08] bg-black/40 hover:border-violet-400/40 transition group max-w-[480px]"
          title="Открыть в полноэкранном просмотрщике"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={line.name}
            className="block w-full h-auto max-h-[360px] object-contain bg-black/30"
          />
          <div className="px-2.5 py-1.5 flex items-center gap-2 text-[10.5px] text-white/55 group-hover:text-white/85">
            <span className="truncate">📷 {line.name}</span>
            <span className="text-white/35 flex-shrink-0">{kb}</span>
          </div>
        </button>
        <div className="text-[10px] text-white/35 mt-1 select-text font-mono">{line.path}</div>
      </div>
    )
  }
  if (line.kind === 'session') {
    return null   // not user-visible
  }
  if (line.kind === 'stderr') {
    return <pre className="text-red-300/90 whitespace-pre-wrap break-words m-0">{line.text}</pre>
  }
  if (line.kind === 'error') {
    return <div className="text-red-300 bg-red-500/10 border border-red-400/20 rounded px-2 py-1 text-[11.5px]">⚠ {line.text}</div>
  }
  if (line.kind === 'done') {
    const ok = line.code === 0
    return (
      <div className={
        'mt-2 text-[11px] px-2 py-1 rounded inline-block border ' +
        (ok
          ? 'text-emerald-300 border-emerald-400/30 bg-emerald-500/5'
          : 'text-amber-300 border-amber-400/30 bg-amber-500/5')
      }>
        ✓ exit {line.code ?? '—'} · {(line.ms / 1000).toFixed(1)}s
      </div>
    )
  }
  if (line.kind === 'step') {
    const meta = line.meta || ''
    if (meta === 'thinking') {
      return <div className="text-white/35 italic whitespace-pre-wrap break-words">💭 {line.text}</div>
    }
    if (meta === 'tool') {
      const tx = line.text || ''
      if (/automations\/delegate/.test(tx)) { const nm = (tx.match(/"name"\s*:\s*"([^"]+)"/) || [])[1]; return <div className="text-violet-300/70 text-[11px]">→ делегирует саб-агента{nm ? ': ' + nm : ''}</div> }
      if (/queue-next/.test(tx)) return <div className="text-violet-300/70 text-[11px]">→ ставит follow-up</div>
      if (/127\.0\.0\.1:3001\/automations/.test(tx)) return <div className="text-violet-300/50 text-[11px]">→ внутренний запрос</div>
      return <div className="text-sky-300/85 whitespace-pre-wrap break-words">→ {tx}</div>
    }
    if (meta === 'result') {
      let tx = line.text || ''
      try { const j = JSON.parse(tx); if (j && typeof j === 'object' && typeof j.stdout === 'string') tx = j.stdout } catch (e) {}
      return <div className="pl-3 border-l border-white/10 text-white/55"><JsonOrText text={tx} /></div>
    }
    return <div className="text-white/70 whitespace-pre-wrap break-words">· {line.text}</div>
  }
  // stdout (default) — расшифровываем встроенный JSON в читаемое дерево
  return <JsonOrText text={line.text} />
}

function statusLabel(s: RunRecord['status'], code?: number | null): string {
  if (s === 'running') return 'идёт…'
  if (s === 'done') return `ok (exit ${code ?? 0})`
  if (s === 'failed') return `сбой (exit ${code ?? '—'})`
  return 'остановлено'
}
function statusClass(s: RunRecord['status']): string {
  if (s === 'running') return 'text-violet-300 border-violet-400/30 bg-violet-500/5'
  if (s === 'done') return 'text-emerald-300 border-emerald-400/30 bg-emerald-500/5'
  if (s === 'failed') return 'text-red-300 border-red-400/30 bg-red-500/5'
  return 'text-white/55 border-white/10'
}
function statusDot(s: RunRecord['status']): string {
  if (s === 'done') return 'bg-emerald-400'
  if (s === 'failed') return 'bg-red-400'
  if (s === 'stopped') return 'bg-white/40'
  return 'bg-violet-400'
}
