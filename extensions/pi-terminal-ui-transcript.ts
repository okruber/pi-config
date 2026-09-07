import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  getAgentDir,
  keyHint,
  SettingsManager,
  type ExtensionAPI,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'
import { hexToFg, TERMINAL_UI_COLORS, readThemeHex } from './pi-terminal-ui-style.ts'
import {
  BUILTIN_TOOL_NAMES,
  EdgeOutputComponent,
  ToolLedgerComponent,
  type BuiltInToolName,
} from './pi-terminal-ui-tools.ts'

export type TranscriptTransformContext = {
  messageType: 'user' | 'assistant' | 'assistant-thinking'
  isStreaming: boolean
  availableWidth: number
  themeSourcePath?: string
}

const ANSI_ITALIC_OFF = '\x1b[23m'
const ANSI_FG_OFF = '\x1b[39m'

function quoteMarkdown(markdown: string): string {
  return markdown.split('\n').map((line) => `> ${line}`).join('\n')
}

function userBody(markdown: string, sourcePath: string | undefined): string {
  const color = readThemeHex(sourcePath, ['deepNavy']) ?? TERMINAL_UI_COLORS.deepNavy
  const prefix = `${ANSI_ITALIC_OFF}${hexToFg(color)}`
  return markdown.split('\n').map((line) => `> ${prefix}${line}${ANSI_FG_OFF}`).join('\n')
}

export function transformTranscriptMarkdown(
  markdown: string,
  context: TranscriptTransformContext,
): string {
  if (context.messageType === 'assistant') return markdown
  if (context.messageType === 'assistant-thinking') return quoteMarkdown(markdown)
  return userBody(markdown, context.themeSourcePath)
}

type AnyToolDefinition = ToolDefinition<any, any, any>
type AnyRenderContext = Parameters<NonNullable<AnyToolDefinition['renderCall']>>[2]
export type RuntimeToolSettings = Pick<
  SettingsManager,
  'getImageAutoResize' | 'getShellCommandPrefix' | 'getShellPath'
>
type DecoratorState = {
  originalCall?: Component
  originalResult?: Component
}

export function createRuntimeToolDefinitions(
  cwd: string,
  settings: RuntimeToolSettings,
): AnyToolDefinition[] {
  return [
    createReadToolDefinition(cwd, { autoResizeImages: settings.getImageAutoResize() }),
    createBashToolDefinition(cwd, {
      commandPrefix: settings.getShellCommandPrefix(),
      shellPath: settings.getShellPath(),
    }),
    createEditToolDefinition(cwd),
    createWriteToolDefinition(cwd),
    createGrepToolDefinition(cwd),
    createFindToolDefinition(cwd),
    createLsToolDefinition(cwd),
  ]
}

function originalContext(
  context: AnyRenderContext,
  lastComponent: Component | undefined,
): AnyRenderContext {
  return { ...context, expanded: true, lastComponent }
}

function isBuiltInToolName(name: string): name is BuiltInToolName {
  return BUILTIN_TOOL_NAMES.some((candidate) => candidate === name)
}

function hasSemanticCallBody(name: BuiltInToolName): boolean {
  return name === 'edit' || name === 'write'
}

export function decorateBuiltInTool(definition: AnyToolDefinition): AnyToolDefinition {
  if (!isBuiltInToolName(definition.name)) {
    throw new Error(`Cannot decorate non-built-in tool: ${definition.name}`)
  }
  const name = definition.name
  const originalCall = definition.renderCall
  const originalResult = definition.renderResult

  return {
    ...definition,
    renderShell: 'self',
    renderCall(args, theme, context) {
      const state = context.state as DecoratorState
      let originalComponent: Component | undefined
      if (hasSemanticCallBody(name) && originalCall) {
        originalComponent = originalCall(
          args,
          theme,
          originalContext(context, state.originalCall),
        )
        state.originalCall = originalComponent
      }
      return new ToolLedgerComponent({
        name,
        args: args as Record<string, unknown>,
        cwd: context.cwd,
        expanded: context.expanded,
        isPartial: context.isPartial,
        isError: context.isError,
        theme,
        expansionHint: keyHint('app.tools.expand', 'to expand'),
        semanticBody: hasSemanticCallBody(name) ? originalComponent : undefined,
      })
    },
    renderResult(result, options, theme, context) {
      const state = context.state as DecoratorState
      let inner: Component | undefined
      if (originalResult) {
        inner = originalResult(
          result,
          { ...options, expanded: true },
          theme,
          originalContext(context, state.originalResult),
        )
        state.originalResult = inner
      }
      return new EdgeOutputComponent({
        name,
        inner,
        expanded: options.expanded,
        theme,
        expansionHint: keyHint('app.tools.expand', 'to expand'),
        stripInnerBackground: name === 'edit',
        stripInnerLeftPadding: name === 'edit',
      })
    },
  }
}

export default function (pi: ExtensionAPI) {
  let getThemeSourcePath = (): string | undefined => undefined

  pi.registerMarkdownTransformer((markdown, context) => transformTranscriptMarkdown(markdown, {
    ...context,
    themeSourcePath: getThemeSourcePath(),
  }))

  pi.on('session_start', (_event, ctx) => {
    getThemeSourcePath = () => undefined
    if (ctx.mode !== 'tui') return
    getThemeSourcePath = () => ctx.ui.theme.sourcePath

    const settings = SettingsManager.create(ctx.cwd, getAgentDir(), {
      projectTrusted: ctx.isProjectTrusted(),
    })
    for (const definition of createRuntimeToolDefinitions(ctx.cwd, settings)) {
      pi.registerTool(decorateBuiltInTool(definition))
    }
  })

  pi.on('session_shutdown', () => {
    getThemeSourcePath = () => undefined
  })
}
