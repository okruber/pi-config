import { keyHint, truncateToVisualLines, type Theme } from '@earendil-works/pi-coding-agent'
import {
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
} from '@earendil-works/pi-tui'
import { hexToBg, hexToFg, resolveThemeVar, type OsseoColorName } from './osseo-style.ts'

export type FrameState = 'pending' | 'success' | 'error'

const BOX = { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│', teeR: '├', teeL: '┤' } as const
const BAR_RUN = BOX.h.repeat(3)

const FRAME_LINE_VAR: Record<FrameState, OsseoColorName> = {
  pending: 'framePendingLine',
  success: 'frameLine',
  error: 'frameErrorLine',
}

const FRAME_FILL_VAR: Record<FrameState, OsseoColorName> = {
  pending: 'toolPendingBg',
  success: 'toolSuccessBg',
  error: 'toolErrorBg',
}

const STATE_SYMBOL_VAR: Record<FrameState, OsseoColorName> = {
  pending: 'signalOrange',
  success: 'signalGreen',
  error: 'signalRed',
}

export const STATE_SYMBOL: Record<FrameState, '◌' | '✓' | '✗'> = {
  pending: '◌',
  success: '✓',
  error: '✗',
}

export type ThemeSlice = Pick<Theme, 'sourcePath' | 'fg' | 'bold'>

export type FrameColors = {
  line: (text: string) => string
  fill: (text: string) => string
  symbol: (text: string) => string
  title: (text: string) => string
  subject: (text: string) => string
  meta: (text: string) => string
  body: (text: string) => string
  errorText: (text: string) => string
  added: (text: string) => string
  removed: (text: string) => string
  warning: (text: string) => string
}

export function resolveFrameColors(theme: ThemeSlice, state: FrameState): FrameColors {
  const sourcePath = theme.sourcePath
  const fillAnsi = hexToBg(resolveThemeVar(sourcePath, FRAME_FILL_VAR[state]))
  return {
    line: (text) => `${hexToFg(resolveThemeVar(sourcePath, FRAME_LINE_VAR[state]))}${text}\x1b[39m`,
    fill: (text) => {
      const stabilized = text
        .replace(/\x1b\[(?:0)?m/g, (match) => `${match}${fillAnsi}`)
        .replace(/\x1b\[49m/g, (match) => `${match}${fillAnsi}`)
      return `${fillAnsi}${stabilized}\x1b[49m`
    },
    symbol: (text) => `${hexToFg(resolveThemeVar(sourcePath, STATE_SYMBOL_VAR[state]))}${text}\x1b[39m`,
    title: (text) => theme.fg('toolTitle', theme.bold(text)),
    subject: (text) => theme.fg('muted', text),
    meta: (text) => theme.fg('dim', text),
    body: (text) => theme.fg('toolOutput', text),
    errorText: (text) => theme.fg('error', text),
    added: (text) => theme.fg('toolDiffAdded', text),
    removed: (text) => theme.fg('toolDiffRemoved', text),
    warning: (text) => theme.fg('warning', text),
  }
}

export type FrameSection = { label?: string; lines: readonly string[] }

export type FrameOptions = {
  header?: string
  state: FrameState
  sections?: readonly FrameSection[]
  width: number
}

function bar(
  leftGlyph: string,
  rightGlyph: string,
  label: string | undefined,
  width: number,
  colors: FrameColors,
): string {
  const left = `${leftGlyph}${BAR_RUN}`
  const budget = Math.max(0, width - visibleWidth(left) - visibleWidth(rightGlyph))
  if (!label) {
    return colors.line(`${left}${BOX.h.repeat(budget)}${rightGlyph}`)
  }
  const trimmed = truncateToWidth(` ${label} `, budget, '')
  const fill = BOX.h.repeat(Math.max(0, budget - visibleWidth(trimmed)))
  return `${colors.line(left)}${trimmed}${colors.line(`${fill}${rightGlyph}`)}`
}

export function renderFrame(options: FrameOptions, colors: FrameColors): string[] {
  const { header, width } = options
  if (width <= 0) return []
  const contentWidth = Math.max(1, width - 4)
  const rows: string[] = [bar(BOX.tl, BOX.tr, header, width, colors)]
  for (const [index, section] of (options.sections ?? []).entries()) {
    if (section.label || index > 0) {
      rows.push(bar(BOX.teeR, BOX.teeL, section.label, width, colors))
    }
    for (const line of section.lines) {
      const trimmed = line.trimEnd()
      const wrapped = trimmed === '' ? [''] : wrapTextWithAnsi(trimmed, contentWidth)
      for (const row of wrapped) {
        const padded = `${row}${' '.repeat(Math.max(0, contentWidth - visibleWidth(row)))}`
        rows.push(`${colors.line(BOX.v)} ${padded} ${colors.line(BOX.v)}`)
      }
    }
  }
  rows.push(bar(BOX.bl, BOX.br, undefined, width, colors))
  return rows.map((row) => colors.fill(truncateToWidth(row, width, '', true)))
}
