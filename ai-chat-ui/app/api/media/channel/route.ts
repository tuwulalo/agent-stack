import { NextResponse } from 'next/server'
import { YT_CHANNEL_ID, YT_RSS_URL, buildChannelSnapshot } from '../../../lib/mediaStudio'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  if (!YT_CHANNEL_ID) {
    return NextResponse.json(
      { error: 'Set NEXT_PUBLIC_YT_CHANNEL_ID in .env.local to connect your YouTube channel.' },
      { status: 400 },
    )
  }
  try {
    const res = await fetch(YT_RSS_URL, {
      headers: { 'User-Agent': 'AgentStackMediaStudio/0.1' },
      cache: 'no-store',
      next: { revalidate: 0 },
    })
    if (!res.ok) throw new Error(`RSS HTTP ${res.status}`)
    const xml = await res.text()
    return NextResponse.json(buildChannelSnapshot(xml))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load the channel'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
