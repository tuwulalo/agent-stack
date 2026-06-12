/**
 * Pool of subagent personas — each delegate-task subagent gets a stable
 * name + colour variant by index. Colours map to existing tailwind ring/glow
 * classes so the rest of the UI keeps working. The mascot SVG accepts
 * (bodyFrom, bodyTo, visor) hex values for distinct silhouettes.
 */

export interface Persona {
  name: string
  /** mascot helmet gradient stops */
  bodyFrom: string
  bodyTo: string
  /** visor scan colour (RGB hex, no alpha) */
  visor: string
  /** tailwind classes for ring / glow / label / accent gradient */
  ringClass: string
  glowClass: string
  labelClass: string
  accentClass: string
  /** css var hex for the bullet dot in the modal header */
  dotColor: string
}

export const PERSONAS: Persona[] = [
  {
    name: 'Socrates',
    bodyFrom: '#67e8f9', bodyTo: '#0e7490', visor: '#67e8f9',
    ringClass: 'ring-cyan-400/40',     glowClass: 'shadow-cyan-500/20',
    labelClass: 'text-cyan-200/85',    accentClass: 'from-cyan-500/15',
    dotColor: '#67e8f9',
  },
  {
    name: 'Plato',
    bodyFrom: '#f0abfc', bodyTo: '#86198f', visor: '#f0abfc',
    ringClass: 'ring-fuchsia-400/40',  glowClass: 'shadow-fuchsia-500/20',
    labelClass: 'text-fuchsia-200/85', accentClass: 'from-fuchsia-500/15',
    dotColor: '#f0abfc',
  },
  {
    name: 'Hypatia',
    bodyFrom: '#6ee7b7', bodyTo: '#065f46', visor: '#6ee7b7',
    ringClass: 'ring-emerald-400/40', glowClass: 'shadow-emerald-500/20',
    labelClass: 'text-emerald-200/85', accentClass: 'from-emerald-500/15',
    dotColor: '#6ee7b7',
  },
  {
    name: 'Echo',
    bodyFrom: '#fcd34d', bodyTo: '#92400e', visor: '#fcd34d',
    ringClass: 'ring-amber-400/40',   glowClass: 'shadow-amber-500/20',
    labelClass: 'text-amber-200/85',  accentClass: 'from-amber-500/15',
    dotColor: '#fcd34d',
  },
  {
    name: 'Phoenix',
    bodyFrom: '#a78bfa', bodyTo: '#5b21b6', visor: '#a78bfa',
    ringClass: 'ring-violet-400/40',  glowClass: 'shadow-violet-500/20',
    labelClass: 'text-violet-200/85', accentClass: 'from-violet-500/15',
    dotColor: '#a78bfa',
  },
  {
    name: 'Atlas',
    bodyFrom: '#fda4af', bodyTo: '#9f1239', visor: '#fda4af',
    ringClass: 'ring-rose-400/40',    glowClass: 'shadow-rose-500/20',
    labelClass: 'text-rose-200/85',   accentClass: 'from-rose-500/15',
    dotColor: '#fda4af',
  },
  {
    name: 'Orion',
    bodyFrom: '#7dd3fc', bodyTo: '#0c4a6e', visor: '#7dd3fc',
    ringClass: 'ring-sky-400/40',     glowClass: 'shadow-sky-500/20',
    labelClass: 'text-sky-200/85',    accentClass: 'from-sky-500/15',
    dotColor: '#7dd3fc',
  },
  {
    name: 'Lyra',
    bodyFrom: '#5eead4', bodyTo: '#115e59', visor: '#5eead4',
    ringClass: 'ring-teal-400/40',    glowClass: 'shadow-teal-500/20',
    labelClass: 'text-teal-200/85',   accentClass: 'from-teal-500/15',
    dotColor: '#5eead4',
  },
]

export function pickPersona(index: number): Persona {
  if (!Number.isFinite(index) || index < 0) return PERSONAS[0]
  return PERSONAS[index % PERSONAS.length]
}
