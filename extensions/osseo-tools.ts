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

export function createOsseoRenderers(name: BuiltInToolName): ToolRendererPair {
  switch (name) {
    case 'bash':
      return bashRenderers()
    default:
      throw new Error(`osseo renderer not implemented yet: ${name}`)
  }
}
