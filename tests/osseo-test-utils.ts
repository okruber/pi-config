import { initTheme } from '@earendil-works/pi-coding-agent'
import { stripTerminalSequences, type Component } from '@earendil-works/pi-tui'

// keyHint, renderDiff, and highlightCode read pi's global theme proxy, which
// throws until initTheme has run once in this process.
let themeReady = false
function ensureGlobalTheme(): void {
  if (themeReady) return
  try {
    initTheme('osseo-bone')
  } catch {
    initTheme('dark')
  }
  themeReady = true
}
ensureGlobalTheme()

export function fakeTheme(sourcePath?: string): any {
  return {
    sourcePath,
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  }
}

export function fakeContext(overrides: Record<string, unknown> = {}): any {
  return {
    args: {},
    toolCallId: 'call-1',
    invalidate: () => {},
    lastComponent: undefined,
    state: {},
    cwd: '/repo',
    executionStarted: false,
    argsComplete: true,
    isPartial: true,
    expanded: false,
    showImages: false,
    isError: false,
    ...overrides,
  }
}

export function renderStripped(component: Component, width: number): string[] {
  return component.render(width).map((line) => stripTerminalSequences(line))
}

export function textResult(lines: string[], details?: Record<string, unknown>): any {
  return { content: [{ type: 'text', text: lines.join('\n') }], details }
}
