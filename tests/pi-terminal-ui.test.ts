import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { stripTerminalSequences, visibleWidth } from '@earendil-works/pi-tui'
import {
  loadThemeFromPath,
  setThemeInstance,
} from '../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js'
import {
  TERMINAL_UI_COLORS,
  hexToBg,
  hexToFg,
  readThemeHex,
} from '../extensions/pi-terminal-ui-style.ts'
import {
  contextRole,
  fitStatusWidths,
  statusHex,
  statusText,
} from '../extensions/pi-terminal-ui-status.ts'
import {
  TOKEN_CACHE_STATUS_KEY,
  TOKEN_RATE_STATUS_KEY,
} from '../extensions/pi-terminal-ui-tools.ts'
import ompChatboxExtension, {
  contextDockRole,
  partitionEditorRows,
} from '../extensions/omp-chatbox.ts'
import tokenSpeedExtension, {
  cacheStatusLabel,
  tokenRateStatusLabel,
  type CacheCounters,
} from '../extensions/token-speed.ts'

const piThemePath = new URL('../themes/bone.json', import.meta.url).pathname
setThemeInstance(loadThemeFromPath(piThemePath, 'truecolor'))

const EXPECTED = {
  oxblood: '#6a3026',
  bone: '#e9e3df',
  darkSpruce: '#1c1e1b',
  deepNavy: '#04162a',
  mossGreen: '#3e4739',
  mauveTaupe: '#907062',
  cloudPetal: '#fbf9f7',
  sageGrey: '#89897c',
  dustyBlue: '#8894a0',
  terracotta: '#a56148',
} as const

test('sampled Pi Terminal UI palette remains exact', () => {
  assert.deepEqual(TERMINAL_UI_COLORS, EXPECTED)
})

test('hex helpers emit truecolor ANSI sequences', () => {
  assert.equal(hexToFg('#6a3026'), '\x1b[38;2;106;48;38m')
  assert.equal(hexToBg('#e9e3df'), '\x1b[48;2;233;227;223m')
})

test('theme lookup uses the first matching valid hex value', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-terminal-ui-theme-'))
  const sourcePath = join(dir, 'theme.json')
  writeFileSync(sourcePath, JSON.stringify({ vars: { accent: '#123456', fallback: 'invalid' } }))
  assert.equal(readThemeHex(sourcePath, ['missing', 'accent']), '#123456')
  assert.equal(readThemeHex(sourcePath, ['fallback']), undefined)
})

test('theme lookup tolerates a missing source file', () => {
  assert.equal(readThemeHex('/missing/theme.json', ['accent']), undefined)
  assert.equal(readThemeHex(undefined, ['accent']), undefined)
})

const REQUIRED_THEME_TOKENS = [
  'accent', 'border', 'borderAccent', 'borderMuted', 'success', 'error',
  'warning', 'muted', 'dim', 'text', 'thinkingText', 'selectedBg',
  'userMessageBg', 'userMessageText', 'customMessageBg', 'customMessageText',
  'customMessageLabel', 'toolPendingBg', 'toolSuccessBg', 'toolErrorBg',
  'toolTitle', 'toolOutput', 'mdHeading', 'mdLink', 'mdLinkUrl', 'mdCode',
  'mdCodeBlock', 'mdCodeBlockBorder', 'mdQuote', 'mdQuoteBorder', 'mdHr',
  'mdListBullet', 'toolDiffAdded', 'toolDiffRemoved', 'toolDiffContext',
  'syntaxComment', 'syntaxKeyword', 'syntaxFunction', 'syntaxVariable',
  'syntaxString', 'syntaxNumber', 'syntaxType', 'syntaxOperator',
  'syntaxPunctuation', 'thinkingOff', 'thinkingMinimal', 'thinkingLow',
  'thinkingMedium', 'thinkingHigh', 'thinkingXhigh', 'bashMode',
] as const

test('Pi theme defines every required token and exact brand variables', () => {
  const theme = JSON.parse(readFileSync(new URL('../themes/bone.json', import.meta.url), 'utf8'))
  assert.equal(theme.name, 'bone')
  for (const [name, hex] of Object.entries(TERMINAL_UI_COLORS)) assert.equal(theme.vars[name], hex)
  for (const token of REQUIRED_THEME_TOKENS) assert.equal(typeof theme.colors[token], 'string', token)
})

test('terminal theme pairs Bone background with Deep Navy foreground', () => {
  const yaml = readFileSync(new URL('../themes/bone.terminal.yaml', import.meta.url), 'utf8')
  assert.match(yaml, /^name: Bone$/m)
  assert.match(yaml, /^background: "#e9e3df"$/m)
  assert.match(yaml, /^foreground: "#04162a"$/m)
  assert.match(yaml, /^selection: "#907062"$/m)
})

test('status roles map to the approved Pi Terminal UI palette', () => {
  assert.equal(statusHex('identity'), TERMINAL_UI_COLORS.oxblood)
  assert.equal(statusHex('model'), TERMINAL_UI_COLORS.dustyBlue)
  assert.equal(statusHex('reasoning'), TERMINAL_UI_COLORS.mossGreen)
  assert.equal(statusHex('path'), TERMINAL_UI_COLORS.terracotta)
  assert.equal(statusHex('context'), TERMINAL_UI_COLORS.mauveTaupe)
  assert.equal(statusHex('danger'), TERMINAL_UI_COLORS.oxblood)
})

test('status roles honor matching variables from the active theme', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-terminal-ui-status-'))
  const sourcePath = join(dir, 'theme.json')
  writeFileSync(sourcePath, JSON.stringify({ vars: { oxblood: '#123456' } }))
  assert.equal(statusHex('identity', sourcePath), '#123456')
  assert.equal(statusHex('model', sourcePath), TERMINAL_UI_COLORS.dustyBlue)
})

test('context pressure selects neutral, warning, and danger roles', () => {
  assert.equal(contextRole(null), 'muted')
  assert.equal(contextRole(69.9), 'context')
  assert.equal(contextRole(70), 'path')
  assert.equal(contextRole(89.9), 'path')
  assert.equal(contextRole(90), 'danger')
})

test('status text closes bold and foreground ANSI state', () => {
  const text = statusText('identity', 'π')
  assert.match(text, /^\x1b\[38;2;106;48;38m\x1b\[1mπ/)
  assert.match(text, /\x1b\[22m\x1b\[39m$/)
})

test('status widths fit wide and narrow terminals', () => {
  assert.deepEqual(fitStatusWidths(70, 20, 80), { left: 70, right: 7, gap: 3 })
  assert.deepEqual(fitStatusWidths(70, 20, 40), { left: 37, right: 0, gap: 3 })
  assert.deepEqual(fitStatusWidths(12, 0, 20), { left: 12, right: 0, gap: 8 })
})

test('dock context colors preserve pressure thresholds', () => {
  const role = (percent: number | null) => contextDockRole({
    getContextUsage: () => ({ percent }),
  } as any)
  assert.equal(role(null), 'session')
  assert.equal(role(69.9), 'context')
  assert.equal(role(70), 'path')
  assert.equal(role(90), 'identity')
})

test('editor row partition removes only Pi borders', () => {
  assert.deepEqual(partitionEditorRows([
    '────────', 'first   ', 'second  ', '────────', 'choice  ',
  ], 8), {
    editorRows: ['first   ', 'second  '],
    autocompleteRows: ['choice  '],
  })
  assert.deepEqual(partitionEditorRows([
    '─── ↑ 2 more ', 'body         ', '─── ↓ 3 more ',
  ], 13), {
    editorRows: ['body         '],
    autocompleteRows: [],
  })
})

test('chatbox renders dock, raised editor rows, and quiet footer', () => {
  const handlers = new Map<string, (...args: any[]) => void>()
  let footerFactory: ((...args: any[]) => any) | undefined
  let editorFactory: ((...args: any[]) => any) | undefined
  const pi = {
    on(name: string, handler: (...args: any[]) => void) {
      handlers.set(name, handler)
    },
    exec: async () => ({ stdout: 'feature\n' }),
    getThinkingLevel: () => 'high',
  }
  ompChatboxExtension(pi as any)
  const statuses = new Map([
    [TOKEN_CACHE_STATUS_KEY, 'cache 96.1%'],
    [TOKEN_RATE_STATUS_KEY, '12 tok/s'],
  ])
  const theme = {
    sourcePath: undefined,
    fg: (_name: string, text: string) => text,
  }
  const ctx = {
    mode: 'tui',
    cwd: '/repo',
    model: { provider: 'test', id: 'model', name: 'Claude', contextWindow: 200000 },
    modelRegistry: { isUsingOAuth: () => false },
    getContextUsage: () => ({ percent: 31, tokens: 62000, contextWindow: 200000 }),
    sessionManager: {
      getEntries: () => [],
      getSessionName: () => 'acceptance',
    },
    ui: {
      theme,
      setFooter(factory: typeof footerFactory) {
        footerFactory = factory
      },
      setEditorComponent(factory: typeof editorFactory) {
        editorFactory = factory
      },
    },
  }

  handlers.get('session_start')?.({}, ctx)
  assert.ok(footerFactory)
  assert.ok(editorFactory)
  const tui = { terminal: { rows: 40 }, requestRender: () => undefined }
  const footer = footerFactory(tui, theme, {
    getExtensionStatuses: () => statuses,
  })
  assert.deepEqual(footer.render(80), [])
  const editor = editorFactory(tui, {
    borderColor: (text: string) => text,
    selectList: {},
  }, { matches: () => false })
  editor.setText('first line\nsecond line')
  const rows = editor.render(80)
  const plain = rows.map(stripTerminalSequences)
  assert.match(plain[0]!, /π.*✺ Claude.*● high/)
  assert.ok(plain.some((line) => /^│ first line/.test(line)))
  assert.ok(plain.some((line) => /esc.*interrupts.*12 tok\/s/.test(line)))
  assert.ok(!plain.some((line) => /^─+$/.test(line)))
  for (const row of rows) assert.ok(visibleWidth(row) <= 80)
  handlers.get('session_shutdown')?.({}, ctx)
})

test('token-speed publishes dock statuses without a second powerline widget', () => {
  const source = readFileSync(new URL('../extensions/token-speed.ts', import.meta.url), 'utf8')
  assert.match(source, /TOKEN_CACHE_STATUS_KEY/)
  assert.match(source, /TOKEN_RATE_STATUS_KEY/)
  assert.match(source, /ctx\.ui\.setStatus/)
  assert.doesNotMatch(source, /ctx\.ui\.setWidget/)
})

test('cache and token-rate status labels are plain and compact', () => {
  const session: CacheCounters = {
    day: '2026-09-05',
    totalRequests: 4,
    hitRequests: 3,
    cachedInputTokens: 961,
    totalInputTokens: 1000,
  }
  const total: CacheCounters = {
    ...session,
    cachedInputTokens: 942,
  }
  assert.equal(cacheStatusLabel(session, total, false), 'cache 96.1% · day 94.2%')
  assert.equal(cacheStatusLabel(session, undefined, true), 'cache 96.1% ⚠')
  assert.equal(cacheStatusLabel(undefined, undefined, false), undefined)
  assert.equal(tokenRateStatusLabel(false, 12.4), '0 tok/s')
  assert.equal(tokenRateStatusLabel(true, 12.4), '12 tok/s')
})

test('token-speed refreshes and clears both dock statuses', () => {
  const handlers = new Map<string, (...args: any[]) => void>()
  const statusCalls: Array<[string, string | undefined]> = []
  tokenSpeedExtension({
    on(name: string, handler: (...args: any[]) => void) {
      handlers.set(name, handler)
    },
  } as any)
  const ctx = {
    mode: 'tui',
    model: undefined,
    sessionManager: { getSessionId: () => 'session-id' },
    ui: {
      setStatus(key: string, value: string | undefined) {
        statusCalls.push([key, value])
      },
    },
  }

  try {
    handlers.get('session_start')?.({}, ctx)
    handlers.get('message_start')?.({ message: { role: 'assistant' } }, ctx)
    handlers.get('message_update')?.({
      assistantMessageEvent: { type: 'text_delta', delta: 'streaming text' },
    }, ctx)
    const beforeModelSelect = statusCalls.length
    handlers.get('model_select')?.({}, ctx)
    assert.ok(statusCalls.length > beforeModelSelect)
    handlers.get('message_end')?.({}, ctx)
    for (const [, value] of statusCalls) {
      if (value !== undefined) assert.ok(!value.includes('\x1b'))
    }
  } finally {
    handlers.get('session_shutdown')?.({}, ctx)
  }

  assert.deepEqual(statusCalls.slice(-2), [
    [TOKEN_CACHE_STATUS_KEY, undefined],
    [TOKEN_RATE_STATUS_KEY, undefined],
  ])
})

test('token-speed performs no terminal setup outside TUI mode', () => {
  const handlers = new Map<string, (...args: any[]) => void>()
  tokenSpeedExtension({
    on(name: string, handler: (...args: any[]) => void) {
      handlers.set(name, handler)
    },
  } as any)
  let statusCalls = 0
  const ctx = {
    mode: 'print',
    model: undefined,
    sessionManager: { getSessionId: () => 'print-session' },
    ui: { setStatus: () => { statusCalls += 1 } },
  }
  handlers.get('session_start')?.({}, ctx)
  handlers.get('message_start')?.({ message: { role: 'assistant' } }, ctx)
  handlers.get('message_update')?.({
    assistantMessageEvent: { type: 'text_delta', delta: 'text' },
  }, ctx)
  handlers.get('model_select')?.({}, ctx)
  handlers.get('message_end')?.({}, ctx)
  handlers.get('agent_end')?.({}, ctx)
  handlers.get('session_shutdown')?.({}, ctx)
  assert.equal(statusCalls, 0)
})
