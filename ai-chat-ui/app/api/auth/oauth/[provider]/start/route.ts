import { NextRequest, NextResponse } from 'next/server'
import { getProvider, getRedirectUri, randomState } from '../../../../../lib/oauth'

export const runtime = 'nodejs'

const STATE_COOKIE = 'oauth_state'
const NEXT_COOKIE = 'oauth_next'

export async function GET(
  req: NextRequest,
  { params }: { params: { provider: string } }
) {
  const providerName = params.provider
  const provider = getProvider(providerName)
  if (!provider) {
    return NextResponse.json(
      { ok: false, error: `provider ${providerName} is not configured` },
      { status: 404 }
    )
  }

  const state = randomState()
  const redirectUri = getRedirectUri(providerName as 'github' | 'google', req)
  const next = req.nextUrl.searchParams.get('next') || '/'

  const url = new URL(provider.authUrl)
  url.searchParams.set('client_id', provider.clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', provider.scope)
  url.searchParams.set('state', state)
  url.searchParams.set('response_type', 'code')
  if (providerName === 'google') {
    url.searchParams.set('access_type', 'online')
    url.searchParams.set('prompt', 'select_account')
  }

  const res = NextResponse.redirect(url.toString())
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    maxAge: 600,
    path: '/',
  })
  res.cookies.set(NEXT_COOKIE, next, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    maxAge: 600,
    path: '/',
  })
  return res
}
