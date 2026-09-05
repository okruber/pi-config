import type { Theme } from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'
import { stripTerminalSequences, truncateToWidth } from '@earendil-works/pi-tui'
import { hexToFg, IMETO_COLORS, readThemeHex } from './imeto-style.ts'

export const BUILTIN_TOOL_NAMES = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'] as const
export type BuiltInToolName = (typeof BUILTIN_TOOL_NAMES)[number]
export type ToolVisualState = 'pending' | 'success' | 'error'
export type ToolSummary = { action: BuiltInToolName; subject: string }
export type PreviewSelection = { lines: string[]; omitted: number }

export const TOKEN_RATE_STATUS_KEY = 'imeto-token-rate'
export const TOKEN_CACHE_STATUS_KEY = 'imeto-cache-state'

const ANSI_CLOSE = '\x1b[22m\x1b[27m\x1b[39m\x1b[49m'
const ANSI_SGR_RE = /\x1b\[([0-9;]*)m/g
const ANSI_PREFIX_RE = /^((?:\x1b\[[0-?]*[ -/]*[@-~])*) /
const CHANGED_LINE_RE = /^[+-](?![+-])/

export function toolVisualState(isPartial: boolean, isError: boolean): ToolVisualState {
  if (isPartial) return 'pending'
  return isError ? 'error' : 'success'
}

export function toolStateSymbol(state: ToolVisualState): '◌' | '✓' | '×' {
  if (state === 'pending') return '◌'
  return state === 'success' ? '✓' : '×'
}

function normalizeSummaryText(value: string, fallback: string): string {
  const normalized = stripTerminalSequences(value)
    .replace(/\r\n|\r|\n/g, ' ↵ ')
    .replace(/\t/g, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/ +/g, ' ')
    .trim()
  return normalized || fallback
}

function stringArg(args: Record<string, unknown>, key: string, fallback: string): string {
  const value = args[key]
  return typeof value === 'string' && value.length > 0
    ? normalizeSummaryText(value, fallback)
    : fallback
}

export function summarizeToolCall(
  name: BuiltInToolName,
  args: Record<string, unknown>,
  _cwd: string,
): ToolSummary {
  if (name === 'bash') return { action: name, subject: stringArg(args, 'command', '…') }
  if (name === 'grep') {
    const pattern = stringArg(args, 'pattern', '')
    return { action: name, subject: `/${pattern}/ in ${stringArg(args, 'path', '.')}` }
  }
  if (name === 'find') {
    return { action: name, subject: `${stringArg(args, 'pattern', '…')} in ${stringArg(args, 'path', '.')}` }
  }
  if (name === 'ls') return { action: name, subject: stringArg(args, 'path', '.') }
  return { action: name, subject: stringArg(args, 'path', '…') }
}

export function fitAnsi(text: string, width: number): string {
  if (width <= 0) return ''
  return `${truncateToWidth(text, width, '')}${ANSI_CLOSE}`
}

export function stripBackgroundAnsi(text: string): string {
  return text.replace(ANSI_SGR_RE, (sequence, rawParameters: string) => {
    const parameters = rawParameters === ''
      ? [0]
      : rawParameters.split(';').map((value) => Number.parseInt(value, 10))
    const kept: number[] = []
    for (let index = 0; index < parameters.length; index++) {
      const code = parameters[index]!
      if (code === 48) {
        const mode = parameters[index + 1]
        if (mode === 2) index += 4
        else if (mode === 5) index += 2
        continue
      }
      if ((code >= 40 && code <= 49) || (code >= 100 && code <= 107)) continue
      kept.push(code)
    }
    return kept.length > 0 ? `\x1b[${kept.join(';')}m` : ''
  })
}

function isChangedLine(line: string): boolean {
  return CHANGED_LINE_RE.test(stripTerminalSequences(line))
}

export function selectPreviewLines(
  name: BuiltInToolName,
  lines: string[],
  expanded: boolean,
): PreviewSelection {
  if (expanded) return { lines: [...lines], omitted: 0 }
  if (name === 'bash') return { lines: lines.slice(-5), omitted: Math.max(0, lines.length - 5) }
  if (name === 'edit') {
    const selected: string[] = []
    let changed = 0
    for (const line of lines) {
      if (isChangedLine(line)) {
        if (changed === 6) break
        changed += 1
      }
      selected.push(line)
    }
    return { lines: selected, omitted: lines.length - selected.length }
  }
  const limit = name === 'write' ? 6 : 5
  return { lines: lines.slice(0, limit), omitted: Math.max(0, lines.length - limit) }
}

type ToolTheme = Pick<Theme, 'sourcePath' | 'fg' | 'bold'>

export type ToolLedgerInput = {
  name: BuiltInToolName
  args: Record<string, unknown>
  cwd: string
  expanded: boolean
  isPartial: boolean
  isError: boolean
  theme: ToolTheme
  expansionHint: string
  semanticBody?: Component
}

export type EdgeOutputInput = {
  name: BuiltInToolName
  inner?: Component
  expanded: boolean
  theme: ToolTheme
  expansionHint: string
  stripInnerBackground?: boolean
  dropInnerHeader?: boolean
  stripInnerLeftPadding?: boolean
}

type SemanticBodyOptions = {
  dropHeader: boolean
  stripBackground: boolean
  stripLeftPadding: boolean
}

function stateHex(state: ToolVisualState, sourcePath: string | undefined): string {
  const variable = state === 'pending' ? 'terracotta' : state === 'success' ? 'mossGreen' : 'oxblood'
  const fallback = state === 'pending'
    ? IMETO_COLORS.terracotta
    : state === 'success'
      ? IMETO_COLORS.mossGreen
      : IMETO_COLORS.oxblood
  return readThemeHex(sourcePath, [variable]) ?? fallback
}

function edgeHex(sourcePath: string | undefined): string {
  return readThemeHex(sourcePath, ['mauveTaupe']) ?? IMETO_COLORS.mauveTaupe
}

function isBlankAnsi(line: string): boolean {
  return stripTerminalSequences(line).trim().length === 0
}

function removeLeftPaddingCell(line: string): string {
  return line.replace(ANSI_PREFIX_RE, '$1')
}

function semanticBodyLines(lines: string[], options: SemanticBodyOptions): string[] {
  let body = options.stripBackground ? lines.map(stripBackgroundAnsi) : [...lines]
  while (body.length > 0 && isBlankAnsi(body[0]!)) body.shift()
  while (body.length > 0 && isBlankAnsi(body.at(-1)!)) body.pop()
  if (options.dropHeader && body.length > 0) {
    const separator = body.findIndex(isBlankAnsi)
    body = separator >= 0 ? body.slice(separator + 1) : body.slice(1)
  }
  while (body.length > 0 && isBlankAnsi(body[0]!)) body.shift()
  while (body.length > 0 && isBlankAnsi(body.at(-1)!)) body.pop()
  return options.stripLeftPadding ? body.map(removeLeftPaddingCell) : body
}

function edgeLine(line: string, width: number, sourcePath: string | undefined): string {
  const edge = `${hexToFg(edgeHex(sourcePath))}│\x1b[39m `
  return fitAnsi(`${edge}${line}`, width)
}

export class ToolLedgerComponent implements Component {
  private readonly input: ToolLedgerInput
  private cachedWidth: number | undefined
  private cachedLines: string[] | undefined

  constructor(input: ToolLedgerInput) {
    this.input = input
  }

  render(width: number): string[] {
    if (width <= 0) return []
    if (this.cachedWidth === width && this.cachedLines) return this.cachedLines

    const state = toolVisualState(this.input.isPartial, this.input.isError)
    const summary = summarizeToolCall(this.input.name, this.input.args, this.input.cwd)
    const symbol = `${hexToFg(stateHex(state, this.input.theme.sourcePath))}${toolStateSymbol(state)}\x1b[39m`
    const action = this.input.theme.fg('toolTitle', this.input.theme.bold(summary.action))
    const subject = this.input.theme.fg(this.input.name === 'bash' ? 'muted' : 'accent', summary.subject)
    const lines = [fitAnsi(`${symbol} ${action} ${subject}`, width)]

    if (this.input.semanticBody) {
      const innerWidth = Math.max(1, width - 2)
      const body = semanticBodyLines(this.input.semanticBody.render(innerWidth), {
        dropHeader: true,
        stripBackground: this.input.name === 'edit',
        stripLeftPadding: this.input.name === 'edit',
      })
      const selection = selectPreviewLines(this.input.name, body, this.input.expanded)
      lines.push(...selection.lines.map((line) => edgeLine(line, width, this.input.theme.sourcePath)))
      if (selection.omitted > 0) {
        lines.push(edgeLine(
          this.input.theme.fg('muted', this.input.expansionHint),
          width,
          this.input.theme.sourcePath,
        ))
      }
    }

    this.cachedWidth = width
    this.cachedLines = lines
    return lines
  }

  invalidate(): void {
    this.cachedWidth = undefined
    this.cachedLines = undefined
    this.input.semanticBody?.invalidate()
  }
}

export class EdgeOutputComponent implements Component {
  private readonly input: EdgeOutputInput
  private cachedWidth: number | undefined
  private cachedLines: string[] | undefined

  constructor(input: EdgeOutputInput) {
    this.input = input
  }

  render(width: number): string[] {
    if (width <= 0 || !this.input.inner) return []
    if (this.cachedWidth === width && this.cachedLines) return this.cachedLines

    const innerWidth = Math.max(1, width - 2)
    const body = semanticBodyLines(this.input.inner.render(innerWidth), {
      dropHeader: this.input.dropInnerHeader ?? false,
      stripBackground: this.input.stripInnerBackground ?? false,
      stripLeftPadding: this.input.stripInnerLeftPadding ?? false,
    })
    const selection = selectPreviewLines(this.input.name, body, this.input.expanded)
    const lines = selection.lines.map((line) => edgeLine(line, width, this.input.theme.sourcePath))
    if (selection.omitted > 0) {
      lines.push(edgeLine(
        this.input.theme.fg('muted', this.input.expansionHint),
        width,
        this.input.theme.sourcePath,
      ))
    }

    this.cachedWidth = width
    this.cachedLines = lines
    return lines
  }

  invalidate(): void {
    this.cachedWidth = undefined
    this.cachedLines = undefined
    this.input.inner?.invalidate()
  }
}
