'use client'

import { useEffect, useState } from 'react'
import { JsonOrText } from '../../components/JsonView'
import { KIMI_API } from '../../lib/config'

type Line = { kind: string; meta?: string; text?: string; path?: string; name?: string; mime?: string }
type Hist = { session?: { name?: string; createdAt?: number; costUsd?: number; turns?: number }; lines?: Line[]; running?: boolean }

export default function SharePage({ params }: { params: { id: string } }) {
  const [data, setData] = useState<Hist | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    fetch(`${KIMI_API}/automations/sessions/${encodeURIComponent(params.id)}/history`)
      .then(async (r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
      .then(setData)
      .catch((e) => setErr(String(e?.message || e)))
  }, [params.id])

  return (
    <div className="min-h-screen bg-[#08080c] text-white">
      <header className="border-b border-white/[0.06] bg-black/30 px-5 py-3 flex items-center gap-3">
        <span className="text-[13px] font-semibold text-violet-200">Эфир · публичный реплей</span>
        {data?.session?.name && <span className="text-[12px] text-white/55 truncate">{data.session.name}</span>}
        <span className="flex-1" />
        {typeof data?.session?.costUsd === 'number' && data.session.costUsd > 0 && (
          <span className="text-[11px] font-mono text-emerald-300/75">${data.session.costUsd.toFixed(data.session.costUsd < 1 ? 3 : 2)}</span>
        )}
        {data?.running && <span className="text-[11px] text-amber-300 animate-pulse">● в работе</span>}
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 font-mono text-[12.5px] leading-relaxed">
        {err && <div className="text-red-300">Сессия недоступна: {err}</div>}
        {!err && !data && <div className="text-white/40">Загрузка…</div>}
        {data?.lines?.map((l, i) => {
          if (l.kind === 'prompt') {
            return <div key={i} className="my-2 px-3 py-2 rounded bg-violet-500/10 border border-violet-400/20 whitespace-pre-wrap break-words">{l.text}</div>
          }
          if (l.kind === 'stdout') {
            return <div key={i} className="my-1.5 text-white/90"><JsonOrText text={l.text || ''} /></div>
          }
          if (l.kind === 'step' && l.meta === 'thinking') {
            return <div key={i} className="my-1 pl-3 border-l border-white/10 text-white/35 italic whitespace-pre-wrap break-words">{(l.text || '').slice(0, 600)}</div>
          }
          if (l.kind === 'step' && l.meta === 'tool') {
            return <div key={i} className="my-0.5 text-sky-300/70 text-[11px] truncate">→ {l.text}</div>
          }
          if (l.kind === 'step' && l.meta === 'result') {
            return <div key={i} className="my-1 pl-3 border-l border-white/10 text-white/55"><JsonOrText text={l.text || ''} /></div>
          }
          if (l.kind === 'artifact' && l.path) {
            return <img key={i} src={`${KIMI_API}/agent/file?path=${encodeURIComponent(l.path)}`} alt={l.name || ''} className="my-2 max-w-full rounded border border-white/10" />
          }
          if (l.kind === 'error') {
            return <div key={i} className="my-1 text-red-300/85 whitespace-pre-wrap break-words">{l.text}</div>
          }
          return <div key={i} className="my-0.5 text-white/40 text-[11px]">{l.text}</div>
        })}
      </main>
    </div>
  )
}
