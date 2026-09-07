import {
  CustomEditor,
  keyHint,
  rawKeyHint,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
} from '@earendil-works/pi-coding-agent'
import type { Component, EditorTheme, TUI } from '@earendil-works/pi-tui'
import { stripTerminalSequences, visibleWidth } from '@earendil-works/pi-tui'
import { contextRole } from './pi-terminal-ui-status.ts'
import {
  TOKEN_CACHE_STATUS_KEY,
  TOKEN_RATE_STATUS_KEY,
  fitAnsi,
  paintEditorBody,
  renderDock,
  renderQuietFooter,
  type DockField,
  type DockRole,
} from './pi-terminal-ui-tools.ts'

const STATUS_BRIDGE = Symbol.for('omp.footer.statuses.v1')

type StatusBridge = { version: 1; getStatuses(): ReadonlyMap<string, string> }

class EmptyFooter implements Component {
  render(): string[] {
    return []
  }

  invalidate(): void {}
}

function formatCwd(cwd: string): string {
  const home = process.env.HOME
  if (home && cwd === home) return '~'
  if (home && cwd.startsWith(`${home}/`)) return `~${cwd.slice(home.length)}`
  return cwd
}

function compactPath(cwd: string): string {
  const formatted = formatCwd(cwd)
  const parts = formatted.split('/').filter(Boolean)
  if (formatted === '~' || parts.length <= 2) return formatted
  const last = parts.at(-1) ?? formatted
  return formatted.startsWith('~/') ? `~/${last}` : last
}

function formatTokens(count: number): string {
  if (count < 1000) return String(count)
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`
  if (count < 1000000) return `${Math.round(count / 1000)}k`
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`
  return `${Math.round(count / 1000000)}M`
}

function formatContext(ctx: ExtensionContext): string {
  const usage = ctx.getContextUsage()
  const window = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0
  if (!window) return 'ctx ?'
  if (!usage || usage.percent === null || usage.tokens === null) return `?/${formatTokens(window)}`
  return `${usage.percent.toFixed(1)}%/${formatTokens(window)}`
}

export function contextDockRole(ctx: Pick<ExtensionContext, 'getContextUsage'>): DockRole {
  const role = contextRole(ctx.getContextUsage()?.percent ?? null)
  if (role === 'danger') return 'identity'
  if (role === 'path') return 'path'
  if (role === 'muted') return 'session'
  return 'context'
}

function totalCost(ctx: ExtensionContext): number {
  let cost = 0
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type !== 'message') continue
    const message = entry.message as any
    if (message?.role !== 'assistant') continue
    cost += Number(message?.usage?.cost?.total ?? 0)
  }
  return cost
}

function modelLabel(ctx: ExtensionContext): string {
  const model = ctx.model
  if (!model) return 'no model'
  return model.name || model.id || 'model'
}

function subscriptionLabel(ctx: ExtensionContext): string | undefined {
  const provider = ctx.model?.provider
  if (!provider) return undefined
  const envKeyBase = provider.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()
  const label = process.env[`PI_${envKeyBase}_EMAIL`] || process.env[`PI_${envKeyBase}_LABEL`]
  return label?.trim() || undefined
}

function isEditorBorderLine(line: string, width: number): boolean {
  const plain = stripTerminalSequences(line)
  return visibleWidth(line) === width && (
    /^─+$/.test(plain) || /^─── [↑↓] \d+ more ─*$/.test(plain)
  )
}

export function partitionEditorRows(
  lines: string[],
  width: number,
): { editorRows: string[]; autocompleteRows: string[] } {
  let bottomIndex = -1
  for (let index = lines.length - 1; index >= 1; index--) {
    if (isEditorBorderLine(lines[index]!, width)) {
      bottomIndex = index
      break
    }
  }
  if (bottomIndex < 0) {
    return { editorRows: lines.slice(1), autocompleteRows: [] }
  }
  return {
    editorRows: lines.slice(1, bottomIndex),
    autocompleteRows: lines.slice(bottomIndex + 1),
  }
}

function currentStatuses(): ReadonlyMap<string, string> {
  const bridge = (globalThis as Record<symbol, unknown>)[STATUS_BRIDGE] as StatusBridge | undefined
  return bridge?.getStatuses() ?? new Map<string, string>()
}

function dockFields(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  branch: string | undefined,
  statuses: ReadonlyMap<string, string>,
): DockField[] {
  const thinking = typeof (pi as any).getThinkingLevel === 'function'
    ? (pi as any).getThinkingLevel()
    : 'off'
  const cost = totalCost(ctx)
  const usingSubscription = ctx.model
    ? (ctx.modelRegistry as any).isUsingOAuth?.(ctx.model) === true
    : false
  const fields: DockField[] = [
    { id: 'identity', text: 'π', role: 'identity', required: true },
    { id: 'model', text: `✺ ${modelLabel(ctx)}`, role: 'model', required: true },
    { id: 'reasoning', text: `● ${thinking}`, role: 'reasoning', required: true },
    {
      id: 'path',
      text: `⌘ ${compactPath(ctx.cwd)}${branch ? `:${branch}` : ''}`,
      role: 'path',
      required: false,
    },
    {
      id: 'context',
      text: formatContext(ctx),
      role: contextDockRole(ctx),
      required: false,
    },
  ]

  if (cost > 0 || usingSubscription) {
    const subscription = usingSubscription ? subscriptionLabel(ctx) : undefined
    fields.push({
      id: 'cost',
      text: usingSubscription
        ? `sub${subscription ? `: ${subscription}` : ''}`
        : `$${cost.toFixed(cost >= 10 ? 2 : 3)}`,
      role: 'cost',
      required: false,
    })
  }

  const cache = statuses.get(TOKEN_CACHE_STATUS_KEY)
  if (cache) fields.push({ id: 'cache', text: cache, role: 'cache', required: false })
  const sessionName = ctx.sessionManager.getSessionName()
  if (sessionName) {
    fields.push({ id: 'session', text: sessionName, role: 'session', required: false })
  }
  return fields
}

export default function (pi: ExtensionAPI) {
  let activeTui: TUI | undefined
  let branch: string | undefined

  pi.on('session_shutdown', () => {
    activeTui = undefined
    delete (globalThis as Record<symbol, unknown>)[STATUS_BRIDGE]
  })

  pi.on('session_start', (_event, ctx) => {
    if (ctx.mode !== 'tui') return
    branch = undefined
    ctx.ui.setFooter((_tui, _theme, footerData) => {
      const bridge: StatusBridge = {
        version: 1,
        getStatuses: () => footerData.getExtensionStatuses(),
      }
      ;(globalThis as Record<symbol, unknown>)[STATUS_BRIDGE] = bridge
      return new EmptyFooter()
    })

    const refreshBranch = async () => {
      const result = await pi.exec('git', ['branch', '--show-current'], { cwd: ctx.cwd }).catch(() => undefined)
      const stdout = result?.stdout.trim()
      branch = stdout && stdout.length > 0 ? stdout : undefined
      activeTui?.requestRender()
    }
    void refreshBranch()

    class OmpChatboxEditor extends CustomEditor {
      constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
        super(tui, theme, keybindings, { paddingX: 0 })
        activeTui = tui
      }

      // Pi reapplies default editor padding after construction.
      setPaddingX(): void {}

      render(width: number): string[] {
        if (width <= 0) return []
        const innerWidth = Math.max(1, width - 2)
        const rendered = super.render(innerWidth)
        const { editorRows, autocompleteRows } = partitionEditorRows(rendered, innerWidth)
        const statuses = currentStatuses()
        const fields = dockFields(pi, ctx, branch, statuses)
        const hint = ctx.ui.theme.fg('dim', [
          rawKeyHint('esc', 'interrupts'),
          keyHint('app.tools.expand', 'expands'),
          rawKeyHint('/', 'commands'),
        ].join(' · '))
        const rate = statuses.get(TOKEN_RATE_STATUS_KEY)

        return [
          renderDock(fields, width, ctx.ui.theme.sourcePath),
          ...editorRows.map((line) => paintEditorBody(line, width, ctx.ui.theme.sourcePath)),
          renderQuietFooter(
            hint,
            rate ? ctx.ui.theme.fg('dim', rate) : undefined,
            width,
          ),
          ...autocompleteRows.map((line) => fitAnsi(`  ${line}`, width)),
        ]
      }
    }

    ctx.ui.setEditorComponent(
      (tui, theme, keybindings) => new OmpChatboxEditor(tui, theme, keybindings),
    )
  })
}
