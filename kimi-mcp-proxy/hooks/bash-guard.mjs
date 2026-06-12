import fs from 'node:fs'

let raw = ''
try { raw = fs.readFileSync(0, 'utf8') } catch { /* no stdin */ }
let inp = {}
try { inp = JSON.parse(raw) } catch { /* not json */ }

const cmd = String(inp?.tool_input?.command || '')

// Fail-closed blocklist: catastrophic / system-destructive / platform-self-harm.
const DANGER = [
  /\brm\s+(?:-\S+\s+)*-\S*[rf]\S*\s+(?:-\S+\s+)*(?:\/|\/\*|~|\/etc|\/usr|\/var|\/boot|\/lib\b|\/bin\b|\/sbin\b)(?:\s|\/|$|\*)/,
  /\brm\s+-\S*[rf]\S*\s+\/opt\/(?:kimi-mcp-proxy|ai-chat-ui)/,
  /\bmkfs\b/,
  /\bdd\b[^\n]*\bof=\/dev\/(?:sd|nvme|vd|xvd)/,
  /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:/,            // fork bomb
  /\b(?:shutdown|reboot|halt|poweroff)\b/,
  /\binit\s+[06]\b/,
  /\bchmod\s+-R\s+0?777\s+\//,
  />\s*\/dev\/(?:sd|nvme|vd|xvd)[a-z]/,
  /\bsystemctl\s+(?:stop|disable|mask)\s+(?:kimi-mcp-proxy|ai-chat-ui|caddy)/,
  /\b(?:mv|cp)\s+\/\s+/,
  /\b>\s*\/etc\/(?:passwd|shadow|sudoers)/,
]

for (const re of DANGER) {
  if (re.test(cmd)) {
    process.stderr.write(
      'BLOCKED by bash-guard: команда выглядит деструктивной/системной и заблокирована политикой безопасности платформы. '
      + 'Если действие легитимно — попроси оператора выполнить его вручную.\n'
    )
    process.exit(2) // exit 2 = PreToolUse deny; stderr is fed back to the model
  }
}
process.exit(0)
