'use client'

import { useEffect, useState } from 'react'

export default function LoginPage() {
  const [u, setU] = useState('admin')
  const [p, setP] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Ошибки от OAuth-callback: /login?error=not-allowed:foo@bar.com
  useEffect(() => {
    const e = new URLSearchParams(window.location.search).get('error')
    if (e) setErr(decodeURIComponent(e))
  }, [])

  const next = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('next') || '/'
    : '/'

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setErr(j?.error || `HTTP ${res.status}`)
        return
      }
      const next = new URLSearchParams(window.location.search).get('next') || '/'
      // Hard navigation so middleware runs and the cookie takes effect.
      window.location.href = next
    } catch (e) {
      setErr((e as Error).message || 'Не удалось войти')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background:
          'radial-gradient(1200px 800px at 20% 10%, rgba(139,92,246,0.10), transparent 60%),' +
          'radial-gradient(800px 600px at 80% 90%, rgba(59,130,246,0.08), transparent 60%),' +
          '#08080c',
        fontFamily: 'var(--font-inter), system-ui, sans-serif',
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          width: 380,
          padding: '28px 26px',
          borderRadius: 18,
          border: '1px solid rgba(255,255,255,0.08)',
          background: 'rgba(255,255,255,0.025)',
          backdropFilter: 'blur(20px)',
          boxShadow: '0 30px 80px -20px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: 'linear-gradient(135deg,#8b5cf6,#6366f1)',
              display: 'grid',
              placeItems: 'center',
              fontSize: 14,
              fontWeight: 700,
              color: '#fff',
            }}
          >
            H
          </div>
          <div style={{ color: 'rgba(255,255,255,0.95)', fontSize: 16, fontWeight: 600 }}>
            Hermes × Kimi
          </div>
        </div>
        <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginBottom: 20 }}>
          Вход для администратора
        </div>

        <label style={labelStyle}>Логин</label>
        <input
          autoFocus
          value={u}
          onChange={(e) => setU(e.target.value)}
          autoComplete="username"
          style={inputStyle}
        />

        <label style={{ ...labelStyle, marginTop: 14 }}>Пароль</label>
        <input
          type="password"
          value={p}
          onChange={(e) => setP(e.target.value)}
          autoComplete="current-password"
          style={inputStyle}
        />

        {err && (
          <div
            style={{
              marginTop: 14,
              fontSize: 12.5,
              color: '#fca5a5',
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.18)',
              borderRadius: 8,
              padding: '8px 12px',
            }}
          >
            {err}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !p}
          style={{
            marginTop: 18,
            width: '100%',
            padding: '10px 14px',
            border: 0,
            borderRadius: 10,
            color: '#fff',
            fontSize: 14,
            fontWeight: 500,
            background:
              loading || !p
                ? 'rgba(99,102,241,0.45)'
                : 'linear-gradient(180deg,#8b5cf6,#6366f1)',
            cursor: loading || !p ? 'not-allowed' : 'pointer',
            transition: 'transform 0.05s',
          }}
        >
          {loading ? 'Вход…' : 'Войти'}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '18px 0' }}>
          <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.08em' }}>
            ИЛИ
          </div>
          <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
        </div>

        <a
          href={`/api/auth/oauth/github/start?next=${encodeURIComponent(next)}`}
          style={oauthBtnStyle}
        >
          <span style={{ fontSize: 16 }}></span>
          Войти через GitHub
        </a>
        <a
          href={`/api/auth/oauth/google/start?next=${encodeURIComponent(next)}`}
          style={{ ...oauthBtnStyle, marginTop: 8 }}
        >
          <span style={{ fontSize: 16 }}>G</span>
          Войти через Google
        </a>
      </form>
    </div>
  )
}

const oauthBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  width: '100%',
  padding: '10px 14px',
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.04)',
  color: '#fff',
  fontSize: 14,
  textDecoration: 'none',
  boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.45)',
  marginBottom: 6,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  borderRadius: 9,
  background: 'rgba(0,0,0,0.4)',
  border: '1px solid rgba(255,255,255,0.1)',
  color: '#fff',
  outline: 'none',
  fontSize: 14,
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}
