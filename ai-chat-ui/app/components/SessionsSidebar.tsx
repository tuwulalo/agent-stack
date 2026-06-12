'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, X, MessageSquare, Zap, ExternalLink, Sparkles, Pencil, Play } from 'lucide-react'
import Link from 'next/link'
import { KimiMascot } from '@/components/ui/kimi-mascot'
import type { ChatSession } from '../lib/sessions'

function relTime(ms: number): string {
  const diff = Date.now() - ms
  const m = Math.round(diff / 60_000)
  if (m < 1) return 'только что'
  if (m < 60) return `${m} мин`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} ч`
  const d = Math.round(h / 24)
  if (d < 30) return `${d} дн`
  return new Date(ms).toLocaleDateString('ru')
}

export interface SessionsSidebarProps {
  open: boolean
  onClose: () => void
  sessions: ChatSession[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  onRename: (id: string, title: string) => void
  hermesUrl: string
}

export function SessionsSidebar({
  open,
  onClose,
  sessions,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onRename,
  hermesUrl,
}: SessionsSidebarProps) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  /* close on Esc */
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const beginRename = (s: ChatSession) => {
    setEditing(s.id)
    setDraft(s.title)
  }
  const commitRename = () => {
    if (editing) onRename(editing, draft.trim() || 'Без названия')
    setEditing(null)
  }

  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* scrim */}
          <motion.div
            key="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
          />
          {/* drawer */}
          <motion.aside
            key="drawer"
            initial={{ x: -340, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -340, opacity: 0 }}
            transition={{ type: 'spring', damping: 26, stiffness: 280 }}
            className="fixed top-0 left-0 h-screen w-[320px] z-50 flex flex-col border-r border-white/[0.06] bg-[#0b0a14]/95 backdrop-blur-xl shadow-2xl"
          >
            {/* header */}
            <div className="flex items-center gap-2.5 px-4 pt-4 pb-3 border-b border-white/[0.05]">
              <div className="w-9 h-9 rounded-lg grid place-items-center bg-white/[0.04] border border-white/10 overflow-hidden">
                <KimiMascot size={28} />
              </div>
              <div className="flex flex-col leading-tight flex-1 min-w-0">
                <span className="text-[13px] font-semibold text-white/90 truncate">
                  Hermes × Kimi
                </span>
                <span className="text-[10px] uppercase tracking-[0.12em] text-white/40">
                  workflow hub
                </span>
              </div>
              <button
                onClick={onClose}
                className="w-7 h-7 grid place-items-center rounded-md text-white/45 hover:text-white hover:bg-white/[0.06]"
                aria-label="Закрыть"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* new chat */}
            <div className="px-3 pt-3">
              <button
                onClick={() => {
                  onNew()
                  onClose()
                }}
                onAuxClick={(e) => {
                  // middle-click → open a fresh empty chat in a new tab
                  if (e.button !== 1) return
                  e.preventDefault()
                  window.open(window.location.pathname + '?new=1', '_blank', 'noopener')
                }}
                title="Клик — новый чат · средняя кнопка — открыть в новой вкладке"
                className="w-full flex items-center justify-center gap-2 h-9 rounded-md bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white text-[13px] font-medium shadow-md shadow-violet-500/30 hover:brightness-110 transition"
              >
                <Plus className="w-4 h-4" />
                Новый чат
              </button>
            </div>

            {/* sessions list */}
            <div className="flex-1 overflow-y-auto py-3 px-2 min-h-0">
              <div className="text-[10px] uppercase tracking-[0.14em] text-white/35 px-2 py-2">
                Сессии · {sorted.length}
              </div>
              {sorted.length === 0 && (
                <div className="text-[12px] text-white/40 px-2 py-3">
                  Пока пусто. Начни диалог — он появится здесь.
                </div>
              )}
              {sorted.map((s) => {
                const active = s.id === activeId
                const Icon = s.mode === 'agent' ? Zap : MessageSquare
                return (
                  <div
                    key={s.id}
                    role="link"
                    title="Клик — открыть · средняя кнопка — в новой вкладке"
                    className={`group relative flex items-start gap-2 px-2.5 py-2 rounded-md cursor-pointer mb-0.5 transition ${
                      active ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'
                    }`}
                    onClick={() => {
                      onSelect(s.id)
                      onClose()
                    }}
                    onAuxClick={(e) => {
                      // middle-click (button=1) → open this session in a new tab
                      if (e.button !== 1) return
                      e.preventDefault()
                      const url = `${window.location.pathname}?session=${encodeURIComponent(s.id)}`
                      window.open(url, '_blank', 'noopener')
                    }}
                    onMouseDown={(e) => {
                      // Some browsers don't fire onAuxClick reliably; suppress middle-click autoscroll
                      if (e.button === 1) e.preventDefault()
                    }}
                  >
                    {active && (
                      <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r bg-gradient-to-b from-violet-400 to-fuchsia-400" />
                    )}
                    <Icon
                      className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${
                        s.mode === 'agent' ? 'text-fuchsia-300/85' : 'text-violet-300/80'
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      {editing === s.id ? (
                        <input
                          autoFocus
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onBlur={commitRename}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename()
                            if (e.key === 'Escape') setEditing(null)
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="w-full bg-black/40 border border-white/15 rounded px-1.5 py-0.5 text-[12.5px] text-white outline-none"
                        />
                      ) : (
                        <div
                          className="text-[12.5px] text-white/85 truncate"
                          onDoubleClick={(e) => {
                            e.stopPropagation()
                            beginRename(s)
                          }}
                          title={s.title}
                        >
                          {s.title}
                        </div>
                      )}
                      <div className="flex items-center gap-1.5 text-[10.5px] text-white/40 mt-0.5">
                        <span>{relTime(s.updatedAt)}</span>
                        {s.messages.length > 0 && (
                          <>
                            <span>·</span>
                            <span>{s.messages.length} сообщ.</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 flex-shrink-0 transition">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          beginRename(s)
                        }}
                        className="w-6 h-6 grid place-items-center rounded text-white/40 hover:text-white hover:bg-white/[0.08] transition"
                        aria-label="Переименовать"
                        title="Переименовать (или двойной клик по названию)"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onDelete(s.id)
                        }}
                        className="w-6 h-6 grid place-items-center rounded text-white/35 hover:text-red-300 hover:bg-red-500/10 transition"
                        aria-label="Удалить сессию"
                        title="Удалить"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* footer */}
            <div className="px-3 py-3 border-t border-white/[0.05]">
              <Link
                href="/automations"
                onClick={onClose}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] text-[12.5px] text-white/75 hover:text-white transition"
              >
                <span className="flex items-center gap-2">
                  <Play className="w-3.5 h-3.5 text-violet-300" />
                  Автоматизации
                </span>
                <ExternalLink className="w-3.5 h-3.5 opacity-60" />
              </Link>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
