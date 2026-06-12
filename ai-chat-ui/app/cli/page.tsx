'use client'

import { useEffect, useState } from 'react'

export default function CliApprovePage() {
  const [code, setCode] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'ok' | 'err'>('idle')
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    const u = new URLSearchParams(window.location.search).get('user_code')
    if (u) setCode(u.toUpperCase())
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('sending')
    setMsg(null)
    try {
      const r = await fetch('/api/auth/cli/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_code: code.trim() }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        setStatus('err')
        setMsg(j?.error || `HTTP ${r.status}`)
        return
      }
      setStatus('ok')
      setMsg('Done. Go back to your terminal — the token is already there.')
    } catch (e) {
      setStatus('err')
      setMsg((e as Error).message)
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
        onSubmit={submit}
        style={{
          width: 420,
          padding: '28px 26px',
          borderRadius: 18,
          border: '1px solid rgba(255,255,255,0.08)',
          background: 'rgba(255,255,255,0.025)',
          backdropFilter: 'blur(20px)',
        }}
      >
        <div style={{ color: '#fff', fontSize: 18, fontWeight: 600, marginBottom: 4 }}>
          Device sign-in
        </div>
        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginBottom: 22 }}>
          Enter the short code shown to you by{' '}
          <code style={{ background: 'rgba(255,255,255,0.06)', padding: '1px 6px', borderRadius: 4 }}>
            agent-stack login
          </code>
        </div>

        <label
          style={{
            display: 'block',
            fontSize: 11,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.45)',
            marginBottom: 6,
          }}
        >
          Device code
        </label>
        <input
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="XXXX-XXXX"
          style={{
            width: '100%',
            padding: '12px 14px',
            borderRadius: 9,
            background: 'rgba(0,0,0,0.4)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: '#fff',
            outline: 'none',
            fontSize: 18,
            letterSpacing: '0.2em',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            textAlign: 'center',
            boxSizing: 'border-box',
          }}
        />

        {msg && (
          <div
            style={{
              marginTop: 14,
              fontSize: 12.5,
              color: status === 'ok' ? '#86efac' : '#fca5a5',
              background: status === 'ok' ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 8,
              padding: '8px 12px',
            }}
          >
            {msg}
          </div>
        )}

        <button
          type="submit"
          disabled={status === 'sending' || code.length < 8}
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
              status === 'sending' || code.length < 8
                ? 'rgba(99,102,241,0.45)'
                : 'linear-gradient(180deg,#8b5cf6,#6366f1)',
            cursor: status === 'sending' || code.length < 8 ? 'not-allowed' : 'pointer',
          }}
        >
          {status === 'sending' ? 'Confirming…' : 'Confirm'}
        </button>
      </form>
    </div>
  )
}
