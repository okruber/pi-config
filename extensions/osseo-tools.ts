import {
  getLanguageFromPath,
  highlightCode,
  renderDiff,
  type Theme,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { hyperlink, truncateToWidth, type Component } from '@earendil-works/pi-tui'
import { resolve as resolvePath } from 'node:path'
import {
  MemoComponent,
  STATE_SYMBOL,
  countUnit,
  expandHint,
  moreLine,
  normalizeInline,
  renderFrame,
  resolveFrameColors,
  resultText,
  statusHeader,
  stripNoticeFooter,
  tailWindow,
  treeList,
  type FrameColors,
  type FrameSection,
  type FrameState,
} from './osseo-frame.ts'

export const BUILTIN_TOOL_NAMES = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'] as const
export type BuiltInToolName = (typeof BUILTIN_TOOL_NAMES)[number]

type AnyToolDefinition = ToolDefinition<any, any, any>
export type ToolRendererPair = Pick<AnyToolDefinition, 'renderCall' | 'renderResult'>

type FrameRenderState = {
  resultPresent?: boolean
  startedAt?: number
  endedAt?: number
  interval?: ReturnType<typeof setInterval>
}

type RenderContextLike = {
  args: Record<string, unknown>
  state: FrameRenderState
  cwd: string
  executionStarted: boolean
  argsComplete: boolean
  isPartial: boolean
  expanded: boolean
  isError: boolean
  invalidate: () => void
}

const BASH_OUTPUT_PREVIEW_LINES = 10
const CODE_PREVIEW_LINES = 12
const LIST_PREVIEW_ITEMS = 8
const DIFF_PREVIEW_LINES = 40

function ensureTimer(state: FrameRenderState, context: RenderContextLike): void {
  if (state.interval !== undefined) return
  state.interval = setInterval(() => context.invalidate(), 1000)
}

function stopTimer(state: FrameRenderState): void {
  if (state.interval === undefined) return
  clearInterval(state.interval)
  state.interval = undefined
}

function elapsedMs(state: FrameRenderState): number | undefined {
  if (state.startedAt === undefined) return undefined
  return (state.endedAt ?? Date.now()) - state.startedAt
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

function argsKey(args: unknown): string {
  try {
    return JSON.stringify(args) ?? ''
  } catch {
    return ''
  }
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function pathArg(args: Record<string, unknown>): string {
  return stringArg(args, 'path') ?? stringArg(args, 'file_path') ?? ''
}

function linkedPath(display: string, cwd: string, colors: FrameColors): string {
  const styled = colors.subject(display)
  if (display.length === 0 || display === '…') return styled
  return hyperlink(styled, `file://${resolvePath(cwd, display)}`)
}

function truncationWarning(
  details: Record<string, unknown> | undefined,
  notice: string | undefined,
): string | undefined {
  const truncation = details?.truncation as
    | { truncated?: boolean; outputLines?: number; totalLines?: number }
    | undefined
  if (
    truncation?.truncated &&
    typeof truncation.outputLines === 'number' &&
    typeof truncation.totalLines === 'number'
  ) {
    return `[Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines]`
  }
  return notice
}

function errorLines(result: unknown, colors: FrameColors): string[] {
  return resultText(result as { content?: Array<{ type?: string; text?: unknown }> })
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => colors.errorText(line))
}

function bashCommandLines(args: Record<string, unknown>, colors: FrameColors): string[] {
  const command = stringArg(args, 'command') ?? '…'
  const highlighted = highlightCode(command, 'bash')
  const prefix = colors.meta('$ ')
  return highlighted.map((line, index) => (index === 0 ? `${prefix}${line}` : line))
}

function bashRenderers(): ToolRendererPair {
  return {
    renderCall(args, theme, context) {
      const ctx = context as unknown as RenderContextLike
      const state = ctx.state
      if (ctx.executionStarted && state.startedAt === undefined) state.startedAt = Date.now()
      if (ctx.executionStarted) ensureTimer(state, ctx)
      return new MemoComponent(
        (width) => {
          if (state.resultPresent) return []
          const colors = resolveFrameColors(theme, 'pending')
          const lines = bashCommandLines(ctx.args, colors)
          const elapsed = elapsedMs(state)
          if (ctx.executionStarted && elapsed !== undefined) {
            lines.push(colors.meta(`running · ${Math.floor(elapsed / 1000)}s`))
          }
          return renderFrame({ state: 'pending', sections: [{ lines }], width }, colors)
        },
        () =>
          [
            state.resultPresent === true,
            ctx.executionStarted,
            Math.floor((elapsedMs(state) ?? 0) / 1000),
            argsKey(args),
          ].join('|'),
      )
    },
    renderResult(result, options, theme, context) {
      const ctx = context as unknown as RenderContextLike
      const state = ctx.state
      state.resultPresent = true
      if (!options.isPartial || ctx.isError) {
        state.endedAt ??= Date.now()
        stopTimer(state)
      }
      return new MemoComponent(
        (width) => {
          const frameState: FrameState = ctx.isError ? 'error' : options.isPartial ? 'pending' : 'success'
          const colors = resolveFrameColors(theme, frameState)
          const sections: FrameSection[] = [{ lines: bashCommandLines(ctx.args, colors) }]
          const { body, notice } = stripNoticeFooter(resultText(result))
          const outputLines: string[] = []
          if (body.trim().length > 0) {
            const styled = body
              .split('\n')
              .map((line) => colors.body(line))
              .join('\n')
            if (options.expanded) {
              outputLines.push(...styled.split('\n'))
            } else {
              outputLines.push(...tailWindow(styled, BASH_OUTPUT_PREVIEW_LINES, Math.max(1, width - 4), colors))
            }
          } else {
            outputLines.push(colors.meta('(no output)'))
          }
          const elapsed = elapsedMs(state)
          if (elapsed !== undefined) {
            outputLines.push(colors.meta(`[${options.isPartial ? 'Elapsed' : 'Took'} ${formatDuration(elapsed)}]`))
          }
          const warning = truncationWarning(
            (result as { details?: Record<string, unknown> }).details,
            notice,
          )
          if (warning) outputLines.push(colors.warning(warning))
          sections.push({ label: colors.title('Output'), lines: outputLines })
          return renderFrame({ state: frameState, sections, width }, colors)
        },
        () =>
          [
            ctx.isError,
            options.isPartial,
            options.expanded,
            resultText(result).length,
            Math.floor((elapsedMs(state) ?? 0) / 1000),
          ].join('|'),
      )
    },
  }
}

function readSubjectParts(args: Record<string, unknown>): { path: string; suffix: string; startLine: number } {
  const path = pathArg(args)
  const offset = typeof args.offset === 'number' ? args.offset : undefined
  const limit = typeof args.limit === 'number' ? args.limit : undefined
  const startLine = offset ?? 1
  const suffix =
    offset !== undefined || limit !== undefined
      ? `:${startLine}${limit !== undefined ? `-${startLine + limit - 1}` : ''}`
      : ''
  return { path: path || '…', suffix, startLine }
}

export function readCodeLines(
  text: string,
  language: string | undefined,
  startLine: number,
  expanded: boolean,
  colors: FrameColors,
): string[] {
  const raw = text.split('\n')
  while (raw.length > 0 && raw[raw.length - 1] === '') raw.pop()
  if (raw.length === 0) return [colors.meta('(empty file)')]
  const shown = expanded ? raw : raw.slice(0, CODE_PREVIEW_LINES)
  const highlighted = highlightCode(shown.join('\n'), language)
  const gutterWidth = Math.max(2, String(startLine + shown.length - 1).length)
  const lines = highlighted.map((line, index) => {
    const gutter = String(startLine + index).padStart(gutterWidth, ' ')
    return `${colors.meta(`${gutter} `)}${line}`
  })
  if (!expanded && raw.length > shown.length) {
    lines.push(`${colors.meta(`… ${raw.length - shown.length} more lines `)}${expandHint(colors)}`)
  }
  return lines
}

function readRenderers(): ToolRendererPair {
  const header = (state: FrameState, args: Record<string, unknown>, cwd: string, colors: FrameColors): string => {
    const { path, suffix } = readSubjectParts(args)
    return `${colors.symbol(STATE_SYMBOL[state])} ${colors.title('Read')}: ${linkedPath(path, cwd, colors)}${colors.subject(suffix)}`
  }
  return {
    renderCall(args, theme, context) {
      const ctx = context as unknown as RenderContextLike
      const state = ctx.state
      return new MemoComponent(
        (width) => {
          if (state.resultPresent) return []
          const colors = resolveFrameColors(theme, 'pending')
          return [truncateToWidth(header('pending', ctx.args, ctx.cwd, colors), width, '')]
        },
        () => [state.resultPresent === true, argsKey(args)].join('|'),
      )
    },
    renderResult(result, options, theme, context) {
      const ctx = context as unknown as RenderContextLike
      const state = ctx.state
      state.resultPresent = true
      return new MemoComponent(
        (width) => {
          const frameState: FrameState = ctx.isError ? 'error' : 'success'
          const colors = resolveFrameColors(theme, frameState)
          const head = header(frameState, ctx.args, ctx.cwd, colors)
          if (ctx.isError) {
            return renderFrame({ header: head, state: 'error', sections: [{ lines: errorLines(result, colors) }], width }, colors)
          }
          const content = (result as { content?: Array<{ type?: string }> }).content ?? []
          if (content.some((block) => block?.type === 'image')) {
            return renderFrame({ header: head, state: frameState, sections: [{ lines: [colors.meta('(image)')] }], width }, colors)
          }
          const { body, notice } = stripNoticeFooter(resultText(result))
          const { startLine } = readSubjectParts(ctx.args)
          const sections: FrameSection[] = [
            { lines: readCodeLines(body, getLanguageFromPath(pathArg(ctx.args)), startLine, options.expanded, colors) },
          ]
          const warning = truncationWarning((result as { details?: Record<string, unknown> }).details, notice)
          if (warning) sections.push({ label: colors.title('Output'), lines: [colors.warning(warning)] })
          return renderFrame({ header: head, state: frameState, sections, width }, colors)
        },
        () => [ctx.isError, options.expanded, resultText(result).length].join('|'),
      )
    },
  }
}

function writeRenderers(): ToolRendererPair {
  const contentOf = (args: Record<string, unknown>): string => stringArg(args, 'content') ?? ''
  const head = (
    state: FrameState,
    args: Record<string, unknown>,
    cwd: string,
    colors: FrameColors,
    meta?: string,
  ): string => {
    let line = `${colors.symbol(STATE_SYMBOL[state])} ${colors.title('Write')}: ${linkedPath(pathArg(args) || '…', cwd, colors)}`
    if (meta) line += colors.meta(` · ${meta}`)
    return line
  }
  return {
    renderCall(args, theme, context) {
      const ctx = context as unknown as RenderContextLike
      const state = ctx.state
      return new MemoComponent(
        (width) => {
          if (state.resultPresent) return []
          const colors = resolveFrameColors(theme, 'pending')
          const content = contentOf(ctx.args)
          const language = getLanguageFromPath(pathArg(ctx.args))
          const lines: string[] = []
          if (content.length > 0) {
            const raw = content.split('\n')
            const tail = raw.length > CODE_PREVIEW_LINES
            const shown = tail ? raw.slice(-CODE_PREVIEW_LINES) : raw
            if (tail) lines.push(colors.meta(`… ${raw.length - shown.length} earlier lines`))
            lines.push(...highlightCode(shown.join('\n'), language))
          }
          if (!ctx.argsComplete) lines.push(colors.meta('(streaming…)'))
          return renderFrame(
            { header: head('pending', ctx.args, ctx.cwd, colors), state: 'pending', sections: [{ lines }], width },
            colors,
          )
        },
        () => [state.resultPresent === true, ctx.argsComplete, contentOf(ctx.args).length].join('|'),
      )
    },
    renderResult(result, options, theme, context) {
      const ctx = context as unknown as RenderContextLike
      const state = ctx.state
      state.resultPresent = true
      return new MemoComponent(
        (width) => {
          if (ctx.isError) {
            const colors = resolveFrameColors(theme, 'error')
            return renderFrame(
              { header: head('error', ctx.args, ctx.cwd, colors), state: 'error', sections: [{ lines: errorLines(result, colors) }], width },
              colors,
            )
          }
          const colors = resolveFrameColors(theme, 'success')
          const content = contentOf(ctx.args)
          const raw = content.split('\n')
          const language = getLanguageFromPath(pathArg(ctx.args))
          const shown = options.expanded ? raw : raw.slice(0, CODE_PREVIEW_LINES)
          const lines = highlightCode(shown.join('\n'), language)
          if (!options.expanded && raw.length > shown.length) {
            lines.push(`${colors.meta(`… ${raw.length - shown.length} more lines `)}${expandHint(colors)}`)
          }
          return renderFrame(
            {
              header: head('success', ctx.args, ctx.cwd, colors, countUnit(raw.length, 'line')),
              state: 'success',
              sections: [{ lines }],
              width,
            },
            colors,
          )
        },
        () => [ctx.isError, options.expanded, contentOf(ctx.args).length].join('|'),
      )
    },
  }
}

export function editDiffStats(diff: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+')) added += 1
    else if (line.startsWith('-')) removed += 1
  }
  return { added, removed }
}

function editRenderers(): ToolRendererPair {
  const head = (
    state: FrameState,
    args: Record<string, unknown>,
    cwd: string,
    colors: FrameColors,
    diff?: string,
  ): string => {
    let line = `${colors.symbol(STATE_SYMBOL[state])} ${colors.title('Edit')}: ${linkedPath(pathArg(args) || '…', cwd, colors)}`
    if (diff) {
      const stats = editDiffStats(diff)
      const parts: string[] = []
      if (stats.added > 0) parts.push(colors.added(`+${stats.added}`))
      if (stats.removed > 0) parts.push(colors.removed(`-${stats.removed}`))
      if (parts.length > 0) line += ` ${parts.join(' ')}`
    }
    return line
  }
  return {
    renderCall(args, theme, context) {
      const ctx = context as unknown as RenderContextLike
      const state = ctx.state
      return new MemoComponent(
        (width) => {
          if (state.resultPresent) return []
          const colors = resolveFrameColors(theme, 'pending')
          const edits = Array.isArray(ctx.args.edits) ? ctx.args.edits.length : 1
          const lines = [colors.meta(`${countUnit(edits, 'edit')} pending`)]
          return renderFrame(
            { header: head('pending', ctx.args, ctx.cwd, colors), state: 'pending', sections: [{ lines }], width },
            colors,
          )
        },
        () => [state.resultPresent === true, argsKey(args)].join('|'),
      )
    },
    renderResult(result, options, theme, context) {
      const ctx = context as unknown as RenderContextLike
      const state = ctx.state
      state.resultPresent = true
      return new MemoComponent(
        (width) => {
          if (ctx.isError) {
            const colors = resolveFrameColors(theme, 'error')
            return renderFrame(
              { header: head('error', ctx.args, ctx.cwd, colors), state: 'error', sections: [{ lines: errorLines(result, colors) }], width },
              colors,
            )
          }
          const colors = resolveFrameColors(theme, 'success')
          const details = (result as { details?: { diff?: unknown } }).details
          const diff = typeof details?.diff === 'string' ? details.diff : ''
          const body =
            diff.length > 0
              ? renderDiff(diff, { filePath: pathArg(ctx.args) }).split('\n')
              : [colors.meta('(no changes)')]
          const shown = options.expanded ? body : body.slice(0, DIFF_PREVIEW_LINES)
          const lines = [...shown]
          if (!options.expanded && body.length > shown.length) {
            lines.push(moreLine(body.length - shown.length, 'diff line', colors))
          }
          return renderFrame(
            {
              header: head('success', ctx.args, ctx.cwd, colors, diff || undefined),
              state: 'success',
              sections: [{ lines }],
              width,
            },
            colors,
          )
        },
        () => {
          const details = (result as { details?: { diff?: unknown } }).details
          return [ctx.isError, options.expanded, typeof details?.diff === 'string' ? details.diff.length : 0].join('|')
        },
      )
    },
  }
}

type SearchListConfig = {
  title: string
  unit: string
  emptyText: string
  subject: (args: Record<string, unknown>) => string
}

function searchListRenderers(config: SearchListConfig): ToolRendererPair {
  return {
    renderCall(args, theme, context) {
      const ctx = context as unknown as RenderContextLike
      const state = ctx.state
      return new MemoComponent(
        (width) => {
          if (state.resultPresent) return []
          const colors = resolveFrameColors(theme, 'pending')
          return [truncateToWidth(statusHeader({ state: 'pending', title: config.title, subject: config.subject(ctx.args) }, colors), width, '')]
        },
        () => [state.resultPresent === true, argsKey(args)].join('|'),
      )
    },
    renderResult(result, options, theme, context) {
      const ctx = context as unknown as RenderContextLike
      const state = ctx.state
      state.resultPresent = true
      return new MemoComponent(
        (width) => {
          const subject = config.subject(ctx.args)
          if (ctx.isError) {
            const colors = resolveFrameColors(theme, 'error')
            return [
              statusHeader({ state: 'error', title: config.title, subject }, colors),
              ...errorLines(result, colors),
            ].map((line) => truncateToWidth(line, width, ''))
          }
          const colors = resolveFrameColors(theme, 'success')
          const { body } = stripNoticeFooter(resultText(result))
          const items = body.split('\n').filter((line) => line.trim().length > 0)
          const meta = [countUnit(items.length, config.unit)]
          const details = (result as { details?: Record<string, unknown> }).details ?? {}
          if (
            (details.truncation as { truncated?: boolean } | undefined)?.truncated === true ||
            details.matchLimitReached !== undefined ||
            details.resultLimitReached !== undefined ||
            details.entryLimitReached !== undefined
          ) {
            meta.push('truncated')
          }
          const header = statusHeader({ state: 'success', title: config.title, subject, meta }, colors)
          const rows =
            items.length === 0
              ? [colors.meta(`(${config.emptyText})`)]
              : treeList(
                  items.map((line) => colors.body(line)),
                  { expanded: options.expanded, maxCollapsed: LIST_PREVIEW_ITEMS, unit: config.unit },
                  colors,
                )
          return [header, ...rows].map((line) => truncateToWidth(line, width, ''))
        },
        () => [ctx.isError, options.expanded, resultText(result).length].join('|'),
      )
    },
  }
}

export function createOsseoRenderers(name: BuiltInToolName): ToolRendererPair {
  switch (name) {
    case 'bash':
      return bashRenderers()
    case 'read':
      return readRenderers()
    case 'write':
      return writeRenderers()
    case 'edit':
      return editRenderers()
    case 'grep':
      return searchListRenderers({
        title: 'Grep',
        unit: 'match',
        emptyText: 'no matches',
        subject: (args) => `/${normalizeInline(stringArg(args, 'pattern') ?? '?')}/ in ${normalizeInline(stringArg(args, 'path') ?? '.')}`,
      })
    case 'find':
      return searchListRenderers({
        title: 'Find',
        unit: 'file',
        emptyText: 'no files found',
        subject: (args) => `${normalizeInline(stringArg(args, 'pattern') ?? '…')} in ${normalizeInline(stringArg(args, 'path') ?? '.')}`,
      })
    case 'ls':
      return searchListRenderers({
        title: 'Ls',
        unit: 'entry',
        emptyText: 'empty directory',
        subject: (args) => normalizeInline(stringArg(args, 'path') ?? '.'),
      })
  }
}

export default function () {}
