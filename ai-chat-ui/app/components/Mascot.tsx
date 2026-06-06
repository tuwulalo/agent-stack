'use client'

/**
 * 10 минималистичных маскотов отряда «зек» (из Claude Design handoff).
 * Каждый — уникальный геометрический силуэт с лицом. Если `live=true` —
 * включаются индивидуальные SVG-анимации (см. mascot animations в globals.css).
 */

export type MascotId =
  | 'sisto'    // systemd / процессы
  | 'shild'    // SSH / fail2ban / фаервол
  | 'keddi'    // Caddy / nginx / реверс-прокси
  | 'hranitel' // Postgres / Redis / бэкапы
  | 'logan'    // журналы / поиск
  | 'signal'   // DNS / curl / трассировка
  | 'mostik'   // MCP / туннели / мосты
  | 'kuvald'   // сборки / деплои / CI
  | 'okular'   // uptime / метрики / алерты
  | 'maestro'  // оркестратор / root

export type MascotStatus = 'active' | 'ready' | 'idle' | 'failed'

/** Identity маскота — то, что не меняется (имя, домен, дефолтный промпт).
    Runtime stats (status/turns/runtime/lastTask) считаются отдельно из живых
    сессий через buildRosterFromSessions(). */
export interface MascotIdentity {
  id: MascotId
  idx: string
  name: string
  role: string
  domain: string
  traits: string[]
  /** Дефолтный промпт под этого маскота — подставляется в textarea при
      клике «↪ позвать в автомат» если у юзера нет своего конкретного запроса. */
  defaultPrompt: string
}

/** Полное состояние маскота для UI — identity + runtime. */
export interface MascotMeta extends MascotIdentity {
  status: MascotStatus
  statusLabel: string
  lastTask: string
  turns: number
  runtime: string
  /** id серверной сессии этого маскота, если есть (для прямого открытия). */
  sessionId: string | null
}

/** Каноническая identity-таблица — без runtime данных. */
export const ROSTER_IDENTITY: MascotIdentity[] = [
  { id: 'sisto',    idx: '01', name: 'Систо',     role: 'systemd · процессы · юниты',       domain: 'Сервисы',      traits: ['systemctl', 'journalctl', 'юниты', 'таймеры'],
    defaultPrompt: 'Проверь все systemd-юниты на VPS — какие active, какие failed, какие не enabled. Для каждого failed подними `journalctl -u <unit> --since "1h ago" --no-pager | tail -30` и скажи что не так. Кратко.' },
  { id: 'shild',    idx: '02', name: 'Шилд',      role: 'SSH · fail2ban · фаервол',         domain: 'Безопасность', traits: ['sshd', 'fail2ban', 'iptables', 'ufw'],
    defaultPrompt: 'Проверь безопасность VPS: PermitRootLogin/PasswordAuthentication в sshd_config, статус fail2ban + забаненные IP, открытые порты наружу (ss -ltnp), последние 50 failed логинов в /var/log/auth.log. Скажи где дыра.' },
  { id: 'keddi',    idx: '03', name: 'Кэдди',     role: 'Caddy · nginx · реверс-прокси',    domain: 'Веб',          traits: ['caddy', 'nginx', 'TLS', 'HTTP/2'],
    defaultPrompt: 'Распарси /etc/caddy/Caddyfile — какие vhost\'ы, на какие апстримы. Для каждого хоста curl -sS -o /dev/null -w "%{http_code} %{time_total}s\\n" https://<host>/. Проверь SSL-expiry через openssl s_client. Скажи где беда.' },
  { id: 'hranitel', idx: '04', name: 'Хранитель', role: 'Postgres · Redis · бэкапы',        domain: 'Данные',       traits: ['psql', 'redis-cli', 'pg_dump', 'wal'],
    defaultPrompt: 'Проверь состояние БД на VPS: какие postgres/redis instances запущены, размер /var/lib/{postgresql,redis}, последний бэкап (mtime). Сделай pg_dump --schema-only одной БД для проверки целостности.' },
  { id: 'logan',    idx: '05', name: 'Логан',     role: 'журналы · поиск · корреляция',     domain: 'Логи',         traits: ['grep', 'awk', 'jq', 'loki'],
    defaultPrompt: 'Сделай deep-scan журналов за последние 24ч: journalctl --since "24h ago" --priority=err | tail -50, top-10 процессов по log volume, аномалии в /var/log/syslog. Сгруппируй по причинам.' },
  { id: 'signal',   idx: '06', name: 'Сигнал',    role: 'DNS · curl · трассировка',         domain: 'Сеть',         traits: ['dig', 'mtr', 'tcpdump', 'curl'],
    defaultPrompt: 'Проверь сетку VPS: dig +short для всех публичных доменов из caddy, ping/mtr до 1.1.1.1, ss -tulpn (что слушает), iptables -L -n -v. Скажи где проблема с резолвом или маршрутизацией.' },
  { id: 'mostik',   idx: '07', name: 'Мостик',    role: 'MCP · туннели · мосты',            domain: 'Интеграции',   traits: ['mcp', 'ssh -L', 'wireguard', 'stunnel'],
    defaultPrompt: 'Диагностика kimi-mcp-proxy: статус сервиса, последние 50 строк journalctl -u kimi-mcp-proxy, какие MCP клиенты подключены, время отклика /health. Где медленно — патч.' },
  { id: 'kuvald',   idx: '08', name: 'Кувалд',    role: 'сборки · деплои · CI',             domain: 'Деплой',       traits: ['docker', 'make', 'systemd-run', 'git'],
    defaultPrompt: 'Пересобери ai-chat-ui (npm run build в /opt/ai-chat-ui), безопасно перезапусти ai-chat-ui.service через systemd-run --on-active=3s. Проверь что после рестарта сервис active и /health отвечает.' },
  { id: 'okular',   idx: '09', name: 'Окуляр',    role: 'uptime · метрики · алерты',        domain: 'Мониторинг',   traits: ['uptime', 'vmstat', 'iostat', 'loadavg'],
    defaultPrompt: 'Соберу health-отчёт VPS: uptime + loadavg, free -h, df -h, top-10 процессов по %CPU и %MEM, iostat -xz 1 3, vmstat 1 3. Скажи где упирается.' },
  { id: 'maestro',  idx: '10', name: 'Маэстро',   role: 'оркестратор · root · координация', domain: 'Оркестрация',  traits: ['root', 'delegate', 'parallel', 'merge'],
    defaultPrompt: 'Сделай полный аудит VPS параллельно через ≥5 саб-агентов: services, security, web, data, logs, network, deploy, monitoring. Раздели через POST /automations/delegate с parentSessionId=$KP_SESSION_ID и собери в единый отчёт.' },
]

/** Backwards-compatible — старый код всё ещё может импортить ROSTER, но
    теперь это просто identity без runtime stats. */
export const ROSTER = ROSTER_IDENTITY

export interface Connection {
  from: MascotId
  to: MascotId
  state: 'active' | 'done'
}

/** @deprecated — оставлено для обратной совместимости. В UI используй
    buildConnectionsFromSessions(). */
export const CONNECTIONS: Connection[] = []

// ─── individual mascots ──────────────────────────────────────────────────────
// BG — внутренний фон лица (тёмный фон карточки)
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

/** Универсальный рендерер маскота по id. */
export function Mascot({ id, size = 64, live = false }: { id: MascotId; size?: number; live?: boolean }) {
  const Cmp = REGISTRY[id]
  if (!Cmp) return null
  return <Cmp size={size} live={live} />
}

/** Эвристика: подобрать маскот по тексту названия сессии/задачи.
    Порядок проверок — от самых специфичных к общим, чтобы Security всегда
    ловила Шилд, а не Логан (хотя оба про auth.log). */
export function guessMascot(text: string): MascotId {
  const s = (text || '').toLowerCase()

  // Security — Шилд: SSH, fail2ban, файервол, auth.log scan, brute force, secrets
  if (/(ssh\b|sshd|fail2ban|iptables|firewall|ufw|nftables|whitelist|brute|harden|security|безопасн|sudoers|permitroot|passwordauth)/i.test(s)) return 'shild'

  // Web — Кэдди: Caddy, nginx, TLS, vhost, web stack
  if (/(caddy|nginx|tls|ssl|https?\b|vhost|reverse[\s-]?proxy|let'?s.?encrypt|certbot|веб|web|http\/2)/i.test(s)) return 'keddi'

  // Data — Хранитель: БД, бэкапы
  if (/(postgres|psql|redis|mysql|mongo|sqlite|backup|снапшот|snapshot|pg_dump|pg_restore|\bwal\b|dump|данные|datab)/i.test(s)) return 'hranitel'

  // Logs — Логан: журналы, grep
  if (/(\blog\b|log\.|журнал|grep|awk|jq|loki|auth\.log|syslog|messages)/i.test(s)) return 'logan'

  // Network — Сигнал: DNS, curl, ping, mtr
  if (/(\bdns\b|\bdig\b|\bping\b|curl|wget|mtr\b|tcpdump|traceroute|resolv|nslookup|сеть|network|сетев|резолв)/i.test(s)) return 'signal'

  // Integrations / MCP — Мостик: туннели, proxy, stack-wide
  if (/(\bmcp\b|tunnel|туннель|wireguard|stunnel|bridge|мост|интеграц|playwright|hermes|kimi-mcp|kimi-proxy|kimi.proxy)/i.test(s)) return 'mostik'

  // Deploy / CI — Кувалд: сборки, файлы кода, docker
  if (/(deploy|build|docker|make|rebuild|git\b|push|сборк|деплой|компил|\.css|\.js\b|\.html|\.md\b|app[-\.]?js|styles[-\.]?css|hero[-\.]?html|footer[-\.]?html|features[-\.]?html|readme[-\.]?md)/i.test(s)) return 'kuvald'

  // Monitoring — Окуляр: uptime, метрики, ресурсы, диск/память
  if (/(uptime|metric|метрик|vmstat|iostat|loadavg|monitor|мониторинг|здоров|health|disk|memory|диск|память|\bcpu\b|\bram\b|\bvps\b\s*health)/i.test(s)) return 'okular'

  // Orchestration / audit — Маэстро: root, audit, delegation
  if (/(orchestr|оркестратор|\broot\b|delegate|parallel|audit|аудит|sub[-\s]?agent|саб[-\s]?агент|coordin|корень|main)/i.test(s)) return 'maestro'

  // Services / systemd — Систо: сервисы, контейнеры, юниты
  if (/(systemd|systemctl|journalctl|сервис|service\b|unit\b|container|контейнер|таймер|timer\b|process|процесс)/i.test(s)) return 'sisto'

  return 'maestro' // fallback — общий оркестратор/чат
}

// ─── live state computation from real server sessions ────────────────────

/** Минимальный shape серверной сессии нужный нам — компат с AgentSession. */
export interface ServerSessionLike {
  id: string
  name: string
  turns: number
  lastUsedAt: number
  lastPrompt?: string
  parentSessionId?: string | null
}

/** Возраст в мс с последнего использования. */
function ageMs(s: ServerSessionLike): number {
  return Date.now() - (s.lastUsedAt || 0)
}

/** Активна ли сессия прямо сейчас (последняя активность < 90с). */
function isLiveSession(s: ServerSessionLike): boolean {
  return ageMs(s) < 90_000 && s.turns > 0
}

/** Человеко-читаемый runtime. */
function formatRuntime(ms: number): string {
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}с назад`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}м назад`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}ч назад`
  return `${Math.floor(h / 24)}д назад`
}

/**
 * Собрать live-ростер маскотов из реальных сессий.
 * Каждая сессия маппится на маскота через guessMascot(name+prompt), и для
 * каждого маскота берём:
 *   • status — active если есть свежая (<90с) сессия с turns>0, ready если
 *     была недавняя сессия, idle если вообще нет
 *   • turns — сумма turns всех сессий этого маскота
 *   • lastTask — name самой свежей сессии
 *   • runtime — formatRuntime от lastUsedAt самой свежей сессии
 *   • sessionId — id самой свежей сессии (для прямого открытия)
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
        statusLabel: 'ждёт',
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
      statusLabel: live ? 'идёт' : 'готов',
      lastTask: latest.name.length > 80 ? latest.name.slice(0, 80) + '…' : latest.name,
      turns: totalTurns,
      runtime: formatRuntime(ageMs(latest)),
      sessionId: latest.id,
    }
  })
}

/**
 * Собрать живые дуги делегирования между маскотами из реальных
 * parent→child связей в сессиях.
 *   • если parent активен И child активен → state='active' (бегущая пунктирка)
 *   • если parent есть но никто из них не активен → state='done' (статика)
 *   • self-loops (parent и child мапятся на один маскот) — отбрасываем
 */
export function buildConnectionsFromSessions(sessions: ServerSessionLike[]): Connection[] {
  const byId = new Map(sessions.map((s) => [s.id, s]))
  const edges = new Map<string, Connection>() // ключ "from→to" для дедупа
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
    // active побеждает done
    if (!prev || (isActive && prev.state === 'done')) {
      edges.set(key, { from: fromM, to: toM, state: isActive ? 'active' : 'done' })
    }
  }
  return [...edges.values()]
}

/** Найти identity по id (для UI хелперов). */
export function findMascot(id: MascotId): MascotIdentity | undefined {
  return ROSTER_IDENTITY.find((m) => m.id === id)
}
