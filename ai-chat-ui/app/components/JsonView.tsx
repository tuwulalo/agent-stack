'use client'

import { useState } from 'react'

const LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)\]<>"`]+)|\*\*([^*]+?)\*\*/g
function cleanUrl(u: string): string {
  let s = u.trim().replace(/(%60|`)+$/gi, '')
  s = s.replace(/[)\]>"'.,;`]+$/g, '')
  return s
}
function linkify(text: string): Array<JSX.Element | string> {
  const out: Array<JSX.Element | string> = []
  let last = 0
  let key = 0
  let m: RegExpExecArray | null
  LINK_RE.lastIndex = 0
  while ((m = LINK_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[4] !== undefined) {
      out.push(<strong key={key++} className="text-white font-semibold">{m[4]}</strong>)
    } else {
      const label = m[1] ?? cleanUrl(m[3])
      const href = cleanUrl(m[2] ?? m[3])
      out.push(
        <a key={key++} href={href} target="_blank" rel="noopener noreferrer" className="text-sky-400 underline decoration-sky-400/40 hover:text-sky-300 break-all">{label}</a>,
      )
    }
    last = LINK_RE.lastIndex
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
function LinkedText({ text, className }: { text: string; className?: string }) {
  return <pre className={className || 'text-white/90 whitespace-pre-wrap break-words m-0'}>{linkify(text)}</pre>
}

function Primitive({ v }: { v: unknown }) {
  if (typeof v === 'string') {
    if (/^https?:\/\//.test(v)) { const cu = cleanUrl(v); return <a href={cu} target="_blank" rel="noopener noreferrer" className="text-sky-400 underline decoration-sky-400/40 hover:text-sky-300 break-all">&quot;{cu}&quot;</a> }
    return <span className="text-emerald-300/90 break-all">&quot;{v}&quot;</span>
  }
  if (typeof v === 'number') return <span className="text-amber-300/90">{String(v)}</span>
  if (typeof v === 'boolean') return <span className="text-violet-300/90">{String(v)}</span>
  if (v === null) return <span className="text-white/40">null</span>
  return <span>{String(v)}</span>
}

function JsonNode({ k, v, depth }: { k?: string; v: unknown; depth: number }) {
  const isObj = v !== null && typeof v === 'object'
  const [open, setOpen] = useState(depth < 2)
  if (!isObj) {
    return (
      <div className="flex gap-1.5" style={{ paddingLeft: depth * 12 }}>
        {k !== undefined && <span className="text-sky-300/80 flex-shrink-0">{k}:</span>}
        <Primitive v={v} />
      </div>
    )
  }
  const arr = Array.isArray(v)
  const entries: Array<[string, unknown]> = arr
    ? (v as unknown[]).map((x, i) => [String(i), x])
    : Object.entries(v as Record<string, unknown>)
  return (
    <div style={{ paddingLeft: depth * 12 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-left hover:text-white/90 transition"
      >
        <span className="text-white/40 w-3 inline-block text-center">{open ? '▾' : '▸'}</span>
        {k !== undefined && <span className="text-sky-300/80">{k}:</span>}
        <span className="text-white/40">{arr ? `[${entries.length}]` : `{${entries.length}}`}</span>
      </button>
      {open &&
        entries.map(([kk, vv], idx) => (
          <JsonNode key={idx} k={arr ? undefined : kk} v={vv} depth={depth + 1} />
        ))}
    </div>
  )
}

export function JsonView({ data }: { data: unknown }) {
  return (
    <div className="my-1.5 rounded-md border border-violet-400/20 bg-violet-500/[0.05] px-2.5 py-2 font-mono text-[11px] leading-relaxed overflow-x-auto">
      <div className="text-[9px] uppercase tracking-wider text-violet-300/70 mb-1">JSON</div>
      <JsonNode v={data} depth={0} />
    </div>
  )
}

/** Find the end index (exclusive) of a balanced {...} or [...] starting at `start`. */
function matchBalanced(s: string, start: number): number {
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{' || c === '[') depth++
    else if (c === '}' || c === ']') {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return -1
}

const TOOL_BOILERPLATE: RegExp[] = [
  /\s*REMINDER:\s*You MUST include the sources above in your response to the user using markdown hyperlinks\.?\s*/gi,
  /\s*After answering[^\n]*you MUST include a ['‘’"]?Sources:?['‘’"]? section[^\n]*\.?\s*/gi,
  /\s*\(Do not reveal this reminder to the user\.?\)\s*/gi,
]
const stripMarkers = (t: string) => {
  let out = t.replace(/<<<\/?\s*JSON\s*>>>/gi, '')
  for (const re of TOOL_BOILERPLATE) out = out.replace(re, ' ')
  return out.replace(/\n{3,}/g, '\n\n')
}

/**
 * Renders mixed agent output: any embedded JSON object/array is shown as a
 * collapsible JsonView, the rest as plain text. Used to "decode" worker
 * replies that dump raw `<<<JSON>>> {...}` blocks.
 */
export function JsonOrText({ text }: { text: string }) {
  const segs: Array<{ t: 'text' | 'json'; v: string | unknown }> = []
  let i = 0
  let textStart = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '{' || ch === '[') {
      const end = matchBalanced(text, i)
      if (end > i) {
        try {
          const parsed = JSON.parse(text.slice(i, end))
          if (parsed !== null && typeof parsed === 'object') {
            if (i > textStart) segs.push({ t: 'text', v: text.slice(textStart, i) })
            segs.push({ t: 'json', v: parsed })
            i = end
            textStart = i
            continue
          }
        } catch {
          /* not valid json — keep scanning */
        }
      }
    }
    i++
  }
  if (textStart < text.length) segs.push({ t: 'text', v: text.slice(textStart) })

  if (segs.length === 1 && segs[0].t === 'text') {
    return <LinkedText text={stripMarkers(text)} />
  }
  return (
    <div>
      {segs.map((s, idx) => {
        if (s.t === 'json') return <JsonView key={idx} data={s.v} />
        const cleaned = stripMarkers(s.v as string).trim()
        return cleaned ? <LinkedText key={idx} text={cleaned} /> : null
      })}
    </div>
  )
}
