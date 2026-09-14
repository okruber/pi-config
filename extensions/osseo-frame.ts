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

const FRAME_FILL_SLOT: Record<FrameState, 'toolPendingBg' | 'toolSuccessBg' | 'toolErrorBg'> = {
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

export type ThemeSlice = Pick<Theme, 'sourcePath' | 'fg' | 'bold' | 'getBgAnsi'>

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
  const fillAnsi = theme.getBgAnsi(FRAME_FILL_SLOT[state])
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

export function statusHeader(
  options: { state: FrameState; title: string; subject?: string; meta?: readonly string[] },
  colors: FrameColors,
): string {
  let line = `${colors.symbol(STATE_SYMBOL[options.state])} ${colors.title(options.title)}`
  if (options.subject) line += `: ${colors.subject(options.subject)}`
  const meta = (options.meta ?? []).filter((item) => item.length > 0)
  if (meta.length > 0) line += colors.meta(` · ${meta.join(' · ')}`)
  return line
}

export function normalizeInline(value: string, fallback = '…'): string {
  const normalized = stripTerminalSequences(value)
    .replace(/\r\n|\r|\n/g, ' ↵ ')
    .replace(/\t/g, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/ +/g, ' ')
    .trim()
  return normalized || fallback
}

export function expandHint(colors: FrameColors): string {
  return `${colors.meta('(')}${keyHint('app.tools.expand', 'to expand')}${colors.meta(')')}`
}

function plural(unit: string, count: number): string {
  if (count === 1) return unit
  if (/[^aeiou]y$/.test(unit)) return `${unit.slice(0, -1)}ies`
  if (/(?:ch|sh|s|x|z)$/.test(unit)) return `${unit}es`
  return `${unit}s`
}

export function countUnit(count: number, unit: string): string {
  return `${count} ${plural(unit, count)}`
}

export function moreLine(count: number, unit: string, colors: FrameColors): string {
  return `${colors.meta(`… ${count} more ${plural(unit, count)} `)}${expandHint(colors)}`
}

export function treeList(
  items: readonly string[],
  options: { expanded: boolean; maxCollapsed: number; unit: string },
  colors: FrameColors,
): string[] {
  const shown = options.expanded ? items : items.slice(0, options.maxCollapsed)
  const truncated = !options.expanded && items.length > shown.length
  const rows = shown.map((item, index) => {
    const last = index === shown.length - 1 && !truncated
    return `${colors.meta(last ? '└─' : '├─')} ${item}`
  })
  if (truncated) rows.push(moreLine(items.length - shown.length, options.unit, colors))
  return rows
}

export function tailWindow(styledText: string, maxLines: number, width: number, colors: FrameColors): string[] {
  const result = truncateToVisualLines(styledText, maxLines, width)
  if (result.skippedCount <= 0) return result.visualLines
  return [
    `${colors.meta(`… (${result.skippedCount} earlier lines, `)}${keyHint('app.tools.expand', 'to expand')}${colors.meta(')')}`,
    ...result.visualLines,
  ]
}

export function stripNoticeFooter(text: string): { body: string; notice?: string } {
  const trimmed = text.trimEnd()
  if (!trimmed.endsWith(']')) return { body: trimmed, notice: undefined }
  const start = trimmed.lastIndexOf('\n\n[')
  if (start === -1) return { body: trimmed, notice: undefined }
  return { body: trimmed.slice(0, start), notice: trimmed.slice(start + 2) }
}

export function resultText(result: { content?: Array<{ type?: string; text?: unknown }> } | undefined): string {
  if (!result?.content) return ''
  const parts: string[] = []
  for (const block of result.content) {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

export class MemoComponent implements Component {
  #key: string | undefined
  #lines: string[] | undefined
  readonly #frame: (width: number) => string[]
  readonly #deps: () => string

  constructor(frame: (width: number) => string[], deps: () => string) {
    this.#frame = frame
    this.#deps = deps
  }

  render(width: number): string[] {
    const key = `${width}|${this.#deps()}`
    if (key === this.#key && this.#lines !== undefined) return this.#lines
    this.#key = key
    this.#lines = this.#frame(width)
    return this.#lines
  }

  invalidate(): void {
    this.#key = undefined
    this.#lines = undefined
  }
}
