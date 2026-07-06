// Make Pi tool-result highlights look more like the OMP harness:
// subtle Catppuccin card fill from the theme, plus a thin rounded border.
// This is intentionally defensive because it patches Pi's internal TUI class.

import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const PATCH_FLAG = Symbol.for('pi.omp-tool-boxes.patched')
const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g

function fallbackVisibleWidth(text: string): number {
  // Good enough for box padding; Pi's own utility is used when available.
  return Array.from(text.replace(ANSI_RE, '')).length
}

function padVisible(line: string, width: number, visibleWidth: (text: string) => number): string {
  const pad = Math.max(0, width - visibleWidth(line))
  return line + ' '.repeat(pad)
}

export default async function () {
  const globalState = globalThis as typeof globalThis & { [PATCH_FLAG]?: boolean }
  if (globalState[PATCH_FLAG]) return
  globalState[PATCH_FLAG] = true

  try {
    const require = createRequire(import.meta.url)
    const resolveOr = (specifier: string, fallback: string): string => {
      try {
        return require.resolve(specifier)
      } catch {
        return fallback
      }
    }

    const piRoot = '/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent'
    const toolExecutionPath = resolveOr(
      '@earendil-works/pi-coding-agent/dist/modes/interactive/components/tool-execution.js',
      `${piRoot}/dist/modes/interactive/components/tool-execution.js`,
    )
    const themePath = resolveOr(
      '@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js',
      `${piRoot}/dist/modes/interactive/theme/theme.js`,
    )
    const tuiUtilsPath = resolveOr(
      '@earendil-works/pi-tui/dist/utils.js',
      `${piRoot}/node_modules/@earendil-works/pi-tui/dist/utils.js`,
    )

    const [{ ToolExecutionComponent }, { theme }, tuiUtils] = await Promise.all([
      import(pathToFileURL(toolExecutionPath).href),
      import(pathToFileURL(themePath).href),
      import(pathToFileURL(tuiUtilsPath).href).catch(() => ({})),
    ])

    if (!ToolExecutionComponent?.prototype?.render) return

    const visibleWidth =
      typeof tuiUtils.visibleWidth === 'function' ? tuiUtils.visibleWidth : fallbackVisibleWidth
    const originalRender = ToolExecutionComponent.prototype.render

    ToolExecutionComponent.prototype.render = function ompToolBoxRender(width: number): string[] {
      // Leave custom self-rendering tools alone; they own their own frame.
      try {
        if (typeof this.getRenderShell === 'function' && this.getRenderShell() === 'self') {
          return originalRender.call(this, width)
        }
      } catch {
        return originalRender.call(this, width)
      }

      if (width < 8) return originalRender.call(this, width)

      const innerWidth = Math.max(1, width - 2)
      const lines: string[] = originalRender.call(this, innerWidth)
      if (!Array.isArray(lines) || lines.length === 0) return lines

      const leading: string[] = []
      let firstBodyLine = 0
      while (firstBodyLine < lines.length && visibleWidth(lines[firstBodyLine].trim()) === 0) {
        leading.push(lines[firstBodyLine])
        firstBodyLine++
      }

      const body = lines.slice(firstBodyLine)
      if (body.length === 0) return lines

      const colorBorder = (text: string) => {
        try {
          return theme.fg('borderMuted', text)
        } catch {
          return text
        }
      }

      const horizontal = '─'.repeat(innerWidth)
      const top = colorBorder(`╭${horizontal}╮`)
      const bottom = colorBorder(`╰${horizontal}╯`)
      const boxed = body.map(
        (line) => colorBorder('│') + padVisible(line, innerWidth, visibleWidth) + colorBorder('│'),
      )

      return [...leading, top, ...boxed, bottom]
    }
  } catch {
    // Styling must never interfere with agent startup.
  }
}
