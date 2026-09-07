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
      return new ToolLedgerComponent({
        name,
        args: args as Record<string, unknown>,
        isPartial: context.isPartial,
        isError: context.isError,
        theme,
      })
    },
    renderResult(result, options, theme, context) {
      const expanded = options.expanded
      const inner = originalResult
        ? originalResult(
            result,
            expanded ? { ...options, expanded: true } : options,
            theme,
            context,
          )
        : undefined
      return new EdgeOutputComponent({
        inner: inner as Component | undefined,
        expanded,
        theme,
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