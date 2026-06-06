'use client'

import { useCallback, useEffect, useState } from 'react'
import { Send, RefreshCw } from 'lucide-react'
import { KIMI_API } from '../lib/config'
import { formatRel } from '../lib/agent-sessions'

interface Thread { key: string; name: string; active: boolean; sessionId: string | null; turns: number; lastSummary?: string; lastUsedAt?: number | null; running?: boolean }
interface TgInfo { linked: boolean; botUsername: string; active: string; threads: Thread[] }

export function TelegramTab({ onOpen }: { onOpen: (sessionId: string) => void }) {
  const [info, setInfo] = useState<TgInfo | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${KIMI_API}/automations/telegram`)
      if (!r.ok) throw new Error('HTTP ' + r.status)
      setInfo(await r.json()); setErr(null)
    } catch (e: any) { setErr(String(e?.message || e)) }
  }, [])

  useEffect(() => {
    void load()
    const id = setInterval(() => { if (document.visibilityState === 'visible') void load() }, 4000)
    return () => clearInterval(id)
  }, [load])

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4">
        <Send className="w-4 h-4 text-sky-300" />
        <h2 className="text-[15px] font-semibold">Telegram-мост</h2>
        <span className="flex-1" />
        <button onClick={() => void load()} className="p-1.5 rounded text-white/40 hover:text-white hover:bg-white/[0.06] transition" title="Обновить"><RefreshCw className="w-3.5 h-3.5" /></button>
      </div>

      <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4 mb-4 text-[12.5px] text-white/70">
        Бот: <a href={`https://t.me/${info?.botUsername || 'workgamza_bot'}`} target="_blank" rel="noopener" className="text-sky-300 hover:underline">@{info?.botUsername || 'workgamza_bot'}</a>
        {info?.linked
          ? <span className="ml-2 text-emerald-300">● привязан к владельцу</span>
          : <span className="ml-2 text-amber-300">○ не привязан — напиши боту любое сообщение, чтобы залочить его на себя</span>}
        <div className="mt-2 text-white/45 text-[11.5px]">Пиши боту задачу — она выполняется на VPS в активном потоке. Переписка синхронна с этими сессиями: можешь продолжить любой поток здесь, нажав «открыть».</div>
      </div>

      {err && <div className="text-red-300 text-[12px] mb-3">Ошибка: {err}</div>}

      <div className="space-y-2">
        {(info?.threads || []).map((t) => (
          <div key={t.key} className={'rounded-lg border p-3 ' + (t.active ? 'border-sky-400/40 bg-sky-500/[0.06]' : 'border-white/[0.06] bg-white/[0.015]')}>
            <div className="flex items-center gap-2">
              {t.running && <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />}
              <span className="text-[13px] text-white/90 font-medium">{t.name}</span>
              <span className="text-[10px] text-white/35 font-mono">/{t.key}</span>
              {t.active && <span className="text-[10px] text-sky-300">активный</span>}
              <span className="flex-1" />
              <span className="text-[10.5px] text-white/35 font-mono">{t.turns}t{t.lastUsedAt ? ' · ' + formatRel(t.lastUsedAt) : ''}</span>
            </div>
            {t.lastSummary && <div className="mt-1.5 text-[11.5px] text-white/45 line-clamp-2">{t.lastSummary.slice(0, 200)}</div>}
            <div className="mt-2">
              {t.sessionId
                ? <button onClick={() => onOpen(t.sessionId!)} className="px-2.5 py-1 rounded text-[11px] bg-white/[0.05] hover:bg-sky-500/15 text-white/70 hover:text-sky-100 transition">↪ открыть переписку</button>
                : <span className="text-[11px] text-white/30">поток ещё не использовался</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
