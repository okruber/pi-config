import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  UserMessageComponent,
} from '@earendil-works/pi-coding-agent'
import { stripTerminalSequences } from '@earendil-works/pi-tui'
import {
  loadThemeFromPath,
  setThemeInstance,
} from '../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js'
import { hexToFg, IMETO_COLORS } from '../extensions/imeto-style.ts'
import imetoTranscriptExtension, {
  transformTranscriptMarkdown,
} from '../extensions/imeto-transcript.ts'

const themePath = fileURLToPath(new URL('../themes/imeto-bone.json', import.meta.url))

const baseContext = {
  isStreaming: false,
  availableWidth: 80,
  themeSourcePath: themePath,
} as const

test('user Markdown receives the YOU label and quoted structural edge', () => {
  const transformed = transformTranscriptMarkdown('Inspect `theme.json`.\n\nKeep the diff small.', {
    ...baseContext,
    messageType: 'user',
  })
  assert.equal(
    stripTerminalSequences(transformed),
    '> YOU\n>\n> Inspect `theme.json`.\n> \n> Keep the diff small.',
  )
})

test('thinking receives only the quiet quoted edge', () => {
  assert.equal(
    transformTranscriptMarkdown('Checking the contract.\nThen running tests.', {
      ...baseContext,
      messageType: 'assistant-thinking',
      isStreaming: true,
    }),
    '> Checking the contract.\n> Then running tests.',
  )
})

test('assistant Markdown remains unchanged during streaming and final render', () => {
  const markdown = '## Result\n\nBody with `code`.'
  assert.equal(transformTranscriptMarkdown(markdown, {
    ...baseContext,
    messageType: 'assistant',
    isStreaming: true,
  }), markdown)
  assert.equal(transformTranscriptMarkdown(markdown, {
    ...baseContext,
    messageType: 'assistant',
  }), markdown)
})

test('blank and long user content remain valid quoted Markdown', () => {
  const long = `first\n\n${'long '.repeat(80).trim()}`
  const transformed = stripTerminalSequences(transformTranscriptMarkdown(long, {
    ...baseContext,
    messageType: 'user',
    availableWidth: 40,
  }))
  assert.ok(transformed.startsWith('> YOU\n>\n> first\n> \n> long'))
  assert.equal(stripTerminalSequences(transformTranscriptMarkdown('', {
    ...baseContext,
    messageType: 'user',
    availableWidth: 40,
  })), '> YOU\n>\n> ')
})

test('missing theme data uses exact Im­eto transcript fallbacks', () => {
  const transformed = transformTranscriptMarkdown('Body', {
    messageType: 'user',
    isStreaming: false,
    availableWidth: 80,
    themeSourcePath: '/missing/imeto-theme.json',
  })
  assert.ok(transformed.includes(hexToFg(IMETO_COLORS.oxblood)))
  assert.ok(transformed.includes(hexToFg(IMETO_COLORS.deepNavy)))
})

test('extension wiring follows live TUI themes and clears them for other lifecycles', () => {
  const directory = mkdtempSync(join(tmpdir(), 'imeto-transcript-'))
  try {
    const firstPath = join(directory, 'first.json')
    const secondPath = join(directory, 'second.json')
    writeFileSync(firstPath, JSON.stringify({ vars: { oxblood: '#010203', deepNavy: '#040506' } }))
    writeFileSync(secondPath, JSON.stringify({ vars: { oxblood: '#111213', deepNavy: '#141516' } }))

    const handlers = new Map<string, (...args: any[]) => void>()
    let transformer: ((markdown: string, context: any) => string) | undefined
    const pi = {
      registerMarkdownTransformer(value: typeof transformer) {
        transformer = value
      },
      on(name: string, handler: (...args: any[]) => void) {
        handlers.set(name, handler)
      },
    }
    imetoTranscriptExtension(pi as any)
    assert.ok(transformer)

    const theme = { sourcePath: firstPath }
    handlers.get('session_start')?.({}, { mode: 'tui', ui: { theme } })
    const transform = () => transformer!('Body', {
      messageType: 'user', isStreaming: false, availableWidth: 80,
    })
    assert.ok(transform().includes(hexToFg('#010203')))
    theme.sourcePath = secondPath
    assert.ok(transform().includes(hexToFg('#111213')))

    handlers.get('session_start')?.({}, { mode: 'print' })
    assert.ok(transform().includes(hexToFg(IMETO_COLORS.oxblood)))

    handlers.get('session_start')?.({}, { mode: 'tui', ui: { theme } })
    handlers.get('session_shutdown')?.()
    assert.ok(transform().includes(hexToFg(IMETO_COLORS.oxblood)))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('Pi renders the user label and body with distinct upright Im­eto roles', () => {
  setThemeInstance(loadThemeFromPath(themePath, 'truecolor'))
  const transformer = (markdown: string, context: any) => transformTranscriptMarkdown(markdown, {
    ...context,
    themeSourcePath: themePath,
  })
  const component = new UserMessageComponent('Inspect `theme.json`.', undefined, 1, [transformer])
  const lines = component.render(60)
  const label = lines.find((line) => stripTerminalSequences(line).includes('YOU'))
  const body = lines.find((line) => stripTerminalSequences(line).includes('Inspect'))
  assert.ok(label)
  assert.ok(body)
  assert.match(label, new RegExp(`\\x1b\\[23m${escapeRegExp(hexToFg(IMETO_COLORS.oxblood))}\\x1b\\[1mYOU`))
  assert.match(body, new RegExp(`\\x1b\\[23m${escapeRegExp(hexToFg(IMETO_COLORS.deepNavy))}Inspect`))
  assert.match(stripTerminalSequences(label), /│ YOU/)
  assert.match(stripTerminalSequences(body), /│ Inspect theme\.json\./)
})

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
