import type { Theme } from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'
import { stripTerminalSequences, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'
import { hexToBg, hexToFg, resolveThemeVar, type OsseoColorName } from './osseo-style.ts'

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

export const TOOL_ACCENTS: Record<BuiltInToolName, string> = {
  read: '#2072B2',
  ls: '#2072B2',
  bash: '#B85E14',
  edit: '#8A6D00',
  write: '#0B8C50',
  grep: '#B4423C',
  find: '#B4423C',
}

// omp rule: 3 lines collapsed. Live-tail scans only the trailing bytes so
// per-tick cost stays bounded by the cap regardless of total output size.
const DETAIL_TAIL_LINES = 3
const TAIL_SCAN_BYTES = 2048
const MIN_FRAME_WIDTH = 12

export type ToolTheme = Pick<Theme, 'sourcePath' | 'fg' | 'bold'>

export type ToolResultContent = {
  content?: Array<{ type?: string; text?: unknown }>
  details?: Record<string, unknown>
}

export type DetailInput = {
  name: BuiltInToolName
  args: Record<string, unknown>
  result: ToolResultContent | undefined
  isPartial: boolean
  isError: boolean
  elapsedMs: number | undefined
  sourcePath: string | undefined
}

export type PendingDetailSource = {
  isSettled: () => boolean
  snapshot: () => DetailInput
}

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

function accentLine(hex: string, text: string): string {
  return `${hexToFg(hex)}${text}\x1b[39m`
}

function hintLine(text: string, sourcePath: string | undefined): string {
  return `${hexToFg(resolveThemeVar(sourcePath, 'mauveTaupe'))}${text}\x1b[39m`
}

function resultText(result: ToolResultContent | undefined): string {
  if (!result?.content) return ''
  const parts: string[] = []
  for (const block of result.content) {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

function resultDiff(result: ToolResultContent | undefined): string | undefined {
  const diff = result?.details?.diff
  return typeof diff === 'string' && diff.length > 0 ? diff : undefined
}

function splitBodyLines(output: string): string[] {
  const lines = output.split('\n')
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

function countTail(output: string, count: number): { lines: string[]; total: number } {
  const sliced = output.length > TAIL_SCAN_BYTES
  const text = sliced ? output.slice(-TAIL_SCAN_BYTES) : output
  const lines = text.split('\n')
  if (sliced && lines.length > 0) lines.shift()
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  let total = 0
  for (let i = 0; i < output.length; i++) {
    if (output.charCodeAt(i) === 10) total++
  }
  if (output.length > 0 && output.charCodeAt(output.length - 1) !== 10) total++
  return { lines: lines.slice(-count), total }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

function writeSizeLine(args: Record<string, unknown>, accent: string): string {
  const content = typeof args.content === 'string' ? args.content : ''
  const bytes = Buffer.byteLength(content)
  const lines = content.split('\n').length
  return `${accentLine(accent, formatBytes(bytes))} · ${accentLine(accent, `${lines} ${lines === 1 ? 'line' : 'lines'}`)}`
}

function readDetail(args: Record<string, unknown>, output: string): string[] {
  const lineCount = splitBodyLines(output).length
  const start = typeof args.offset === 'number' ? args.offset : 1
  const end =
    typeof args.limit === 'number' ? start + args.limit - 1 : start + Math.max(lineCount, 1) - 1
  return [`${accentLine(TOOL_ACCENTS.read, `${lineCount} lines`)} · L${start}–${end}`]
}

function grepDetail(output: string, sourcePath: string | undefined): string[] {
  const locations: string[] = []
  for (const line of splitBodyLines(output)) {
    const match = /^([^:\n]+):(\d+):/.exec(line)
    if (match) locations.push(`${match[1]}:${match[2]}`)
  }
  if (locations.length === 0) return [accentLine(TOOL_ACCENTS.grep, 'no matches')]
  const shown = locations.slice(0, 3)
  const first = `${accentLine(TOOL_ACCENTS.grep, `${locations.length} matches`)} · first: ${shown[0]}`
  if (shown.length === 1) return [first]
  let rest = shown.slice(1).join(' · ')
  if (locations.length > 3) rest += ` ${hintLine(`… +${locations.length - 3} file`, sourcePath)}`
  return [first, rest]
}

function findDetail(output: string, sourcePath: string | undefined): string[] {
  const files = splitBodyLines(output)
  const shown = files.slice(0, 3)
  let line = `${accentLine(TOOL_ACCENTS.find, `${files.length} files`)}`
  if (shown.length > 0) line += ` · ${shown.join(' · ')}`
  if (files.length > 3) line += ` ${hintLine(`… +${files.length - 3} more`, sourcePath)}`
  return [line]
}

function lsDetail(output: string): string[] {
  const entries = splitBodyLines(output)
  const dirs = entries.filter((entry) => entry.endsWith('/')).length
  return [`${accentLine(TOOL_ACCENTS.ls, `${entries.length} entries`)} · ${dirs} dirs`]
}

function bashDetail(input: DetailInput, output: string): string[] {
  if (input.isPartial) {
    const elapsed = input.elapsedMs !== undefined ? ` · ${(input.elapsedMs / 1000).toFixed(1)} s` : ''
    const { lines } = countTail(output, DETAIL_TAIL_LINES)
    return [accentLine(TOOL_ACCENTS.bash, `running${elapsed}`), ...lines]
  }
  const { lines, total } = countTail(output, DETAIL_TAIL_LINES)
  if (lines.length === 0) return [accentLine(TOOL_ACCENTS.bash, 'no output')]
  const detail = [...lines]
  if (total > lines.length) {
    detail.push(hintLine(`… +${total - lines.length} more`, input.sourcePath))
  }
  return detail
}

function editDetail(input: DetailInput, output: string): string[] {
  const diff = resultDiff(input.result)
  if (diff === undefined) {
    const lines = splitBodyLines(output).slice(0, 3)
    return lines.length > 0 ? lines : []
  }
  const changes: Array<{ sign: '-' | '+'; text: string }> = []
  for (const line of diff.split('\n')) {
    const match = /^([+-]) *\d+ (.*)$/.exec(line)
    if (match) changes.push({ sign: match[1] as '-' | '+', text: match[2] ?? '' })
  }
  if (changes.length === 0) return []
  const rows = changes.slice(0, 3).map((change) => {
    const color = change.sign === '-' ? 'oxblood' : 'mossGreen'
    const prefix = change.sign === '-' ? '−' : '+'
    return `${hexToFg(resolveThemeVar(input.sourcePath, color))}${prefix} ${change.text}\x1b[39m`
  })
  if (changes.length > 3) rows.push(hintLine(`… +${changes.length - 3} more changes`, input.sourcePath))
  return rows
}

function errorDetail(output: string, sourcePath: string | undefined): string[] {
  const all = splitBodyLines(output)
  if (all.length === 0) return [hintLine('failed', sourcePath)]
  const hasStatus = /^Command (exited with code \d+|aborted|timed out after \d+ seconds)$/.test(
    all[all.length - 1]!,
  )
  const body = hasStatus ? all.slice(0, -1) : all
  const statusLine = hasStatus ? all[all.length - 1] : undefined
  const bodyTail = body.slice(-2)
  const rows = [...bodyTail]
  if (body.length > bodyTail.length) {
    rows.push(hintLine(`… +${body.length - bodyTail.length} more`, sourcePath))
  }
  if (statusLine !== undefined) rows.push(statusLine)
  return rows.length > 0 ? rows : [hintLine('failed', sourcePath)]
}

function pendingDetail(input: DetailInput): string[] {
  const { name, args, elapsedMs } = input
  const accent = TOOL_ACCENTS[name]
  if (name === 'bash') {
    const elapsed = elapsedMs !== undefined ? ` · ${(elapsedMs / 1000).toFixed(1)} s` : ''
    return [accentLine(accent, `running${elapsed}`)]
  }
  if (name === 'edit') {
    const edits = Array.isArray(args.edits) ? args.edits.length : 1
    return [accentLine(accent, `${edits} edit${edits === 1 ? '' : 's'} pending`)]
  }
  if (name === 'write') return [writeSizeLine(args, accent)]
  if (name === 'read') {
    const start = typeof args.offset === 'number' ? args.offset : 1
    const end = typeof args.limit === 'number' ? start + args.limit - 1 : '…'
    return [accentLine(accent, `reading · L${start}–${end}`)]
  }
  if (name === 'grep' || name === 'find') {
    return [accentLine(accent, `searching · ${stringArg(args, 'path', '.')}`)]
  }
  return [accentLine(accent, `listing · ${stringArg(args, 'path', '.')}`)]
}

export function buildToolDetail(input: DetailInput): string[] {
  const output = resultText(input.result)
  if (input.isError) return errorDetail(output, input.sourcePath)
  if (!input.result) return pendingDetail(input)
  switch (input.name) {
    case 'bash':
      return bashDetail(input, output)
    case 'edit':
      return editDetail(input, output)
    case 'read':
      return readDetail(input.args, output)
    case 'write':
      return [writeSizeLine(input.args, TOOL_ACCENTS.write)]
    case 'grep':
      return grepDetail(output, input.sourcePath)
    case 'find':
      return findDetail(output, input.sourcePath)
    case 'ls':
      return lsDetail(output)
  }
}

export function frameDetail(
  detail: string[],
  state: ToolVisualState,
  sourcePath: string | undefined,
  width: number,
): string[] {
  if (detail.length === 0 || width < MIN_FRAME_WIDTH) return []
  const contentWidth = width - 4
  const innerWidth = contentWidth - 2
  const borderColor = resolveThemeVar(
    sourcePath,
    state === 'pending' ? 'framePendingLine' : state === 'error' ? 'frameErrorLine' : 'frameLine',
  )
  const fillColor = resolveThemeVar(
    sourcePath,
    state === 'pending' ? 'framePendingFill' : state === 'error' ? 'frameErrorFill' : 'cloudPetal',
  )
  const barColor = resolveThemeVar(sourcePath, STATE_COLOR_VAR[state])
  const border = hexToFg(borderColor)
  const fill = hexToBg(fillColor)
  const rail = `${border}│${ANSI_CLOSE}`
  const top = `  ${border}╭${'─'.repeat(contentWidth)}╮${ANSI_CLOSE}`
  const bottom = `  ${border}╰${'─'.repeat(contentWidth)}╯${ANSI_CLOSE}`
  const rows = detail.map((line) => {
    const content = fitAnsi(line, innerWidth)
    const pad = innerWidth - visibleWidth(content)
    return (
      `  ${hexToFg(barColor)}▌${ANSI_CLOSE}` +
      `${fill} ${content}${ANSI_CLOSE}` +
      `${fill}${' '.repeat(Math.max(0, pad))}${ANSI_CLOSE}` +
      rail
    )
  })
  return [top, ...rows, bottom]
}

function argsKey(name: BuiltInToolName, args: Record<string, unknown>): string {
  const copy: Record<string, unknown> = { ...args }
  if (typeof copy.content === 'string') copy.content = copy.content.length
  return JSON.stringify([name, copy])
}

function detailKey(input: DetailInput): string {
  const output = resultText(input.result)
  return JSON.stringify([
    input.name,
    input.isPartial,
    input.isError,
    output.length,
    resultDiff(input.result)?.length ?? 0,
    input.elapsedMs !== undefined ? Math.floor(input.elapsedMs / 1000) : undefined,
    argsKey(input.name, input.args),
  ])
}

type LedgerInput = {
  name: BuiltInToolName
  args: Record<string, unknown>
  isPartial: boolean
  isError: boolean
  theme: ToolTheme
  expanded?: boolean
  pending?: PendingDetailSource
}

export class ToolLedgerComponent implements Component {
  private readonly input: LedgerInput
  private cachedKey: string | undefined
  private cachedLines: string[] | undefined

  constructor(input: LedgerInput) {
    this.input = input
  }

  render(width: number): string[] {
    if (width <= 0) return []
    const state = toolVisualState(this.input.isPartial, this.input.isError)
    const showFrame =
      this.input.pending !== undefined &&
      this.input.expanded !== true &&
      !this.input.pending.isSettled()
    const pending = showFrame ? this.input.pending!.snapshot() : undefined
    const key = JSON.stringify([
      width,
      state,
      this.input.expanded ?? false,
      showFrame,
      pending !== undefined && pending.elapsedMs !== undefined
        ? Math.floor(pending.elapsedMs / 1000)
        : undefined,
      pending !== undefined ? argsKey(pending.name, pending.args) : undefined,
    ])
    if (key === this.cachedKey && this.cachedLines) return this.cachedLines

    const summary = summarizeToolCall(this.input.name, this.input.args)
    const symbol = `${hexToFg(resolveThemeVar(this.input.theme.sourcePath, STATE_COLOR_VAR[state]))}${toolStateSymbol(state)}\x1b[39m`
    const action = `${hexToFg(TOOL_ACCENTS[this.input.name])}${this.input.theme.bold(summary.action)}\x1b[39m`
    const subject = this.input.theme.fg(this.input.name === 'bash' ? 'muted' : 'accent', summary.subject)
    const lines = [fitAnsi(`${symbol} ${action} ${subject}`, width)]
    if (pending !== undefined) {
      lines.push(
        ...frameDetail(buildToolDetail(pending), state, this.input.theme.sourcePath, width),
      )
    }
    this.cachedKey = key
    this.cachedLines = lines
    return lines
  }

  invalidate(): void {
    this.cachedKey = undefined
    this.cachedLines = undefined
  }
}

type EdgeInput = {
  inner?: Component
  expanded: boolean
  theme: ToolTheme
  detail?: DetailInput
}

export class EdgeOutputComponent implements Component {
  private readonly input: EdgeInput
  private cachedKey: string | undefined
  private cachedLines: string[] | undefined

  constructor(input: EdgeInput) {
    this.input = input
  }

  render(width: number): string[] {
    if (width <= 0) return []
    if (this.input.expanded) {
      if (!this.input.inner) return []
      if (this.cachedKey === widthKey(width) && this.cachedLines) return this.cachedLines
      const innerWidth = Math.max(1, width - 2)
      const edge = `${hexToFg(resolveThemeVar(this.input.theme.sourcePath, 'mauveTaupe'))}│\x1b[39m `
      this.cachedKey = widthKey(width)
      this.cachedLines = this.input.inner
        .render(innerWidth)
        .map((line) => fitAnsi(`${edge}${line}`, width))
      return this.cachedLines
    }
    if (!this.input.detail) return []
    const key = JSON.stringify([width, detailKey(this.input.detail)])
    if (key === this.cachedKey && this.cachedLines) return this.cachedLines
    const detail = this.input.detail
    const state = toolVisualState(detail.isPartial, detail.isError)
    this.cachedKey = key
    this.cachedLines = frameDetail(buildToolDetail(detail), state, detail.sourcePath, width)
    return this.cachedLines
  }

  invalidate(): void {
    this.cachedKey = undefined
    this.cachedLines = undefined
    this.input.inner?.invalidate()
  }
}

function widthKey(width: number): string {
  return `w${width}`
}

export default function () {}