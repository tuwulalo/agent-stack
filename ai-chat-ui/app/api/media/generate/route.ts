import { NextRequest, NextResponse } from 'next/server'
import { DEFAULT_MODEL } from '../../../lib/config'
import { type GenerateKind, buildSystemPrompt } from '../../../lib/mediaStudio'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const KIMI_BASE = (process.env.KIMI_API_INTERNAL || 'http://127.0.0.1:3001').replace(/\/$/, '')
// Same shared key the UI already uses for the device-approve endpoint.
const PROXY_API_KEY = process.env.PROXY_API_KEY || ''

export async function POST(req: NextRequest) {
  let body: { kind?: GenerateKind; topic?: string; extra?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const kind = body.kind
  if (!kind || !['ideas', 'script', 'thumbnail'].includes(kind)) {
    return NextResponse.json({ error: 'kind must be ideas | script | thumbnail' }, { status: 400 })
  }

  const topic = (body.topic || '').trim()
  if (!topic) {
    return NextResponse.json({ error: 'topic is required' }, { status: 400 })
  }

  const userPrompt =
    kind === 'ideas'
      ? `Context / theme for the ideas: ${topic}${body.extra ? `\nAdditional notes: ${body.extra}` : ''}`
      : kind === 'script'
        ? `Video topic: ${topic}${body.extra ? `\nTone and wishes: ${body.extra}` : ''}`
        : `Title of the future video: ${topic}${body.extra ? `\nThumbnail style: ${body.extra}` : ''}`

  try {
    const res = await fetch(`${KIMI_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(PROXY_API_KEY ? { Authorization: `Bearer ${PROXY_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        stream: false,
        temperature: 0.75,
        messages: [
          { role: 'system', content: buildSystemPrompt(kind) },
          { role: 'user', content: userPrompt },
        ],
      }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return NextResponse.json(
        { error: `Proxy HTTP ${res.status}`, detail: detail.slice(0, 300) },
        { status: 502 },
      )
    }

    const json = await res.json()
    const content = json.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) {
      return NextResponse.json({ error: 'Empty response from the model' }, { status: 502 })
    }

    return NextResponse.json({
      kind,
      topic,
      content,
      model: json.model || DEFAULT_MODEL,
      engine: kind === 'thumbnail' ? 'prompt for an image model (concept)' : 'proxy',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Generation failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
