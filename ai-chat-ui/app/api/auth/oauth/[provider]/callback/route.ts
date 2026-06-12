import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE, signSession } from '../../../../../lib/auth'
import {
  exchangeCodeForToken,
  fetchUserEmail,
  getProvider,
  getRedirectUri,
  isEmailAllowed,
} from '../../../../../lib/oauth'

export const runtime = 'nodejs'

const THIRTY_DAYS_MS = 1000 * 60 * 60 * 24 * 30

function deny(req: NextRequest, reason: string) {
  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.searchParams.set('error', reason)
  return NextResponse.redirect(url)
}

export async function GET(
  req: NextRequest,
  { params }: { params: { provider: string } }
) {
  const providerName = params.provider as 'github' | 'google'
  const provider = getProvider(providerName)
  if (!provider) return deny(req, 'unknown-provider')

  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const cookieState = req.cookies.get('oauth_state')?.value

  if (!code || !state || !cookieState || state !== cookieState) {
    return deny(req, 'bad-state')
  }

  const secret = process.env.AUTH_SECRET
  if (!secret) return deny(req, 'no-auth-secret')

  const redirectUri = getRedirectUri(providerName, req)
  const accessToken = await exchangeCodeForToken(provider, code, redirectUri)
  if (!accessToken) return deny(req, 'token-exchange-failed')

  const email = await fetchUserEmail(provider, accessToken)
  if (!email) return deny(req, 'no-email')

  if (!isEmailAllowed(email)) {
    return deny(req, `not-allowed:${email}`)
  }

  const exp = Date.now() + THIRTY_DAYS_MS
  const session = await signSession({ u: email, exp }, secret)

  const next = req.cookies.get('oauth_next')?.value || '/'
  const dest = req.nextUrl.clone()
  dest.pathname = next.startsWith('/') ? next : '/'
  dest.search = ''

  const res = NextResponse.redirect(dest)
  res.cookies.set(SESSION_COOKIE, session, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    maxAge: THIRTY_DAYS_MS / 1000,
    path: '/',
  })
  // clean up the temporary cookies
  res.cookies.set('oauth_state', '', { maxAge: 0, path: '/' })
  res.cookies.set('oauth_next', '', { maxAge: 0, path: '/' })
  return res
}
