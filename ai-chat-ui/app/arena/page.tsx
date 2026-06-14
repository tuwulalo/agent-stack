'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Copy,
  Download,
  Loader2,
  LogOut,
  Play,
  Plus,
  Square,
  Swords,
  Trash2,
} from 'lucide-react'
import { Markdown } from '../components/Markdown'
import {
  type ArenaProvider,
  type ArenaResult,
  type ArenaTest,
  fetchArenaProviders,
  runArenaCell,
} from '../lib/arena'

const TESTS_LS_KEY = 'hk:arena:tests:v1'
const PROVIDERS_LS_KEY = 'hk:arena:providers:v1'
const MAX_PROVIDERS = 3
const SOFT_TEST_CAP = 10

type CellStatus = 'idle' | 'running' | 'done' | 'error'
interface Cell extends Partial<ArenaResult> {
  status: CellStatus
}

let seq = 0
function uid(): string {
  seq += 1
  return `t${Date.now().toString(36)}${seq}`
}

function cellKey(testId: string, providerId: string): string {
  return `${testId}::${providerId}`
}

const SEED_TESTS: ArenaTest[] = [
  {
    id: uid(),
    title: 'Reasoning',
    prompt: 'A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost? Explain briefly.',
  },
  {
    id: uid(),
    title: 'Coding',
    prompt: 'Write a TypeScript function `debounce<T>(fn: T, ms: number)` with correct typing. Return only the code.',
  },
]

export default function ArenaPage() {
  const [hydrated, setHydrated] = useState(false)
  const [tests, setTests] = useState<ArenaTest[]>(SEED_TESTS)
  const [providers, setProviders] = useState<ArenaProvider[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [providerError, setProviderError] = useState<string | null>(null)
  const [cells, setCells] = useState<Record<string, Cell>>({})
  const [running, setRunning] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // Hydrate persisted state.
  useEffect(() => {
    try {
      const t = localStorage.getItem(TESTS_LS_KEY)
      if (t) {
        const parsed = JSON.parse(t)
        if (Array.isArray(parsed) && parsed.length) setTests(parsed)
      }
      const p = localStorage.getItem(PROVIDERS_LS_KEY)
      if (p) {
        const parsed = JSON.parse(p)
        if (Array.isArray(parsed)) setSelected(parsed)
      }
    } catch { /* ignore corrupt storage */ }
    setHydrated(true)
  }, [])

  // Load the provider catalog and default the selection to the first available.
  useEffect(() => {
    let cancelled = false
    fetchArenaProviders()
      .then((list) => {
        if (cancelled) return
        setProviders(list)
        setSelected((prev) => {
          const valid = prev.filter((id) => list.some((p) => p.id === id && p.available))
          if (valid.length) return valid.slice(0, MAX_PROVIDERS)
          return list.filter((p) => p.available).slice(0, MAX_PROVIDERS).map((p) => p.id)
        })
      })
      .catch((e) => !cancelled && setProviderError(e instanceof Error ? e.message : 'Failed to load providers'))
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (hydrated) localStorage.setItem(TESTS_LS_KEY, JSON.stringify(tests))
  }, [tests, hydrated])
  useEffect(() => {
    if (hydrated) localStorage.setItem(PROVIDERS_LS_KEY, JSON.stringify(selected))
  }, [selected, hydrated])

  const toggleProvider = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((p) => p !== id)
      if (prev.length >= MAX_PROVIDERS) return prev
      return [...prev, id]
    })
  }

  const addTest = () => setTests((prev) => [...prev, { id: uid(), title: `Test ${prev.length + 1}`, prompt: '' }])
  const updateTest = (id: string, patch: Partial<ArenaTest>) =>
    setTests((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  const removeTest = (id: string) => setTests((prev) => prev.filter((t) => t.id !== id))

  const stop = useCallback(() => abortRef.current?.abort(), [])

  const runAll = useCallback(async () => {
    const activeTests = tests.filter((t) => t.prompt.trim())
    if (!activeTests.length || !selected.length || running) return

    const ctrl = new AbortController()
    abortRef.current = ctrl
    setRunning(true)

    // Mark every cell as running up front so the grid fills in place.
    setCells(() => {
      const next: Record<string, Cell> = {}
      for (const t of activeTests) for (const pid of selected) next[cellKey(t.id, pid)] = { status: 'running' }
      return next
    })

    const jobs: Promise<void>[] = []
    for (const t of activeTests) {
      for (const pid of selected) {
        const key = cellKey(t.id, pid)
        jobs.push(
          runArenaCell(pid, t, ctrl.signal)
            .then((res) =>
              setCells((prev) => ({ ...prev, [key]: { ...res, status: res.error ? 'error' : 'done' } })),
            )
            .catch((e) =>
              setCells((prev) => ({
                ...prev,
                [key]: { status: 'error', error: ctrl.signal.aborted ? 'stopped' : String(e?.message || e) },
              })),
            ),
        )
      }
    }
    await Promise.allSettled(jobs)
    setRunning(false)
    abortRef.current = null
  }, [tests, selected, running])

  const exportMarkdown = () => {
    const cols = selected.map((id) => providers.find((p) => p.id === id))
    const lines: string[] = ['# Model Arena results', '']
    for (const t of tests.filter((x) => x.prompt.trim())) {
      lines.push(`## ${t.title || 'Untitled'}`, '', '```', t.prompt, '```', '')
      for (const col of cols) {
        if (!col) continue
        const c = cells[cellKey(t.id, col.id)]
        lines.push(`### ${col.label} — ${col.model}`)
        if (c?.ms) lines.push(`_${c.ms} ms${c.usage?.total_tokens ? `, ${c.usage.total_tokens} tokens` : ''}_`, '')
        lines.push(c?.error ? `> error: ${c.error}` : (c?.text || '_(no result)_'), '')
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'arena-results.md'
    a.click()
    URL.revokeObjectURL(url)
  }

  const activeCount = tests.filter((t) => t.prompt.trim()).length
  const cols = selected.map((id) => providers.find((p) => p.id === id)).filter(Boolean) as ArenaProvider[]
  const hasResults = Object.keys(cells).length > 0

  return (
    <div className="min-h-screen bg-[#08080c] text-white">
      <header className="border-b border-white/[0.06] bg-black/30 backdrop-blur-xl sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 text-[13px] text-white/65 hover:text-white transition">
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Back to chat</span>
          </Link>
          <div className="w-px h-5 bg-white/10" />
          <Swords className="w-4 h-4 text-violet-300" />
          <h1 className="text-[14px] font-semibold text-white/95">Model Arena</h1>
          <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/25 text-[10px] uppercase tracking-wider text-amber-200/90">
            beta
          </span>
          <span className="flex-1" />
          {hasResults && (
            <button
              onClick={exportMarkdown}
              className="px-2.5 py-1.5 rounded-md bg-white/[0.04] hover:bg-white/[0.09] border border-white/10 text-xs text-white/70 hover:text-white transition flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Export</span>
            </button>
          )}
          <button
            onClick={async () => {
              try { await fetch('/api/auth/logout', { method: 'POST' }) } catch { /* ignore */ }
              window.location.href = '/login'
            }}
            className="px-2.5 py-1.5 rounded-md bg-white/[0.04] hover:bg-white/[0.09] border border-white/10 text-xs text-white/70 hover:text-white transition flex items-center gap-1.5"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Provider picker */}
        <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-white/90">Systems to compare</h2>
            <span className="text-[11px] text-white/40">{selected.length}/{MAX_PROVIDERS} selected</span>
          </div>
          {providerError ? (
            <p className="text-sm text-red-300">{providerError}</p>
          ) : providers.length === 0 ? (
            <div className="flex items-center gap-2 text-white/50 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading providers…
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {providers.map((p) => {
                const on = selected.includes(p.id)
                const disabled = !p.available || (!on && selected.length >= MAX_PROVIDERS)
                return (
                  <button
                    key={p.id}
                    onClick={() => p.available && toggleProvider(p.id)}
                    disabled={disabled && !on}
                    title={p.available ? p.model : 'No API key configured — set it in .env'}
                    className={
                      'px-3 py-2 rounded-lg border text-[12.5px] transition flex flex-col items-start gap-0.5 min-w-[150px] ' +
                      (on
                        ? 'bg-violet-500/15 border-violet-400/40 text-white'
                        : p.available
                          ? 'bg-white/[0.03] border-white/[0.08] text-white/70 hover:bg-white/[0.06] hover:text-white'
                          : 'bg-white/[0.02] border-white/[0.05] text-white/30 cursor-not-allowed')
                    }
                  >
                    <span className="font-medium flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${p.available ? (on ? 'bg-violet-400' : 'bg-emerald-400/60') : 'bg-white/20'}`} />
                      {p.label}
                    </span>
                    <span className="text-[10.5px] text-white/40 font-mono">{p.available ? p.model : 'no key'}</span>
                  </button>
                )
              })}
            </div>
          )}
        </section>

        {/* Tests editor */}
        <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white/90">Tests</h2>
            <span className="text-[11px] text-white/40">
              {activeCount} ready{tests.length > SOFT_TEST_CAP ? ` · ${tests.length} (a lot — keep it focused)` : ''}
            </span>
          </div>
          <div className="space-y-3">
            {tests.map((t, i) => (
              <div key={t.id} className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[11px] text-white/35 tabular-nums w-5">{i + 1}</span>
                  <input
                    value={t.title}
                    onChange={(e) => updateTest(t.id, { title: e.target.value })}
                    placeholder="Title"
                    className="flex-1 bg-transparent text-[13px] font-medium text-white/90 outline-none placeholder:text-white/30"
                  />
                  <button
                    onClick={() => removeTest(t.id)}
                    className="text-white/30 hover:text-red-300 transition p-1"
                    title="Remove test"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <textarea
                  value={t.prompt}
                  onChange={(e) => updateTest(t.id, { prompt: e.target.value })}
                  placeholder="Prompt sent to every selected system…"
                  rows={2}
                  className="w-full rounded-md bg-black/30 border border-white/[0.06] px-2.5 py-2 text-[12.5px] text-white/85 outline-none resize-y placeholder:text-white/25 focus:border-violet-500/40"
                />
                <input
                  value={t.system || ''}
                  onChange={(e) => updateTest(t.id, { system: e.target.value })}
                  placeholder="System prompt (optional)"
                  className="mt-2 w-full rounded-md bg-black/20 border border-white/[0.05] px-2.5 py-1.5 text-[11.5px] text-white/60 outline-none placeholder:text-white/20 focus:border-violet-500/30"
                />
              </div>
            ))}
          </div>
          <button
            onClick={addTest}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/[0.04] border border-white/10 text-[12px] text-white/70 hover:text-white hover:bg-white/[0.08] transition"
          >
            <Plus className="w-3.5 h-3.5" /> Add test
          </button>
        </section>

        {/* Run controls */}
        <div className="flex items-center gap-3">
          {running ? (
            <button
              onClick={stop}
              className="px-4 py-2 rounded-lg text-[13px] bg-red-500/15 hover:bg-red-500/25 text-red-200 border border-red-400/25 transition flex items-center gap-2"
            >
              <Square className="w-4 h-4" /> Stop
            </button>
          ) : (
            <button
              onClick={() => void runAll()}
              disabled={!activeCount || !selected.length}
              className="px-4 py-2 rounded-lg text-[13px] bg-gradient-to-b from-violet-500 to-indigo-600 text-white hover:from-violet-400 hover:to-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center gap-2"
            >
              <Play className="w-4 h-4" /> Run {activeCount}×{selected.length}
            </button>
          )}
          <span className="text-[11px] text-white/35">{activeCount} tests across {selected.length} systems</span>
        </div>

        {/* Results matrix */}
        {hasResults && (
          <section className="overflow-x-auto rounded-2xl border border-white/[0.08] bg-white/[0.02]">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-[#0c0c12] text-left text-[11px] uppercase tracking-wider text-white/45 font-medium px-4 py-3 border-b border-white/[0.06] min-w-[160px]">
                    Test
                  </th>
                  {cols.map((p) => (
                    <th key={p.id} className="text-left px-4 py-3 border-b border-white/[0.06] border-l border-white/[0.04] min-w-[280px]">
                      <div className="text-[12.5px] font-semibold text-white/90">{p.label}</div>
                      <div className="text-[10.5px] text-white/40 font-mono">{p.model}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tests.filter((t) => t.prompt.trim()).map((t) => (
                  <tr key={t.id} className="align-top">
                    <td className="sticky left-0 bg-[#0c0c12] px-4 py-3 border-b border-white/[0.05]">
                      <div className="text-[12.5px] font-medium text-white/85">{t.title || 'Untitled'}</div>
                      <div className="text-[11px] text-white/40 mt-1 line-clamp-3">{t.prompt}</div>
                    </td>
                    {cols.map((p) => {
                      const c = cells[cellKey(t.id, p.id)]
                      return (
                        <td key={p.id} className="px-4 py-3 border-b border-white/[0.05] border-l border-white/[0.04]">
                          <ResultCell cell={c} />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </main>
    </div>
  )
}

function ResultCell({ cell }: { cell?: Cell }) {
  const [copied, setCopied] = useState(false)
  if (!cell || cell.status === 'idle') return <span className="text-white/25 text-sm">—</span>
  if (cell.status === 'running') {
    return (
      <div className="flex items-center gap-2 text-white/45 text-sm">
        <Loader2 className="w-4 h-4 animate-spin text-violet-400" /> running…
      </div>
    )
  }
  if (cell.status === 'error' || cell.error) {
    return <div className="text-[12.5px] text-red-300/90 break-words">⚠ {cell.error}</div>
  }
  const text = cell.text || ''
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-[10.5px] text-white/40">
        <span className="tabular-nums">{cell.ms} ms</span>
        {cell.usage?.total_tokens ? <span className="tabular-nums">{cell.usage.total_tokens} tok</span> : null}
        <button
          onClick={() => {
            navigator.clipboard.writeText(text).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }).catch(() => {})
          }}
          className="ml-auto flex items-center gap-1 text-white/40 hover:text-white transition"
        >
          <Copy className="w-3 h-3" /> {copied ? 'copied' : 'copy'}
        </button>
      </div>
      <div className="max-h-[340px] overflow-y-auto text-[13px] leading-relaxed pr-1 md">
        <Markdown text={text} />
      </div>
    </div>
  )
}
