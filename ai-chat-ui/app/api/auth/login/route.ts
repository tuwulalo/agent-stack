import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE, signSession, timingSafeEqualStr } from '../../../lib/auth'

export const runtime = 'nodejs'

const THIRTY_DAYS_MS = 1000 * 60 * 60 * 24 * 30

export async function POST(req: NextRequest) {
  let body: { username?: string; password?: string } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Некорректный JSON' }, { status: 400 })
  }

  const username = String(body.username || '').trim()
  const password = String(body.password || '')

  const expectedUser = process.env.AUTH_USER || 'admin'
  const expectedPass = process.env.AUTH_PASSWORD
  const secret = process.env.AUTH_SECRET

  if (!expectedPass || !secret) {
    return NextResponse.json(
      { ok: false, error: 'Сервер не сконфигурирован (нет AUTH_PASSWORD / AUTH_SECRET)' },
      { status: 500 }
    )
  }

  const userOk = timingSafeEqualStr(username, expectedUser)
  const passOk = timingSafeEqualStr(password, expectedPass)

  if (!userOk || !passOk) {
    return NextResponse.json({ ok: false, error: 'Неверный логин или пароль' }, { status: 401 })
  }

  const exp = Date.now() + THIRTY_DAYS_MS
  const token = await signSession({ u: expectedUser, exp }, secret)

  const res = NextResponse.json({ ok: true, user: expectedUser })
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    maxAge: THIRTY_DAYS_MS / 1000,
    path: '/',
  })
  return res
}
