import type { Theme } from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'
import { stripTerminalSequences, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'
import { hexToFg, resolveThemeVar, type OsseoColorName } from './osseo-style.ts'

export const BUILTIN_TOOL_NAMES = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'] as const
export type BuiltInToolName = (typeof BUILTIN_TOOL_NAMES)[number]
export type ToolVisualState = 'pending' | 'success' | 'error'
export type ToolSummary = { action: BuiltInToolName; subject: string }

const ANSI_CLOSE = '\x1b[22m\x1b[27m\x1b[39m\x1b[49m'
const STATE_COLOR_VAR: Record<ToolVisualState, OsseoColorName> = {
  pending: 'terracotta',
  success: 'mossGreen',
  error: 'oxblood',
}

export type ToolTheme = Pick<Theme, 'sourcePath' | 'fg' | 'bold'>

export function toolVisualState(isPartial: boolean, isError: boolean): ToolVisualState {
  if (isPartial) return 'pending'
  return isError ? 'error' : 'success'
}

export function toolStateSymbol(state: ToolVisualState): '◌' | '✓' | '✗' {
  if (state === 'pending') return '◌'
  return state === 'success' ? '✓' : '✗'
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

export function summarizeToolCall(name: BuiltInToolName, args: Record<string, unknown>): ToolSummary {
  if (name === 'bash') return { action: name, subject: stringArg(args, 'command', '…') }
  if (name === 'grep') {
    return { action: name, subject: `/${stringArg(args, 'pattern', '')}/ in ${stringArg(args, 'path', '.')}` }
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

type LedgerInput = {
  name: BuiltInToolName
  args: Record<string, unknown>
  isPartial: boolean
  isError: boolean
  theme: ToolTheme
}

type EdgeInput = {
  inner?: Component
  expanded: boolean
  theme: ToolTheme
}

export class ToolLedgerComponent implements Component {
  private readonly input: LedgerInput
  private cachedWidth: number | undefined
  private cachedLine: string | undefined

  constructor(input: LedgerInput) {
    this.input = input
  }

  render(width: number): string[] {
    if (width <= 0) return []
    if (this.cachedWidth === width && this.cachedLine) return [this.cachedLine]

    const state = toolVisualState(this.input.isPartial, this.input.isError)
    const summary = summarizeToolCall(this.input.name, this.input.args)
    const symbol = `${hexToFg(resolveThemeVar(this.input.theme.sourcePath, STATE_COLOR_VAR[state]))}${toolStateSymbol(state)}\x1b[39m`
    const action = this.input.theme.fg('toolTitle', this.input.theme.bold(summary.action))
    const subject = this.input.theme.fg(this.input.name === 'bash' ? 'muted' : 'accent', summary.subject)
    this.cachedWidth = width
    this.cachedLine = fitAnsi(`${symbol} ${action} ${subject}`, width)
    return [this.cachedLine]
  }

  invalidate(): void {
    this.cachedWidth = undefined
    this.cachedLine = undefined
  }
}

export class EdgeOutputComponent implements Component {
  private readonly input: EdgeInput
  private cachedWidth: number | undefined
  private cachedLines: string[] | undefined

  constructor(input: EdgeInput) {
    this.input = input
  }

  render(width: number): string[] {
    if (width <= 0 || !this.input.inner) return []
    if (!this.input.expanded) return this.input.inner.render(width)
    if (this.cachedWidth === width && this.cachedLines) return this.cachedLines

    const innerWidth = Math.max(1, width - 2)
    const edge = `${hexToFg(resolveThemeVar(this.input.theme.sourcePath, 'mauveTaupe'))}│\x1b[39m `
    this.cachedWidth = width
    this.cachedLines = this.input.inner
      .render(innerWidth)
      .map((line) => fitAnsi(`${edge}${line}`, width))
    return this.cachedLines
  }

  invalidate(): void {
    this.cachedWidth = undefined
    this.cachedLines = undefined
    this.input.inner?.invalidate()
  }
}

export default function () {}
