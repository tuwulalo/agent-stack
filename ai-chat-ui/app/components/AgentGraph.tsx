'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Cpu, Network, RefreshCw } from 'lucide-react'
import { type AgentSession, listAgentSessions } from '../lib/agent-sessions'

/* ── layout maths ─────────────────────────────────────────────────────── */

interface PositionedNode {
  s: AgentSession
  x: number
  y: number
  width: number          // total horizontal slot reserved (incl. descendants)
  childrenIds: string[]
}

const NODE_R = 26
const COL_GAP = 110       // horizontal pixels per leaf
const ROW_GAP = 130       // vertical pixels per depth level
const PADDING = 60        // canvas margin

/** Lay out a forest of sessions as a hierarchical tree (top-down).
    Each leaf takes `COL_GAP` horizontal slot, parents centered above. */
function layout(sessions: AgentSession[]): {
  nodes: Map<string, PositionedNode>
  width: number
  height: number
  edges: Array<{ from: string; to: string }>
} {
  const byParent = new Map<string | null, AgentSession[]>()
  for (const s of sessions) {
    const k = s.parentSessionId || null
    if (!byParent.has(k)) byParent.set(k, [])
    byParent.get(k)!.push(s)
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => a.createdAt - b.createdAt)
  }

  const nodes = new Map<string, PositionedNode>()
  const edges: Array<{ from: string; to: string }> = []
  let maxDepth = 0

  // First pass: compute width for each node (= max(1, sum of children widths))
  const widthCache = new Map<string, number>()
  function widthOf(id: string | null): number {
    if (widthCache.has(id ?? '__roots__')) return widthCache.get(id ?? '__roots__')!
    const kids = byParent.get(id) || []
    let w: number
    if (kids.length === 0) w = 1
    else w = kids.reduce((acc, k) => acc + widthOf(k.id), 0)
    widthCache.set(id ?? '__roots__', w)
    return w
  }

  const totalLeafSlots = widthOf(null)

  // Second pass: assign x-positions
  function place(parentId: string | null, leftSlot: number, depth: number): void {
    const kids = byParent.get(parentId) || []
    let cursor = leftSlot
    for (const s of kids) {
      const w = widthOf(s.id)
      const centerSlot = cursor + w / 2
      const x = PADDING + centerSlot * COL_GAP
      const y = PADDING + depth * ROW_GAP
      const childrenIds = (byParent.get(s.id) || []).map((c) => c.id)
      nodes.set(s.id, { s, x, y, width: w * COL_GAP, childrenIds })
      if (parentId) edges.push({ from: parentId, to: s.id })
      maxDepth = Math.max(maxDepth, depth)
      place(s.id, cursor, depth + 1)
      cursor += w
    }
  }
  place(null, 0, 0)

  const width = PADDING * 2 + totalLeafSlots * COL_GAP
  const height = PADDING * 2 + maxDepth * ROW_GAP + NODE_R * 2

  return { nodes, edges, width, height }
}

/* ── status colors ────────────────────────────────────────────────────── */

type Status = 'running' | 'done' | 'failed' | 'idle'

function statusOf(s: AgentSession, byParent: Map<string | null, AgentSession[]>): Status {
  // We don't have a real-time "running" flag — infer:
  //  recent (< 90s since lastUsedAt) and has 0 children or children also recent → running
  const recent = Date.now() - (s.lastUsedAt || 0) < 90_000
  if (recent && s.turns > 0) return 'running'
  if (s.turns === 0) return 'idle'
  if (s.lastSummary && s.lastSummary.length > 0) return 'done'
  return 'done'
}

const STATUS_FILL: Record<Status, string> = {
  running: '#a78bfa',     // violet-400
  done:    '#34d399',     // emerald-400
  failed:  '#f87171',     // red-400
  idle:    '#525252',     // neutral-600
}
const STATUS_GLOW: Record<Status, string> = {
  running: 'rgba(167, 139, 250, 0.6)',
  done:    'rgba(52, 211, 153, 0.35)',
  failed:  'rgba(248, 113, 113, 0.5)',
  idle:    'rgba(80, 80, 80, 0.2)',
}

/* ── main component ───────────────────────────────────────────────────── */

interface Props {
  /** Click on a node → caller can switch to Run tab + pin this session */
  onPickSession?: (sessionId: string) => void
  activeSessionId?: string | null
  /** External refresh trigger — bump to re-fetch */
  refreshKey?: number
  /** If set, show only sessions in the subtree rooted at this session
      (climbs to the ultimate root, then includes all descendants).
      Useful when invoking the graph from within a single chat. */
  focusSessionId?: string | null
}

export function AgentGraph({ onPickSession, activeSessionId, refreshKey = 0, focusSessionId = null }: Props) {
  const [allSessions, setAllSessions] = useState<AgentSession[]>([])
  const [loading, setLoading] = useState(false)
  const [now, setNow] = useState(Date.now())

  // Filter sessions to the focus subtree (root ancestor + all descendants)
  const sessions = useMemo(() => {
    if (!focusSessionId) return allSessions
    const byId = new Map(allSessions.map((s) => [s.id, s]))
    // Climb to find the ultimate root
    let rootId = focusSessionId
    let cursor = byId.get(focusSessionId)
    while (cursor?.parentSessionId) {
      rootId = cursor.parentSessionId
      cursor = byId.get(cursor.parentSessionId)
    }
    // BFS down from root, collect descendants
    const out = new Set<string>([rootId])
    const queue = [rootId]
    const childrenOf = new Map<string, string[]>()
    for (const s of allSessions) {
      if (!s.parentSessionId) continue
      if (!childrenOf.has(s.parentSessionId)) childrenOf.set(s.parentSessionId, [])
      childrenOf.get(s.parentSessionId)!.push(s.id)
    }
    while (queue.length > 0) {
      const id = queue.shift()!
      for (const cid of (childrenOf.get(id) || [])) {
        if (!out.has(cid)) { out.add(cid); queue.push(cid) }
      }
    }
    return allSessions.filter((s) => out.has(s.id))
  }, [allSessions, focusSessionId])

  // Re-fetch periodically so the graph animates live
  useEffect(() => {
    const reload = () => {
      setLoading(true)
      listAgentSessions(200)
        .then(setAllSessions)
        .catch(() => {})
        .finally(() => setLoading(false))
    }
    reload()
    const id = window.setInterval(reload, 4_000)
    return () => window.clearInterval(id)
  }, [refreshKey])

  // Tick for live "running" status decay
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1500)
    return () => window.clearInterval(id)
  }, [])

  const byParent = useMemo(() => {
    const m = new Map<string | null, AgentSession[]>()
    for (const s of sessions) {
      const k = s.parentSessionId || null
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(s)
    }
    return m
  }, [sessions])

  const { nodes, edges, width, height } = useMemo(() => layout(sessions), [sessions])

  if (sessions.length === 0) {
    return (
      <div className="px-4 py-20 text-center">
        <Network className="w-14 h-14 text-white/15 mx-auto mb-4" />
        <div className="text-[14px] text-white/65 mb-1">The graph is empty</div>
        <div className="text-[12px] text-white/40 max-w-[360px] mx-auto leading-relaxed">
          Run a task that delegates to sub-agents and a live tree will appear here.
          Sub-agents hang below their parent, and moving particles show active communication.
        </div>
      </div>
    )
  }

  // Re-evaluate statuses with `now` so the UI updates as the running window expires
  const statusByNode = new Map<string, Status>()
  for (const s of sessions) {
    const recent = now - (s.lastUsedAt || 0) < 90_000
    let st: Status = 'idle'
    if (s.turns === 0) st = 'idle'
    else if (recent) st = 'running'
    else st = 'done'
    statusByNode.set(s.id, st)
  }

  return (
    <div className="relative">
      {/* Legend */}
      <div className="sticky top-0 z-10 px-4 py-2 bg-[#08080c]/85 backdrop-blur-md border-b border-white/[0.06] flex items-center gap-4 text-[11px]">
        <span className="flex items-center gap-1.5 text-white/55"><Network className="w-3.5 h-3.5 text-violet-300" /> Agent graph · {sessions.length}</span>
        <span className="flex-1" />
        {(['running','done','idle','failed'] as const).map(st => (
          <span key={st} className="flex items-center gap-1.5 text-white/55">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: STATUS_FILL[st], boxShadow: `0 0 8px ${STATUS_GLOW[st]}` }} />
            {st === 'running' ? 'running' : st === 'done' ? 'done' : st === 'idle' ? 'idle' : 'failed'}
          </span>
        ))}
        <button
          className="text-white/45 hover:text-white px-2 py-1 rounded hover:bg-white/[0.06] transition"
          onClick={() => {
            setLoading(true)
            listAgentSessions(200).then(setAllSessions).finally(() => setLoading(false))
          }}
          title="Refresh"
        >
          <RefreshCw className={'w-3.5 h-3.5 ' + (loading ? 'animate-spin' : '')} />
        </button>
      </div>

      {/* SVG canvas */}
      <div className="overflow-auto max-h-[calc(100vh-160px)]">
        <svg
          width={Math.max(width, 600)}
          height={Math.max(height, 360)}
          className="block mx-auto my-3"
        >
          {/* SVG defs: filters + markers */}
          <defs>
            <filter id="glow-violet" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="glow-emerald" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <linearGradient id="edge-flow" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="rgba(167,139,250,0)" />
              <stop offset="50%" stopColor="rgba(167,139,250,0.9)" />
              <stop offset="100%" stopColor="rgba(167,139,250,0)" />
            </linearGradient>
          </defs>

          {/* Edges */}
          {edges.map(({ from, to }) => {
            const p = nodes.get(from)!
            const c = nodes.get(to)!
            // Cubic Bezier from bottom of parent to top of child
            const x1 = p.x
            const y1 = p.y + NODE_R
            const x2 = c.x
            const y2 = c.y - NODE_R
            const midY = (y1 + y2) / 2
            const d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`
            const childStatus = statusByNode.get(to) || 'idle'
            const active = childStatus === 'running'

            return (
              <g key={from + '→' + to}>
                {/* Static base line */}
                <path
                  d={d}
                  fill="none"
                  stroke={active ? 'rgba(167,139,250,0.4)' : 'rgba(255,255,255,0.12)'}
                  strokeWidth={active ? 1.5 : 1}
                />
                {/* Animated traveling particle when active — pulsing dashed line */}
                {active && (
                  <path
                    d={d}
                    fill="none"
                    stroke="#a78bfa"
                    strokeWidth={2.5}
                    strokeDasharray="6 12"
                    strokeLinecap="round"
                    style={{
                      animation: 'agent-flow 1.4s linear infinite',
                      filter: 'drop-shadow(0 0 4px rgba(167,139,250,0.7))',
                    }}
                  />
                )}
              </g>
            )
          })}

          {/* Nodes */}
          <AnimatePresence>
            {Array.from(nodes.values()).map(({ s, x, y, childrenIds }) => {
              const st = statusByNode.get(s.id) || 'idle'
              const isActive = activeSessionId === s.id
              const isRoot = !s.parentSessionId
              const fill = STATUS_FILL[st]
              const glow = STATUS_GLOW[st]
              const useGlow = st === 'running'

              return (
                <motion.g
                  key={s.id}
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.5 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 22 }}
                  style={{ cursor: 'pointer' }}
                  onClick={() => onPickSession?.(s.id)}
                >
                  {/* Outer glow ring (pulsing for running) */}
                  {useGlow && (
                    <circle
                      cx={x} cy={y} r={NODE_R + 8}
                      fill="none"
                      stroke={fill}
                      strokeWidth={2}
                      opacity={0.7}
                      style={{ animation: 'agent-pulse 1.6s ease-in-out infinite' }}
                    />
                  )}
                  {/* Active session selector ring */}
                  {isActive && (
                    <circle
                      cx={x} cy={y} r={NODE_R + 4}
                      fill="none"
                      stroke="rgba(255, 255, 255, 0.9)"
                      strokeWidth={2}
                      strokeDasharray="3 3"
                    />
                  )}
                  {/* Body */}
                  <circle
                    cx={x} cy={y} r={NODE_R}
                    fill={fill}
                    fillOpacity={isRoot ? 0.95 : 0.85}
                    stroke={isRoot ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.5)'}
                    strokeWidth={isRoot ? 2 : 1}
                    style={useGlow ? { filter: `drop-shadow(0 0 12px ${glow})` } : undefined}
                  />
                  {/* Icon */}
                  <g transform={`translate(${x - 8}, ${y - 8})`} pointerEvents="none">
                    <CpuSvg color="#0c0b16" />
                  </g>
                  {/* Depth badge top-right */}
                  {!isRoot && (
                    <g transform={`translate(${x + NODE_R - 4}, ${y - NODE_R + 4})`}>
                      <circle r={8} fill="#0c0b16" stroke={fill} strokeWidth={1.3} />
                      <text x={0} y={3} textAnchor="middle" fontSize="9" fill="#fff" fontFamily="ui-monospace, monospace">{s.depth ?? '?'}</text>
                    </g>
                  )}
                  {/* Name label below */}
                  <text
                    x={x}
                    y={y + NODE_R + 16}
                    textAnchor="middle"
                    fill={isActive ? '#fff' : 'rgba(255,255,255,0.78)'}
                    fontSize={11}
                    fontFamily="ui-sans-serif, system-ui"
                  >
                    {s.name.length > 22 ? s.name.slice(0, 20) + '…' : s.name}
                  </text>
                  {/* Sub-line: turns + age */}
                  <text
                    x={x}
                    y={y + NODE_R + 30}
                    textAnchor="middle"
                    fill="rgba(255,255,255,0.42)"
                    fontSize={9.5}
                    fontFamily="ui-monospace, monospace"
                  >
                    {s.turns} turn{s.turns === 1 ? '' : 's'} · {relAge(now - (s.lastUsedAt || 0))}{childrenIds.length > 0 ? ` · ⤓${childrenIds.length}` : ''}
                  </text>
                </motion.g>
              )
            })}
          </AnimatePresence>
        </svg>
      </div>

      {/* Keyframes (scoped via <style jsx>) */}
      <style jsx global>{`
        @keyframes agent-pulse {
          0%, 100% { opacity: 0.7; transform-origin: center; r: ${NODE_R + 8}; }
          50%      { opacity: 0.1; r: ${NODE_R + 16}; }
        }
        @keyframes agent-flow {
          to { stroke-dashoffset: -36; }
        }
      `}</style>
    </div>
  )
}

function CpuSvg({ color }: { color: string }) {
  // tiny inline CPU icon (lucide path), 16×16, colored
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
    </svg>
  )
}

function relAge(ms: number): string {
  if (ms < 60_000) return Math.max(1, Math.floor(ms / 1000)) + 's'
  if (ms < 60 * 60_000) return Math.floor(ms / 60_000) + 'm'
  if (ms < 24 * 60 * 60_000) return Math.floor(ms / 3_600_000) + 'h'
  return Math.floor(ms / 86_400_000) + 'd'
}
