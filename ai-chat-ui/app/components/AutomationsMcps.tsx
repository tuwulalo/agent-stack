'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  AlertCircle, Check, Download, ExternalLink, KeyRound, Loader2, Pencil,
  Plug, Plus, Power, RefreshCw, Settings, Sparkles, Trash2, X,
} from 'lucide-react'
import {
  type McpCatalogItem,
  type McpConfigured,
  addMcp,
  deleteMcp,
  getMcpCatalog,
  listMcps,
  restartMcp,
  statusClass,
  statusLabel,
  updateMcp,
} from '../lib/mcps'

export function AutomationsMcps() {
  const [mcps, setMcps] = useState<McpConfigured[]>([])
  const [catalog, setCatalog] = useState<McpCatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [installFromCatalog, setInstallFromCatalog] = useState<McpCatalogItem | null>(null)
  const [customOpen, setCustomOpen] = useState(false)
  const [editMcp, setEditMcp] = useState<McpConfigured | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [m, c] = await Promise.all([listMcps(), getMcpCatalog()])
      setMcps(m)
      setCatalog(c)
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
    // refresh every 4s while there's a 'connecting' MCP so status updates fast
    const id = window.setInterval(() => {
      const anyConnecting = mcps.some((m) => m.status === 'connecting')
      void listMcps().then(setMcps).catch(() => {})
    }, 4_000)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload])

  const installedCatalogIds = useMemo(
    () => new Set(mcps.map((m) => m.fromCatalog).filter(Boolean) as string[]),
    [mcps],
  )

  const onInstall = (cat: McpCatalogItem) => {
    if (cat.env.length === 0 && (!cat.argsHint || cat.args.length > 0)) {
      // one-click install possible (defaults are fine)
      // …but still show the dialog so the user can review args if hinted
      setInstallFromCatalog(cat)
    } else {
      setInstallFromCatalog(cat)
    }
  }

  const onRestart = async (m: McpConfigured) => {
    setBusy(true)
    try {
      await restartMcp(m.id)
      setTimeout(() => void reload(), 700)
    } finally { setBusy(false) }
  }

  const onToggle = async (m: McpConfigured) => {
    setBusy(true)
    try {
      await updateMcp(m.id, { enabled: !m.enabled })
      await reload()
    } finally { setBusy(false) }
  }

  const onDelete = async (m: McpConfigured) => {
    if (!confirm(`Удалить MCP «${m.name}»?`)) return
    setBusy(true)
    try {
      await deleteMcp(m.id)
      await reload()
    } finally { setBusy(false) }
  }

  return (
    <div className="grid grid-cols-12 gap-4">
      {/* Installed */}
      <section className="col-span-12 lg:col-span-7 space-y-2">
        <div className="flex items-center gap-2 mb-1">
          <Plug className="w-4 h-4 text-violet-300" />
          <h2 className="text-[13px] font-medium text-white/90">Установленные MCP</h2>
          <span className="text-[11px] text-white/35">{mcps.length}</span>
          <span className="flex-1" />
          <button
            onClick={() => void reload()}
            disabled={loading}
            className="p-1.5 rounded text-white/45 hover:text-white hover:bg-white/[0.06] transition"
            title="Обновить"
          >
            <RefreshCw className={'w-3.5 h-3.5 ' + (loading ? 'animate-spin' : '')} />
          </button>
          <button
            onClick={() => setCustomOpen(true)}
            className="px-2.5 py-1.5 rounded-md text-[12px] bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-white/75 hover:text-white transition flex items-center gap-1.5"
            title="Добавить произвольный MCP-сервер"
          >
            <Plus className="w-3.5 h-3.5" />
            Свой
          </button>
        </div>

        {error && (
          <div className="px-3 py-2 rounded text-[11.5px] text-red-300 bg-red-500/10 border border-red-400/20">
            {error}
          </div>
        )}

        {loading && mcps.length === 0 ? (
          <div className="py-10 text-center text-white/40 text-[12.5px]">загрузка…</div>
        ) : mcps.length === 0 ? (
          <div className="px-4 py-10 text-center rounded-lg border border-dashed border-white/10">
            <Plug className="w-10 h-10 text-white/15 mx-auto mb-3" />
            <div className="text-[13px] text-white/65 mb-1">MCP-серверы пока не подключены</div>
            <div className="text-[11.5px] text-white/40 max-w-[340px] mx-auto leading-relaxed">
              Выбери справа из каталога — установка одной кнопкой. Или подключи свой произвольный
              сервер через `npx … / docker … / python …`.
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            {mcps.map((m) => {
              const open = !!expanded[m.id]
              return (
                <motion.div
                  key={m.id}
                  layout
                  className="rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.035] transition overflow-hidden"
                >
                  <div className="flex items-start gap-3 px-3.5 py-3">
                    <div className={
                      'w-7 h-7 rounded-md grid place-items-center flex-shrink-0 ' +
                      (m.status === 'connected' ? 'bg-emerald-500/15 text-emerald-300'
                       : m.status === 'failed' ? 'bg-red-500/15 text-red-300'
                       : m.status === 'connecting' ? 'bg-amber-500/15 text-amber-300'
                       : 'bg-white/[0.04] text-white/30')
                    }>
                      {m.status === 'connecting' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plug className="w-3.5 h-3.5" />}
                    </div>
                    <button
                      onClick={() => setExpanded((p) => ({ ...p, [m.id]: !open }))}
                      className="flex-1 min-w-0 text-left"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-medium text-white/90 truncate">{m.name}</span>
                        <span className={'text-[10px] px-1.5 py-0.5 rounded border ' + statusClass(m.status)}>
                          {statusLabel(m.status)}
                        </span>
                        {m.toolCount > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded text-violet-200/85 bg-violet-500/10 border border-violet-400/20">
                            {m.toolCount} tool{m.toolCount === 1 ? '' : 's'}
                          </span>
                        )}
                        {m.envKeys.length > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded text-white/55 bg-white/[0.04] border border-white/[0.08] flex items-center gap-1">
                            <KeyRound className="w-2.5 h-2.5" />
                            {m.envKeys.length}
                          </span>
                        )}
                        {!m.enabled && (
                          <span className="text-[10px] text-amber-300 px-1.5 py-0.5 rounded bg-amber-400/5 border border-amber-400/20">
                            пауза
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[10.5px] text-white/40 font-mono truncate">
                        {m.command} {m.args.join(' ')}
                      </div>
                      {m.error && (
                        <div className="mt-1 text-[11px] text-red-300/90 line-clamp-2">
                          <AlertCircle className="inline w-3 h-3 mr-1 -mt-0.5" />
                          {m.error}
                        </div>
                      )}
                    </button>
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      <button
                        onClick={() => onRestart(m)}
                        disabled={busy}
                        className="p-1.5 rounded text-white/55 hover:text-violet-300 hover:bg-white/[0.06] transition disabled:opacity-40"
                        title="Перезапустить"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onToggle(m)}
                        disabled={busy}
                        className={
                          'p-1.5 rounded hover:bg-white/[0.06] transition disabled:opacity-40 ' +
                          (m.enabled ? 'text-emerald-300' : 'text-white/40 hover:text-white')
                        }
                        title={m.enabled ? 'Остановить' : 'Запустить'}
                      >
                        <Power className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setEditMcp(m)}
                        className="p-1.5 rounded text-white/55 hover:text-white hover:bg-white/[0.06] transition"
                        title="Редактировать"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onDelete(m)}
                        disabled={busy}
                        className="p-1.5 rounded text-white/40 hover:text-red-300 hover:bg-red-500/10 transition disabled:opacity-40"
                        title="Удалить"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <AnimatePresence>
                    {open && m.tools.length > 0 && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden border-t border-white/[0.04]"
                      >
                        <div className="px-3.5 py-2.5 bg-black/20">
                          <div className="text-[10.5px] uppercase tracking-wider text-white/45 mb-1.5">
                            Доступные инструменты ({m.tools.length})
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            {m.tools.map((t) => (
                              <div
                                key={t.name}
                                className="px-2 py-1.5 rounded bg-white/[0.025] border border-white/[0.04]"
                              >
                                <div className="text-[11.5px] font-mono text-violet-200/90">{t.name}</div>
                                {t.description && (
                                  <div className="text-[10.5px] text-white/45 line-clamp-2 leading-snug mt-0.5">
                                    {t.description}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )
            })}
          </div>
        )}

        <p className="text-[10.5px] text-white/30 pt-3 border-t border-white/[0.04] leading-relaxed">
          MCP-серверы запускаются как дочерние процессы прокси и держат stdio-соединение.
          Сейчас инструменты видны, но в чат Kimi пока НЕ инжектятся — это следующий шаг (выбор «какие MCP видит какой агент»).
        </p>
      </section>

      {/* Catalog */}
      <aside className="col-span-12 lg:col-span-5">
        <div className="flex items-center gap-2 mb-1.5">
          <Sparkles className="w-4 h-4 text-violet-300" />
          <h2 className="text-[13px] font-medium text-white/90">Каталог</h2>
          <span className="text-[11px] text-white/35">{catalog.length}</span>
        </div>
        <div className="space-y-1.5 max-h-[calc(100vh-220px)] overflow-y-auto pr-1">
          {catalog.map((c) => {
            const installed = installedCatalogIds.has(c.id)
            return (
              <button
                key={c.id}
                onClick={() => onInstall(c)}
                disabled={installed}
                className={
                  'w-full text-left px-3 py-2.5 rounded-lg border transition group ' +
                  (installed
                    ? 'border-emerald-400/20 bg-emerald-500/5 cursor-default'
                    : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] hover:border-violet-400/30')
                }
              >
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-white/90">{c.name}</span>
                  {installed ? (
                    <span className="ml-auto text-[10.5px] text-emerald-300 flex items-center gap-1">
                      <Check className="w-3 h-3" />
                      установлено
                    </span>
                  ) : (
                    <span className="ml-auto text-[10.5px] text-violet-300 opacity-0 group-hover:opacity-100 flex items-center gap-1">
                      <Download className="w-3 h-3" />
                      установить
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-white/55 leading-snug mt-0.5">{c.description}</div>
                <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                  {c.env.map((e) => (
                    <span key={e} className="text-[9.5px] px-1.5 py-0.5 rounded text-amber-200/90 bg-amber-400/5 border border-amber-400/20 flex items-center gap-0.5">
                      <KeyRound className="w-2.5 h-2.5" />
                      {e}
                    </span>
                  ))}
                  {c.argsHint && (
                    <span className="text-[9.5px] px-1.5 py-0.5 rounded text-sky-200/85 bg-sky-400/5 border border-sky-400/20">
                      args: {c.argsHint}
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </aside>

      <AnimatePresence>
        {installFromCatalog && (
          <InstallDialog
            cat={installFromCatalog}
            onClose={() => setInstallFromCatalog(null)}
            onInstalled={async () => {
              setInstallFromCatalog(null)
              await reload()
            }}
          />
        )}
        {customOpen && (
          <CustomDialog
            onClose={() => setCustomOpen(false)}
            onAdded={async () => { setCustomOpen(false); await reload() }}
          />
        )}
        {editMcp && (
          <EditDialog
            mcp={editMcp}
            onClose={() => setEditMcp(null)}
            onSaved={async () => { setEditMcp(null); await reload() }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
function InstallDialog({
  cat, onClose, onInstalled,
}: {
  cat: McpCatalogItem
  onClose: () => void
  onInstalled: () => Promise<void>
}) {
  const [args, setArgs] = useState(cat.args.join(' '))
  const [envValues, setEnvValues] = useState<Record<string, string>>(
    Object.fromEntries(cat.env.map((k) => [k, ''])),
  )
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const ready = cat.env.every((k) => (envValues[k] || '').trim())

  const onInstall = async () => {
    setBusy(true); setErr(null)
    try {
      await addMcp({
        catalogId: cat.id,
        args: args.trim().split(/\s+/).filter(Boolean),
        env: envValues,
        enabled: true,
      })
      await onInstalled()
    } catch (e: any) {
      setErr(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  return <ModalShell onClose={onClose} title={`Установить ${cat.name}`} icon={Download}>
    <p className="text-[11.5px] text-white/55 mb-3 leading-relaxed">{cat.description}</p>
    <Field label="Команда">
      <code className="block px-2.5 py-1.5 rounded bg-black/40 border border-white/10 text-[12px] font-mono text-white/85">
        {cat.command} {args}
      </code>
    </Field>
    {(cat.args.length > 0 || cat.argsHint) && (
      <Field label={`Аргументы${cat.argsHint ? ' — ' + cat.argsHint : ''}`}>
        <input
          value={args} onChange={(e) => setArgs(e.target.value)}
          spellCheck={false}
          className={inputCls + ' font-mono'}
        />
      </Field>
    )}
    {cat.env.length > 0 && (
      <Field label="Переменные окружения (обязательно)">
        <div className="space-y-2">
          {cat.env.map((k) => (
            <div key={k}>
              <div className="text-[10.5px] text-amber-200/85 font-mono mb-0.5 flex items-center gap-1">
                <KeyRound className="w-3 h-3" />
                {k}
              </div>
              <input
                type="password"
                value={envValues[k] || ''}
                onChange={(e) => setEnvValues((p) => ({ ...p, [k]: e.target.value }))}
                placeholder={`Введи значение ${k}`}
                className={inputCls + ' font-mono'}
              />
            </div>
          ))}
        </div>
      </Field>
    )}
    {err && <div className="text-[11.5px] text-red-300 bg-red-500/10 border border-red-400/20 rounded px-2 py-1">{err}</div>}
    <ModalFooter onClose={onClose} primary={{
      label: busy ? 'Подключаю…' : 'Установить и запустить',
      onClick: onInstall,
      disabled: busy || !ready,
    }} />
  </ModalShell>
}

function CustomDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [command, setCommand] = useState('npx')
  const [argsStr, setArgsStr] = useState('-y @modelcontextprotocol/server-everything')
  const [envStr, setEnvStr] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const onAdd = async () => {
    setBusy(true); setErr(null)
    try {
      const env: Record<string, string> = {}
      for (const line of envStr.split('\n')) {
        const t = line.trim()
        if (!t || t.startsWith('#')) continue
        const eq = t.indexOf('=')
        if (eq <= 0) continue
        env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim()
      }
      await addMcp({
        name: name.trim() || 'Custom MCP',
        command: command.trim(),
        args: argsStr.trim().split(/\s+/).filter(Boolean),
        env,
        enabled: true,
      })
      await onAdded()
    } catch (e: any) {
      setErr(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  return <ModalShell onClose={onClose} title="Свой MCP-сервер" icon={Plus}>
    <Field label="Название">
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
        placeholder="Например: my-internal-tool" className={inputCls} />
    </Field>
    <Field label="Команда">
      <input value={command} onChange={(e) => setCommand(e.target.value)}
        className={inputCls + ' font-mono'} />
    </Field>
    <Field label="Аргументы (через пробел)">
      <input value={argsStr} onChange={(e) => setArgsStr(e.target.value)}
        className={inputCls + ' font-mono'} />
    </Field>
    <Field label="Переменные окружения (по строке, KEY=value)">
      <textarea value={envStr} onChange={(e) => setEnvStr(e.target.value)}
        rows={3} placeholder={'GITHUB_TOKEN=ghp_xxx\nDEBUG=1'}
        className={inputCls + ' font-mono resize-y min-h-[80px]'} />
    </Field>
    {err && <div className="text-[11.5px] text-red-300 bg-red-500/10 border border-red-400/20 rounded px-2 py-1">{err}</div>}
    <ModalFooter onClose={onClose} primary={{
      label: busy ? 'Подключаю…' : 'Добавить и запустить',
      onClick: onAdd,
      disabled: busy || !command.trim(),
    }} />
  </ModalShell>
}

function EditDialog({ mcp, onClose, onSaved }: { mcp: McpConfigured; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(mcp.name)
  const [argsStr, setArgsStr] = useState(mcp.args.join(' '))
  const [envStr, setEnvStr] = useState(mcp.envKeys.map((k) => `${k}=`).join('\n'))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const onSave = async () => {
    setBusy(true); setErr(null)
    try {
      const env: Record<string, string> = {}
      for (const line of envStr.split('\n')) {
        const t = line.trim()
        if (!t || t.startsWith('#')) continue
        const eq = t.indexOf('=')
        if (eq <= 0) continue
        const key = t.slice(0, eq).trim()
        const val = t.slice(eq + 1).trim()
        if (val) env[key] = val      // empty value = "don't change" (server merges fresh on update)
      }
      await updateMcp(mcp.id, {
        name: name.trim() || 'Без названия',
        args: argsStr.trim().split(/\s+/).filter(Boolean),
        ...(Object.keys(env).length > 0 ? { env } : {}),
      })
      await onSaved()
    } catch (e: any) { setErr(String(e?.message || e)) }
    finally { setBusy(false) }
  }

  return <ModalShell onClose={onClose} title={`Редактировать ${mcp.name}`} icon={Settings}>
    <Field label="Название">
      <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
    </Field>
    <Field label={`Команда (неизменяема): ${mcp.command}`}>
      <input value={argsStr} onChange={(e) => setArgsStr(e.target.value)}
        className={inputCls + ' font-mono'} placeholder="аргументы" />
    </Field>
    {mcp.envKeys.length > 0 && (
      <Field label="Переменные окружения (значения скрыты — заполни только те, что меняешь)">
        <textarea value={envStr} onChange={(e) => setEnvStr(e.target.value)}
          rows={3} className={inputCls + ' font-mono resize-y min-h-[80px]'} />
        <div className="text-[10.5px] text-white/35 mt-1">
          Пустое значение справа от `=` оставит старое нетронутым.
        </div>
      </Field>
    )}
    {err && <div className="text-[11.5px] text-red-300 bg-red-500/10 border border-red-400/20 rounded px-2 py-1">{err}</div>}
    <ModalFooter onClose={onClose} primary={{
      label: busy ? 'Сохраняю…' : 'Сохранить и перезапустить',
      onClick: onSave,
      disabled: busy,
    }} />
  </ModalShell>
}

// ─────────────────────────────────────────────────────────────────────────

function ModalShell({
  onClose, title, icon: Icon, children,
}: {
  onClose: () => void
  title: string
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
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
        className="w-[min(600px,92vw)] max-h-[88vh] rounded-xl border border-white/10 bg-[#0c0b16]/95 backdrop-blur-xl shadow-2xl flex flex-col overflow-hidden"
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06] flex-shrink-0">
          <Icon className="w-4 h-4 text-violet-300" />
          <div className="text-[14px] font-medium text-white/95 flex-1 truncate">{title}</div>
          <button onClick={onClose} className="p-1.5 rounded text-white/45 hover:text-white hover:bg-white/[0.06]">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-4 py-4 space-y-3 overflow-y-auto flex-1">{children}</div>
      </motion.div>
    </motion.div>
  )
}

function ModalFooter({
  onClose, primary,
}: {
  onClose: () => void
  primary: { label: string; onClick: () => void; disabled?: boolean }
}) {
  return (
    <div className="flex items-center gap-2 pt-2 border-t border-white/[0.06] -mx-4 px-4 -mb-4 py-3 bg-black/20">
      <button
        onClick={onClose}
        className="px-3 py-1.5 rounded-md text-[12px] text-white/65 hover:text-white hover:bg-white/[0.06] transition"
      >
        Отмена
      </button>
      <span className="flex-1" />
      <button
        onClick={primary.onClick}
        disabled={primary.disabled}
        className="px-3.5 py-1.5 rounded-md text-[12px] bg-gradient-to-b from-violet-500 to-indigo-600 text-white hover:from-violet-400 hover:to-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition"
      >
        {primary.label}
      </button>
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

const inputCls =
  'w-full px-3 py-2 rounded-md bg-black/40 border border-white/10 text-[13px] text-white outline-none focus:border-violet-400/60 transition'
