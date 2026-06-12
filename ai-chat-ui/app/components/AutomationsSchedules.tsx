'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Calendar, CheckCircle2, Clock, Cpu, Pencil, Play, Plus, Power, RefreshCw,
  Sparkles, Square, Terminal, Trash2, X, XCircle,
} from 'lucide-react'
// type-only import
type ClaudeAgent = 'claude'
import {
  CRON_PRESETS,
  type RunRecord,
  type Schedule,
  createSchedule,
  deleteSchedule,
  describeCron,
  fireSchedule,
  formatDuration,
  formatRelTime,
  listRuns,
  listSchedules,
  updateSchedule,
} from '../lib/automations'

const AGENT_DESC: Record<Schedule['agent'], { label: string; icon: React.ComponentType<{className?:string}>; hint: string }> = {
  hermes: { label: 'Hermes', icon: Sparkles, hint: 'hermes -z "<task>" --yolo · all Hermes tools' },
  claude: { label: 'Claude', icon: Cpu,      hint: 'claude -p "<task>" · Max subscription · Read/Edit/Bash/...' },
  shell:  { label: 'Shell',  icon: Terminal, hint: 'bash -c "<task>" · fast system commands' },
}

interface EditorState {
  id: string | null
  name: string
  cron: string
  agent: Schedule['agent']
  task: string
  enabled: boolean
}

const EMPTY_EDITOR: EditorState = {
  id: null,
  name: '',
  cron: '0 9 * * *',
  agent: 'hermes',
  task: '',
  enabled: true,
}

export function AutomationsSchedules() {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [runs, setRuns] = useState<RunRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [openRun, setOpenRun] = useState<RunRecord | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [s, r] = await Promise.all([listSchedules(), listRuns({ limit: 100 })])
      setSchedules(s)
      setRuns(r)
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
    // refresh every 15s so run history stays current
    const id = window.setInterval(() => { void reload() }, 15_000)
    return () => window.clearInterval(id)
  }, [reload])

  const onCreate = () => setEditor(EMPTY_EDITOR)
  const onEdit = (s: Schedule) =>
    setEditor({
      id: s.id,
      name: s.name,
      cron: s.cron,
      agent: s.agent,
      task: s.task,
      enabled: s.enabled,
    })

  const onSave = async () => {
    if (!editor) return
    if (!editor.task.trim()) {
      setError('Describe the task')
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (editor.id) {
        await updateSchedule(editor.id, {
          name: editor.name, cron: editor.cron, agent: editor.agent,
          task: editor.task, enabled: editor.enabled,
        })
      } else {
        await createSchedule({
          name: editor.name || 'Untitled',
          cron: editor.cron, agent: editor.agent, task: editor.task, enabled: editor.enabled,
        })
      }
      setEditor(null)
      await reload()
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  const onToggle = async (s: Schedule) => {
    setBusy(true)
    try {
      await updateSchedule(s.id, { enabled: !s.enabled })
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const onDelete = async (s: Schedule) => {
    if (!confirm(`Delete "${s.name}"?`)) return
    setBusy(true)
    try {
      await deleteSchedule(s.id)
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const onFire = async (s: Schedule) => {
    setBusy(true)
    try {
      await fireSchedule(s.id)
      // run is async server-side; refresh after a moment
      setTimeout(() => void reload(), 1500)
    } finally {
      setBusy(false)
    }
  }

  const runsByScheduleId = useMemo(() => {
    const map: Record<string, RunRecord[]> = {}
    for (const r of runs) {
      if (!r.scheduleId) continue
      ;(map[r.scheduleId] ||= []).push(r)
    }
    return map
  }, [runs])

  return (
    <div className="grid grid-cols-12 gap-4">
      {/* Left: schedules list */}
      <section className="col-span-12 lg:col-span-7 space-y-2">
        <div className="flex items-center gap-2 mb-1">
          <Calendar className="w-4 h-4 text-violet-300" />
          <h2 className="text-[13px] font-medium text-white/90">Schedules</h2>
          <span className="text-[11px] text-white/35">{schedules.length}</span>
          <span className="flex-1" />
          <button
            onClick={() => void reload()}
            disabled={loading}
            className="p-1.5 rounded text-white/45 hover:text-white hover:bg-white/[0.06] transition"
            title="Refresh"
          >
            <RefreshCw className={'w-3.5 h-3.5 ' + (loading ? 'animate-spin' : '')} />
          </button>
          <button
            onClick={onCreate}
            className="px-3 py-1.5 rounded-md text-[12px] bg-gradient-to-b from-violet-500 to-indigo-600 text-white hover:from-violet-400 hover:to-indigo-500 transition flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            New
          </button>
        </div>

        {error && (
          <div className="px-3 py-2 rounded text-[11.5px] text-red-300 bg-red-500/10 border border-red-400/20">
            {error}
          </div>
        )}

        {loading && schedules.length === 0 ? (
          <div className="py-10 text-center text-white/40 text-[12.5px]">loading…</div>
        ) : schedules.length === 0 ? (
          <div className="px-4 py-12 text-center rounded-lg border border-dashed border-white/10">
            <Clock className="w-10 h-10 text-white/15 mx-auto mb-3" />
            <div className="text-[13px] text-white/65 mb-1">No schedules yet</div>
            <div className="text-[11.5px] text-white/40 mb-4 max-w-[340px] mx-auto leading-relaxed">
              Create a task with a cron expression — it will run in the background
              and write its results to the history.
            </div>
            <button
              onClick={onCreate}
              className="px-3 py-1.5 rounded-md text-[12px] bg-violet-500/20 hover:bg-violet-500/30 text-violet-100 border border-violet-400/25 transition inline-flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              Create the first one
            </button>
          </div>
        ) : (
          <div className="space-y-1.5">
            {schedules.map((s) => {
              const A = AGENT_DESC[s.agent]
              const lastRuns = runsByScheduleId[s.id]?.slice(0, 5) ?? []
              return (
                <motion.div
                  key={s.id}
                  layout
                  className="px-3.5 py-3 rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.035] transition"
                >
                  <div className="flex items-start gap-3">
                    <div className={
                      'w-7 h-7 rounded-md grid place-items-center flex-shrink-0 ' +
                      (s.enabled ? 'bg-violet-500/15 text-violet-300' : 'bg-white/[0.04] text-white/30')
                    }>
                      <A.icon className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-medium text-white/90 truncate">{s.name}</span>
                        <span className="text-[10.5px] text-white/40 px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.06]">
                          {A.label}
                        </span>
                        <span className="text-[10.5px] text-white/40 px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.06] font-mono">
                          {describeCron(s.cron)}
                        </span>
                        {!s.enabled && (
                          <span className="text-[10px] text-amber-300 px-1.5 py-0.5 rounded bg-amber-400/5 border border-amber-400/20">
                            paused
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-[11.5px] text-white/55 line-clamp-2 leading-snug">
                        {s.task}
                      </div>
                      <div className="mt-1 flex items-center gap-2.5 text-[10.5px] text-white/35">
                        <span>cron <code className="text-white/55">{s.cron}</code></span>
                        <span>·</span>
                        <span>{s.lastFireAt ? `last run ${formatRelTime(s.lastFireAt)}` : 'never run yet'}</span>
                        {s.lastFireAt && (
                          <span className={s.lastFireOk ? 'text-emerald-300' : 'text-red-300'}>
                            {s.lastFireOk ? '✓' : '✗'}
                          </span>
                        )}
                      </div>
                      {lastRuns.length > 0 && (
                        <div className="mt-2 flex items-center gap-1 flex-wrap">
                          {lastRuns.map((r) => (
                            <button
                              key={r.id}
                              onClick={() => setOpenRun(r)}
                              title={`${formatRelTime(r.startedAt)} · ${formatDuration(r.durationMs)} · exit ${r.exitCode ?? '—'}`}
                              className={
                                'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border transition ' +
                                (r.exitCode === 0
                                  ? 'text-emerald-300 border-emerald-400/25 bg-emerald-500/5 hover:bg-emerald-500/10'
                                  : 'text-red-300 border-red-400/25 bg-red-500/5 hover:bg-red-500/10')
                              }
                            >
                              {r.exitCode === 0
                                ? <CheckCircle2 className="w-2.5 h-2.5" />
                                : <XCircle className="w-2.5 h-2.5" />}
                              {formatDuration(r.durationMs)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      <button
                        onClick={() => onFire(s)}
                        disabled={busy}
                        className="p-1.5 rounded text-white/55 hover:text-violet-300 hover:bg-white/[0.06] transition disabled:opacity-40"
                        title="Run now"
                      >
                        <Play className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onToggle(s)}
                        disabled={busy}
                        className={
                          'p-1.5 rounded hover:bg-white/[0.06] transition disabled:opacity-40 ' +
                          (s.enabled ? 'text-emerald-300' : 'text-white/40 hover:text-white')
                        }
                        title={s.enabled ? 'Pause' : 'Enable'}
                      >
                        <Power className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onEdit(s)}
                        className="p-1.5 rounded text-white/55 hover:text-white hover:bg-white/[0.06] transition"
                        title="Edit"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onDelete(s)}
                        disabled={busy}
                        className="p-1.5 rounded text-white/40 hover:text-red-300 hover:bg-red-500/10 transition disabled:opacity-40"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}
      </section>

      {/* Right: run history (all schedules, recent first) */}
      <aside className="col-span-12 lg:col-span-5">
        <div className="flex items-center gap-2 mb-1.5">
          <Clock className="w-4 h-4 text-violet-300" />
          <h2 className="text-[13px] font-medium text-white/90">Run history</h2>
          <span className="text-[11px] text-white/35">{runs.length}</span>
        </div>
        {runs.length === 0 ? (
          <div className="px-4 py-8 text-center rounded-lg border border-dashed border-white/10 text-[11.5px] text-white/40">
            Nothing has run yet.
          </div>
        ) : (
          <div className="space-y-1 max-h-[calc(100vh-220px)] overflow-y-auto pr-1">
            {runs.map((r) => (
              <button
                key={r.id}
                onClick={() => setOpenRun(r)}
                className="w-full text-left px-3 py-2 rounded-md border border-white/[0.05] bg-white/[0.02] hover:bg-white/[0.04] transition"
              >
                <div className="flex items-center gap-2">
                  {r.exitCode === 0 ? (
                    <CheckCircle2 className="w-3 h-3 text-emerald-300 flex-shrink-0" />
                  ) : (
                    <XCircle className="w-3 h-3 text-red-300 flex-shrink-0" />
                  )}
                  <span className="text-[12px] text-white/85 truncate flex-1">{r.name}</span>
                  <span className="text-[10px] text-white/40 flex-shrink-0">{formatDuration(r.durationMs)}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-white/35">
                  <span>{r.agent}</span>
                  <span>·</span>
                  <span>{r.source}</span>
                  <span>·</span>
                  <span>{formatRelTime(r.startedAt)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </aside>

      {/* Editor modal */}
      <AnimatePresence>
        {editor && (
          <ScheduleEditor
            value={editor}
            onChange={setEditor}
            onClose={() => setEditor(null)}
            onSave={onSave}
            busy={busy}
          />
        )}
        {openRun && <RunViewer run={openRun} onClose={() => setOpenRun(null)} />}
      </AnimatePresence>
    </div>
  )
}

function ScheduleEditor({
  value, onChange, onClose, onSave, busy,
}: {
  value: EditorState
  onChange: (v: EditorState) => void
  onClose: () => void
  onSave: () => void
  busy: boolean
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
      className="fixed inset-0 z-[80] grid place-items-center bg-black/55 backdrop-blur-sm"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 240, damping: 24 }}
        className="w-[min(640px,92vw)] rounded-xl border border-white/10 bg-[#0c0b16]/95 backdrop-blur-xl shadow-2xl overflow-hidden"
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
          <Calendar className="w-4 h-4 text-violet-300" />
          <div className="text-[14px] font-medium text-white/95 flex-1">
            {value.id ? 'Edit schedule' : 'New schedule'}
          </div>
          <button onClick={onClose} className="p-1.5 rounded text-white/45 hover:text-white hover:bg-white/[0.06]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-4 space-y-3">
          <Field label="Name">
            <input
              autoFocus
              value={value.name}
              onChange={(e) => onChange({ ...value, name: e.target.value })}
              placeholder="e.g. Daily morning VPS report"
              className={inputStyle}
            />
          </Field>

          <Field label="Agent">
            <div className="flex gap-2">
              {(['hermes', 'claude', 'shell'] as const).map((a) => {
                const A = AGENT_DESC[a]
                const active = value.agent === a
                return (
                  <button
                    key={a}
                    onClick={() => onChange({ ...value, agent: a })}
                    className={
                      'flex-1 px-3 py-2 rounded-md border text-left transition ' +
                      (active
                        ? 'border-violet-400/40 bg-violet-500/10 text-white'
                        : 'border-white/[0.08] bg-white/[0.02] text-white/75 hover:bg-white/[0.04]')
                    }
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <A.icon className={'w-3.5 h-3.5 ' + (active ? 'text-violet-300' : 'text-white/50')} />
                      <span className="text-[12.5px] font-medium">{A.label}</span>
                    </div>
                    <div className="text-[10.5px] text-white/40 leading-snug">{A.hint}</div>
                  </button>
                )
              })}
            </div>
          </Field>

          <Field label="Schedule (cron)">
            <input
              value={value.cron}
              onChange={(e) => onChange({ ...value, cron: e.target.value })}
              placeholder="0 9 * * *  (min hour day month weekday)"
              className={inputStyle + ' font-mono'}
            />
            <div className="mt-2 flex flex-wrap gap-1">
              {CRON_PRESETS.map((p) => (
                <button
                  key={p.expr}
                  onClick={() => onChange({ ...value, cron: p.expr })}
                  className={
                    'px-2 py-0.5 rounded text-[11px] border transition ' +
                    (value.cron === p.expr
                      ? 'border-violet-400/40 bg-violet-500/15 text-violet-100'
                      : 'border-white/[0.08] bg-white/[0.02] text-white/55 hover:text-white hover:bg-white/[0.05]')
                  }
                >
                  {p.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Task">
            <textarea
              value={value.task}
              onChange={(e) => onChange({ ...value, task: e.target.value })}
              rows={5}
              spellCheck={false}
              placeholder={value.agent === 'hermes'
                ? 'Describe a task for Hermes in plain language…'
                : 'Bash command, e.g.:  uptime && df -h | head -5'}
              className={inputStyle + ' font-mono resize-y min-h-[110px]'}
            />
          </Field>

          <label className="flex items-center gap-2 text-[12.5px] text-white/75 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={value.enabled}
              onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
              className="w-4 h-4 accent-violet-500"
            />
            Enable right away
          </label>
        </div>

        <div className="flex items-center gap-2 px-4 py-3 border-t border-white/[0.06] bg-black/20">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-[12px] text-white/65 hover:text-white hover:bg-white/[0.06] transition"
          >
            Cancel
          </button>
          <span className="flex-1" />
          <button
            onClick={onSave}
            disabled={busy || !value.task.trim()}
            className="px-3.5 py-1.5 rounded-md text-[12px] bg-gradient-to-b from-violet-500 to-indigo-600 text-white hover:from-violet-400 hover:to-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {busy ? 'Saving…' : value.id ? 'Save' : 'Create'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

function RunViewer({ run, onClose }: { run: RunRecord; onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
      className="fixed inset-0 z-[80] grid place-items-center bg-black/60 backdrop-blur-sm"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
        className="w-[min(880px,94vw)] h-[min(720px,86vh)] rounded-xl border border-white/10 bg-[#0c0b16]/95 backdrop-blur-xl shadow-2xl flex flex-col overflow-hidden"
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
          {run.exitCode === 0 ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-300" />
          ) : (
            <XCircle className="w-4 h-4 text-red-300" />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-medium text-white/95 truncate">{run.name}</div>
            <div className="text-[10.5px] text-white/40">
              {run.agent} · {run.source} · {formatRelTime(run.startedAt)} · {formatDuration(run.durationMs)} · exit {run.exitCode ?? '—'}{run.killed ? ' (killed)' : ''}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded text-white/45 hover:text-white hover:bg-white/[0.06]">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3 text-[12px] font-mono"
             style={{ fontFamily: 'var(--font-mono-loaded), ui-monospace, monospace' }}>
          <Section title="task" body={run.task} />
          {run.stdout && <Section title="stdout" body={run.stdout} />}
          {run.stderr && <Section title="stderr" body={run.stderr} red />}
        </div>
      </motion.div>
    </motion.div>
  )
}

function Section({ title, body, red }: { title: string; body: string; red?: boolean }) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wider text-white/40 mb-1">{title}</div>
      <pre className={
        'whitespace-pre-wrap break-words m-0 p-2 rounded border ' +
        (red
          ? 'text-red-200/90 border-red-400/20 bg-red-500/5'
          : 'text-white/85 border-white/[0.06] bg-black/30')
      }>{body}</pre>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wider text-white/45 mb-1">{label}</div>
      {children}
    </div>
  )
}

const inputStyle =
  'w-full px-3 py-2 rounded-md bg-black/40 border border-white/10 text-[13px] text-white outline-none focus:border-violet-400/60 transition'
