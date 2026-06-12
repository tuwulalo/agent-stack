'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Save, Trash2, Eye, FileText } from 'lucide-react'
import { Markdown } from './Markdown'
import { deleteNote, noteTitle, readNote, writeNote } from '../lib/notes'

interface Props {
  chatId: string
  name: string | null         // null = closed
  isSystem?: boolean
  onClose: () => void
  onChanged?: () => void      // refresh parent list
}

export function NoteEditor({ chatId, name, isSystem = false, onClose, onChanged }: Props) {
  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!name) return
    let cancelled = false
    setLoading(true)
    setErr(null)
    readNote(chatId, name)
      .then((c) => {
        if (cancelled) return
        const safe = c ?? ''
        setContent(safe)
        setOriginal(safe)
        setLoading(false)
      })
      .catch((e) => {
        if (cancelled) return
        setErr(String(e?.message || e))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [chatId, name])

  if (!name) return null

  const dirty = content !== original

  const save = async () => {
    setSaving(true)
    setErr(null)
    try {
      const ok = await writeNote(chatId, name, content)
      if (!ok) throw new Error('write failed')
      setOriginal(content)
      onChanged?.()
    } catch (e) {
      setErr(String((e as Error)?.message || e))
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (isSystem) return
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return
    setSaving(true)
    try {
      const ok = await deleteNote(chatId, name)
      if (!ok) throw new Error('delete failed')
      onChanged?.()
      onClose()
    } catch (e) {
      setErr(String((e as Error)?.message || e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onMouseDown={(e) => {
          // close only when clicking the dim layer, not children
          if (e.target === e.currentTarget) onClose()
        }}
        className="fixed inset-0 z-[80] grid place-items-center bg-black/55 backdrop-blur-sm"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: 6 }}
          transition={{ type: 'spring', stiffness: 240, damping: 24 }}
          className="relative w-[min(820px,92vw)] h-[min(720px,84vh)] rounded-xl border border-white/10 bg-[#0c0b16]/95 backdrop-blur-xl shadow-2xl flex flex-col overflow-hidden"
        >
          {/* header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
            <FileText className="w-4 h-4 text-violet-300 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-[14px] text-white/90 font-medium truncate">
                {noteTitle(name)}
              </div>
              <div className="text-[10.5px] text-white/40 truncate">{name}</div>
            </div>
            <div className="flex gap-1 bg-white/[0.04] rounded-md p-0.5 border border-white/[0.06]">
              <button
                onClick={() => setTab('edit')}
                className={
                  'px-2.5 py-1 rounded text-[11px] transition ' +
                  (tab === 'edit' ? 'bg-white/[0.08] text-white' : 'text-white/55 hover:text-white/85')
                }
              >
                Editor
              </button>
              <button
                onClick={() => setTab('preview')}
                className={
                  'px-2.5 py-1 rounded text-[11px] transition flex items-center gap-1 ' +
                  (tab === 'preview' ? 'bg-white/[0.08] text-white' : 'text-white/55 hover:text-white/85')
                }
              >
                <Eye className="w-3 h-3" />
                Preview
              </button>
            </div>
            <button
              onClick={onClose}
              className="ml-1 p-1.5 rounded-md text-white/45 hover:text-white hover:bg-white/[0.06] transition"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* body */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {loading ? (
              <div className="h-full grid place-items-center text-white/40 text-sm">Loading…</div>
            ) : tab === 'edit' ? (
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                spellCheck={false}
                className="w-full h-full p-4 bg-transparent text-[13px] text-white/90 outline-none resize-none font-mono"
                style={{ fontFamily: 'var(--font-mono-loaded), ui-monospace, monospace' }}
                placeholder="# Heading&#10;&#10;- item"
              />
            ) : (
              <div className="h-full overflow-y-auto px-5 py-4 prose-invert-sm">
                {content.trim() ? (
                  <Markdown content={content} />
                ) : (
                  <div className="text-white/40 text-sm italic">Empty.</div>
                )}
              </div>
            )}
          </div>

          {/* footer */}
          <div className="flex items-center gap-2 px-4 py-3 border-t border-white/[0.06]">
            {err && (
              <span className="text-[11.5px] text-red-300 bg-red-500/10 border border-red-500/20 rounded px-2 py-0.5">
                {err}
              </span>
            )}
            <span className="text-[11px] text-white/40">
              {isSystem ? 'system file' : 'user file'}
              {dirty && <span className="ml-2 text-amber-300">• unsaved</span>}
            </span>
            <span className="flex-1" />
            {!isSystem && (
              <button
                onClick={remove}
                disabled={saving}
                className="px-2.5 py-1.5 rounded-md text-[11.5px] text-red-300/85 hover:text-red-200 hover:bg-red-500/10 transition flex items-center gap-1 disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>
            )}
            <button
              onClick={save}
              disabled={!dirty || saving}
              className="px-3 py-1.5 rounded-md text-[12px] bg-gradient-to-b from-violet-500 to-indigo-600 text-white hover:from-violet-400 hover:to-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center gap-1.5"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
