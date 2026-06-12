import { KIMI_API } from './config'

export interface AttachedFile {
  /** stable client-side id */
  id: string
  name: string
  size: number
  mime: string
  /** loaded text content if file was readable as text, otherwise undefined */
  text?: string
  /** original File ref — kept until the message is sent so we can upload */
  raw: File
}

const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'rst', 'log',
  'json', 'jsonc', 'json5', 'xml', 'yaml', 'yml', 'toml', 'ini', 'env', 'csv', 'tsv',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'vue', 'svelte', 'astro',
  'html', 'htm', 'css', 'scss', 'sass', 'less',
  'py', 'rb', 'php', 'go', 'rs', 'java', 'kt', 'swift', 'scala',
  'c', 'cc', 'cpp', 'cxx', 'h', 'hpp', 'cs', 'fs', 'vb',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
  'sql', 'graphql', 'gql', 'proto',
  'dockerfile', 'gitignore', 'gitattributes', 'editorconfig',
  'lock', 'mod', 'sum',
])

const TEXT_MIME_PREFIXES = ['text/']
const TEXT_MIME_EXACT = new Set([
  'application/json',
  'application/xml',
  'application/javascript',
  'application/typescript',
  'application/x-yaml',
  'application/x-toml',
  'application/x-sh',
  'application/sql',
])

export function isTextFile(file: File): boolean {
  const mime = (file.type || '').toLowerCase()
  if (TEXT_MIME_PREFIXES.some((p) => mime.startsWith(p))) return true
  if (TEXT_MIME_EXACT.has(mime)) return true
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  if (TEXT_EXTS.has(ext)) return true
  // common no-extension text files
  const baseName = file.name.toLowerCase()
  if (['dockerfile', 'makefile', 'readme', 'license'].includes(baseName)) return true
  return false
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '?'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function langFromName(name: string): string {
  const ext = (name.split('.').pop() || '').toLowerCase()
  const map: Record<string, string> = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
    ts: 'typescript', tsx: 'tsx',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
    sh: 'bash', bash: 'bash', zsh: 'bash',
    yml: 'yaml', yaml: 'yaml',
    md: 'markdown', markdown: 'markdown',
    sql: 'sql', html: 'html', css: 'css', scss: 'scss',
    json: 'json', xml: 'xml', toml: 'toml',
    c: 'c', cpp: 'cpp', cs: 'csharp', java: 'java', php: 'php',
    dockerfile: 'docker',
  }
  return map[ext] || ext || 'text'
}

const MAX_TEXT_BYTES = 200_000   // ~200 KB cap before we just send a head + tail

export async function readFileAsText(file: File): Promise<string> {
  const text = await file.text()
  if (text.length <= MAX_TEXT_BYTES) return text
  const head = text.slice(0, MAX_TEXT_BYTES * 0.7)
  const tail = text.slice(-MAX_TEXT_BYTES * 0.25)
  const cut = text.length - head.length - tail.length
  return `${head}\n\n/* … обрезано ${cut.toLocaleString('ru')} символов … */\n\n${tail}`
}

/** Read any File as a data: URL — used to embed image thumbnails in user message bubbles. */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

/** Embed inline only when the image is small enough not to bloat localStorage. */
export const INLINE_IMAGE_BYTES_CAP = 2_500_000   // ~2.5 MB

export async function fileToAttachment(file: File): Promise<AttachedFile> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const att: AttachedFile = {
    id,
    name: file.name,
    size: file.size,
    mime: file.type || 'application/octet-stream',
    raw: file,
  }
  if (isTextFile(file) && file.size <= MAX_TEXT_BYTES * 4) {
    try {
      att.text = await readFileAsText(file)
    } catch {
      /* keep as binary */
    }
  }
  return att
}

export interface UploadResponse {
  uploadId: string | null
  dir: string | null
  files: Array<{ name: string; storedAs: string; path: string; size: number; mime: string }>
}

/** Upload binary attachments to the proxy so Hermes can reach them via shell tools. */
export async function uploadAttachments(
  attachments: AttachedFile[],
  signal?: AbortSignal,
): Promise<UploadResponse | null> {
  const uploadable = attachments.filter((a) => a.text === undefined)
  if (uploadable.length === 0) return null
  const fd = new FormData()
  for (const a of uploadable) fd.append('files', a.raw, a.name)
  const res = await fetch(`${KIMI_API}/agent/uploads`, {
    method: 'POST',
    body: fd,
    signal,
  })
  if (!res.ok) {
    let detail = ''
    try { detail = await res.text() } catch { /* ignore */ }
    throw new Error(`Upload HTTP ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ''}`)
  }
  return (await res.json()) as UploadResponse
}

/** Build the section to prepend before the user prompt for chat-mode.
    Only inlines TEXT files — images go in OpenAI vision content blocks
    handled separately (see toChatContentBlocks). */
export function buildChatPrefix(attachments: AttachedFile[]): string {
  const textOnly = attachments.filter((a) => a.text !== undefined)
  if (textOnly.length === 0) return ''
  const parts = textOnly.map(
    (a) =>
      `Файл **${a.name}** (${formatBytes(a.size)}):\n\n\`\`\`${langFromName(a.name)}\n${a.text}\n\`\`\``,
  )
  return parts.join('\n\n') + '\n\n---\n\n'
}

/** Vision pre-pass: ask Kimi to describe the attached images so a downstream
    text-only consumer (Hermes oneshot) has a textual handle on what's attached.
    Returns one description per image, in attachment order. */
export async function describeImages(
  images: AttachedFile[],
  signal?: AbortSignal,
): Promise<string[]> {
  if (images.length === 0) return []
  const dataUrls = await Promise.all(
    images.map(
      (img) =>
        new Promise<string>((resolve, reject) => {
          const r = new FileReader()
          r.onload = () => resolve(String(r.result))
          r.onerror = () => reject(r.error)
          r.readAsDataURL(img.raw)
        }),
    ),
  )
  const out: string[] = []
  for (let i = 0; i < images.length; i++) {
    const body = {
      model: 'kimi-for-coding',
      stream: false,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                'Опиши кратко, но конкретно, что на этом изображении: какие объекты, текст (если есть — выпиши дословно), цвета, композиция. Это описание увидит другой ИИ-агент, у которого нет vision, чтобы он мог принять решение по задаче. Уложись в 4-6 предложений.',
            },
            { type: 'image_url', image_url: { url: dataUrls[i] } },
          ],
        },
      ],
    }
    try {
      const res = await fetch(`${KIMI_API}/v1/chat/completions`, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        out.push(`(не удалось получить описание: HTTP ${res.status})`)
        continue
      }
      const j = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      const text = j.choices?.[0]?.message?.content?.trim() || '(пустое описание)'
      out.push(text)
    } catch (e: any) {
      if (e?.name === 'AbortError') throw e
      out.push(`(ошибка vision pre-pass: ${e?.message || e})`)
    }
  }
  return out
}

/** Build OpenAI-compatible content blocks (text + image_url) for Kimi vision. */
export async function toChatContentBlocks(
  text: string,
  attachments: AttachedFile[],
): Promise<Array<
  { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
>> {
  const images = attachments.filter((a) => a.mime.startsWith('image/'))
  const blocks: Array<
    { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
  > = []
  if (text) blocks.push({ type: 'text', text })
  for (const img of images) {
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result))
        r.onerror = () => reject(r.error)
        r.readAsDataURL(img.raw)
      })
      blocks.push({ type: 'image_url', image_url: { url: dataUrl } })
    } catch {
      /* skip unreadable */
    }
  }
  return blocks
}

/** Build the section to prepend before the user prompt for agent-mode.
    `imageDescriptions` is an array aligned with `attachments.filter(isImage)` —
    one Kimi-vision summary per image. */
export function buildAgentPrefix(
  attachments: AttachedFile[],
  uploaded: UploadResponse | null,
  imageDescriptions: string[] = [],
): string {
  if (attachments.length === 0) return ''
  const images = attachments.filter((a) => a.mime.startsWith('image/'))
  const descByName = new Map<string, string>()
  images.forEach((a, i) => {
    if (imageDescriptions[i]) descByName.set(a.name, imageDescriptions[i])
  })

  const lines: string[] = ['Прикреплены файлы:']
  for (const a of attachments) {
    if (a.text !== undefined) {
      lines.push(`- **${a.name}** (${formatBytes(a.size)}) — текстовое содержимое ниже.`)
    } else {
      const u = uploaded?.files.find((f) => f.name === a.name)
      const isImage = a.mime.startsWith('image/')
      const desc = descByName.get(a.name)
      const head = `- **${a.name}** (${formatBytes(a.size)}, ${a.mime}) — лежит по пути: \`${u?.path ?? '?'}\``
      if (isImage && desc) {
        lines.push(`${head}\n  Что на изображении (по результату Kimi vision):\n  > ${desc.replace(/\n/g, '\n  > ')}`)
      } else {
        lines.push(head)
      }
    }
  }
  const inline = attachments
    .filter((a) => a.text !== undefined)
    .map(
      (a) =>
        `\n\n### ${a.name}\n\n\`\`\`${langFromName(a.name)}\n${a.text}\n\`\`\``,
    )
    .join('')
  return lines.join('\n') + inline + '\n\n---\n\n'
}
