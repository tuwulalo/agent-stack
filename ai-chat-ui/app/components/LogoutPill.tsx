'use client'

import { useState } from 'react'

/**
 * Tiny logout pill rendered globally via root layout. Hidden on the /login page.
 */
export function LogoutPill() {
  const [busy, setBusy] = useState(false)

  // Hide on the login screen
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/login')) {
    return null
  }

  async function logout() {
    if (busy) return
    setBusy(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch {
      /* ignore network errors — still redirect */
    } finally {
      window.location.href = '/login'
    }
  }

  return (
    <button
      type="button"
      onClick={logout}
      title="Sign out"
      style={{
        position: 'fixed',
        top: 14,
        right: 14,
        zIndex: 60,
        height: 28,
        padding: '0 10px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 11,
        color: 'rgba(255,255,255,0.55)',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 8,
        cursor: 'pointer',
        backdropFilter: 'blur(8px)',
      }}
      onMouseEnter={(e) => {
        ;(e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.95)'
        ;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.08)'
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.55)'
        ;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'
      }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
      </svg>
      <span>Sign out</span>
    </button>
  )
}
