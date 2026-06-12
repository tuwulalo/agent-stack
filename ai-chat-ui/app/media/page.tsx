'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  BarChart3,
  Copy,
  ExternalLink,
  Film,
  ImageIcon,
  Lightbulb,
  Loader2,
  LogOut,
  RefreshCw,
  Sparkles,
  Youtube,
} from 'lucide-react'
import { Markdown } from '../components/Markdown'
import type { ChannelSnapshot, GenerateKind } from '../lib/mediaStudio'
import { BRAND_SITE, YT_CHANNEL_URL } from '../lib/mediaStudio'

type Tab = 'overview' | 'ideas' | 'scripts' | 'thumbnails' | 'analytics'

const TABS: { id: Tab; label: string; icon: typeof Lightbulb }[] = [
  { id: 'overview', label: 'Overview', icon: Youtube },
  { id: 'ideas', label: 'Ideas', icon: Lightbulb },
  { id: 'scripts', label: 'Scripts', icon: Film },
  { id: 'thumbnails', label: 'Thumbnails', icon: ImageIcon },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
]

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}

function fmtNum(n: number) {
  return new Intl.NumberFormat('en-US').format(n)
}

export default function MediaStudioPage() {
  const [tab, setTab] = useState<Tab>('overview')
  const [snapshot, setSnapshot] = useState<ChannelSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [topic, setTopic] = useState('')
  const [extra, setExtra] = useState('')
  const [generating, setGenerating] = useState<GenerateKind | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [genError, setGenError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/media/channel', { cache: 'no-store' })
      const data = (await res.json()) as ChannelSnapshot & { error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setSnapshot(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the channel')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const maxViews = useMemo(() => {
    if (!snapshot?.videos.length) return 1
    return Math.max(...snapshot.videos.map((v) => v.views), 1)
  }, [snapshot])

  async function generate(kind: GenerateKind) {
    if (!topic.trim()) {
      setGenError('Enter a topic / title')
      return
    }
    setGenerating(kind)
    setGenError(null)
    setResult(null)
    try {
      const res = await fetch('/api/media/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, topic: topic.trim(), extra: extra.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setResult(data.content as string)
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenerating(null)
    }
  }

  async function copyResult() {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }

  const genTab = tab === 'ideas' ? 'ideas' : tab === 'scripts' ? 'script' : tab === 'thumbnails' ? 'thumbnail' : null

  return (
    <div className="min-h-screen bg-[#08080c] text-white">
      <header className="border-b border-white/[0.06] bg-black/30 backdrop-blur-xl sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 text-[13px] text-white/65 hover:text-white transition">
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Back to chat</span>
          </Link>
          <div className="w-px h-5 bg-white/10" />
          <Youtube className="w-4 h-4 text-red-400" />
          <h1 className="text-[14px] font-semibold text-white/95">Media Studio</h1>
          <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/25 text-[10px] uppercase tracking-wider text-amber-200/90">
            concept v0
          </span>
          <div className="ml-2 hidden md:flex gap-0.5 bg-white/[0.03] border border-white/[0.06] rounded-md p-0.5 overflow-x-auto">
            {TABS.map((t) => {
              const Icon = t.icon
              const active = tab === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={
                    'px-2.5 py-1 rounded text-[11.5px] transition flex items-center gap-1.5 whitespace-nowrap ' +
                    (active ? 'bg-white/[0.08] text-white' : 'text-white/55 hover:text-white/85 hover:bg-white/[0.04]')
                  }
                >
                  <Icon className="w-3 h-3" />
                  {t.label}
                </button>
              )
            })}
          </div>
          <span className="flex-1" />
          <a
            href={YT_CHANNEL_URL}
            target="_blank"
            rel="noreferrer"
            className="px-2.5 py-1.5 rounded-md bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-xs text-red-200 transition flex items-center gap-1.5"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Open channel</span>
          </a>
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
        <div className="md:hidden max-w-7xl mx-auto px-4 pb-2 flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={
                'px-2 py-1 rounded text-[11px] whitespace-nowrap ' +
                (tab === t.id ? 'bg-white/10 text-white' : 'text-white/50')
              }
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* concept banner */}
        <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.06] px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
          <Sparkles className="w-5 h-5 text-violet-300 shrink-0" />
          <div className="text-[13px] text-white/80 leading-relaxed">
            <strong className="text-white/95">Concept preview.</strong>{' '}
            A separate <code className="text-violet-200/90">/media</code> section for growing your channel.
            Today: RSS analytics, ideas and scripts via the proxy model, thumbnail briefs for an image model.
            Next: YouTube Data API, direct image generation, a publishing calendar.
          </div>
          <button
            onClick={() => void refresh()}
            className="shrink-0 px-3 py-1.5 rounded-md bg-white/[0.06] border border-white/10 text-xs hover:bg-white/10 transition flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
        )}

        {tab === 'overview' && (
          <div className="grid lg:grid-cols-3 gap-5">
            <section className="lg:col-span-2 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
              <div className="flex items-start gap-4">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-red-500/30 to-violet-500/30 border border-white/10 grid place-items-center">
                  <Youtube className="w-7 h-7 text-red-300" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold">{snapshot?.channel.name ?? 'Your channel'}</h2>
                  <p className="text-white/55 text-sm mt-1">{snapshot?.channel.tagline ?? CHANNEL_FALLBACK.tagline}</p>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <a href={YT_CHANNEL_URL} target="_blank" rel="noreferrer" className="text-xs text-red-300 hover:underline">
                      YouTube →
                    </a>
                    {BRAND_SITE && (
                      <a href={BRAND_SITE} target="_blank" rel="noreferrer" className="text-xs text-violet-300 hover:underline">
                        {BRAND_SITE.replace(/^https?:\/\//, '')} →
                      </a>
                    )}
                  </div>
                </div>
              </div>
              <ul className="mt-5 space-y-1.5 text-[13px] text-white/65">
                {(snapshot?.channel.niche ?? CHANNEL_FALLBACK.niche).map((n) => (
                  <li key={n} className="flex gap-2">
                    <span className="text-violet-400">·</span>
                    {n}
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 space-y-3">
              <h3 className="text-sm font-semibold text-white/90">Summary (RSS)</h3>
              {loading ? (
                <div className="flex items-center gap-2 text-white/50 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                </div>
              ) : snapshot ? (
                <>
                  <Metric label="Videos in feed" value={String(snapshot.stats.videoCount)} />
                  <Metric label="Total views" value={fmtNum(snapshot.stats.totalViews)} />
                  <Metric label="Average / video" value={fmtNum(snapshot.stats.avgViews)} />
                  <Metric
                    label="Latest video"
                    value={snapshot.stats.latestPublished ? fmtDate(snapshot.stats.latestPublished) : '—'}
                  />
                  <p className="text-[11px] text-white/40 pt-1">{snapshot.conceptNote}</p>
                </>
              ) : null}
            </section>

            <section className="lg:col-span-3 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
              <h3 className="text-sm font-semibold mb-4">Latest videos</h3>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {(snapshot?.videos ?? []).slice(0, 6).map((v) => (
                  <a
                    key={v.id}
                    href={v.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group rounded-xl overflow-hidden border border-white/[0.06] bg-black/20 hover:border-white/15 transition"
                  >
                    <div className="aspect-video bg-black/40 relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={v.thumbnail} alt="" className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition" />
                    </div>
                    <div className="p-3">
                      <p className="text-[13px] font-medium line-clamp-2 group-hover:text-white transition text-white/85">{v.title}</p>
                      <p className="text-[11px] text-white/45 mt-1">{fmtDate(v.publishedAt)} · {fmtNum(v.views)} views</p>
                    </div>
                  </a>
                ))}
              </div>
            </section>
          </div>
        )}

        {(tab === 'ideas' || tab === 'scripts' || tab === 'thumbnails') && genTab && (
          <div className="grid lg:grid-cols-2 gap-5">
            <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 space-y-4">
              <h2 className="text-base font-semibold">
                {tab === 'ideas' && 'Idea generator'}
                {tab === 'scripts' && 'Script generator'}
                {tab === 'thumbnails' && 'Thumbnail brief (image model)'}
              </h2>
              <p className="text-[13px] text-white/55 leading-relaxed">
                {tab === 'ideas' && 'The model suggests 5 topics in your channel style: comparisons, tutorials, AI news.'}
                {tab === 'scripts' && 'A video skeleton with timecodes, a hook and your CTA.'}
                {tab === 'thumbnails' && 'An English prompt to paste into an image model. Copy the image manually for now (v1 adds auto-generation).'}
              </p>
              <label className="block text-[12px] text-white/50">
                {tab === 'thumbnails' ? 'Title of the future video' : 'Topic / context'}
                <input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder={
                    tab === 'ideas'
                      ? 'e.g.: comparing two coding models on agent tasks'
                      : tab === 'scripts'
                        ? 'e.g.: what the new model release changes for developers'
                        : 'e.g.: WHICH AI BUILDS THE BEST APP?'
                  }
                  className="mt-1.5 w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-violet-500/40"
                />
              </label>
              <label className="block text-[12px] text-white/50">
                Additional notes (optional)
                <textarea
                  value={extra}
                  onChange={(e) => setExtra(e.target.value)}
                  rows={3}
                  placeholder={
                    tab === 'thumbnails'
                      ? 'style: neon, dark background, large faces…'
                      : 'tone, length, what to avoid…'
                  }
                  className="mt-1.5 w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-violet-500/40 resize-none"
                />
              </label>
              {snapshot && tab === 'ideas' && !topic && (
                <div className="flex flex-wrap gap-2">
                  {snapshot.videos.slice(0, 3).map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setTopic(`Follow-up / similar topic: ${v.title}`)}
                      className="text-[11px] px-2 py-1 rounded-md bg-white/[0.04] border border-white/10 text-white/60 hover:text-white hover:bg-white/[0.08] transition"
                    >
                      ↪ {v.title.slice(0, 42)}…
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={() => void generate(genTab)}
                disabled={!!generating}
                className="w-full py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-sm font-medium transition flex items-center justify-center gap-2"
              >
                {generating === genTab ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Generate
              </button>
              {genError && <p className="text-sm text-red-300">{genError}</p>}
            </section>

            <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 min-h-[320px] flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-white/90">Result</h3>
                {result && (
                  <button
                    onClick={() => void copyResult()}
                    className="text-xs text-white/50 hover:text-white flex items-center gap-1"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                )}
              </div>
              {generating ? (
                <div className="flex-1 grid place-items-center text-white/45 text-sm gap-2">
                  <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
                  The model is thinking…
                </div>
              ) : result ? (
                <div className="flex-1 overflow-y-auto text-[14px] md">
                  <Markdown text={result} />
                </div>
              ) : (
                <p className="text-sm text-white/40">Generated text will appear here.</p>
              )}
              {tab === 'thumbnails' && result && (
                <div className="mt-4 pt-4 border-t border-white/[0.06]">
                  <p className="text-[11px] uppercase tracking-wider text-white/40 mb-2">Thumbnail mockup (concept)</p>
                  <div className="aspect-video rounded-lg bg-gradient-to-br from-[#1a0a2e] via-[#0d0d14] to-[#2d0a0a] border border-white/10 relative overflow-hidden">
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
                      <span className="text-[10px] text-red-400/80 uppercase tracking-widest mb-2">
                        {snapshot?.channel.name ?? 'CHANNEL'}
                      </span>
                      <span className="text-lg sm:text-xl font-black text-white drop-shadow-lg leading-tight max-w-[90%]">
                        {(topic || 'TITLE').slice(0, 48).toUpperCase()}
                      </span>
                      <span className="mt-3 text-[10px] text-white/35">image model → v1</span>
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        {tab === 'analytics' && (
          <div className="space-y-5">
            <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold">Views per video</h2>
                <span className="text-[11px] text-amber-200/70 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded">
                  RSS · no CTR or retention yet
                </span>
              </div>
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin text-white/40" />
              ) : (
                <div className="space-y-3">
                  {(snapshot?.videos ?? []).map((v) => (
                    <div key={v.id} className="flex items-center gap-3">
                      <div className="w-24 sm:w-32 shrink-0 text-[11px] text-white/45 tabular-nums">{fmtDate(v.publishedAt)}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] truncate text-white/80">{v.title}</p>
                        <div className="mt-1.5 h-2 rounded-full bg-white/[0.06] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-violet-600 to-red-500/80"
                            style={{ width: `${Math.max(4, (v.views / maxViews) * 100)}%` }}
                          />
                        </div>
                      </div>
                      <div className="w-16 text-right text-sm tabular-nums text-white/70">{fmtNum(v.views)}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="grid md:grid-cols-2 gap-5">
              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
                <h3 className="text-sm font-semibold mb-3">Coming in v1</h3>
                <ul className="space-y-2 text-[13px] text-white/60">
                  <li>· YouTube Data API — subscribers, CTR, impressions</li>
                  <li>· Retention graph for every video</li>
                  <li>· A/B comparison of titles / thumbnails</li>
                  <li>· Report export to PDF / Notion</li>
                </ul>
              </div>
              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
                <h3 className="text-sm font-semibold mb-3">Ties into the stack</h3>
                <ul className="space-y-2 text-[13px] text-white/60">
                  <li>· CTAs in videos → your site / products</li>
                  <li>· Ideas from your projects → content plan</li>
                  <li>· Auto-posting drafts to Telegram</li>
                </ul>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  )
}

const CHANNEL_FALLBACK = {
  tagline: 'AI, coding and hands-on product builds',
  niche: ['LLM comparisons', 'AI news', 'practical products'],
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-baseline gap-4 text-[13px]">
      <span className="text-white/50">{label}</span>
      <span className="font-semibold tabular-nums text-white/90">{value}</span>
    </div>
  )
}
