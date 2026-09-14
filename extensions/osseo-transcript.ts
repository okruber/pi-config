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
import { BUILTIN_TOOL_NAMES, createOsseoRenderers, type BuiltInToolName } from './osseo-tools.ts'

type AnyToolDefinition = ToolDefinition<any, any, any>
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
  return { ...definition, renderShell: 'self', ...createOsseoRenderers(definition.name) }
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
