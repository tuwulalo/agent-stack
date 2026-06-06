import { NextResponse } from 'next/server'
import { SESSION_COOKIE } from '../../../lib/auth'

export const runtime = 'nodejs'

export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    maxAge: 0,
    path: '/',
  })
  return res
}
