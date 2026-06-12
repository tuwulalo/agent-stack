'use client'

import * as React from 'react'
import { useEffect, useRef, useCallback, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  ImageIcon,
  Figma,
  MonitorIcon,
  ArrowUpIcon,
  Paperclip,
  XIcon,
  Sparkles,
  Command,
  StopCircle,
  MessageSquare,
  Zap,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { KimiMascot } from './kimi-mascot'
import { HermesMascot } from './hermes-mascot'
import { TypingDots } from './typing-dots'

/* ───────────────────────── auto-resize textarea hook ─────────────────────── */

interface UseAutoResizeTextareaProps {
  minHeight: number
  maxHeight?: number
}

function useAutoResizeTextarea({ minHeight, maxHeight }: UseAutoResizeTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const adjustHeight = useCallback(
    (reset?: boolean) => {
      const textarea = textareaRef.current
      if (!textarea) return
      if (reset) {
        textarea.style.height = `${minHeight}px`
        return
      }
      textarea.style.height = `${minHeight}px`
      const newHeight = Math.max(
        minHeight,
        Math.min(textarea.scrollHeight, maxHeight ?? Number.POSITIVE_INFINITY),
      )
      textarea.style.height = `${newHeight}px`
    },
    [minHeight, maxHeight],
  )

  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) textarea.style.height = `${minHeight}px`
  }, [minHeight])

  useEffect(() => {
    const handleResize = () => adjustHeight()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [adjustHeight])

  return { textareaRef, adjustHeight }
}

/* ───────────────────────── small textarea wrapper ────────────────────────── */

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  containerClassName?: string
  showRing?: boolean
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, containerClassName, showRing = true, ...props }, ref) => {
    const [isFocused, setIsFocused] = useState(false)
    return (
      <div className={cn('relative', containerClassName)}>
        <textarea
          ref={ref}
          className={cn(
            'flex min-h-[80px] w-full rounded-md border border-white/10 bg-transparent px-3 py-2 text-sm',
            'transition-all duration-200 ease-in-out',
            'placeholder:text-white/30',
            'disabled:cursor-not-allowed disabled:opacity-50',
            showRing
              ? 'focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
              : '',
            className,
          )}
          onFocus={(e) => {
            setIsFocused(true)
            props.onFocus?.(e)
          }}
          onBlur={(e) => {
            setIsFocused(false)
            props.onBlur?.(e)
          }}
          {...props}
        />
        {showRing && isFocused && (
          <motion.span
            className="absolute inset-0 rounded-md pointer-events-none ring-2 ring-offset-0 ring-violet-500/30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          />
        )}
      </div>
    )
  },
)
Textarea.displayName = 'Textarea'

/* ───────────────────────── command suggestions ───────────────────────────── */

interface CommandSuggestion {
  icon: React.ReactNode
  label: string
  description: string
  prefix: string
}

/* ───────────────────────── main component ────────────────────────────────── */

export type ChatMode = 'auto' | 'chat' | 'agent'

export interface AnimatedAIChatAttachment {
  id: string
  name: string
  size: number
  mime?: string
  /** true → file content was read as text and will be inlined */
  isText?: boolean
}

export interface AnimatedAIChatProps {
  value: string
  onValueChange: (v: string) => void
  onSubmit: () => void
  onStop?: () => void
  isStreaming?: boolean
  modelLabel?: string
  mode?: ChatMode
  onModeChange?: (m: ChatMode) => void
  /** Lifted attachments — if not provided, internal stub list is used */
  attachments?: AnimatedAIChatAttachment[]
  onAddFiles?: (files: File[]) => void
  onRemoveAttachment?: (id: string) => void
  /** Optional agent picker (replaces `modelLabel` when provided) */
  agentSlot?: React.ReactNode
  /** Hide the big greeting/suggestions when there's an active conversation */
  compact?: boolean
  /** Slot rendered above the input — typically the messages list */
  children?: React.ReactNode
  className?: string
}

function fmtSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '?'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

const COMMAND_SUGGESTIONS: CommandSuggestion[] = [
  {
    icon: <ImageIcon className="w-4 h-4" />,
    label: 'Объясни код',
    description: 'Разбор сниппета построчно',
    prefix: '/explain',
  },
  {
    icon: <Figma className="w-4 h-4" />,
    label: 'Endpoint',
    description: 'Express + zod валидация',
    prefix: '/endpoint',
  },
  {
    icon: <MonitorIcon className="w-4 h-4" />,
    label: 'SQL',
    description: 'Оптимизировать запрос',
    prefix: '/sql',
  },
  {
    icon: <Sparkles className="w-4 h-4" />,
    label: 'Hermes',
    description: 'Команда для агента',
    prefix: '/hermes',
  },
]

export function AnimatedAIChat({
  value,
  onValueChange,
  onSubmit,
  onStop,
  isStreaming = false,
  modelLabel,
  mode = 'chat',
  onModeChange,
  attachments: attachmentsProp,
  onAddFiles,
  onRemoveAttachment,
  agentSlot,
  compact = false,
  children,
  className,
}: AnimatedAIChatProps) {
  const isAgent = mode === 'agent'
  const isAuto = mode === 'auto'
  const isChat = mode === 'chat'

  /* Attachments: controlled if `attachmentsProp` provided, otherwise internal */
  const [internalAtts, setInternalAtts] = useState<AnimatedAIChatAttachment[]>([])
  const attachments = attachmentsProp ?? internalAtts
  const fileInputRef = useRef<HTMLInputElement>(null)

  const openPicker = () => fileInputRef.current?.click()
  const [isDragOver, setIsDragOver] = useState(false)
  const dragDepthRef = useRef(0)

  const handleFiles = (list: FileList | File[] | null) => {
    if (!list) return
    const arr = Array.isArray(list) ? list : Array.from(list)
    if (arr.length === 0) return
    if (onAddFiles) {
      onAddFiles(arr)
    } else {
      setInternalAtts((prev) => [
        ...prev,
        ...arr.map((f) => ({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: f.name,
          size: f.size,
          mime: f.type,
        })),
      ])
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  /** Strip away clipboard images so they don't paste as visible text noise. */
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items
    if (!items || items.length === 0) return
    const files: File[] = []
    for (const item of Array.from(items)) {
      if (item.kind !== 'file') continue
      if (!item.type.startsWith('image/')) continue
      const f = item.getAsFile()
      if (!f) continue
      // Clipboard images usually come as "image.png" — give them a unique name
      const ext = (item.type.split('/')[1] || 'png').split('+')[0]
      const looksGeneric = !f.name || /^(image|file)\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name)
      const name = looksGeneric
        ? `pasted-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${ext}`
        : f.name
      files.push(new File([f], name, { type: f.type }))
    }
    if (files.length > 0) {
      e.preventDefault()
      handleFiles(files)
    }
  }

  const handleDragEnter = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return
    e.preventDefault()
    dragDepthRef.current++
    setIsDragOver(true)
  }
  const handleDragOver = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  const handleDragLeave = () => {
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setIsDragOver(false)
  }
  const handleDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer?.files || e.dataTransfer.files.length === 0) return
    e.preventDefault()
    dragDepthRef.current = 0
    setIsDragOver(false)
    handleFiles(e.dataTransfer.files)
  }

  const removeAttach = (id: string) => {
    if (onRemoveAttachment) onRemoveAttachment(id)
    else setInternalAtts((prev) => prev.filter((a) => a.id !== id))
  }

  const [activeSuggestion, setActiveSuggestion] = useState<number>(-1)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [recentCommand, setRecentCommand] = useState<string | null>(null)
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })
  const [inputFocused, setInputFocused] = useState(false)

  const { textareaRef, adjustHeight } = useAutoResizeTextarea({
    minHeight: 60,
    maxHeight: 200,
  })
  const commandPaletteRef = useRef<HTMLDivElement>(null)

  /* command palette logic */
  useEffect(() => {
    if (value.startsWith('/') && !value.includes(' ')) {
      setShowCommandPalette(true)
      const matchIdx = COMMAND_SUGGESTIONS.findIndex((c) => c.prefix.startsWith(value))
      setActiveSuggestion(matchIdx)
    } else {
      setShowCommandPalette(false)
    }
  }, [value])

  /* glow follows cursor when input focused */
  useEffect(() => {
    const onMove = (e: MouseEvent) => setMousePosition({ x: e.clientX, y: e.clientY })
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  /* close palette on outside click */
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node
      const cmdBtn = document.querySelector('[data-command-button]')
      if (
        commandPaletteRef.current &&
        !commandPaletteRef.current.contains(target) &&
        !cmdBtn?.contains(target)
      ) {
        setShowCommandPalette(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const canSubmit = value.trim().length > 0 || attachments.length > 0

  const send = () => {
    if (isStreaming) return
    if (!canSubmit) return
    onSubmit()
    adjustHeight(true)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showCommandPalette) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveSuggestion((p) => (p < COMMAND_SUGGESTIONS.length - 1 ? p + 1 : 0))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveSuggestion((p) => (p > 0 ? p - 1 : COMMAND_SUGGESTIONS.length - 1))
        return
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        if (activeSuggestion >= 0) {
          e.preventDefault()
          pickSuggestion(activeSuggestion)
          return
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowCommandPalette(false)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const pickSuggestion = (i: number) => {
    const cmd = COMMAND_SUGGESTIONS[i]
    onValueChange(cmd.prefix + ' ')
    setShowCommandPalette(false)
    setRecentCommand(cmd.label)
    setTimeout(() => setRecentCommand(null), 2000)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  /* ───────────────────────── render ─────────────────────────── */

  return (
    <div
      className={cn(
        'flex flex-col w-full items-center justify-center bg-transparent text-white relative',
        // overflow-hidden is needed for the glow-blob clip in hero mode,
        // but in compact mode it would clip the upward-popping command palette.
        compact ? 'py-6' : 'min-h-screen p-6 overflow-hidden',
        className,
      )}
    >
      {/* glow blobs */}
      {!compact && (
        <div className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-violet-500/10 rounded-full mix-blend-normal filter blur-[128px] animate-pulse" />
          <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-indigo-500/10 rounded-full mix-blend-normal filter blur-[128px] animate-pulse delay-700" />
          <div className="absolute top-1/4 right-1/3 w-64 h-64 bg-fuchsia-500/10 rounded-full mix-blend-normal filter blur-[96px] animate-pulse delay-1000" />
        </div>
      )}

      <div className={cn('w-full mx-auto relative', compact ? 'max-w-3xl' : 'max-w-2xl')}>
        <motion.div
          className="relative z-10 space-y-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        >
          {!compact && (
            <div className="text-center space-y-3">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15, duration: 0.5 }}
                className="inline-block"
              >
                <h1 className="text-3xl md:text-4xl font-medium tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white/95 to-white/40 pb-1">
                  {isAgent ? 'Что выполнить на VPS?' : isChat ? 'Чем помочь сегодня?' : 'Спроси что угодно'}
                </h1>
                <motion.div
                  className="h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: '100%', opacity: 1 }}
                  transition={{ delay: 0.4, duration: 0.7 }}
                />
              </motion.div>
              <motion.p
                className="text-sm text-white/40"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.25 }}
              >
                {isAgent
                  ? 'Hermes выполнит задачу автономно — шеллы, файлы, всё сам'
                  : 'Напиши вопрос или начни команду со слэша'}
              </motion.p>
            </div>
          )}

          {/* messages slot */}
          {children}

          {/* composer card */}
          <motion.div
            className={cn(
              'relative backdrop-blur-2xl bg-white/[0.02] rounded-2xl border shadow-2xl transition-colors',
              isDragOver
                ? 'border-violet-400/60 ring-2 ring-violet-500/25'
                : 'border-white/[0.06]',
            )}
            initial={{ scale: 0.98 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.1 }}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <AnimatePresence>
              {isDragOver && (
                <motion.div
                  key="drop-overlay"
                  className="absolute inset-0 z-30 grid place-items-center rounded-2xl bg-violet-950/55 backdrop-blur-sm pointer-events-none border-2 border-dashed border-violet-300/50"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <div className="flex flex-col items-center gap-2 text-center">
                    <Paperclip className="w-7 h-7 text-violet-200" />
                    <div className="text-[13px] font-medium text-white">
                      Отпусти, чтобы прикрепить
                    </div>
                    <div className="text-[11px] text-white/65">
                      файлы добавятся к следующему сообщению
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <AnimatePresence>
              {showCommandPalette && (
                <motion.div
                  ref={commandPaletteRef}
                  className="absolute left-4 right-4 bottom-full mb-2 backdrop-blur-xl bg-black/90 rounded-lg z-50 shadow-lg border border-white/10 overflow-hidden"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 5 }}
                  transition={{ duration: 0.15 }}
                >
                  <div className="py-1 bg-black/95">
                    {COMMAND_SUGGESTIONS.map((s, i) => (
                      <motion.div
                        key={s.prefix}
                        className={cn(
                          'flex items-center gap-2 px-3 py-2 text-xs transition-colors cursor-pointer',
                          activeSuggestion === i
                            ? 'bg-white/10 text-white'
                            : 'text-white/70 hover:bg-white/5',
                        )}
                        onClick={() => pickSuggestion(i)}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: i * 0.03 }}
                      >
                        <div className="w-5 h-5 flex items-center justify-center text-white/60">
                          {s.icon}
                        </div>
                        <div className="font-medium">{s.label}</div>
                        <div className="text-white/40 text-xs ml-1">{s.prefix}</div>
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="p-4">
              <Textarea
                ref={textareaRef}
                value={value}
                onChange={(e) => {
                  onValueChange(e.target.value)
                  adjustHeight()
                }}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                placeholder={
                  isAgent
                    ? 'Например: «открой google.com и сохрани скриншот в /tmp/g.png»'
                    : 'Вставь текст или картинку (Ctrl+V) · спроси Kimi…'
                }
                containerClassName="w-full"
                className={cn(
                  'w-full px-4 py-3',
                  'resize-none',
                  'bg-transparent',
                  'border-none',
                  'text-white/90 text-sm',
                  'focus:outline-none',
                  'placeholder:text-white/20',
                  'min-h-[60px]',
                )}
                style={{ overflow: 'hidden' }}
                showRing={false}
              />
            </div>

            <AnimatePresence>
              {attachments.length > 0 && (
                <motion.div
                  className="px-4 pb-3 flex gap-2 flex-wrap"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  {attachments.map((a) => (
                    <motion.div
                      key={a.id}
                      className="flex items-center gap-2 text-[12px] bg-white/[0.04] hover:bg-white/[0.06] border border-white/10 py-1.5 pl-2.5 pr-1.5 rounded-md text-white/75 max-w-[260px]"
                      initial={{ opacity: 0, scale: 0.92 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.92 }}
                    >
                      <Paperclip className="w-3 h-3 text-white/45 flex-shrink-0" />
                      <span className="truncate" title={a.name}>{a.name}</span>
                      <span className="text-white/40 flex-shrink-0 text-[11px]">
                        {fmtSize(a.size)}
                      </span>
                      {a.isText === false && (
                        <span className="px-1 rounded bg-white/[0.06] text-white/55 text-[10px] tracking-wider uppercase flex-shrink-0">
                          bin
                        </span>
                      )}
                      <button
                        onClick={() => removeAttach(a.id)}
                        className="ml-0.5 w-5 h-5 grid place-items-center rounded text-white/45 hover:text-white hover:bg-white/[0.08] transition-colors flex-shrink-0"
                        aria-label={`Убрать ${a.name}`}
                      >
                        <XIcon className="w-3 h-3" />
                      </button>
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            {/* hidden native file picker */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(e) => handleFiles(e.target.files)}
            />

            <div className="px-3 py-3 border-t border-white/[0.05] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <motion.button
                  type="button"
                  onClick={openPicker}
                  whileTap={{ scale: 0.94 }}
                  className="w-8 h-8 grid place-items-center rounded-md text-white/45 hover:text-white/90 hover:bg-white/[0.06] transition-colors"
                  aria-label="Вложить файл"
                  title="Вложить файл"
                >
                  <Paperclip className="w-4 h-4" />
                </motion.button>
                <motion.button
                  type="button"
                  data-command-button
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowCommandPalette((p) => !p)
                  }}
                  whileTap={{ scale: 0.94 }}
                  className={cn(
                    'w-8 h-8 grid place-items-center rounded-md transition-colors',
                    showCommandPalette
                      ? 'bg-white/[0.10] text-white/95'
                      : 'text-white/45 hover:text-white/90 hover:bg-white/[0.06]',
                  )}
                  aria-label="Открыть палитру команд"
                >
                  <Command className="w-4 h-4" />
                </motion.button>

                {onModeChange && (
                  <div
                    role="tablist"
                    aria-label="Режим"
                    className="flex items-center gap-0.5 h-8 p-0.5 rounded-md bg-white/[0.04] border border-white/10"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={isAuto}
                      onClick={() => onModeChange('auto')}
                      className={cn(
                        'flex items-center gap-1.5 h-7 px-2.5 rounded text-[11px] font-medium transition',
                        isAuto
                          ? 'bg-gradient-to-r from-amber-400/25 to-violet-400/25 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]'
                          : 'text-white/55 hover:text-white/85',
                      )}
                      title="Kimi сам решает звать Hermes или нет"
                    >
                      <Sparkles className="w-3 h-3" />
                      Auto
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={isChat}
                      onClick={() => onModeChange('chat')}
                      className={cn(
                        'flex items-center gap-1.5 h-7 px-2.5 rounded text-[11px] font-medium transition',
                        isChat
                          ? 'bg-white/[0.10] text-white/95'
                          : 'text-white/55 hover:text-white/85',
                      )}
                      title="Только Kimi, без Hermes — для Q&A и кода"
                    >
                      <MessageSquare className="w-3 h-3" />
                      Chat
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={isAgent}
                      onClick={() => onModeChange('agent')}
                      className={cn(
                        'flex items-center gap-1.5 h-7 px-2.5 rounded text-[11px] font-medium transition',
                        isAgent
                          ? 'bg-gradient-to-r from-violet-500/35 to-fuchsia-500/35 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]'
                          : 'text-white/55 hover:text-white/85',
                      )}
                      title="Принудительно через Hermes — для shell/файлов/сабагентов"
                    >
                      <Zap className="w-3 h-3" />
                      Agent
                    </button>
                  </div>
                )}

                {agentSlot}

                {modelLabel && (
                  <div className="hidden md:flex items-center gap-2 h-8 px-2.5 rounded-md bg-white/[0.04] border border-white/10 text-[11px] text-white/55 truncate">
                    <span
                      className={cn(
                        'w-1.5 h-1.5 rounded-full flex-shrink-0',
                        isAgent
                          ? 'bg-fuchsia-400 shadow-[0_0_6px_rgba(232,121,249,0.7)]'
                          : 'bg-violet-400 shadow-[0_0_6px_rgba(168,85,247,0.7)]',
                      )}
                    />
                    <span className="truncate">
                      {isAgent ? 'Hermes Agent' : modelLabel}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {/* inline status next to send button — replaces the floating pill */}
                <AnimatePresence>
                  {isStreaming && compact && (
                    <motion.div
                      key="status"
                      initial={{ opacity: 0, x: 8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 8 }}
                      className="hidden sm:flex items-center gap-2 h-8 px-2.5 rounded-md bg-white/[0.04] border border-white/10 text-[11px] text-white/65"
                    >
                      <span>{isAgent ? 'Hermes выполняет' : 'Думает'}</span>
                      <TypingDots />
                    </motion.div>
                  )}
                </AnimatePresence>

                {isStreaming ? (
                  <motion.button
                    type="button"
                    onClick={onStop}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.97 }}
                    className="h-8 px-3 rounded-md text-[12px] font-medium flex items-center gap-1.5 bg-white/[0.08] hover:bg-white/[0.12] text-white border border-white/15 transition-colors"
                  >
                    <StopCircle className="w-3.5 h-3.5" />
                    <span>Остановить</span>
                  </motion.button>
                ) : (
                  <motion.button
                    type="button"
                    onClick={send}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.97 }}
                    disabled={!canSubmit}
                    className={cn(
                      'h-8 px-3 rounded-md text-[12px] font-semibold transition-all',
                      'flex items-center gap-1.5',
                      canSubmit
                        ? 'bg-white text-[#0A0A0B] shadow-md shadow-white/10 hover:shadow-white/20'
                        : 'bg-white/[0.05] text-white/35 cursor-not-allowed',
                    )}
                  >
                    <ArrowUpIcon className="w-3.5 h-3.5" />
                    <span>Отправить</span>
                  </motion.button>
                )}
              </div>
            </div>
          </motion.div>

          {!compact && (
            <div className="flex flex-wrap items-center justify-center gap-2">
              {COMMAND_SUGGESTIONS.map((s, i) => (
                <motion.button
                  key={s.prefix}
                  onClick={() => pickSuggestion(i)}
                  className="flex items-center gap-2 px-3 py-2 bg-white/[0.02] hover:bg-white/[0.05] rounded-lg text-sm text-white/60 hover:text-white/90 transition-all relative group border border-white/[0.05]"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.08 }}
                >
                  {s.icon}
                  <span>{s.label}</span>
                </motion.button>
              ))}
            </div>
          )}
        </motion.div>
      </div>

      <AnimatePresence>
        {recentCommand && (
          <motion.div
            className="fixed bottom-8 left-1/2 -translate-x-1/2 backdrop-blur-2xl bg-white/[0.04] rounded-full px-4 py-2 shadow-lg border border-white/10 text-sm text-white/80 z-50"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
          >
            Выбрано: <span className="text-white">{recentCommand}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isStreaming && !compact && (
          <motion.div
            className="fixed bottom-8 left-1/2 -translate-x-1/2 backdrop-blur-2xl bg-white/[0.04] rounded-full pl-2 pr-4 py-1.5 shadow-lg border border-white/10 z-40"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
          >
            <div className="flex items-center gap-2.5">
              <div
                className={cn(
                  'w-7 h-7 rounded-full grid place-items-center overflow-hidden ring-1',
                  isAgent
                    ? 'bg-white/[0.05] ring-fuchsia-400/25'
                    : 'bg-white/[0.05] ring-white/10',
                )}
              >
                {isAgent ? <HermesMascot size={22} /> : <KimiMascot size={22} />}
              </div>
              <div className="flex items-center gap-2 text-sm text-white/75">
                <span>{isAgent ? 'Hermes выполняет' : 'Kimi думает'}</span>
                <TypingDots />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {inputFocused && !compact && (
        <motion.div
          className="fixed w-[50rem] h-[50rem] rounded-full pointer-events-none z-0 opacity-[0.025] bg-gradient-to-r from-violet-500 via-fuchsia-500 to-indigo-500 blur-[96px]"
          animate={{ x: mousePosition.x - 400, y: mousePosition.y - 400 }}
          transition={{ type: 'spring', damping: 25, stiffness: 150, mass: 0.5 }}
        />
      )}
    </div>
  )
}

