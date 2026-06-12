'use client'

/**
 * 10 minimalist mascots of the "zek" squad (from the Claude Design handoff).
 * Each one is a unique geometric silhouette with a face. When `live=true`,
 * individual SVG animations kick in (see mascot animations in globals.css).
 */

export type MascotId =
  | 'sisto'    // systemd / processes
  | 'shild'    // SSH / fail2ban / firewall
  | 'keddi'    // Caddy / nginx / reverse proxy
  | 'hranitel' // Postgres / Redis / backups
  | 'logan'    // logs / search
  | 'signal'   // DNS / curl / tracing
  | 'mostik'   // MCP / tunnels / bridges
  | 'kuvald'   // builds / deploys / CI
  | 'okular'   // uptime / metrics / alerts
  | 'maestro'  // orchestrator / root

export type MascotStatus = 'active' | 'ready' | 'idle' | 'failed'

/** Mascot identity — the part that never changes (name, domain, default prompt).
    Runtime stats (status/turns/runtime/lastTask) are computed separately from
    live sessions via buildRosterFromSessions(). */
export interface MascotIdentity {
  id: MascotId
  idx: string
  name: string
  role: string
  domain: string
  traits: string[]
  /** Default prompt for this mascot — inserted into the textarea when the user
      clicks "↪ send to automation" and has no specific request of their own. */
  defaultPrompt: string
}

/** Full mascot state for the UI — identity + runtime. */
export interface MascotMeta extends MascotIdentity {
  status: MascotStatus
  statusLabel: string
  lastTask: string
  turns: number
  runtime: string
  /** id of this mascot's server session, if any (for opening it directly). */
  sessionId: string | null
}

/** Canonical identity table — no runtime data. */
export const ROSTER_IDENTITY: MascotIdentity[] = [
  { id: 'sisto',    idx: '01', name: 'Sisto',    role: 'systemd · processes · units',       domain: 'Services',      traits: ['systemctl', 'journalctl', 'units', 'timers'],
    defaultPrompt: 'Check all systemd units on the VPS — which are active, which failed, which are not enabled. For each failed unit run `journalctl -u <unit> --since "1h ago" --no-pager | tail -30` and explain what went wrong. Keep it brief.' },
  { id: 'shild',    idx: '02', name: 'Shild',    role: 'SSH · fail2ban · firewall',         domain: 'Security',      traits: ['sshd', 'fail2ban', 'iptables', 'ufw'],
    defaultPrompt: 'Check VPS security: PermitRootLogin/PasswordAuthentication in sshd_config, fail2ban status + banned IPs, ports open to the outside (ss -ltnp), last 50 failed logins in /var/log/auth.log. Point out the weak spots.' },
  { id: 'keddi',    idx: '03', name: 'Keddi',    role: 'Caddy · nginx · reverse proxy',     domain: 'Web',           traits: ['caddy', 'nginx', 'TLS', 'HTTP/2'],
    defaultPrompt: 'Parse /etc/caddy/Caddyfile — which vhosts point to which upstreams. For each host run curl -sS -o /dev/null -w "%{http_code} %{time_total}s\\n" https://<host>/. Check SSL expiry via openssl s_client. Report anything broken.' },
  { id: 'hranitel', idx: '04', name: 'Hranitel', role: 'Postgres · Redis · backups',        domain: 'Data',          traits: ['psql', 'redis-cli', 'pg_dump', 'wal'],
    defaultPrompt: 'Check database health on the VPS: which postgres/redis instances are running, size of /var/lib/{postgresql,redis}, most recent backup (mtime). Run pg_dump --schema-only on one database to verify integrity.' },
  { id: 'logan',    idx: '05', name: 'Logan',    role: 'logs · search · correlation',       domain: 'Logs',          traits: ['grep', 'awk', 'jq', 'loki'],
    defaultPrompt: 'Do a deep scan of the logs for the last 24h: journalctl --since "24h ago" --priority=err | tail -50, top 10 processes by log volume, anomalies in /var/log/syslog. Group findings by cause.' },
  { id: 'signal',   idx: '06', name: 'Signal',   role: 'DNS · curl · tracing',              domain: 'Network',       traits: ['dig', 'mtr', 'tcpdump', 'curl'],
    defaultPrompt: 'Check VPS networking: dig +short for all public domains from caddy, ping/mtr to 1.1.1.1, ss -tulpn (what is listening), iptables -L -n -v. Report any DNS resolution or routing problems.' },
  { id: 'mostik',   idx: '07', name: 'Mostik',   role: 'MCP · tunnels · bridges',           domain: 'Integrations',  traits: ['mcp', 'ssh -L', 'wireguard', 'stunnel'],
    defaultPrompt: 'Diagnose kimi-mcp-proxy: service status, last 50 lines of journalctl -u kimi-mcp-proxy, which MCP clients are connected, /health response time. Patch wherever it is slow.' },
  { id: 'kuvald',   idx: '08', name: 'Kuvald',   role: 'builds · deploys · CI',             domain: 'Deploy',        traits: ['docker', 'make', 'systemd-run', 'git'],
    defaultPrompt: 'Rebuild ai-chat-ui (npm run build in /opt/ai-chat-ui), safely restart ai-chat-ui.service via systemd-run --on-active=3s. Verify the service is active after restart and /health responds.' },
  { id: 'okular',   idx: '09', name: 'Okular',   role: 'uptime · metrics · alerts',         domain: 'Monitoring',    traits: ['uptime', 'vmstat', 'iostat', 'loadavg'],
    defaultPrompt: 'Build a VPS health report: uptime + loadavg, free -h, df -h, top 10 processes by %CPU and %MEM, iostat -xz 1 3, vmstat 1 3. Point out the bottleneck.' },
  { id: 'maestro',  idx: '10', name: 'Maestro',  role: 'orchestrator · root · coordination', domain: 'Orchestration', traits: ['root', 'delegate', 'parallel', 'merge'],
    defaultPrompt: 'Run a full VPS audit in parallel with ≥5 sub-agents: services, security, web, data, logs, network, deploy, monitoring. Split the work via POST /automations/delegate with parentSessionId=$KP_SESSION_ID and merge everything into a single report.' },
]

/** Backwards-compatible — older code may still import ROSTER, but it is now
    just the identity table without runtime stats. */
export const ROSTER = ROSTER_IDENTITY

export interface Connection {
  from: MascotId
  to: MascotId
  state: 'active' | 'done'
}

/** @deprecated — kept for backwards compatibility. In the UI use
    buildConnectionsFromSessions(). */
export const CONNECTIONS: Connection[] = []

// ─── individual mascots ──────────────────────────────────────────────────────
// BG — inner face background (dark card background)
const BG = 'var(--zek-bg-1)'

interface MProps { size?: number; live?: boolean }

function MSisto({ size = 64, live }: MProps) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size}
         className={`mascot-svg-el m-sisto ${live ? 'is-live' : ''}`}
         style={{ color: 'var(--zek-accent)' }}>
      <g className="m-rotor">
        <g fill="currentColor">
          {Array.from({ length: 8 }).map((_, i) => (
            <rect key={i} x="30" y="6" width="4" height="9" rx="1" transform={`rotate(${i*45} 32 32)`} />
          ))}
          <circle cx="32" cy="32" r="18"/>
        </g>
      </g>
      <g className="m-face">
        <circle cx="26" cy="30" r="2.2" fill={BG}/>
        <circle cx="38" cy="30" r="2.2" fill={BG}/>
        <rect x="29" y="37" width="6" height="1.6" rx="0.8" fill={BG}/>
      </g>
    </svg>
  )
}

function MShild({ size = 64, live }: MProps) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size}
         className={`mascot-svg-el m-shild ${live ? 'is-live' : ''}`}
         style={{ color: 'var(--zek-accent)' }}>
      <path className="m-shield-body" d="M32 8 L52 14 L52 32 Q52 46 32 56 Q12 46 12 32 L12 14 Z" fill="currentColor"/>
      <circle cx="26" cy="28" r="2.2" fill={BG}/>
      <circle cx="38" cy="28" r="2.2" fill={BG}/>
      <path className="m-shield-mouth" d="M27 36 Q32 40 37 36" stroke={BG} strokeWidth="1.6" fill="none" strokeLinecap="round"/>
    </svg>
  )
}

function MKeddi({ size = 64, live }: MProps) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size}
         className={`mascot-svg-el m-keddi ${live ? 'is-live' : ''}`}
         style={{ color: 'var(--zek-accent)' }}>
      <rect x="12" y="10" width="40" height="44" rx="4" fill="currentColor"/>
      <rect x="16" y="14" width="32" height="10" rx="2" fill={BG}/>
      <rect x="16" y="40" width="32" height="10" rx="2" fill={BG}/>
      <circle className="m-led m-led-1" cx="20" cy="19" r="1.6" fill="currentColor"/>
      <circle className="m-led m-led-2" cx="26" cy="19" r="1.6" fill="currentColor"/>
      <circle className="m-led m-led-3" cx="44" cy="19" r="1.6" fill="currentColor"/>
      <circle cx="25" cy="32" r="2.2" fill={BG}/>
      <circle cx="39" cy="32" r="2.2" fill={BG}/>
      <rect x="29" y="35" width="6" height="1.6" rx="0.8" fill={BG}/>
    </svg>
  )
}

function MHranitel({ size = 64, live }: MProps) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size}
         className={`mascot-svg-el m-hranitel ${live ? 'is-live' : ''}`}
         style={{ color: 'var(--zek-accent)' }}>
      <path d="M12 16 Q12 8 32 8 Q52 8 52 16 L52 48 Q52 56 32 56 Q12 56 12 48 Z" fill="currentColor"/>
      <ellipse cx="32" cy="16" rx="20" ry="6" fill={BG}/>
      <ellipse cx="32" cy="16" rx="16" ry="4" fill="currentColor" opacity="0.4"/>
      <circle cx="26" cy="34" r="2.2" fill={BG}/>
      <circle cx="38" cy="34" r="2.2" fill={BG}/>
      <path d="M28 42 L36 42" stroke={BG} strokeWidth="1.6" strokeLinecap="round"/>
      <path className="m-scan" d="M14 28 Q32 34 50 28" stroke={BG} strokeWidth="1.2" fill="none"/>
    </svg>
  )
}

function MLogan({ size = 64, live }: MProps) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size}
         className={`mascot-svg-el m-logan ${live ? 'is-live' : ''}`}
         style={{ color: 'var(--zek-accent)' }}>
      <rect x="14" y="10" width="36" height="44" rx="3" fill="currentColor"/>
      <g className="m-loglines">
        <rect x="20" y="16" width="16" height="1.6" fill={BG}/>
        <rect x="20" y="20" width="22" height="1.6" fill={BG}/>
        <rect x="20" y="48" width="14" height="1.6" fill={BG}/>
      </g>
      <circle cx="24" cy="32" r="2.4" fill={BG}/>
      <circle cx="40" cy="32" r="2.4" fill={BG}/>
      <rect x="27" y="40" width="10" height="1.6" rx="0.8" fill={BG}/>
      <path d="M50 10 L50 18 L42 10 Z" fill={BG}/>
    </svg>
  )
}

function MSignal({ size = 64, live }: MProps) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size}
         className={`mascot-svg-el m-signal ${live ? 'is-live' : ''}`}
         style={{ color: 'var(--zek-accent)' }}>
      <path className="m-arc m-arc-1" d="M10 38 Q32 14 54 38" stroke="currentColor" strokeWidth="6" fill="none" strokeLinecap="round"/>
      <path className="m-arc m-arc-2" d="M18 42 Q32 26 46 42" stroke="currentColor" strokeWidth="5" fill="none" strokeLinecap="round"/>
      <path className="m-arc m-arc-3" d="M24 46 Q32 38 40 46" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round"/>
      <circle cx="32" cy="52" r="4" fill="currentColor"/>
      <circle cx="26" cy="34" r="1.6" fill={BG}/>
      <circle cx="38" cy="34" r="1.6" fill={BG}/>
    </svg>
  )
}

function MMostik({ size = 64, live }: MProps) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size}
         className={`mascot-svg-el m-mostik ${live ? 'is-live' : ''}`}
         style={{ color: 'var(--zek-accent)' }}>
      <g className="m-link m-link-l">
        <rect x="8" y="20" width="28" height="20" rx="10" fill="currentColor"/>
        <rect x="12" y="24" width="20" height="12" rx="6" fill={BG}/>
        <circle cx="16" cy="29" r="1.8" fill="currentColor"/>
        <circle cx="22" cy="29" r="1.8" fill="currentColor"/>
      </g>
      <g className="m-link m-link-r">
        <rect x="28" y="24" width="28" height="20" rx="10" fill="currentColor"/>
        <rect x="32" y="28" width="20" height="12" rx="6" fill={BG}/>
        <circle cx="42" cy="33" r="1.8" fill="currentColor"/>
        <circle cx="48" cy="33" r="1.8" fill="currentColor"/>
      </g>
    </svg>
  )
}

function MKuvald({ size = 64, live }: MProps) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size}
         className={`mascot-svg-el m-kuvald ${live ? 'is-live' : ''}`}
         style={{ color: 'var(--zek-accent)' }}>
      <g className="m-hammer" style={{ transformOrigin: '32px 38px' }}>
        <rect x="10" y="14" width="44" height="20" rx="3" fill="currentColor"/>
        <rect x="28" y="32" width="8" height="22" rx="2" fill="currentColor"/>
        <circle cx="26" cy="23" r="2.2" fill={BG}/>
        <circle cx="38" cy="23" r="2.2" fill={BG}/>
        <rect x="29" y="28" width="6" height="1.6" rx="0.8" fill={BG}/>
        <rect x="28" y="42" width="8" height="1" fill={BG} opacity="0.5"/>
        <rect x="28" y="46" width="8" height="1" fill={BG} opacity="0.5"/>
        <rect x="28" y="50" width="8" height="1" fill={BG} opacity="0.5"/>
      </g>
    </svg>
  )
}

function MOkular({ size = 64, live }: MProps) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size}
         className={`mascot-svg-el m-okular ${live ? 'is-live' : ''}`}
         style={{ color: 'var(--zek-accent)' }}>
      <path d="M6 32 Q32 8 58 32 Q32 56 6 32 Z" fill="currentColor"/>
      <circle cx="32" cy="32" r="11" fill={BG}/>
      <g className="m-pupil">
        <circle cx="32" cy="32" r="6" fill="currentColor"/>
        <circle cx="34" cy="30" r="1.6" fill={BG}/>
      </g>
    </svg>
  )
}

function MMaestro({ size = 64, live }: MProps) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size}
         className={`mascot-svg-el m-maestro ${live ? 'is-live' : ''}`}
         style={{ color: 'var(--zek-accent)' }}>
      <path d="M10 24 L18 38 L24 22 L32 38 L40 22 L46 38 L54 24 L54 50 L10 50 Z" fill="currentColor"/>
      <circle className="m-gem m-gem-1" cx="10" cy="24" r="2.5" fill="currentColor"/>
      <circle className="m-gem m-gem-2" cx="32" cy="20" r="2.5" fill="currentColor"/>
      <circle className="m-gem m-gem-3" cx="54" cy="24" r="2.5" fill="currentColor"/>
      <circle cx="25" cy="42" r="2.2" fill={BG}/>
      <circle cx="39" cy="42" r="2.2" fill={BG}/>
      <path d="M27 47 Q32 49 37 47" stroke={BG} strokeWidth="1.4" fill="none" strokeLinecap="round"/>
      <rect x="12" y="46" width="40" height="2" fill={BG} opacity="0.4"/>
    </svg>
  )
}

const REGISTRY: Record<MascotId, (p: MProps) => JSX.Element> = {
  sisto: MSisto, shild: MShild, keddi: MKeddi, hranitel: MHranitel,
  logan: MLogan, signal: MSignal, mostik: MMostik, kuvald: MKuvald,
  okular: MOkular, maestro: MMaestro,
}

/** Universal mascot renderer by id. */
export function Mascot({ id, size = 64, live = false }: { id: MascotId; size?: number; live?: boolean }) {
  const Cmp = REGISTRY[id]
  if (!Cmp) return null
  return <Cmp size={size} live={live} />
}

/** Heuristic: pick a mascot based on the session/task name text.
    Checks run from most specific to most general, so Security always
    catches Shild rather than Logan (even though both deal with auth.log). */
export function guessMascot(text: string): MascotId {
  const s = (text || '').toLowerCase()

  // Security — Shild: SSH, fail2ban, firewall, auth.log scan, brute force, secrets
  if (/(ssh\b|sshd|fail2ban|iptables|firewall|ufw|nftables|whitelist|brute|harden|security|sudoers|permitroot|passwordauth)/i.test(s)) return 'shild'

  // Web — Keddi: Caddy, nginx, TLS, vhost, web stack
  if (/(caddy|nginx|tls|ssl|https?\b|vhost|reverse[\s-]?proxy|let'?s.?encrypt|certbot|web|http\/2)/i.test(s)) return 'keddi'

  // Data — Hranitel: databases, backups
  if (/(postgres|psql|redis|mysql|mongo|sqlite|backup|snapshot|pg_dump|pg_restore|\bwal\b|dump|datab)/i.test(s)) return 'hranitel'

  // Logs — Logan: logs, grep
  if (/(\blog\b|log\.|grep|awk|jq|loki|auth\.log|syslog|messages)/i.test(s)) return 'logan'

  // Network — Signal: DNS, curl, ping, mtr
  if (/(\bdns\b|\bdig\b|\bping\b|curl|wget|mtr\b|tcpdump|traceroute|resolv|nslookup|network)/i.test(s)) return 'signal'

  // Integrations / MCP — Mostik: tunnels, proxy, stack-wide
  if (/(\bmcp\b|tunnel|wireguard|stunnel|bridge|integrat|playwright|hermes|kimi-mcp|kimi-proxy|kimi.proxy)/i.test(s)) return 'mostik'

  // Deploy / CI — Kuvald: builds, code files, docker
  if (/(deploy|build|docker|make|rebuild|git\b|push|compil|\.css|\.js\b|\.html|\.md\b|app[-\.]?js|styles[-\.]?css|hero[-\.]?html|footer[-\.]?html|features[-\.]?html|readme[-\.]?md)/i.test(s)) return 'kuvald'

  // Monitoring — Okular: uptime, metrics, resources, disk/memory
  if (/(uptime|metric|vmstat|iostat|loadavg|monitor|health|disk|memory|\bcpu\b|\bram\b|\bvps\b\s*health)/i.test(s)) return 'okular'

  // Orchestration / audit — Maestro: root, audit, delegation
  if (/(orchestr|\broot\b|delegate|parallel|audit|sub[-\s]?agent|coordin|main)/i.test(s)) return 'maestro'

  // Services / systemd — Sisto: services, containers, units
  if (/(systemd|systemctl|journalctl|service\b|unit\b|container|timer\b|process)/i.test(s)) return 'sisto'

  return 'maestro' // fallback — general orchestrator/chat
}

// ─── live state computation from real server sessions ────────────────────

/** Minimal server-session shape we need — compatible with AgentSession. */
export interface ServerSessionLike {
  id: string
  name: string
  turns: number
  lastUsedAt: number
  lastPrompt?: string
  parentSessionId?: string | null
}

/** Age in ms since last use. */
function ageMs(s: ServerSessionLike): number {
  return Date.now() - (s.lastUsedAt || 0)
}

/** Whether the session is active right now (last activity < 90s ago). */
function isLiveSession(s: ServerSessionLike): boolean {
  return ageMs(s) < 90_000 && s.turns > 0
}

/** Human-readable runtime. */
function formatRuntime(ms: number): string {
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/**
 * Build the live mascot roster from real sessions.
 * Each session maps to a mascot via guessMascot(name+prompt), and for
 * each mascot we take:
 *   • status — active if there is a fresh (<90s) session with turns>0, ready if
 *     there was a recent session, idle if there are none at all
 *   • turns — sum of turns across all of this mascot's sessions
 *   • lastTask — name of the most recent session
 *   • runtime — formatRuntime of the most recent session's lastUsedAt
 *   • sessionId — id of the most recent session (for opening it directly)
 */
export function buildRosterFromSessions(sessions: ServerSessionLike[]): MascotMeta[] {
  // bucket sessions by mascot
  const buckets = new Map<MascotId, ServerSessionLike[]>()
  for (const m of ROSTER_IDENTITY) buckets.set(m.id, [])
  for (const s of sessions) {
    const m = guessMascot((s.name || '') + ' ' + (s.lastPrompt || ''))
    buckets.get(m)!.push(s)
  }
  return ROSTER_IDENTITY.map((ident) => {
    const list = (buckets.get(ident.id) || []).slice().sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    const latest = list[0]
    if (!latest) {
      return {
        ...ident,
        status: 'idle' as MascotStatus,
        statusLabel: 'idle',
        lastTask: '—',
        turns: 0,
        runtime: '—',
        sessionId: null,
      }
    }
    const live = list.some(isLiveSession)
    const totalTurns = list.reduce((acc, s) => acc + (s.turns || 0), 0)
    return {
      ...ident,
      status: live ? ('active' as MascotStatus) : ('ready' as MascotStatus),
      statusLabel: live ? 'working' : 'ready',
      lastTask: latest.name.length > 80 ? latest.name.slice(0, 80) + '…' : latest.name,
      turns: totalTurns,
      runtime: formatRuntime(ageMs(latest)),
      sessionId: latest.id,
    }
  })
}

/**
 * Build live delegation arcs between mascots from real
 * parent→child links in the sessions.
 *   • if the parent is active AND the child is active → state='active' (running dashes)
 *   • if there is a parent but neither is active → state='done' (static)
 *   • self-loops (parent and child map to the same mascot) are dropped
 */
export function buildConnectionsFromSessions(sessions: ServerSessionLike[]): Connection[] {
  const byId = new Map(sessions.map((s) => [s.id, s]))
  const edges = new Map<string, Connection>() // "from→to" key for dedupe
  for (const child of sessions) {
    if (!child.parentSessionId) continue
    const parent = byId.get(child.parentSessionId)
    if (!parent) continue
    const fromM = guessMascot((parent.name || '') + ' ' + (parent.lastPrompt || ''))
    const toM   = guessMascot((child.name  || '') + ' ' + (child.lastPrompt  || ''))
    if (fromM === toM) continue // self-loop
    const key = `${fromM}→${toM}`
    const isActive = isLiveSession(parent) || isLiveSession(child)
    const prev = edges.get(key)
    // active wins over done
    if (!prev || (isActive && prev.state === 'done')) {
      edges.set(key, { from: fromM, to: toM, state: isActive ? 'active' : 'done' })
    }
  }
  return [...edges.values()]
}

/** Find an identity by id (for UI helpers). */
export function findMascot(id: MascotId): MascotIdentity | undefined {
  return ROSTER_IDENTITY.find((m) => m.id === id)
}
