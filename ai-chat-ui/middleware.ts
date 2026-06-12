import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE, verifySession } from './app/lib/auth'

// Anything matched here bypasses the auth gate.
const PUBLIC_PREFIXES = [
  '/login',
  '/share/',
  '/api/auth/',
  '/_next/',
  '/favicon',
  '/icons/',
  '/icon-',
  '/apple-touch-icon',
  '/manifest',
  '/robots.txt',
  '/sitemap.xml',
]
const PUBLIC_EXTS = ['.svg', '.png', '.jpg', '.jpeg', '.webp', '.ico', '.gif', '.txt', '.map']

function isPublic(pathname: string): boolean {
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) return true
  for (const ext of PUBLIC_EXTS) if (pathname.endsWith(ext)) return true
  return false
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (isPublic(pathname)) return NextResponse.next()

  const secret = process.env.AUTH_SECRET
  if (!secret) {
    // Fail closed in production: an unconfigured instance must not expose
    // the chat to the whole internet. Dev mode stays open for local work.
    if (process.env.NODE_ENV !== 'production') return NextResponse.next()
    return new NextResponse(
      'Authentication is not configured. Set AUTH_SECRET, AUTH_USER and AUTH_PASSWORD in ai-chat-ui/.env.local and restart.',
      { status: 503 },
    )
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value
  const payload = token ? await verifySession(token, secret) : null

  if (!payload) {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    if (pathname !== '/') url.searchParams.set('next', pathname + req.nextUrl.search)
    return NextResponse.redirect(url)
  }
  return NextResponse.next()
}

export const config = {
  // Run on everything except static assets that Next.js already optimises.
  matcher: ['/((?!_next/static|_next/image).*)'],
}
