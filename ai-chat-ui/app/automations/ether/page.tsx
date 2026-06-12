'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, X } from 'lucide-react'
import { Mascot, guessMascot, ROSTER_IDENTITY, type MascotId } from '../../components/Mascot'
import { listAgentSessions, getSessionHistory, type AgentSession } from '../../lib/agent-sessions'
import { AskUserBlock } from '../../components/AskUserBlock'
import type { AskUserPayload } from '../../lib/automation'
import { KIMI_API } from '../../lib/config'
import { JsonOrText } from '../../components/JsonView'
import { TweaksPanel } from '../../components/TweaksPanel'

/**
 * «Эфир» — граф диалогов между ИИ-агентами (из v2 zek handoff).
 * 10 маскотов = тайлы на гриде, дуги между ними = реальные parent→child
 * delegate-связи в сессиях. Толщина дуги = кол-во реплик. Цвет:
 *   • active (фиолет, бегущий пунктир) — если оба маскота сейчас активны
 *   • warm (зелёный) — кто-то один активен
 *   • cold (серый) — оба тихие
 *
 * Клик по дуге → панель справа с диалогом (delegate = промпт оркестратора,
 * reply = lastSummary воркера). Клик по маскоту → фокус-фильтр.
 */

// фиксированные позиции тайлов на canvas — % от размера контейнера
const NODE_POSITIONS: Record<MascotId, { x: number; y: number }> = {
  maestro:  { x: 50, y: 14 },
  mostik:   { x: 30, y: 50 },
  sisto:    { x: 50, y: 50 },
  shild:    { x: 70, y: 50 },
  logan:    { x: 50, y: 82 },
  kuvald:   { x: 18, y: 82 },
  okular:   { x: 14, y: 24 },
  signal:   { x: 86, y: 24 },
  keddi:    { x: 86, y: 82 },
  hranitel: { x: 86, y: 50 },
}

interface EtherMessage {
  t: string                 // время для отображения
  ts: number                // timestamp для сортировки
  from: MascotId
  to: MascotId
  type: 'delegate' | 'reply'
  msg: string
  detail?: string
  sessionId?: string        // чтоб можно было открыть конкретную сессию
}

interface EtherEdge {
  id: string                // "a|b" (sorted ids)
  a: MascotId
  b: MascotId
  messages: EtherMessage[]
}

/** Превратить серверные сессии в feed диалогов и edges между маскотами. */
function buildEtherFromSessions(sessions: AgentSession[], resolve: (s: AgentSession) => MascotId = (s) => guessMascot((s.name || '') + ' ' + (s.lastPrompt || ''))): { feed: EtherMessage[]; edges: EtherEdge[]; mascotMsgCounts: Partial<Record<MascotId, number>>; mascotActive: Set<MascotId> } {
  const byId = new Map(sessions.map((s) => [s.id, s]))
  const feed: EtherMessage[] = []
  for (const child of sessions) {
    if (!child.parentSessionId) continue
    const parent = byId.get(child.parentSessionId)
    if (!parent) continue
    const from: MascotId = resolve(parent)
    const to: MascotId = resolve(child)
    if (from === to) continue // self-loop skip
    // delegate event = parent позвал child с задачей
    const delegateTs = child.createdAt || child.lastUsedAt || Date.now()
    feed.push({
      t: formatTime(delegateTs),
      ts: delegateTs,
      from,
      to,
      type: 'delegate',
      msg: child.name || child.lastPrompt?.slice(0, 100) || '— задача —',
      detail: child.lastPrompt ? `задача: ${child.lastPrompt.slice(0, 240)}` : undefined,
      sessionId: child.id,
    })
    // reply event = если child что-то ответил (есть lastSummary), считаем что он responded
    if (child.lastSummary && child.turns > 0) {
      feed.push({
        t: formatTime(child.lastUsedAt || Date.now()),
        ts: child.lastUsedAt || Date.now(),
        from: to,
        to: from,
        type: 'reply',
        msg: child.lastSummary,
        detail: `от: ${child.name}`,
        sessionId: child.id,
      })
    }
  }
  feed.sort((a, b) => a.ts - b.ts)

  // build edges (одна на пару маскотов)
  const edgeMap = new Map<string, EtherEdge>()
  for (const r of feed) {
    const a = r.from < r.to ? r.from : r.to
    const b = r.from < r.to ? r.to : r.from
    const key = `${a}|${b}`
    if (!edgeMap.has(key)) edgeMap.set(key, { id: key, a: a as MascotId, b: b as MascotId, messages: [] })
    edgeMap.get(key)!.messages.push(r)
  }
  const edges = [...edgeMap.values()]

  // mascot active set (live < 90s)
  const mascotActive = new Set<MascotId>()
  for (const s of sessions) {
    if (Date.now() - (s.lastUsedAt || 0) < 90_000 && s.turns > 0) {
      mascotActive.add(resolve(s))
    }
  }

  // counts per mascot
  const mascotMsgCounts: Partial<Record<MascotId, number>> = {}
  for (const r of feed) {
    mascotMsgCounts[r.from] = (mascotMsgCounts[r.from] || 0) + 1
    mascotMsgCounts[r.to]   = (mascotMsgCounts[r.to]   || 0) + 1
  }

  return { feed, edges, mascotMsgCounts, mascotActive }
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

// ─── small atomic components ───────────────────────────────────────────────

function StatusDot({ active }: { active: boolean }) {
  return (
    <span
      className={
        'inline-block w-1.5 h-1.5 rounded-full ' +
        (active ? 'bg-violet-400 shadow-[0_0_8px_rgba(167,139,250,0.6)]' : 'bg-white/30')
      }
    />
  )
}

interface NodeTileProps {
  mid: MascotId
  active: boolean
  msgCount: number
  focused: boolean
  dimmed: boolean
  onClick: () => void
  /** Реальное имя сессии (воркера) — показываем вместо имени персоны */
  name?: string
}
function NodeTile({ mid, active, msgCount, focused, dimmed, onClick, name }: NodeTileProps) {
  const ident = ROSTER_IDENTITY.find((m) => m.id === mid)!
  const pos = NODE_POSITIONS[mid]
  return (
    <button
      data-agent-anchor={mid}
      onClick={onClick}
      className={`zek-node-tile ${focused ? 'focused' : ''} ${dimmed ? 'dimmed' : ''}`}
      style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
    >
      <span className="zek-node-status"><StatusDot active={active} /></span>
      <Mascot id={mid} size={42} live={active} />
      <span className="zek-node-name">{name || ident.name}</span>
      <span className="zek-node-meta">{msgCount > 0 ? `${msgCount} реплик` : ident.domain.toLowerCase()}</span>
    </button>
  )
}

// ─── main page ─────────────────────────────────────────────────────────────

export default function EtherPage() {
  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null)
  const [hoverEdge, setHoverEdge] = useState<string | null>(null)
  const [focusAgent, setFocusAgent] = useState<MascotId | null>(null)
  /** Set of edge ids that appeared in the last refresh — для flash-анимации. */
  const [newEdgeIds, setNewEdgeIds] = useState<Set<string>>(new Set())
  /** focusSessionId из ?focus=<sid> URL param — сессия которую только что
      запустил юзер (подсветим её маскота + auto-select его edge). */
  const [focusSessionId, setFocusSessionId] = useState<string | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const [paths, setPaths] = useState<Array<{ id: string; d: string; count: number; state: 'cold' | 'warm' | 'active'; midX: number; midY: number }>>([])
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [orchThoughts, setOrchThoughts] = useState<Array<{ kind: string; meta?: string; text: string }>>([])
  const [pendingAsk, setPendingAsk] = useState<{ payload: AskUserPayload; sessionId: string } | null>(null)
  const [reportText, setReportText] = useState('')
  const answeredAskRef = useRef<string>('')
  const submitAsk = (formatted: string) => {
    if (!pendingAsk) return
    answeredAskRef.current = JSON.stringify(pendingAsk.payload)
    const sid = pendingAsk.sessionId
    setPendingAsk(null)
    fetch(`${KIMI_API}/automations/run-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: 'claude', task: formatted, sessionId: sid }),
    }).catch(() => {})
  }
  const [reportOpen, setReportOpen] = useState(false)
  const autoReportRef = useRef<string | null>(null)
  const turnsSeenRef = useRef<Map<string, number>>(new Map())
  const thoughtsRef = useRef<HTMLDivElement>(null)

  // parse ?focus=<sid> on mount
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const f = params.get('focus')
    // Нет ?focus= → наводимся на новейший ран (а не на всю историю).
    setFocusSessionId(f || '__pending__')
  }, [])

  // pull sessions + auto-refresh 2s (real-time feel)
  useEffect(() => {
    let cancelled = false
    let prevEdgeIds = new Set<string>()
    const pull = async () => {
      try {
        const s = await listAgentSessions(80)
        if (cancelled) return
        // detect new edges since last poll for flash effect
        const eth = buildEtherFromSessions(s)
        const curIds = new Set(eth.edges.map((e) => e.id))
        const newOnes = new Set<string>()
        for (const id of curIds) if (!prevEdgeIds.has(id)) newOnes.add(id)
        if (prevEdgeIds.size > 0 && newOnes.size > 0) {
          setNewEdgeIds(newOnes)
          setTimeout(() => setNewEdgeIds(new Set()), 2200)
        }
        prevEdgeIds = curIds
        setSessions(s)
      } catch { /* ignore */ }
    }
    void pull()
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void pull()
    }, 2000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  // Self-heal: окно открыли на sentinel '__pending__' (свежий запуск, id ещё
  // неизвестен). Как только в поллинге появится новейшая root-сессия —
  // наводимся на неё сами, не завися от навигации из opener-окна.
  useEffect(() => {
    if (focusSessionId !== '__pending__') return
    const roots = sessions.filter((s) => !s.parentSessionId)
    if (roots.length === 0) return
    const newest = roots.reduce((a, b) => ((b.createdAt || 0) > (a.createdAt || 0) ? b : a))
    setFocusSessionId(newest.id)
  }, [sessions, focusSessionId])

  /** Множество id сессий в дереве фокус-сессии (root + все потомки BFS). */
  const treeSessionIds = useMemo(() => {
    if (!focusSessionId) return null // null = no filter
    const ids = new Set<string>([focusSessionId])
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
  }, [focusSessionId, sessions])

  /** Сессии для эфира — отфильтрованные по дереву если scope=focus. */
  const visibleSessions = useMemo(() => {
    if (!treeSessionIds) return sessions
    return sessions.filter((s) => treeSessionIds.has(s.id))
  }, [sessions, treeSessionIds])

  const sessionMascot = useMemo(() => {
    const map = new Map<string, MascotId>()
    const roster = ROSTER_IDENTITY.map((m) => m.id)
    const ordered = [...visibleSessions].sort((a, b) => {
      const ra = a.parentSessionId ? 1 : 0
      const rb = b.parentSessionId ? 1 : 0
      if (ra !== rb) return ra - rb
      return (a.createdAt || 0) - (b.createdAt || 0)
    })
    ordered.forEach((sx, i) => map.set(sx.id, roster[i % roster.length]))
    return map
  }, [visibleSessions])
  const resolveMascot = useMemo(
    () => (sx: AgentSession) => sessionMascot.get(sx.id) || guessMascot((sx.name || '') + ' ' + (sx.lastPrompt || '')),
    [sessionMascot],
  )
  const nodeNames = useMemo(() => {
    const map = new Map<MascotId, string>()
    for (const sx of visibleSessions) {
      const nm = (sx.name || sx.lastPrompt || '').trim()
      if (nm) map.set(resolveMascot(sx), nm.length > 18 ? nm.slice(0, 18) + '…' : nm)
    }
    return map
  }, [visibleSessions, resolveMascot])
  const ether = useMemo(() => buildEtherFromSessions(visibleSessions, resolveMascot), [visibleSessions, resolveMascot])
  const { feed, edges, mascotMsgCounts, mascotActive } = ether

  /** Маскоты которые ВИДНЫ на canvas — только те которые реально общаются,
      т.е. участвуют хотя бы в одном edge ИЛИ являются root-оркестратором
      текущего фокуса. Маскоты с изолированными сессиями (никого не звали
      и их никто не звал) — НЕ показываем чтоб не захламлять. */
  const visibleMascots: Set<MascotId> = useMemo(() => {
    const set = new Set<MascotId>()
    // 1) все участники edges (т.е. реально общающиеся пары)
    for (const e of ether.edges) {
      set.add(e.a)
      set.add(e.b)
    }
    // 2) корень фокус-сессии — всегда показываем, даже если он ещё не звал воркеров
    if (focusSessionId) {
      const focusSess = visibleSessions.find((s) => s.id === focusSessionId)
      if (focusSess) {
        // climb to root
        let root = focusSess
        let safety = 10
        const byId = new Map(visibleSessions.map((s) => [s.id, s]))
        while (safety-- > 0 && root.parentSessionId) {
          const p = byId.get(root.parentSessionId)
          if (!p) break
          root = p
        }
        set.add(resolveMascot(root))
      }
    }
    return set
  }, [ether, focusSessionId, visibleSessions])
  // Корень дерева фокуса = главный оркестратор.
  const rootSessionId = useMemo(() => {
    if (!focusSessionId || focusSessionId === '__pending__') return null
    const byId = new Map(sessions.map((s) => [s.id, s]))
    let cur = byId.get(focusSessionId)
    if (!cur) return focusSessionId
    let safety = 10
    while (safety-- > 0 && cur && cur.parentSessionId) {
      const p = byId.get(cur.parentSessionId)
      if (!p) break
      cur = p
    }
    return cur?.id || focusSessionId
  }, [sessions, focusSessionId])
  // Live-поток мыслей/логики оркестратора (thinking + нарратив + вызовы tools).
  useEffect(() => {
    if (!rootSessionId) { setOrchThoughts([]); return }
    let cancelled = false
    const pull = async () => {
      try {
        const res = await getSessionHistory(rootSessionId)
        if (cancelled) return
        const th = (res.lines || [])
          .filter((l: any) => l.kind === 'stdout' || (l.kind === 'step' && (l.meta === 'thinking' || l.meta === 'tool' || l.meta === 'note')))
          .map((l: any) => ({ kind: l.kind, meta: l.meta, text: String(l.text || '').trim().slice(0, 600) }))
          .filter((l: any) => l.text)
        setOrchThoughts(th)
        // Детект НЕОТВЕЧЕННОГО [[ASK_USER]]-опроса (последний, после которого нет нового prompt'а)
        const ls: any[] = res.lines || []
        const rTail: string[] = []
        for (let ri = ls.length - 1; ri >= 0; ri--) {
          const rl = ls[ri]
          if (rl.kind === 'stdout' && !rl.meta) rTail.unshift(String(rl.text || ''))
          else if (rTail.length) break
        }
        const rJoined = rTail.join('\n').trim()
        setReportText(rJoined.length >= 40 ? rJoined : ls.filter((l: any) => l.kind === 'stdout' && !l.meta).reduce((a: string, b: any) => (String(b.text || '').length > a.length ? String(b.text) : a), ''))
        let lastPromptIdx = -1, askIdx = -1, askPayload: AskUserPayload | null = null
        ls.forEach((l: any, i: number) => {
          if (l.kind === 'prompt') lastPromptIdx = i
          const t = typeof l.text === 'string' ? l.text : ''
          if (t.includes('[[ASK_USER]]')) {
            const mm = t.match(/\[\[ASK_USER\]\]([\s\S]*?)\[\[\/ASK_USER\]\]/)
            if (mm) { try { const j = JSON.parse(mm[1].trim()); if (j && Array.isArray(j.questions) && j.questions.length) { askPayload = j; askIdx = i } } catch { /* */ } }
          }
        })
        if (askPayload && askIdx > lastPromptIdx && JSON.stringify(askPayload) !== answeredAskRef.current) {
          setPendingAsk({ payload: askPayload, sessionId: rootSessionId })
        } else {
          setPendingAsk(null)
        }
      } catch { /* ignore */ }
    }
    void pull()
    const id = setInterval(() => { if (document.visibilityState === 'visible') void pull() }, 3000)
    return () => { cancelled = true; clearInterval(id) }
  }, [rootSessionId])
  useEffect(() => { thoughtsRef.current?.scrollTo({ top: thoughtsRef.current.scrollHeight }) }, [orchThoughts])
  // Финальный отчёт оркестратора = последний непрерывный блок его stdout-нарратива.
  const finalReport = reportText
  // Авто-открытие отчёта ОДИН раз — когда у оркестратора ЗАВЕРШИЛСЯ ход
  // (его turns вырос с момента, как мы начали смотреть). lastUsedAt для этого
  // не годится: он не обновляется ВО ВРЕМЯ длинного активного хода, из-за чего
  // модал раньше выскакивал в начале на стартовой фразе оркестратора.
  useEffect(() => {
    if (!rootSessionId) return
    const root = sessions.find((s) => s.id === rootSessionId)
    if (!root) return
    const t = root.turns || 0
    const prev = turnsSeenRef.current.get(rootSessionId)
    if (prev === undefined) {
      turnsSeenRef.current.set(rootSessionId, t)
      return
    }
    if (t > prev && finalReport && (root as { lastClean?: boolean }).lastClean !== false && autoReportRef.current !== rootSessionId) {
      autoReportRef.current = rootSessionId
      setReportOpen(true)
    }
    turnsSeenRef.current.set(rootSessionId, t)
  }, [sessions, rootSessionId, finalReport])

  // auto-select first edge when data lands
  useEffect(() => {
    if (selectedEdge && edges.some((e) => e.id === selectedEdge)) return
    if (edges.length > 0) setSelectedEdge(edges[0].id)
    else setSelectedEdge(null)
  }, [edges, selectedEdge])

  // если пришли с ?focus=<sid> — подсветить маскота этой сессии
  useEffect(() => {
    if (!focusSessionId || sessions.length === 0) return
    const s = sessions.find((x) => x.id === focusSessionId)
    if (!s) return
    const m = resolveMascot(s)
    setFocusAgent(m)
  }, [focusSessionId, sessions])

  // recompute curved paths between tile centers
  useLayoutEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const recompute = () => {
      const rect = el.getBoundingClientRect()
      setSize({ w: rect.width, h: rect.height })
      const next = edges.map((e, idx) => {
        const fa = el.querySelector(`[data-agent-anchor="${e.a}"]`)
        const fb = el.querySelector(`[data-agent-anchor="${e.b}"]`)
        if (!fa || !fb) return null
        const ra = fa.getBoundingClientRect()
        const rb = fb.getBoundingClientRect()
        const x1 = ra.left + ra.width / 2 - rect.left
        const y1 = ra.top + ra.height / 2 - rect.top
        const x2 = rb.left + rb.width / 2 - rect.left
        const y2 = rb.top + rb.height / 2 - rect.top
        const mx = (x1 + x2) / 2
        const my = (y1 + y2) / 2
        const dx = x2 - x1, dy = y2 - y1
        const len = Math.sqrt(dx * dx + dy * dy) || 1
        const off = Math.min(60, len * 0.18)
        const sign = idx % 2 === 0 ? 1 : -1
        const cxp = mx + (-dy / len) * off * sign
        const cyp = my + (dx / len) * off * sign
        const TILE_R = 55
        const a1 = Math.atan2(cyp - y1, cxp - x1)
        const a2 = Math.atan2(cyp - y2, cxp - x2)
        const sx1 = x1 + Math.cos(a1) * TILE_R
        const sy1 = y1 + Math.sin(a1) * TILE_R
        const sx2 = x2 + Math.cos(a2) * TILE_R
        const sy2 = y2 + Math.sin(a2) * TILE_R
        const aa = mascotActive.has(e.a)
        const ab = mascotActive.has(e.b)
        const state = aa && ab ? 'active' : aa || ab ? 'warm' : 'cold'
        return {
          id: e.id,
          d: `M ${sx1.toFixed(1)} ${sy1.toFixed(1)} Q ${cxp.toFixed(1)} ${cyp.toFixed(1)} ${sx2.toFixed(1)} ${sy2.toFixed(1)}`,
          count: e.messages.length,
          state: state as 'cold' | 'warm' | 'active',
          midX: cxp,
          midY: cyp,
        }
      }).filter(Boolean) as typeof paths
      setPaths(next)
    }
    recompute()
    const ro = new ResizeObserver(recompute)
    ro.observe(el)
    window.addEventListener('resize', recompute)
    return () => { ro.disconnect(); window.removeEventListener('resize', recompute) }
  }, [edges, mascotActive])

  const selectedEdgeData = edges.find((e) => e.id === selectedEdge) || null

  const focusedEdgeIds = useMemo(() => {
    if (!focusAgent) return null
    return new Set(edges.filter((e) => e.a === focusAgent || e.b === focusAgent).map((e) => e.id))
  }, [focusAgent, edges])

  return (
    <div
      className="min-h-screen text-[var(--zek-text)] flex flex-col"
      style={{
        background: 'var(--zek-bg)',
        fontFamily: 'var(--zek-font-active, "Geist", system-ui, sans-serif)',
        height: '100vh',
        overflow: 'hidden',
      }}
    >
      {/* top bar */}
      <header className="h-12 border-b border-[var(--zek-line)] flex items-center px-5 gap-6 flex-shrink-0">
        <Link href="/automations" className="text-[var(--zek-text-2)] hover:text-[var(--zek-text)] transition flex items-center gap-1.5 text-[13px]">
          <ArrowLeft className="w-3.5 h-3.5" />
          к автоматам
        </Link>
        <span className="flex items-center gap-2.5">
          <span className="w-[18px] h-[18px] rounded grid place-items-center font-mono text-[11px] font-bold" style={{ background: 'var(--zek-accent)', color: '#062014' }}>з</span>
          <span className="font-mono text-[13px] tracking-wider">
            зек <span className="text-[var(--zek-text-3)]">/ эфир</span>
          </span>
        </span>
        <span className="flex-1" />
        <Link href="/automations/squad" className="font-mono text-[11px] text-[var(--zek-text-2)] hover:text-[var(--zek-text)] transition">отряд</Link>
        <Link href="/automations/flow" className="font-mono text-[11px] text-[var(--zek-text-2)] hover:text-[var(--zek-text)] transition">поток</Link>
      </header>

      {/* page heading */}
      <div className="flex items-end justify-between px-8 py-5 gap-4 flex-wrap border-b border-[var(--zek-line)] flex-shrink-0">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--zek-text-3)] mb-1">
            эфир · граф диалогов · live · обновление 2с
            {focusSessionId && focusSessionId !== '__pending__' && (
              <span className="text-[var(--zek-amber)] ml-2">
                · фокус: {sessions.find((s) => s.id === focusSessionId)?.name?.slice(0, 50) || focusSessionId}…
              </span>
            )}
          </div>
          <h1 className="text-[22px] font-semibold tracking-tight m-0">
            {visibleMascots.size > 0 ? (
              <>
                {visibleMascots.size} агент{visibleMascots.size === 1 ? '' : visibleMascots.size < 5 ? 'а' : 'ов'}
                {' · '}
                {edges.length} канал{edges.length === 1 ? '' : edges.length < 5 ? 'а' : 'ов'}
                {' · '}
                {feed.length} реплик
              </>
            ) : (
              'жду спавна агентов…'
            )}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {focusAgent && (
            <button
              onClick={() => setFocusAgent(null)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border bg-[var(--zek-bg-2)] border-[var(--zek-line-2)] text-[var(--zek-text)] font-mono text-[11px]"
            >
              <Mascot id={focusAgent} size={14} />
              {ROSTER_IDENTITY.find((m) => m.id === focusAgent)?.name}
              <X className="w-2.5 h-2.5 text-[var(--zek-text-3)]" />
            </button>
          )}
        </div>
      </div>

      {/* body: canvas + side dialog panel */}
      <div
        className="flex-1 min-h-0 grid"
        style={{ gridTemplateColumns: selectedEdgeData ? '1fr 360px' : '1fr' }}
      >
        <div ref={canvasRef} className="zek-ether-canvas relative min-h-0">
          {rootSessionId && orchThoughts.length > 0 && (
            <div className="absolute left-3 top-3 bottom-3 w-[330px] z-10 rounded-lg border border-[var(--zek-line)] bg-[var(--zek-bg-1)]/85 backdrop-blur flex flex-col overflow-hidden">
              <div className="px-3 py-2 border-b border-[var(--zek-line)] text-[10.5px] uppercase tracking-wider text-[var(--zek-amber)] font-mono flex items-center gap-1.5">
                <span>🧠 мысли оркестратора</span>
                <span className="ml-auto text-[var(--zek-text-3)] normal-case tracking-normal">{orchThoughts.length}</span>
              </div>
              <div ref={thoughtsRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5 text-[11.5px] leading-snug">
                {orchThoughts.map((l, i) => (
                  <div
                    key={i}
                    className={
                      l.meta === 'thinking'
                        ? 'text-[var(--zek-text-2)] italic'
                        : l.meta === 'tool'
                          ? 'text-[var(--zek-purple)] font-mono text-[10px] break-all'
                          : 'text-[var(--zek-text)]'
                    }
                  >
                    {l.meta === 'thinking' ? '💭 ' : l.meta === 'tool' ? '⚙ ' : '› '}
                    {l.text}
                  </div>
                ))}
              </div>
            </div>
          )}
          <svg
            className="zek-ether-svg"
            width={size.w}
            height={size.h}
            viewBox={`0 0 ${size.w} ${size.h}`}
          >
            {paths.map((p) => {
              const isSelected = p.id === selectedEdge
              const isHover = p.id === hoverEdge
              const isFocused = focusedEdgeIds ? focusedEdgeIds.has(p.id) : true
              const isNew = newEdgeIds.has(p.id)
              return (
                <g
                  key={p.id}
                  className={`edge ${p.state} ${isSelected ? 'selected' : ''} ${isHover ? 'hover' : ''} ${!isFocused ? 'out-of-focus' : ''} ${isNew ? 'just-appeared' : ''}`}
                >
                  {/* fat invisible hit area */}
                  <path
                    d={p.d}
                    stroke="transparent"
                    strokeWidth="22"
                    fill="none"
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelectedEdge(p.id)}
                    onMouseEnter={() => setHoverEdge(p.id)}
                    onMouseLeave={() => setHoverEdge(null)}
                  />
                  <path
                    d={p.d}
                    className="zek-edge-path"
                    strokeWidth={isSelected ? 2.4 : Math.min(2.2, 0.7 + p.count * 0.18)}
                  />
                  {/* count badge */}
                  <g
                    transform={`translate(${p.midX} ${p.midY})`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelectedEdge(p.id)}
                  >
                    <circle r="11" className="zek-edge-badge-bg" />
                    <text className="zek-edge-badge-txt" textAnchor="middle" dy="3.5">{p.count}</text>
                  </g>
                </g>
              )
            })}
          </svg>

          {ROSTER_IDENTITY.map((ident) => {
            // В focus-режиме рендерим только те маскоты у которых есть
            // сессии в visibleSessions. В all-режиме — все 10.
            if (!visibleMascots.has(ident.id)) return null
            const isActive = mascotActive.has(ident.id)
            const isFocused = focusAgent === ident.id || (selectedEdgeData && (selectedEdgeData.a === ident.id || selectedEdgeData.b === ident.id))
            const dimmed = !!(focusAgent && ident.id !== focusAgent && !focusedEdgeIds?.has(
              edges.find((e) => (e.a === focusAgent && e.b === ident.id) || (e.b === focusAgent && e.a === ident.id))?.id || '',
            ))
            return (
              <NodeTile
                key={ident.id}
                mid={ident.id}
                name={nodeNames.get(ident.id)}
                active={isActive}
                msgCount={mascotMsgCounts[ident.id] || 0}
                focused={!!isFocused}
                dimmed={dimmed}
                onClick={() => setFocusAgent(focusAgent === ident.id ? null : ident.id)}
              />
            )
          })}

          {visibleMascots.size === 0 && (
            <div className="absolute inset-0 grid place-items-center pointer-events-none">
              <div className="text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full border-2 border-dashed border-[var(--zek-line-2)] mb-3 animate-pulse">
                  <span className="text-[var(--zek-text-3)] text-2xl font-mono">·</span>
                </div>
                <div className="font-mono text-[11px] text-[var(--zek-text-3)] uppercase tracking-wider">
                  {focusSessionId && focusSessionId !== '__pending__'
                    ? 'жду спавна агентов от оркестратора…'
                    : 'нет активных каналов · запусти оркестратора'}
                </div>
              </div>
            </div>
          )}
          {visibleMascots.size > 0 && edges.length === 0 && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 pointer-events-none">
              <div className="font-mono text-[10.5px] text-[var(--zek-text-3)] uppercase tracking-wider bg-[var(--zek-bg-1)] border border-[var(--zek-line)] rounded-full px-3 py-1">
                ⌛ оркестратор работает · скоро позовёт воркеров…
              </div>
            </div>
          )}
        </div>

        {selectedEdgeData && (
          <aside
            className="border-l border-[var(--zek-line)] flex flex-col min-h-0"
            style={{ background: 'var(--zek-bg)' }}
          >
            <header className="px-4 py-3 border-b border-[var(--zek-line)] flex-shrink-0">
              <div className="flex items-center gap-2 mb-1.5 text-[13px] font-semibold">
                <Mascot id={selectedEdgeData.a} size={22} live={mascotActive.has(selectedEdgeData.a)} />
                <span>{ROSTER_IDENTITY.find((m) => m.id === selectedEdgeData.a)?.name}</span>
                <span className="text-[14px] mx-0.5" style={{ color: 'var(--zek-purple)' }}>⇄</span>
                <Mascot id={selectedEdgeData.b} size={22} live={mascotActive.has(selectedEdgeData.b)} />
                <span>{ROSTER_IDENTITY.find((m) => m.id === selectedEdgeData.b)?.name}</span>
              </div>
              <div className="flex items-center gap-1.5 font-mono text-[10.5px] text-[var(--zek-text-3)]">
                <span>{selectedEdgeData.messages.length} реплик</span>
                <span>·</span>
                <span>{selectedEdgeData.messages[0]?.t} → {selectedEdgeData.messages[selectedEdgeData.messages.length - 1]?.t}</span>
                <button
                  onClick={() => setSelectedEdge(null)}
                  className="ml-auto w-6 h-6 rounded grid place-items-center text-[var(--zek-text-3)] hover:text-[var(--zek-text)] hover:bg-white/[0.05] transition"
                  title="закрыть"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3.5 min-h-0">
              {selectedEdgeData.messages.map((m, i) => {
                const isLeft = m.from === selectedEdgeData.a
                const meta = m.type === 'delegate'
                  ? { sym: '→', color: 'var(--zek-purple)', label: 'просит' }
                  : { sym: '←', color: 'var(--zek-accent)', label: 'отвечает' }
                const fromIdent = ROSTER_IDENTITY.find((x) => x.id === m.from)
                return (
                  <div key={i} className={`zek-bubble-row ${isLeft ? 'left' : 'right'}`}>
                    {isLeft && <Mascot id={m.from} size={20} live={mascotActive.has(m.from)} />}
                    <div className={`zek-bubble ${m.type}`}>
                      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--zek-text-3)]">
                        <span className="text-[var(--zek-text-2)]">{fromIdent?.name}</span>
                        <span style={{ color: meta.color }}>{meta.sym} {meta.label}</span>
                        <span className="ml-auto">{m.t}</span>
                      </div>
                      <div className="text-[12.5px] leading-[1.5] text-[var(--zek-text)] whitespace-pre-wrap"><JsonOrText text={m.msg} /></div>
                      {m.detail && (
                        <div className="mt-1.5 px-2 py-1.5 rounded border border-[var(--zek-line)] font-mono text-[10.5px] text-[var(--zek-text-3)] leading-[1.5]" style={{ background: 'var(--zek-bg)' }}>
                          {m.detail}
                        </div>
                      )}
                      {m.sessionId && (
                        <Link
                          href={`/automations?session=${m.sessionId}`}
                          className="text-[10px] font-mono text-[var(--zek-accent)] hover:text-[var(--zek-text)] transition self-end"
                        >
                          ↪ открыть сессию
                        </Link>
                      )}
                    </div>
                    {!isLeft && <Mascot id={m.from} size={20} live={mascotActive.has(m.from)} />}
                  </div>
                )
              })}
            </div>
          </aside>
        )}
      </div>

      {finalReport && (
        <button
          onClick={() => setReportOpen(true)}
          className="fixed top-2.5 left-1/2 -translate-x-1/2 z-30 px-4 py-1.5 rounded-full border border-[var(--zek-amber)] bg-[var(--zek-amber)] text-[#1a1325] text-[12px] font-mono font-semibold shadow-lg hover:brightness-110 transition"
        >
          ☰ Финальный отчёт
        </button>
      )}
      {reportOpen && finalReport && (
        <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm grid place-items-center p-6" onClick={() => setReportOpen(false)}>
          <div className="w-full max-w-3xl max-h-[85vh] rounded-xl border border-[var(--zek-line-2)] bg-[var(--zek-bg-1)] flex flex-col overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-[var(--zek-line)] flex items-center gap-2">
              <span className="text-[15px]">📋</span>
              <div className="text-[13px] font-semibold text-[var(--zek-text)]">Финальный отчёт оркестратора</div>
              <button onClick={() => setReportOpen(false)} className="ml-auto text-[var(--zek-text-3)] hover:text-[var(--zek-text)]"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 text-[13px] leading-relaxed">
              <JsonOrText text={finalReport} />
            </div>
          </div>
        </div>
      )}
      {pendingAsk && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 w-[min(560px,92vw)] max-h-[70vh] overflow-y-auto rounded-xl border border-violet-400/30 bg-[var(--zek-bg-1)] shadow-2xl">
          <div className="px-3 py-1.5 text-[10.5px] uppercase tracking-wider text-violet-300/80 border-b border-violet-400/20">агент спрашивает — ответь прямо тут</div>
          <AskUserBlock payload={pendingAsk.payload} onSubmit={(text) => submitAsk(text)} />
        </div>
      )}
      <TweaksPanel />
    </div>
  )
}
