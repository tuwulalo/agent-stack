'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Brain, Plus, RefreshCw, X, FileText } from 'lucide-react'
import {
  type NoteSummary,
  formatBytes,
  formatRelTime,
  isValidChatId,
  isValidNoteName,
  listNotes,
  noteTitle,
  regenerateDigest,
  writeNote,
} from '../lib/notes'
import { NoteEditor } from './NoteEditor'

interface Props {
  chatId: string | null
  /** Last user → assistant exchange, used as input for the digest button. */
  lastExchange: { user: string; assistant: string } | null
  /** External event token — change it to force-refresh the list (e.g. after every response). */
  refreshKey: number
  /** Controlled open state — the trigger button lives in page.tsx top-right cluster. */
  open: boolean
  onOpenChange: (open: boolean) => void
}

const SYSTEM_BADGE: Record<string, string> = {
  'facts.md':     'text-emerald-300 border-emerald-300/30 bg-emerald-300/5',
  'decisions.md': 'text-amber-300 border-amber-300/30 bg-amber-300/5',
  'summary.md':   'text-sky-300 border-sky-300/30 bg-sky-300/5',
}

export function ChatNotesPanel({ chatId, lastExchange, refreshKey, open, onOpenChange }: Props) {
  const [notes, setNotes] = useState<NoteSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [openNote, setOpenNote] = useState<{ name: string; isSystem: boolean } | null>(null)

  const reload = async () => {
    if (!isValidChatId(chatId)) {
      setNotes([])
      return
    }
    setLoading(true)
    try {
      const list = await listNotes(chatId)
      setNotes(list)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, chatId, refreshKey])

  const doRegenerate = async () => {
    if (!isValidChatId(chatId) || !lastExchange) return
    setBusy(true)
    try {
      const updated = await regenerateDigest(chatId, lastExchange.user, lastExchange.assistant)
      if (updated.length > 0) setNotes(updated)
      else await reload()
    } finally {
      setBusy(false)
    }
  }

  const doCreateNote = async () => {
    if (!isValidChatId(chatId)) return
    const raw = prompt('File name (letters, digits, _ and - only, without .md):', `note-${Date.now().toString(36)}`)
    if (!raw) return
    const name = raw.trim().replace(/\.md$/i, '') + '.md'
    if (!isValidNoteName(name)) {
      alert('Invalid name. Allowed: letters, digits, _, -, up to 80 characters, .md extension')
      return
    }
    const ok = await writeNote(chatId, name, `# ${name.replace(/\.md$/, '')}\n\n`)
    if (ok) {
      await reload()
      setOpenNote({ name, isSystem: false })
    }
  }

  if (!isValidChatId(chatId)) return null

  return (
    <>
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => onOpenChange(false)}
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
            />
            <motion.aside
              key="panel"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 280, damping: 28 }}
              className="fixed top-0 right-0 bottom-0 z-50 w-[min(380px,90vw)] bg-[#0b0a14]/96 border-l border-white/[0.06] backdrop-blur-xl flex flex-col"
            >
              <header className="flex items-center gap-2.5 px-4 py-3.5 border-b border-white/[0.06]">
                <Brain className="w-4 h-4 text-violet-300" />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-white/90">Chat memory</div>
                  <div className="text-[10.5px] text-white/40 truncate">
                    /opt/kimi-chats/{chatId.slice(0, 10)}…
                  </div>
                </div>
                <button
                  onClick={() => onOpenChange(false)}
                  className="p-1.5 rounded-md text-white/45 hover:text-white hover:bg-white/[0.06] transition"
                  title="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </header>

              <div className="px-4 py-2.5 flex items-center gap-2 border-b border-white/[0.04]">
                <button
                  onClick={doRegenerate}
                  disabled={!lastExchange || busy}
                  className="flex-1 px-2.5 py-1.5 rounded-md bg-violet-500/15 hover:bg-violet-500/25 border border-violet-400/20 text-[11.5px] text-violet-200 hover:text-violet-100 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center justify-center gap-1.5"
                  title={lastExchange ? 'Ask Kimi to refresh facts/decisions/summary' : 'Needs at least one reply from Kimi'}
                >
                  <RefreshCw className={'w-3 h-3 ' + (busy ? 'animate-spin' : '')} />
                  {busy ? 'Refreshing…' : 'Regenerate'}
                </button>
                <button
                  onClick={doCreateNote}
                  className="px-2.5 py-1.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-[11.5px] text-white/75 hover:text-white transition flex items-center gap-1"
                  title="Create your own note"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-2 py-2">
                {loading ? (
                  <div className="px-2 py-6 text-center text-[12px] text-white/40">loading…</div>
                ) : notes.length === 0 ? (
                  <div className="px-3 py-8 text-center">
                    <Brain className="w-10 h-10 mx-auto text-white/15 mb-3" />
                    <div className="text-[12.5px] text-white/55 mb-1">Memory is empty for now</div>
                    <div className="text-[10.5px] text-white/35 leading-relaxed">
                      After the first reply, Kimi will automatically create facts.md / decisions.md / summary.md.
                    </div>
                  </div>
                ) : (
                  <ul className="space-y-1.5">
                    {notes.map((n) => {
                      const badge = SYSTEM_BADGE[n.name]
                      return (
                        <li key={n.name}>
                          <button
                            onClick={() => setOpenNote({ name: n.name, isSystem: n.isSystem })}
                            className="w-full text-left px-3 py-2 rounded-md hover:bg-white/[0.04] transition group border border-transparent hover:border-white/[0.06]"
                          >
                            <div className="flex items-center gap-2">
                              <FileText className="w-3.5 h-3.5 text-white/40 flex-shrink-0" />
                              <span className="text-[12.5px] font-medium text-white/90 truncate flex-1">
                                {noteTitle(n.name)}
                              </span>
                              {n.isSystem && badge && (
                                <span className={'text-[9.5px] px-1.5 py-0.5 rounded border ' + badge}>
                                  sys
                                </span>
                              )}
                            </div>
                            {n.preview && (
                              <div className="mt-1 text-[11px] text-white/45 line-clamp-2 leading-snug">
                                {n.preview}
                              </div>
                            )}
                            <div className="mt-1 flex items-center gap-2 text-[10px] text-white/30">
                              <span>{formatBytes(n.size)}</span>
                              <span>·</span>
                              <span>{formatRelTime(n.mtime)}</span>
                            </div>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>

              <footer className="px-4 py-2.5 border-t border-white/[0.04] text-[10.5px] text-white/35 leading-snug">
                These MD files are automatically added to the system prompt of every Kimi reply.
                Edit them by hand — changes take effect immediately.
              </footer>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <NoteEditor
        chatId={chatId}
        name={openNote?.name ?? null}
        isSystem={openNote?.isSystem ?? false}
        onClose={() => setOpenNote(null)}
        onChanged={() => void reload()}
      />
    </>
  )
}
