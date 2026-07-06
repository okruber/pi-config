import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
} from '@earendil-works/pi-coding-agent'
import type { Component, EditorTheme, TUI } from '@earendil-works/pi-tui'
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'

const SEP = '›'
const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g

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
  const envLabel = process.env[`PI_${envKeyBase}_EMAIL`] || process.env[`PI_${envKeyBase}_LABEL`]
  if (envLabel?.trim()) return envLabel.trim()

  const labelsJson = process.env.PI_CLAUDE_SUBSCRIPTION_LABELS
  if (!labelsJson) return undefined
  try {
    const labels = JSON.parse(labelsJson) as Record<string, unknown>
    const label = labels[provider]
    return typeof label === 'string' && label.trim() ? label.trim() : undefined
  } catch {
    return undefined
  }
}

function thinkingColor(level: string): string {
  switch (level) {
    case 'off':
      return 'thinkingOff'
    case 'minimal':
      return 'thinkingMinimal'
    case 'low':
      return 'thinkingLow'
    case 'medium':
      return 'thinkingMedium'
    case 'high':
      return 'thinkingHigh'
    case 'xhigh':
      return 'thinkingXhigh'
    default:
      return 'accent'
  }
}

function makeSegment(theme: ExtensionContext['ui']['theme'], fg: string, text: string): string {
  return theme.bg('toolSuccessBg', theme.fg(fg as any, ` ${text} `))
}

function fitStatusLine(left: string, right: string, width: number, border: (text: string) => string): string {
  if (width <= 0) return ''

  let leftText = left
  let rightText = right
  const minimumGap = rightText ? 3 : 0

  while (visibleWidth(leftText) + visibleWidth(rightText) + minimumGap > width && visibleWidth(rightText) > 0) {
    rightText = truncateToWidth(rightText, Math.max(0, visibleWidth(rightText) - 1), '')
  }
  while (visibleWidth(leftText) + visibleWidth(rightText) + minimumGap > width && visibleWidth(leftText) > 0) {
    leftText = truncateToWidth(leftText, Math.max(0, visibleWidth(leftText) - 1), '')
  }

  const gap = Math.max(0, width - visibleWidth(leftText) - visibleWidth(rightText))
  return leftText + border('─'.repeat(gap)) + rightText
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '')
}

function isEditorBorderLine(line: string, width: number): boolean {
  const plain = stripAnsi(line)
  return (
    visibleWidth(line) === width &&
    (/^─+$/.test(plain) || /^─── [↑↓] \d+ more ─*$/.test(plain))
  )
}

function removeBottomEditorBorder(lines: string[], width: number): number {
  for (let i = lines.length - 1; i >= 1; i--) {
    if (isEditorBorderLine(lines[i], width)) {
      lines.splice(i, 1)
      return i
    }
  }
  return lines.length
}

export default function (pi: ExtensionAPI) {
  let activeTui: TUI | undefined
  let branch: string | undefined

  pi.on('session_shutdown', () => {
    activeTui = undefined
  })

  pi.on('session_start', (_event, ctx) => {
    ctx.ui.setFooter(() => new EmptyFooter())

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

      // Pi copies the default editor's padding into custom editors after
      // construction. Keep our OMP-style inset under our custom left border.
      setPaddingX(): void {}

      render(width: number): string[] {
        const leftBorderWidth = 2
        const innerWidth = Math.max(1, width - leftBorderWidth)
        const lines = super.render(innerWidth)
        if (lines.length < 2) return lines

        const theme = ctx.ui.theme
        const border = (text: string) => this.borderColor(text)
        const sep = theme.bg('toolSuccessBg', theme.fg('borderMuted', ` ${SEP} `))
        const thinking = typeof (pi as any).getThinkingLevel === 'function' ? (pi as any).getThinkingLevel() : 'off'
        const cost = totalCost(ctx)
        const usingSub = ctx.model ? (ctx.modelRegistry as any).isUsingOAuth?.(ctx.model) : false

        const parts = [
          makeSegment(theme, 'accent', 'π'),
          makeSegment(theme, 'toolTitle', `✺ ${modelLabel(ctx)}`),
          makeSegment(theme, thinkingColor(thinking), `● ${thinking === 'off' ? 'off' : thinking}`),
          makeSegment(theme, 'success', `⌘ ${compactPath(ctx.cwd)}${branch ? `:${branch}` : ''}`),
          makeSegment(theme, 'muted', formatContext(ctx)),
        ]

        if (cost > 0 || usingSub) {
          const label = usingSub ? subscriptionLabel(ctx) : undefined
          const subSuffix = usingSub ? ` (sub${label ? `: ${label}` : ''})` : ''
          parts.push(makeSegment(theme, 'warning', `$${cost.toFixed(cost >= 10 ? 2 : 3)}${subSuffix}`))
        }

        const left = parts.join(sep)
        const sessionName = ctx.sessionManager.getSessionName()
        const right = sessionName ? makeSegment(theme, 'accent', sessionName) : ''

        lines[0] = border('╭─') + fitStatusLine(left, right, innerWidth, border)
        const removedBottomIndex = removeBottomEditorBorder(lines, innerWidth)
        const lastEditorContentLine = Math.max(1, removedBottomIndex - 1)

        for (let i = 1; i < lines.length; i++) {
          const isEditorContent = i <= lastEditorContentLine
          const isBottomLeft = i === lastEditorContentLine
          const prefix = isEditorContent
            ? border(isBottomLeft ? '╰' : '│') + ' '
            : '  '
          lines[i] = prefix + lines[i]
        }

        return lines
      }
    }

    ctx.ui.setEditorComponent((tui, theme, keybindings) => new OmpChatboxEditor(tui, theme, keybindings))
  })
}
