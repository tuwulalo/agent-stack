'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { AnimatedAIChat, type ChatMode } from '@/components/ui/animated-ai-chat'
import { KimiMascot } from '@/components/ui/kimi-mascot'
import { HermesMascot } from '@/components/ui/hermes-mascot'
import { TypingDots } from '@/components/ui/typing-dots'
import { Markdown } from './components/Markdown'
import { AgentTrace } from './components/AgentTrace'
import { ImageLightbox, type LightboxImage } from './components/ImageLightbox'
import { SessionsSidebar } from './components/SessionsSidebar'
import { streamChat } from './lib/stream'
import { agentRun, type AgentArtifact, type AgentContextTurn, type AgentStep } from './lib/agent'
import { autoRun, type AutoEvent } from './lib/auto'
import { AgentPicker } from './components/AgentPicker'
import { ChatNotesPanel } from './components/ChatNotesPanel'
import { listNotes as fetchNotesList } from './lib/notes'
import {
  type AttachedFile,
  buildAgentPrefix,
  buildChatPrefix,
  describeImages,
  fileToAttachment,
  fileToDataUrl,
  INLINE_IMAGE_BYTES_CAP,
  toChatContentBlocks,
  uploadAttachments,
} from './lib/attachments'
import {
  type ChatSession,
  type SessionMessage,
  type UserAttachment,
  createSession,
  deriveTitle,
  loadActiveId,
  loadSessions,
  saveActiveId,
  saveSessions,
  uid,
} from './lib/sessions'
import { agentFileUrl, DEFAULT_MODEL, DEFAULT_SYSTEM_PROMPT, HERMES_DASHBOARD, MODELS } from './lib/config'
import { Brain, ExternalLink, FileText, LogOut, Menu, Paperclip, Play, RotateCcw, Sparkles, Terminal, Youtube, Zap } from 'lucide-react'

// Claude's vision pipeline handles at most 5 images per message — bigger
// drops get split into sequential turns, with a "hold on" prompt for all
// but the last batch.
const CLAUDE_IMAGE_BATCH_LIMIT = 5
const MORE_IMAGES_PROMPT = "I sent 5 photos, more are coming — don't do anything yet."
const DEFAULT_ATTACHMENT_PROMPT = 'Look through the attached files and share your conclusions.'
const DEFAULT_IMAGE_PROMPT = 'Look through the attached photos and share your conclusions.'

function splitAttachmentsForClaudeLimit(attachments: AttachedFile[]): AttachedFile[][] {
  const images = attachments.filter((a) => a.mime.startsWith('image/'))
  if (images.length <= CLAUDE_IMAGE_BATCH_LIMIT) return [attachments]

  const nonImages = attachments.filter((a) => !a.mime.startsWith('image/'))
  const batches: AttachedFile[][] = []
  for (let i = 0; i < images.length; i += CLAUDE_IMAGE_BATCH_LIMIT) {
    const imageBatch = images.slice(i, i + CLAUDE_IMAGE_BATCH_LIMIT)
    const isLast = i + CLAUDE_IMAGE_BATCH_LIMIT >= images.length
    batches.push(isLast ? [...imageBatch, ...nonImages] : imageBatch)
  }
  return batches
}

// Per-attachment metadata for the user bubble — embed image thumbnails as
// data URLs (small enough to survive in localStorage).
async function buildUserAttachments(atts: AttachedFile[]): Promise<UserAttachment[]> {
  return Promise.all(
    atts.map(async (a) => {
      const isImage = a.mime.startsWith('image/')
      let dataUrl: string | undefined
      if (isImage && a.size <= INLINE_IMAGE_BYTES_CAP) {
        try {
          dataUrl = await fileToDataUrl(a.raw)
        } catch {
          /* keep undefined -> falls back to chip */
        }
      }
      return { name: a.name, size: a.size, mime: a.mime, isImage, dataUrl }
    }),
  )
}
import Link from 'next/link'

function ElapsedBadge({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const sec = Math.max(0, Math.floor((now - since) / 1000))
  const display = sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`
  return (
    <span className="ml-1.5 text-[10.5px] font-mono text-white/45 tabular-nums">
      {display}
    </span>
  )
}

function MessageBubble({
  m,
  streaming,
  onOpenImage,
}: {
  m: SessionMessage
  streaming: boolean
  onOpenImage: (img: LightboxImage) => void
}) {
  const isUser = m.role === 'user'
  const fromAgent = m.via === 'agent'
  const hasSteps = !!(m.steps && m.steps.length > 0)
  const isEmpty = !isUser && (m.content?.trim().length ?? 0) === 0

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'items-start'}`}>
      {/* avatar */}
      {isUser ? (
        <div
          className="flex-shrink-0 w-8 h-8 rounded-lg grid place-items-center text-[11px] font-semibold tracking-tight bg-white/[0.06] border border-white/10 text-white/80"
          title="You"
        >
          You
        </div>
      ) : fromAgent ? (
        <div
          className="flex-shrink-0 w-8 h-8 rounded-lg grid place-items-center bg-white/[0.04] border border-white/10 overflow-hidden shadow-md shadow-fuchsia-500/15"
          title="Hermes Agent"
        >
          <HermesMascot size={26} />
        </div>
      ) : (
        <div
          className="flex-shrink-0 w-8 h-8 rounded-lg grid place-items-center bg-white/[0.04] border border-white/10 overflow-hidden"
          title="Kimi"
        >
          <KimiMascot size={26} />
        </div>
      )}

      {/* bubble */}
      <div
        className={
          'min-w-0 max-w-[85%] rounded-2xl px-4 py-3 text-[14px] leading-[1.6] ' +
          (isUser
            ? 'bg-white text-[#0A0A0B] shadow-md'
            : 'bg-white/[0.03] border border-white/[0.06] text-white/90 backdrop-blur')
        }
      >
        {!isUser && fromAgent && (
          <div className="flex items-center gap-1.5 mb-2 text-[10.5px] uppercase tracking-[0.12em] text-violet-300/80">
            <Terminal className="w-3 h-3" />
            <span>Hermes · autonomous</span>
            {streaming && <ElapsedBadge since={m.createdAt} />}
            {typeof m.exitCode === 'number' && m.exitCode !== 0 && (
              <span className="ml-1 px-1.5 rounded bg-red-500/15 text-red-300">
                exit {m.exitCode}
              </span>
            )}
          </div>
        )}

        {!isUser && fromAgent && hasSteps && (
          <AgentTrace steps={m.steps!} streaming={streaming} />
        )}

        {isUser ? (
          <>
            {m.userAttachments && m.userAttachments.length > 0 && (
              <div
                className={
                  'mb-2 grid gap-2 ' +
                  (m.userAttachments.filter((a) => a.isImage).length === 1 &&
                  m.userAttachments.length === 1
                    ? 'grid-cols-1'
                    : 'grid-cols-2')
                }
              >
                {m.userAttachments
                  .filter((a) => a.isImage && a.dataUrl)
                  .map((a, i) => {
                    const layoutId = `user-${m.id}-${i}`
                    return (
                      <button
                        key={`img-${i}`}
                        type="button"
                        onClick={() =>
                          onOpenImage({
                            url: a.dataUrl!,
                            name: a.name,
                            size: a.size,
                            layoutId,
                          })
                        }
                        className="group relative block rounded-lg overflow-hidden border border-black/10 bg-black/5 hover:border-violet-500/50 transition cursor-zoom-in p-0 text-left"
                        title={`${a.name} · ${(a.size / 1024).toFixed(1)} KB · click to open`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
                        <motion.img
                          layoutId={layoutId}
                          src={a.dataUrl}
                          alt={a.name}
                          loading="lazy"
                          draggable={false}
                          transition={{ type: 'spring', damping: 32, stiffness: 200, mass: 1 }}
                          className="block w-full h-auto object-cover max-h-[220px] transition-transform duration-300 ease-out group-hover:scale-[1.015]"
                        />
                      </button>
                    )
                  })}
              </div>
            )}
            {m.userAttachments &&
              m.userAttachments.some((a) => !a.isImage || !a.dataUrl) && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {m.userAttachments
                    .filter((a) => !a.isImage || !a.dataUrl)
                    .map((a, i) => (
                      <span
                        key={`f-${i}`}
                        className="inline-flex items-center gap-1.5 max-w-[240px] px-2 py-1 rounded-md bg-black/[0.06] border border-black/10 text-[11.5px] text-[#0A0A0B]/80"
                      >
                        {a.isImage ? (
                          <Paperclip className="w-3 h-3 flex-shrink-0 opacity-60" />
                        ) : (
                          <FileText className="w-3 h-3 flex-shrink-0 opacity-60" />
                        )}
                        <span className="truncate" title={a.name}>
                          {a.name}
                        </span>
                        <span className="opacity-55 flex-shrink-0">
                          {(a.size / 1024).toFixed(1)} KB
                        </span>
                      </span>
                    ))}
                </div>
              )}
            {m.content && (
              <div className="whitespace-pre-wrap break-words">{m.content}</div>
            )}
          </>
        ) : isEmpty ? (
          <div className="flex items-center gap-2 py-1 text-white/45">
            <TypingDots />
            <span className="text-[12px]">
              {fromAgent
                ? hasSteps
                  ? 'Hermes is putting together the final answer…'
                  : 'Starting Hermes…'
                : 'Kimi is thinking…'}
            </span>
          </div>
        ) : (
          <>
            <Markdown text={m.content} />
            {streaming && <span className="streaming-cursor" aria-hidden />}
          </>
        )}

        {!isUser && m.artifacts && m.artifacts.length > 0 && (
          <div
            className={
              'mt-3 grid gap-2 ' +
              (m.artifacts.length === 1 ? 'grid-cols-1' : 'grid-cols-2')
            }
          >
            {m.artifacts.map((a) => {
              const layoutId = `art-${m.id}-${a.path}`
              return (
              <button
                key={a.path}
                type="button"
                onClick={() =>
                  onOpenImage({
                    url: agentFileUrl(a.path),
                    name: a.name,
                    size: a.size,
                    layoutId,
                  })
                }
                className="group relative block rounded-lg overflow-hidden border border-white/10 bg-[#05050a] hover:border-violet-400/40 transition shadow-md shadow-black/40 cursor-zoom-in p-0 text-left"
                title={`${a.name} · ${(a.size / 1024).toFixed(1)} KB · click to open`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
                <motion.img
                  layoutId={layoutId}
                  src={agentFileUrl(a.path)}
                  alt={a.name}
                  loading="lazy"
                  draggable={false}
                  transition={{ type: 'spring', damping: 32, stiffness: 200, mass: 1 }}
                  className={
                    'block w-full h-auto object-contain transition-transform duration-300 ease-out group-hover:scale-[1.015] ' +
                    (m.artifacts!.length === 1 ? 'max-h-[480px]' : 'max-h-[260px]')
                  }
                />
                <div className="absolute bottom-0 inset-x-0 px-3 py-1.5 text-[11px] font-mono text-white/90 bg-gradient-to-t from-black/95 via-black/65 to-transparent flex items-center justify-between gap-3">
                  <span className="truncate" title={a.path}>{a.name}</span>
                  <span className="text-white/55 flex-shrink-0">
                    {(a.size / 1024).toFixed(1)} KB
                  </span>
                </div>
              </button>
            )
            })}
          </div>
        )}

        {!isUser && m.stderr && m.stderr.trim().length > 0 && (
          <details className="mt-3 text-[12px] text-white/55">
            <summary className="cursor-pointer select-none hover:text-white/80">
              stderr ({m.stderr.length} chars)
            </summary>
            <pre className="mt-2 whitespace-pre-wrap break-words bg-black/40 border border-white/10 rounded-md p-2 text-[11.5px] font-mono text-red-200/80 max-h-64 overflow-auto">
              {m.stderr}
            </pre>
          </details>
        )}
      </div>
    </div>
  )
}

export default function Page() {
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [attachments, setAttachments] = useState<AttachedFile[]>([])
  const [lightbox, setLightbox] = useState<LightboxImage | null>(null)
  /** Bumped after every completed assistant response — forces ChatNotesPanel to refetch. */
  const [notesRefresh, setNotesRefresh] = useState(0)
  /** Controlled state for the memory sidebar (trigger lives in the top-right cluster). */
  const [notesOpen, setNotesOpen] = useState(false)
  /** Notes count for the badge on the "Memory" button. Updated when the panel refreshes. */
  const [notesCount, setNotesCount] = useState<number>(0)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  /* hydrate sessions — honors ?session=<id> and ?new=1 URL params for cross-tab linking */
  useEffect(() => {
    const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
    const wantSession = params?.get('session')
    const wantNew = params?.get('new')

    const loaded = loadSessions()
    const savedActive = loadActiveId()

    if (wantNew === '1') {
      const fresh = createSession('auto')
      setSessions([fresh, ...loaded])
      setActiveId(fresh.id)
    } else if (wantSession && loaded.find((s) => s.id === wantSession)) {
      setSessions(loaded)
      setActiveId(wantSession)
    } else if (loaded.length === 0) {
      const first = createSession('auto')
      setSessions([first])
      setActiveId(first.id)
    } else {
      setSessions(loaded)
      const found = savedActive && loaded.find((s) => s.id === savedActive)
      setActiveId(found ? savedActive : loaded[0].id)
    }
    // strip the URL params after consuming so reload won't re-create
    if (params && (wantNew || wantSession) && typeof window !== 'undefined') {
      const url = window.location.pathname
      window.history.replaceState({}, '', url)
    }
    setHydrated(true)
  }, [])

  /* persist sessions + active id */
  useEffect(() => {
    if (!hydrated) return
    saveSessions(sessions)
  }, [sessions, hydrated])
  useEffect(() => {
    if (!hydrated) return
    saveActiveId(activeId)
  }, [activeId, hydrated])

  const session = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? null,
    [sessions, activeId],
  )
  const messages = session?.messages ?? []
  // Always auto-route: Kimi decides whether to answer directly or hand off to
  // Hermes. The manual Chat/Agent toolbar was removed — keep `mode` as a
  // typed constant so existing branches further below still compile.
  const mode: ChatMode = 'auto'

  const updateSession = (
    id: string,
    patch: Partial<ChatSession> | ((s: ChatSession) => ChatSession),
  ) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s
        const next = typeof patch === 'function' ? patch(s) : { ...s, ...patch }
        return { ...next, updatedAt: Date.now() }
      }),
    )
  }
  const updateMessages = (
    id: string,
    patch: (msgs: SessionMessage[]) => SessionMessage[],
  ) => {
    updateSession(id, (s) => ({ ...s, messages: patch(s.messages) }))
  }

  /* autoscroll */
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages])

  /* notes count badge — re-fetch when chat switches or after every response */
  useEffect(() => {
    if (!activeId) {
      setNotesCount(0)
      return
    }
    let cancelled = false
    fetchNotesList(activeId).then((list) => {
      if (!cancelled) setNotesCount(list.length)
    })
    return () => {
      cancelled = true
    }
  }, [activeId, notesRefresh])

  /* attachments */
  const onAddFiles = async (files: File[]) => {
    const loaded = await Promise.all(files.map(fileToAttachment))
    setAttachments((prev) => [...prev, ...loaded])
  }
  const onRemoveAttachment = (id: string) =>
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  const compactAttachments = attachments.map((a) => ({
    id: a.id,
    name: a.name,
    size: a.size,
    mime: a.mime,
    isText: a.text !== undefined,
  }))

  /* mode switch — per-session */
  const setMode = (m: ChatMode) => {
    if (!session) return
    updateSession(session.id, { mode: m })
  }

  /* session ops */
  const onNewSession = () => {
    if (isStreaming) abortRef.current?.abort()
    const fresh = createSession(mode)
    setSessions((prev) => [fresh, ...prev])
    setActiveId(fresh.id)
    setInput('')
    setAttachments([])
  }
  const onSelectSession = (id: string) => {
    if (id === activeId) return
    if (isStreaming) abortRef.current?.abort()
    setActiveId(id)
    setInput('')
    setAttachments([])
  }
  const onDeleteSession = (id: string) => {
    setSessions((prev) => {
      const filtered = prev.filter((s) => s.id !== id)
      if (filtered.length === 0) {
        const fresh = createSession('chat')
        setActiveId(fresh.id)
        return [fresh]
      }
      if (id === activeId) setActiveId(filtered[0].id)
      return filtered
    })
  }
  const onRenameSession = (id: string, title: string) =>
    updateSession(id, { title })
  const onResetCurrent = () => {
    if (!session) return
    if (isStreaming) abortRef.current?.abort()
    updateSession(session.id, { messages: [], title: 'New chat' })
    setInput('')
    setAttachments([])
  }

  /* sending */
  const sendChat = async (
    sid: string,
    prevMessages: SessionMessage[],
    aMsgId: string,
    promptForApi: string,
    currentAttachments: AttachedFile[],
    ctrl: AbortController,
  ) => {
    // Reconstruct multimodal content for prior turns that had image attachments,
    // so Kimi can still "see" them on follow-up questions.
    const historyMessages = prevMessages.map((m) => {
      const imgs = (m.userAttachments || []).filter((a) => a.isImage && a.dataUrl)
      if (imgs.length === 0 || m.role !== 'user') {
        return { role: m.role, content: m.content }
      }
      return {
        role: m.role,
        content: [
          ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
          ...imgs.map((a) => ({
            type: 'image_url' as const,
            image_url: { url: a.dataUrl! },
          })),
        ],
      }
    })

    const currentBlocks = await toChatContentBlocks(promptForApi, currentAttachments)
    const userContent =
      currentBlocks.length > 0
        ? currentBlocks
        : promptForApi    // no images → keep simple string

    const apiMessages = [
      { role: 'system' as const, content: DEFAULT_SYSTEM_PROMPT },
      ...historyMessages,
      { role: 'user' as const, content: userContent },
    ]
    await streamChat({
      model: DEFAULT_MODEL,
      messages: apiMessages,
      signal: ctrl.signal,
      onDelta: (chunk) => {
        updateMessages(sid, (msgs) =>
          msgs.map((m) =>
            m.id === aMsgId ? { ...m, content: m.content + chunk } : m,
          ),
        )
      },
    })
  }

  /** Auto router — backend decides hermes vs direct kimi. Reuses agent event handler shape. */
  // Wait until the kimi proxy answers /health again. Returns true on recovery,
  // false on timeout/user-abort. Used to auto-resume an interrupted reply.
  const waitForProxyHealth = async (
    maxMs: number,
    signal: AbortSignal,
  ): Promise<boolean> => {
    const deadline = Date.now() + maxMs
    while (Date.now() < deadline) {
      if (signal.aborted) return false
      try {
        const r = await fetch('/_kp/health', { signal })
        if (r.ok) return true
      } catch { /* still down */ }
      await new Promise((r) => setTimeout(r, 1500))
    }
    return false
  }

  const sendAuto = async (
    sid: string,
    aMsgId: string,
    promptForApi: string,
    context: AgentContextTurn[],
    agentId: string | null,
    ctrl: AbortController,
  ) => {
    let stderrBuf = ''
    let assistantBuf = ''
    let attempt = 0
    let currentPrompt = promptForApi
    let currentContext: AgentContextTurn[] = context

    // The onEvent handler is identical across attempts. Defined once, reused.
    const handleEvent = (e: AutoEvent) => {
        // mark which route was chosen — surface in the bubble so user understands
        if (e.type === 'route') {
          updateMessages(sid, (msgs) =>
            msgs.map((m) =>
              m.id === aMsgId ? { ...m, via: e.route === 'hermes' ? 'agent' : 'kimi' } : m,
            ),
          )
        } else if (e.type === 'stdout') {
          assistantBuf += e.data
          updateMessages(sid, (msgs) =>
            msgs.map((m) => (m.id === aMsgId ? { ...m, content: m.content + e.data } : m)),
          )
        } else if (e.type === 'step') {
          const step: AgentStep =
            e.kind === 'tool_call'
              ? {
                  kind: 'tool_call',
                  name: e.name,
                  args: e.args,
                  toolCallId: e.toolCallId,
                  ...(e.subagent
                    ? {
                        subagent: true,
                        subagentRole: e.subagentRole,
                        ...(e.subtasks ? { subtasks: e.subtasks } : {}),
                      }
                    : {}),
                }
              : e.kind === 'tool_result'
                ? {
                    kind: 'tool_result',
                    toolCallId: e.toolCallId,
                    text: e.text,
                    ...(e.subagentResults ? { subagentResults: e.subagentResults } : {}),
                  }
                : e.kind === 'thinking'
                  ? { kind: 'thinking', text: e.text }
                  : { kind: 'note', text: e.text }
          updateMessages(sid, (msgs) =>
            msgs.map((m) => (m.id === aMsgId ? { ...m, steps: [...(m.steps || []), step] } : m)),
          )
        } else if (e.type === 'artifact') {
          const art: AgentArtifact = {
            kind: e.kind,
            path: e.path,
            name: e.name,
            size: e.size,
            mime: e.mime,
          }
          updateMessages(sid, (msgs) =>
            msgs.map((m) =>
              m.id === aMsgId
                ? { ...m, artifacts: [...(m.artifacts || []).filter((x) => x.path !== art.path), art] }
                : m,
            ),
          )
        } else if (e.type === 'stderr') {
          stderrBuf += e.data
          updateMessages(sid, (msgs) =>
            msgs.map((m) => (m.id === aMsgId ? { ...m, stderr: stderrBuf } : m)),
          )
        } else if (e.type === 'error') {
          updateMessages(sid, (msgs) =>
            msgs.map((m) =>
              m.id === aMsgId
                ? { ...m, content: m.content + `\n\n**Error:** ${e.message}` }
                : m,
            ),
          )
        }
      }

    // Retry on network drop (e.g. proxy restart): wait for /health, then ask
    // the model to continue from where it left off. Stops after 2 attempts.
    const WAITING_MARK = '\n\n_⏳ connection dropped — waiting for the proxy to come back…_'
    while (true) {
      attempt++
      try {
        await autoRun({
          prompt: currentPrompt,
          context: currentContext,
          agentId,
          chatId: sid,
          signal: ctrl.signal,
          onEvent: handleEvent,
        })
        return
      } catch (e: any) {
        if (e?.name === 'AbortError' || ctrl.signal.aborted) throw e
        const errMsg = String(e?.message || e)
        const isNetwork = /failed to fetch|networkerror|load failed|fetch failed|network|connection|terminated|stream/i.test(errMsg)
        if (!isNetwork || attempt >= 2) throw e

        updateMessages(sid, (msgs) =>
          msgs.map((m) => (m.id === aMsgId ? { ...m, content: m.content + WAITING_MARK } : m)),
        )
        const back = await waitForProxyHealth(60_000, ctrl.signal)
        // Strip the waiting indicator before deciding what to do next.
        updateMessages(sid, (msgs) =>
          msgs.map((m) =>
            m.id === aMsgId ? { ...m, content: (m.content || '').replace(WAITING_MARK, '') } : m,
          ),
        )
        if (!back || ctrl.signal.aborted) throw e

        // Build a continuation request — original user turn + partial reply.
        currentContext = [
          ...context,
          { role: 'user', content: promptForApi },
          { role: 'assistant', content: assistantBuf.trim() || '(empty response)' },
        ]
        currentPrompt =
          'Continue your previous answer from exactly where you left off. ' +
          'Do not repeat what was already said, do not apologize, do not comment on the interruption.'
      }
    }
  }

  const sendAgent = async (
    sid: string,
    aMsgId: string,
    promptForApi: string,
    context: AgentContextTurn[],
    ctrl: AbortController,
  ) => {
    let stderrBuf = ''
    await agentRun({
      prompt: promptForApi,
      context,
      chatId: sid,
      signal: ctrl.signal,
      onEvent: (e) => {
        if (e.type === 'stdout') {
          updateMessages(sid, (msgs) =>
            msgs.map((m) =>
              m.id === aMsgId ? { ...m, content: m.content + e.data } : m,
            ),
          )
        } else if (e.type === 'step') {
          const step: AgentStep =
            e.kind === 'tool_call'
              ? {
                  kind: 'tool_call',
                  name: e.name,
                  args: e.args,
                  toolCallId: e.toolCallId,
                  ...(e.subagent
                    ? {
                        subagent: true,
                        subagentRole: e.subagentRole,
                        ...(e.subtasks ? { subtasks: e.subtasks } : {}),
                      }
                    : {}),
                }
              : e.kind === 'tool_result'
                ? {
                    kind: 'tool_result',
                    toolCallId: e.toolCallId,
                    text: e.text,
                    ...(e.subagentResults ? { subagentResults: e.subagentResults } : {}),
                  }
                : e.kind === 'thinking'
                  ? { kind: 'thinking', text: e.text }
                  : { kind: 'note', text: e.text }
          updateMessages(sid, (msgs) =>
            msgs.map((m) =>
              m.id === aMsgId ? { ...m, steps: [...(m.steps || []), step] } : m,
            ),
          )
        } else if (e.type === 'artifact') {
          const art: AgentArtifact = {
            kind: e.kind,
            path: e.path,
            name: e.name,
            size: e.size,
            mime: e.mime,
          }
          updateMessages(sid, (msgs) =>
            msgs.map((m) =>
              m.id === aMsgId
                ? {
                    ...m,
                    artifacts: [...(m.artifacts || []).filter((x) => x.path !== art.path), art],
                  }
                : m,
            ),
          )
        } else if (e.type === 'stderr') {
          stderrBuf += e.data
          updateMessages(sid, (msgs) =>
            msgs.map((m) => (m.id === aMsgId ? { ...m, stderr: stderrBuf } : m)),
          )
        } else if (e.type === 'error') {
          updateMessages(sid, (msgs) =>
            msgs.map((m) =>
              m.id === aMsgId
                ? { ...m, content: m.content + `\n\n**Startup error:** ${e.message}` }
                : m,
            ),
          )
        } else if (e.type === 'loop_detected') {
          updateMessages(sid, (msgs) =>
            msgs.map((m) =>
              m.id === aMsgId
                ? {
                    ...m,
                    content:
                      m.content +
                      `\n\n> ⚠️ **Loop interrupted** — the agent repeated \`${e.tool}\` ${e.count} times in a row. ${e.message}`,
                  }
                : m,
            ),
          )
        } else if (e.type === 'done') {
          updateMessages(sid, (msgs) =>
            msgs.map((m) =>
              m.id === aMsgId
                ? {
                    ...m,
                    exitCode: e.code,
                    content:
                      m.content.trim().length === 0 && e.code !== 0
                        ? `_(agent exited with code ${e.code}${e.signal ? ' / ' + e.signal : ''})_`
                        : m.content,
                  }
                : m,
            ),
          )
        }
      },
    })
  }

  const send = async () => {
    if (!session) return
    const text = input.trim()
    if ((!text && attachments.length === 0) || isStreaming) return
    setInput('')
    const sid = session.id
    const atts = attachments
    setAttachments([])

    const isFirst = session.messages.length === 0
    const prevMessages = session.messages
    const batches = splitAttachmentsForClaudeLimit(atts)

    const ctrl = new AbortController()
    abortRef.current = ctrl
    setIsStreaming(true)

    try {
      const runningContext: AgentContextTurn[] = []
      let runningChatMessages = prevMessages
      for (const m of prevMessages) {
        if (m.role !== 'user' && m.role !== 'assistant') continue
        const content = (m.content || '').trim()
        if (!content) continue
        runningContext.push({ role: m.role, content })
      }

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i]
        const isLastBatch = i === batches.length - 1
        const visibleText = isLastBatch
          ? (text || (batch.some((a) => a.mime.startsWith('image/')) ? DEFAULT_IMAGE_PROMPT : DEFAULT_ATTACHMENT_PROMPT))
          : MORE_IMAGES_PROMPT
        const userAttachments = await buildUserAttachments(batch)
        const userMsg: SessionMessage = {
          id: uid(),
          role: 'user',
          content: visibleText,
          createdAt: Date.now(),
          ...(userAttachments.length > 0 ? { userAttachments } : {}),
        }
        const aMsg: SessionMessage = {
          id: uid(),
          role: 'assistant',
          content: '',
          createdAt: Date.now(),
          via: mode === 'agent' ? 'agent' : 'kimi',
        }

        updateSession(sid, (s) => ({
          ...s,
          title: isFirst && i === 0 ? deriveTitle(text || batch[0]?.name || 'File') : s.title,
          messages: [...s.messages, userMsg, aMsg],
        }))

        let promptForApi = visibleText
        // attachments make sense for agent + auto (auto routes to hermes when files present)
        if (batch.length > 0) {
          if (mode === 'agent' || mode === 'auto') {
            const images = batch.filter((a) => a.mime.startsWith('image/'))
            const [uploaded, descs] = await Promise.all([
              uploadAttachments(batch, ctrl.signal).catch((err) => {
                throw new Error(`Failed to upload files: ${err?.message || err}`)
              }),
              images.length > 0
                ? describeImages(images, ctrl.signal).catch(() => [])
                : Promise.resolve([] as string[]),
            ])
            promptForApi = buildAgentPrefix(batch, uploaded, descs) + visibleText
          } else {
            promptForApi = buildChatPrefix(batch) + visibleText
          }
        }

        const ctxSlice = runningContext.slice(-12)
        if (mode === 'auto') {
          await sendAuto(sid, aMsg.id, promptForApi, ctxSlice, session?.agentId ?? null, ctrl)
        } else if (mode === 'agent') {
          await sendAgent(sid, aMsg.id, promptForApi, ctxSlice, ctrl)
        } else {
          await sendChat(sid, runningChatMessages, aMsg.id, promptForApi, batch, ctrl)
        }
        runningContext.push({ role: 'user', content: promptForApi })
        runningChatMessages = [...runningChatMessages, userMsg]
      }
    } catch (e: any) {
      const tail =
        e?.name === 'AbortError'
          ? '\n\n_— stopped by the user_'
          : `\n\n**Error:** \`${String(e?.message || e)}\``
      updateMessages(sid, (msgs) => {
        const lastEmptyAssistant = [...msgs].reverse().find((m) => m.role === 'assistant' && m.content === '')
        return msgs.map((m) =>
          m.id === lastEmptyAssistant?.id ? { ...m, content: m.content + tail } : m,
        )
      })
    } finally {
      // Keep the Stop button visible for ~1.5s after the final `done` to cover
      // brief lulls between orchestrator phases (planner pause, synthesis kick,
      // hermes warm-up). If the user manually aborted, drop it immediately.
      const userAborted = ctrl.signal.aborted
      if (userAborted) {
        setIsStreaming(false)
      } else {
        setTimeout(() => setIsStreaming(false), 1500)
      }
      abortRef.current = null
      // Bump after EVERY exchange. The backend fires its digest in the
      // background a few seconds later — we re-fetch when the panel is open.
      setNotesRefresh((n) => n + 1)
      // Give backend digest ~6s to land, then bump again so the panel auto-refreshes.
      setTimeout(() => setNotesRefresh((n) => n + 1), 6_000)
    }
  }

  const stop = () => abortRef.current?.abort()

  const hasMessages = messages.length > 0
  const modelLabel =
    MODELS.find((m) => m.id === DEFAULT_MODEL)?.label || DEFAULT_MODEL

  if (!hydrated) return <div className="min-h-screen w-full" />

  return (
    <div className="lab-bg relative min-h-screen w-full">
      {/* corner: brand → opens sidebar */}
      <button
        onClick={() => setSidebarOpen(true)}
        className="fixed top-4 left-5 z-30 flex items-center gap-2.5 select-none rounded-lg pr-3 py-1.5 -ml-1.5 pl-1.5 hover:bg-white/[0.04] transition group"
        title="Sessions"
      >
        <div className="relative w-9 h-9 rounded-lg grid place-items-center bg-white/[0.04] border border-white/10 overflow-hidden shadow-md shadow-violet-500/15">
          <KimiMascot size={28} />
          <span className="absolute inset-0 grid place-items-center bg-black/55 opacity-0 group-hover:opacity-100 transition">
            <Menu className="w-4 h-4 text-white" />
          </span>
        </div>
        <div className="hidden sm:flex flex-col leading-tight items-start">
          <span className="text-[13px] font-semibold text-white/90">
            Hermes × Kimi
          </span>
          <span className="text-[10px] uppercase tracking-[0.12em] text-white/40">
            {sessions.length} session{sessions.length === 1 ? '' : 's'}
          </span>
        </div>
      </button>

      {/* corner: actions — single row, evenly spaced, no overlaps */}
      <div className="fixed top-4 right-4 z-30 flex items-center gap-1.5">
        {activeId && (
          <button
            onClick={() => setNotesOpen(true)}
            className="px-2.5 py-1.5 rounded-md bg-white/[0.04] hover:bg-white/[0.09] border border-white/10 text-xs text-white/70 hover:text-white transition flex items-center gap-1.5"
            title="Chat memory (MD files)"
          >
            <Brain className="w-3.5 h-3.5 text-violet-300" />
            <span className="hidden sm:inline">Memory</span>
            {notesCount > 0 && (
              <span className="px-1 py-0 rounded bg-white/10 text-[10px] tabular-nums leading-4">
                {notesCount}
              </span>
            )}
          </button>
        )}
        {hasMessages && (
          <button
            onClick={onResetCurrent}
            className="px-2.5 py-1.5 rounded-md bg-white/[0.04] hover:bg-white/[0.09] border border-white/10 text-xs text-white/70 hover:text-white transition flex items-center gap-1.5"
            title="Clear this session"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Clear</span>
          </button>
        )}
        <Link
          href="/automations"
          className="px-2.5 py-1.5 rounded-md bg-white/[0.04] hover:bg-white/[0.09] border border-white/10 text-xs text-white/70 hover:text-white transition flex items-center gap-1.5"
          title="Automations — agents, tasks, schedule"
        >
          <Play className="w-3.5 h-3.5 text-violet-300" />
          <span className="hidden sm:inline">Automations</span>
        </Link>
        <Link
          href="/media"
          className="px-2.5 py-1.5 rounded-md bg-white/[0.04] hover:bg-white/[0.09] border border-white/10 text-xs text-white/70 hover:text-white transition flex items-center gap-1.5"
          title="Media Studio — YouTube ideas, scripts, thumbnails"
        >
          <Youtube className="w-3.5 h-3.5 text-red-400" />
          <span className="hidden sm:inline">Media</span>
        </Link>
        <button
          onClick={async () => {
            try { await fetch('/api/auth/logout', { method: 'POST' }) } catch { /* ignore */ }
            window.location.href = '/login'
          }}
          className="px-2.5 py-1.5 rounded-md bg-white/[0.04] hover:bg-white/[0.09] border border-white/10 text-xs text-white/70 hover:text-white transition flex items-center gap-1.5"
          title="Log out"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Log out</span>
        </button>
      </div>

      {hasMessages ? (
        <div className="flex flex-col h-screen pt-16">
          <div ref={scrollRef} className="flex-1 overflow-y-auto">
            <div className="max-w-3xl mx-auto px-6 py-4 space-y-5">
              {messages.map((m, i) => (
                <MessageBubble
                  key={m.id}
                  m={m}
                  streaming={
                    isStreaming &&
                    i === messages.length - 1 &&
                    m.role === 'assistant'
                  }
                  onOpenImage={setLightbox}
                />
              ))}
              <div className="h-4" />
            </div>
          </div>

          <div className="border-t border-white/[0.05] bg-black/30 backdrop-blur-xl">
            <AnimatedAIChat
              compact
              value={input}
              onValueChange={setInput}
              onSubmit={send}
              onStop={stop}
              isStreaming={isStreaming}
              modelLabel={modelLabel}
              mode={mode}
              attachments={compactAttachments}
              onAddFiles={onAddFiles}
              onRemoveAttachment={onRemoveAttachment}
              agentSlot={
                <AgentPicker
                  agentId={session?.agentId ?? null}
                  onChange={(id) =>
                    session && updateSession(session.id, { agentId: id })
                  }
                />
              }
            />
          </div>
        </div>
      ) : (
        <AnimatedAIChat
          value={input}
          onValueChange={setInput}
          onSubmit={send}
          onStop={stop}
          isStreaming={isStreaming}
          modelLabel={modelLabel}
          mode={mode}
          attachments={compactAttachments}
          onAddFiles={onAddFiles}
          onRemoveAttachment={onRemoveAttachment}
        />
      )}

      <SessionsSidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        sessions={sessions}
        activeId={activeId}
        onSelect={onSelectSession}
        onNew={onNewSession}
        onDelete={onDeleteSession}
        onRename={onRenameSession}
        hermesUrl={HERMES_DASHBOARD}
      />

      {/* Per-chat MD memory panel — sidebar opens when the "Memory" button is clicked */}
      <ChatNotesPanel
        chatId={activeId}
        open={notesOpen}
        onOpenChange={setNotesOpen}
        refreshKey={notesRefresh}
        lastExchange={(() => {
          // Last user/assistant pair in current session — used by the
          // "Regenerate" button to ask Kimi for a fresh digest pass.
          const all = (session?.messages ?? []).filter(
            (m) => m.role === 'user' || m.role === 'assistant',
          )
          let lastAssist: SessionMessage | null = null
          let lastUser: SessionMessage | null = null
          for (let i = all.length - 1; i >= 0; i--) {
            if (!lastAssist && all[i].role === 'assistant' && (all[i].content || '').trim()) {
              lastAssist = all[i]
              continue
            }
            if (lastAssist && all[i].role === 'user') {
              lastUser = all[i]
              break
            }
          }
          if (!lastAssist || !lastUser) return null
          return { user: lastUser.content || '', assistant: lastAssist.content || '' }
        })()}
      />

      <ImageLightbox image={lightbox} onClose={() => setLightbox(null)} />
    </div>
  )
}
