import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  SettingsManager,
  UserMessageComponent,
} from '@earendil-works/pi-coding-agent'
import { Text, stripTerminalSequences, visibleWidth } from '@earendil-works/pi-tui'
import {
  loadThemeFromPath,
  setThemeInstance,
} from '../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js'
import { hexToFg, IMETO_COLORS } from '../extensions/imeto-style.ts'
import imetoTranscriptExtension, {
  createRuntimeToolDefinitions,
  decorateBuiltInTool,
  transformTranscriptMarkdown,
} from '../extensions/imeto-transcript.ts'

const themePath = fileURLToPath(new URL('../themes/imeto-bone.json', import.meta.url))
const renderTheme = loadThemeFromPath(themePath, 'truecolor')
setThemeInstance(renderTheme)

const baseContext = {
  isStreaming: false,
  availableWidth: 80,
  themeSourcePath: themePath,
} as const

const factories = [
  createReadToolDefinition,
  createBashToolDefinition,
  createEditToolDefinition,
  createWriteToolDefinition,
  createGrepToolDefinition,
  createFindToolDefinition,
  createLsToolDefinition,
] as const

test('decorators preserve every non-rendering contract field', () => {
  for (const factory of factories) {
    const original = factory('/repo') as any
    const decorated = decorateBuiltInTool(original) as any
    for (const key of [
      'name', 'label', 'description', 'parameters', 'promptSnippet',
      'promptGuidelines', 'constrainedSampling', 'prepareArguments',
      'executionMode', 'execute',
    ]) {
      assert.equal(decorated[key], original[key], `${original.name}.${key}`)
    }
    assert.equal(decorated.renderShell, 'self')
    assert.notEqual(decorated.renderCall, original.renderCall)
    assert.notEqual(decorated.renderResult, original.renderResult)
  }
})

test('runtime factories keep active read and bash settings', () => {
  const settings = SettingsManager.inMemory({
    images: { autoResize: false },
    shellCommandPrefix: 'source ~/.profile',
    shellPath: '/bin/zsh',
  })
  const definitions = createRuntimeToolDefinitions('/repo', settings as any)
  assert.deepEqual(definitions.map((definition) => definition.name), [
    'read', 'bash', 'edit', 'write', 'grep', 'find', 'ls',
  ])
  assert.match(definitions[0]!.description, /Supports text files and images/)
  assert.match(definitions[1]!.description, /Returns stdout and stderr/)
})

test('decorator retains the original execute function and result shape', async () => {
  const original = createReadToolDefinition('/repo', {
    operations: {
      access: async () => undefined,
      readFile: async () => Buffer.from('one\ntwo'),
      detectImageMimeType: async () => undefined,
    },
  }) as any
  const decorated = decorateBuiltInTool(original) as any
  const result = await decorated.execute(
    'call-1', { path: 'file.txt' }, undefined, undefined, { model: undefined },
  )
  assert.equal(decorated.execute, original.execute)
  assert.deepEqual(result, {
    content: [{ type: 'text', text: 'one\ntwo' }],
    details: undefined,
  })
})

test('registration covers only Pi built-ins', () => {
  const registered: string[] = []
  const fakePi = { registerTool: (definition: any) => registered.push(definition.name) }
  const definitions = createRuntimeToolDefinitions('/repo', SettingsManager.inMemory() as any)
  for (const definition of definitions) fakePi.registerTool(decorateBuiltInTool(definition))
  assert.deepEqual(registered, ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'])
  assert.ok(!registered.includes('ask_user_question'))
  assert.ok(!registered.some((name) => name.startsWith('mcp')))
})

test('non-semantic built-in call renderers are not invoked or retained', () => {
  for (const factory of [
    createReadToolDefinition,
    createBashToolDefinition,
    createGrepToolDefinition,
    createFindToolDefinition,
    createLsToolDefinition,
  ] as const) {
    const original = factory('/repo') as any
    let calls = 0
    original.renderCall = () => {
      calls += 1
      return new Text('discarded', 0, 0)
    }
    const decorated = decorateBuiltInTool(original) as any
    const state: Record<string, unknown> = {}
    const args = original.name === 'bash' ? { command: 'true' } : {}
    decorated.renderCall(args, renderTheme, renderContext(args, state, {
      argsComplete: false,
      isPartial: true,
    }))
    assert.equal(calls, 0, original.name)
    assert.equal(state.originalCall, undefined, original.name)
  }
})

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
    const registered: string[] = []
    let transformer: ((markdown: string, context: any) => string) | undefined
    const pi = {
      registerMarkdownTransformer(value: typeof transformer) {
        transformer = value
      },
      registerTool(definition: any) {
        registered.push(definition.name)
      },
      on(name: string, handler: (...args: any[]) => void) {
        handlers.set(name, handler)
      },
    }
    imetoTranscriptExtension(pi as any)
    assert.ok(transformer)

    const theme = { sourcePath: firstPath }
    const tuiContext = {
      mode: 'tui',
      ui: { theme },
      cwd: directory,
      isProjectTrusted: () => true,
    }
    handlers.get('session_start')?.({}, tuiContext)
    assert.deepEqual(registered, ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'])
    const transform = () => transformer!('Body', {
      messageType: 'user', isStreaming: false, availableWidth: 80,
    })
    assert.ok(transform().includes(hexToFg('#010203')))
    theme.sourcePath = secondPath
    assert.ok(transform().includes(hexToFg('#111213')))

    handlers.get('session_start')?.({}, { mode: 'print' })
    assert.ok(transform().includes(hexToFg(IMETO_COLORS.oxblood)))

    handlers.get('session_start')?.({}, tuiContext)
    handlers.get('session_shutdown')?.()
    assert.ok(transform().includes(hexToFg(IMETO_COLORS.oxblood)))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

type RenderContextOverrides = Partial<{
  cwd: string
  executionStarted: boolean
  argsComplete: boolean
  isPartial: boolean
  expanded: boolean
  showImages: boolean
  isError: boolean
  invalidate: () => void
  lastComponent: any
}>

function renderContext(args: any, state: Record<string, unknown>, overrides: RenderContextOverrides = {}) {
  return {
    args,
    toolCallId: 'render-call',
    invalidate: () => undefined,
    lastComponent: undefined,
    state,
    cwd: '/repo',
    executionStarted: true,
    argsComplete: true,
    isPartial: false,
    expanded: false,
    showImages: false,
    isError: false,
    ...overrides,
  }
}

function textResult(text: string, isError = false) {
  return {
    content: [{ type: 'text', text }],
    details: undefined,
    isError,
  }
}

function plainLines(component: any, width = 80): string[] {
  return component.render(width).map(stripTerminalSequences)
}

const rendererCases = [
  { name: 'read', factory: createReadToolDefinition, args: { path: 'src/file.txt' } },
  { name: 'bash', factory: createBashToolDefinition, args: { command: 'printf ok' } },
  {
    name: 'edit',
    factory: createEditToolDefinition,
    args: { path: 'src/file.ts', edits: [{ oldText: 'old', newText: 'new' }] },
  },
  { name: 'write', factory: createWriteToolDefinition, args: { path: 'src/file.ts', content: 'one' } },
  { name: 'grep', factory: createGrepToolDefinition, args: { pattern: 'needle', path: 'src' } },
  { name: 'find', factory: createFindToolDefinition, args: { pattern: '**/*.ts', path: 'src' } },
  { name: 'ls', factory: createLsToolDefinition, args: { path: 'src' } },
] as const

test('every built-in renderer handles streaming, error, ANSI, and indentation safely', () => {
  for (const item of rendererCases) {
    const definition = decorateBuiltInTool((item.factory as any)('/repo')) as any
    const state = {}
    const pendingContext = renderContext(item.args, state, {
      argsComplete: false,
      isPartial: true,
    })
    const pending = definition.renderCall(item.args, renderTheme, pendingContext)
    assert.match(plainLines(pending).join('\n'), new RegExp(`◌ ${item.name}`))

    const errorContext = renderContext(item.args, state, {
      argsComplete: false,
      isError: true,
      lastComponent: pending,
    })
    const failed = definition.renderCall(item.args, renderTheme, errorContext)
    assert.match(plainLines(failed).join('\n'), new RegExp(`× ${item.name}`))

    const result = definition.renderResult(
      textResult('\x1b[31mfailure\x1b[39m\n  nested', true),
      { expanded: false, isPartial: false },
      renderTheme,
      errorContext,
    )
    const rawLines = result.render(40)
    assert.match(rawLines.map(stripTerminalSequences).join('\n'), /failure/)
    assert.match(rawLines.map(stripTerminalSequences).join('\n'), /│   nested/)
    for (const line of rawLines) {
      assert.ok(visibleWidth(line) <= 40, `${item.name}: ${visibleWidth(line)} > 40`)
      assert.match(line, /\x1b\[22m\x1b\[27m\x1b\[39m\x1b\[49m$/)
    }
  }
})

test('read, bash, grep, find, and ls delegate expanded output before previewing', () => {
  for (const item of rendererCases.filter(({ name }) => name !== 'edit' && name !== 'write')) {
    const definition = decorateBuiltInTool((item.factory as any)('/repo')) as any
    const state = {}
    definition.renderCall(item.args, renderTheme, renderContext(item.args, state))
    const output = Array.from({ length: 8 }, (_, index) => `line ${index + 1}`).join('\n')
    const collapsedContext = renderContext(item.args, state)
    const collapsed = definition.renderResult(
      textResult(output),
      { expanded: false, isPartial: false },
      renderTheme,
      collapsedContext,
    )
    const collapsedText = plainLines(collapsed).join('\n')
    assert.match(collapsedText, /to expand/, item.name)
    if (item.name === 'bash') assert.doesNotMatch(collapsedText, /line 1(?:\D|$)/)
    else assert.doesNotMatch(collapsedText, /line 8(?:\D|$)/)

    const expandedContext = renderContext(item.args, state, {
      expanded: true,
      lastComponent: collapsed,
    })
    const expanded = definition.renderResult(
      textResult(output),
      { expanded: true, isPartial: false },
      renderTheme,
      expandedContext,
    )
    const expandedText = plainLines(expanded).join('\n')
    assert.match(expandedText, /line 1(?:\D|$)/, item.name)
    assert.match(expandedText, /line 8(?:\D|$)/, item.name)
    assert.doesNotMatch(expandedText, /to expand/, item.name)
  }
})

test('write decoration keeps one original renderer while applying its own preview limit', () => {
  const definition = decorateBuiltInTool(createWriteToolDefinition('/repo')) as any
  const args = {
    path: 'src/file.ts',
    content: Array.from({ length: 8 }, (_, index) => `const line${index + 1} = ${index + 1}`).join('\n'),
  }
  const state: Record<string, any> = {}
  const collapsedContext = renderContext(args, state)
  const collapsed = definition.renderCall(args, renderTheme, collapsedContext)
  const original = state.originalCall
  const collapsedText = plainLines(collapsed).join('\n')
  assert.match(collapsedText, /✓ write src\/file\.ts/)
  assert.match(collapsedText, /const line6 = 6/)
  assert.doesNotMatch(collapsedText, /const line7 = 7/)
  assert.match(collapsedText, /to expand/)

  const expanded = definition.renderCall(args, renderTheme, renderContext(args, state, {
    expanded: true,
    lastComponent: collapsed,
  }))
  assert.equal(state.originalCall, original)
  assert.match(plainLines(expanded).join('\n'), /const line8 = 8/)
})

test('edit decoration retains asynchronous preview state and source indentation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'imeto-edit-render-'))
  try {
    const path = join(directory, 'file.ts')
    const oldLines = [
      'const one = 1', 'const two = 2', '  keep', 'const three = 3',
      'const four = 4', 'const five = 5', 'const six = 6', 'const seven = 7',
    ]
    const newLines = [
      'const one = 11', 'const two = 22', '  keep', 'const three = 33',
      'const four = 44', 'const five = 55', 'const six = 66', 'const seven = 77',
    ]
    writeFileSync(path, oldLines.join('\n'))
    const args = {
      path: 'file.ts',
      edits: [{ oldText: oldLines.join('\n'), newText: newLines.join('\n') }],
    }
    const definition = decorateBuiltInTool(createEditToolDefinition(directory)) as any
    const state: Record<string, any> = {}
    let settlePreview: (() => void) | undefined
    const previewReady = new Promise<void>((resolve) => {
      settlePreview = resolve
    })
    const context = renderContext(args, state, {
      cwd: directory,
      invalidate: () => settlePreview?.(),
    })
    const initial = definition.renderCall(args, renderTheme, context)
    const original = state.originalCall
    await Promise.race([
      previewReady,
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('edit preview timeout')), 2000)),
    ])

    const collapsed = definition.renderCall(args, renderTheme, {
      ...context,
      lastComponent: initial,
    })
    assert.equal(state.originalCall, original)
    const rawCollapsed = collapsed.render(100)
    const collapsedText = rawCollapsed.map(stripTerminalSequences).join('\n')
    const changed = rawCollapsed.filter((line: string) => /^[+-]/.test(
      stripTerminalSequences(line).replace(/^│ /, ''),
    ))
    assert.match(collapsedText, /✓ edit file\.ts/)
    assert.ok(changed.length <= 6)
    assert.match(collapsedText, /  keep/)
    assert.ok(rawCollapsed.every((line: string) => !line.includes('\x1b[48;')))

    const expanded = definition.renderCall(args, renderTheme, {
      ...context,
      expanded: true,
      lastComponent: collapsed,
    })
    assert.equal(state.originalCall, original)
    assert.ok(expanded.render(100).filter((line: string) => /^[+-]/.test(
      stripTerminalSequences(line).replace(/^│ /, ''),
    )).length > 6)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('Pi renders the user label and body with distinct upright Im­eto roles', () => {
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
