import { initTheme } from '@earendil-works/pi-coding-agent'
import {
  KeybindingsManager,
  TUI_KEYBINDINGS,
  getKeybindings,
  setKeybindings,
  stripTerminalSequences,
  type Component,
} from '@earendil-works/pi-tui'
import { OSSEO_COLORS, hexToBg } from '../extensions/osseo-style.ts'

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

// Pi registers app-level keybindings like app.tools.expand at TUI startup; a
// bare test process only has the pi-tui defaults, so seed the same binding or
// expand hints render without a key.
if (getKeybindings().getKeys('app.tools.expand' as never).length === 0) {
  setKeybindings(
    new KeybindingsManager({
      ...TUI_KEYBINDINGS,
      'app.tools.expand': { defaultKeys: 'ctrl+o', description: 'Toggle tool output' },
    } as never),
  )
}

export function fakeTheme(sourcePath?: string): any {
  return {
    sourcePath,
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
    getBgAnsi: (color: string) => hexToBg((OSSEO_COLORS as Record<string, string>)[color] ?? '#000000'),
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
