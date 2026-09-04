import { hexToFg, IMETO_COLORS, readThemeHex } from './imeto-style.ts'

export type StatusRole = 'identity' | 'model' | 'reasoning' | 'path' | 'context' | 'muted' | 'danger'
export type StatusWidths = { left: number; right: number; gap: number }

const STATUS_HEX: Record<StatusRole, string> = {
  identity: IMETO_COLORS.oxblood, model: IMETO_COLORS.dustyBlue, reasoning: IMETO_COLORS.mossGreen,
  path: IMETO_COLORS.terracotta, context: IMETO_COLORS.mauveTaupe, muted: IMETO_COLORS.sageGrey,
  danger: IMETO_COLORS.oxblood,
}
const STATUS_VAR: Record<StatusRole, string> = {
  identity: 'oxblood', model: 'dustyBlue', reasoning: 'mossGreen', path: 'terracotta',
  context: 'mauveTaupe', muted: 'sageGrey', danger: 'oxblood',
}

export function statusHex(role: StatusRole, sourcePath?: string): string {
  return readThemeHex(sourcePath, [STATUS_VAR[role]]) ?? STATUS_HEX[role]
}

export function statusText(role: StatusRole, text: string, bold = true, sourcePath?: string): string {
  return `${hexToFg(statusHex(role, sourcePath))}${bold ? '\x1b[1m' : ''}${text}${bold ? '\x1b[22m' : ''}\x1b[39m`
}

export function contextRole(percent: number | null): StatusRole {
  if (percent === null) return 'muted'
  if (percent >= 90) return 'danger'
  if (percent >= 70) return 'path'
  return 'context'
}

export function fitStatusWidths(leftWidth: number, rightWidth: number, width: number): StatusWidths {
  let left = Math.max(0, leftWidth)
  let right = Math.max(0, rightWidth)
  const minimumGap = right > 0 ? 3 : 0
  let overflow = Math.max(0, left + right + minimumGap - Math.max(0, width))
  const trimRight = Math.min(right, overflow)
  right -= trimRight
  overflow -= trimRight
  left = Math.max(0, left - overflow)
  return { left, right, gap: Math.max(0, width - left - right) }
}
