import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE, verifySession } from '../../../../lib/auth'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const secret = process.env.AUTH_SECRET
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'server-misconfigured' }, { status: 500 })
  }

  // 1. The user must be logged in to the UI (basic auth OR OAuth).
  const sessionToken = req.cookies.get(SESSION_COOKIE)?.value
  const session = sessionToken ? await verifySession(sessionToken, secret) : null
  if (!session) {
    return NextResponse.json({ ok: false, error: 'not-authenticated' }, { status: 401 })
  }

  // 2. user_code → forward to the proxy /v1/auth/device/approve along with
  //    the logged-in user's email and the shared secret.
  const body = (await req.json().catch(() => ({}))) as { user_code?: string }
  const userCode = String(body.user_code || '').trim().toUpperCase()
  if (!userCode) {
    return NextResponse.json({ ok: false, error: 'user_code required' }, { status: 400 })
  }

  const proxyBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
  const proxyKey = process.env.PROXY_API_KEY
  if (!proxyKey) {
    return NextResponse.json({ ok: false, error: 'PROXY_API_KEY not set on UI side' }, { status: 500 })
  }

  const r = await fetch(`${proxyBase.replace(/\/$/, '')}/v1/auth/device/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Proxy-Key': proxyKey,
    },
    body: JSON.stringify({ user_code: userCode, email: session.u }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: j?.error || `proxy ${r.status}` }, { status: r.status })
  }
  return NextResponse.json({ ok: true, device: j?.device })
}
