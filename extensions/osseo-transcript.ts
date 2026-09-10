import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  getAgentDir,
  SettingsManager,
  type ExtensionAPI,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'
import {
  BUILTIN_TOOL_NAMES,
  EdgeOutputComponent,
  ToolLedgerComponent,
  type BuiltInToolName,
  type DetailInput,
  type ToolResultContent,
} from './osseo-call-line.ts'

type AnyToolDefinition = ToolDefinition<any, any, any>
type AnyRenderContext = Parameters<NonNullable<AnyToolDefinition['renderCall']>>[2]
export type RuntimeToolSettings = Pick<
  SettingsManager,
  'getImageAutoResize' | 'getShellCommandPrefix' | 'getShellPath'
>

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

// Pi shares rendererState between the call and result render slots. The result
// renderer marks its presence here; the call renderer reads it at paint time,
// which is always after this pass's renderResult has run.
type OsseoRendererState = {
  osseoResultPresent?: boolean
  startedAt?: number
  endedAt?: number
}

function bashElapsedMs(state: OsseoRendererState, isPartial: boolean): number | undefined {
  return isPartial && typeof state.startedAt === 'number' ? Date.now() - state.startedAt : undefined
}

function isBuiltInToolName(name: string): name is BuiltInToolName {
  return BUILTIN_TOOL_NAMES.some((candidate) => candidate === name)
}

export function decorateBuiltInTool(definition: AnyToolDefinition): AnyToolDefinition {
  if (!isBuiltInToolName(definition.name)) {
    throw new Error(`Cannot decorate non-built-in tool: ${definition.name}`)
  }
  const name = definition.name
  const originalResult = definition.renderResult

  return {
    ...definition,
    renderShell: 'self',
    renderCall(args, theme, context) {
      const state = context.state as OsseoRendererState
      return new ToolLedgerComponent({
        name,
        args: args as Record<string, unknown>,
        isPartial: context.isPartial,
        isError: context.isError,
        theme,
        expanded: context.expanded,
        pending: {
          isSettled: () => Boolean(state.osseoResultPresent),
          snapshot: () => ({
            name,
            args: args as Record<string, unknown>,
            result: undefined,
            isPartial: true,
            isError: context.isError,
            elapsedMs: bashElapsedMs(state, context.isPartial),
            sourcePath: theme.sourcePath,
          }) satisfies DetailInput,
        },
      })
    },
    renderResult(result, options, theme, context) {
      const state = context.state as OsseoRendererState
      const inner = originalResult
        ? originalResult(
            result,
            options.expanded ? { ...options, expanded: true } : options,
            theme,
            context,
          )
        : undefined
      state.osseoResultPresent = true
      return new EdgeOutputComponent({
        inner: inner as Component | undefined,
        expanded: options.expanded,
        theme,
        detail: {
          name,
          args: context.args as Record<string, unknown>,
          result: result as ToolResultContent,
          isPartial: options.isPartial,
          isError: context.isError,
          elapsedMs: bashElapsedMs(state, options.isPartial),
          sourcePath: theme.sourcePath,
        } satisfies DetailInput,
      })
    },
  }
}

export default function (pi: ExtensionAPI) {
  pi.on('session_start', (_event, ctx) => {
    if (ctx.mode !== 'tui') return
    const settings = SettingsManager.create(ctx.cwd, getAgentDir(), {
      projectTrusted: ctx.isProjectTrusted(),
    })
    for (const definition of createRuntimeToolDefinitions(ctx.cwd, settings)) {
      pi.registerTool(decorateBuiltInTool(definition))
    }
  })
}