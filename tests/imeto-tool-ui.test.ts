import assert from 'node:assert/strict'
import test from 'node:test'
import { Box, Text, stripTerminalSequences, visibleWidth } from '@earendil-works/pi-tui'
import {
  EdgeOutputComponent,
  ToolLedgerComponent,
  fitAnsi,
  paintEditorBody,
  renderDock,
  renderQuietFooter,
  selectDockFields,
  selectPreviewLines,
  stripBackgroundAnsi,
  summarizeToolCall,
  toolStateSymbol,
  toolVisualState,
  type DockField,
} from '../extensions/imeto-tool-ui.ts'

const theme = {
  sourcePath: undefined,
  fg: (_name: string, text: string) => text,
  bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
} as any

const dockFields: DockField[] = [
  { id: 'identity', text: 'π', role: 'identity', required: true },
  { id: 'model', text: '✺ claude-opus-5', role: 'model', required: true },
  { id: 'reasoning', text: '● high', role: 'reasoning', required: true },
  { id: 'path', text: '⌘ ~/a/very/long/project/path:imeto-terminal-ui', role: 'path', required: false },
  { id: 'context', text: '31%/200k', role: 'context', required: false },
  { id: 'cost', text: '$0.420', role: 'cost', required: false },
  { id: 'cache', text: 'cache 96.1% · day 94.2%', role: 'cache', required: false },
  { id: 'session', text: 'imeto visual acceptance', role: 'session', required: false },
]

test('dock fields degrade in semantic priority order', () => {
  assert.deepEqual(selectDockFields(dockFields, 160).map((field) => field.id), [
    'identity', 'model', 'reasoning', 'path', 'context', 'cost', 'cache', 'session',
  ])
  const standard = selectDockFields(dockFields, 120).map((field) => field.id)
  assert.ok(standard.includes('path'))
  assert.ok(standard.includes('context'))
  assert.ok(!standard.includes('session'))
  assert.deepEqual(selectDockFields(dockFields, 80).map((field) => field.id), [
    'identity', 'model', 'reasoning',
  ])
})

test('dock, editor body, and quiet footer respect every supplied width', () => {
  for (const width of [1, 20, 40, 80, 120, 160]) {
    const rows = [
      renderDock(dockFields, width),
      paintEditorBody('editor content that is intentionally long', width),
      renderQuietFooter('esc interrupts · ctrl+o expands · / commands', '12 tok/s', width),
    ]
    for (const row of rows) assert.ok(visibleWidth(row) <= width)
    if (width > 0) assert.match(rows[0]!, /\x1b\[22m\x1b\[27m\x1b\[39m\x1b\[49m$/)
  }
})

test('editor body restores Cloud Petal after cursor and truncation resets', () => {
  const row = paintEditorBody(`before\x1b[0m${'after'.repeat(20)}`, 40)
  assert.match(row, /\x1b\[0m\x1b\[48;2;251;249;247mafter/)
  assert.equal(row.match(/\x1b\[0m\x1b\[48;2;251;249;247m/g)?.length, 2)
  assert.match(row, /\x1b\[49m$/)
})

test('dock selection truncates paths before required fields', () => {
  const fields: DockField[] = [
    ...dockFields.slice(0, 3),
    {
      id: 'path',
      text: `⌘ ~/${'deep/'.repeat(30)}project`,
      role: 'path',
      required: false,
    },
  ]
  const selected = selectDockFields(fields, 100)
  assert.deepEqual(selected.map((field) => field.id), [
    'identity', 'model', 'reasoning', 'path',
  ])
  assert.match(selected.at(-1)!.text, /…$/)

  const required = selectDockFields(dockFields.slice(0, 3), 20)
  assert.deepEqual(required.map((field) => field.id), ['identity', 'model', 'reasoning'])
  assert.match(required[1]!.text, /…$/)
  assert.equal(required[2]!.text, '● high')
})

test('dock selection never mutates caller fields', () => {
  const snapshot = structuredClone(dockFields)
  selectDockFields(dockFields, 40)
  assert.deepEqual(dockFields, snapshot)
})

test('dock uses truecolor segments and powerline separators', () => {
  const row = renderDock(dockFields.slice(0, 3), 80)
  assert.match(row, /^\x1b\[48;2;106;48;38m\x1b\[38;2;251;249;247m π /)
  assert.equal(stripTerminalSequences(row).split('\uE0B0').length - 1, 2)
})

test('tool states use the approved symbols', () => {
  assert.equal(toolStateSymbol(toolVisualState(true, false)), '◌')
  assert.equal(toolStateSymbol(toolVisualState(false, false)), '✓')
  assert.equal(toolStateSymbol(toolVisualState(false, true)), '×')
})

test('ledger state symbols use the approved semantic colors', () => {
  const pending = new ToolLedgerComponent({
    name: 'read', args: { path: 'a.ts' }, cwd: '/repo', expanded: false,
    isPartial: true, isError: false, theme, expansionHint: 'expand',
  })
  const success = new ToolLedgerComponent({
    name: 'read', args: { path: 'a.ts' }, cwd: '/repo', expanded: false,
    isPartial: false, isError: false, theme, expansionHint: 'expand',
  })
  const error = new ToolLedgerComponent({
    name: 'read', args: { path: 'a.ts' }, cwd: '/repo', expanded: false,
    isPartial: false, isError: true, theme, expansionHint: 'expand',
  })
  assert.match(pending.render(80)[0]!, /\x1b\[38;2;165;97;72m◌/)
  assert.match(success.render(80)[0]!, /\x1b\[38;2;62;71;57m✓/)
  assert.match(error.render(80)[0]!, /\x1b\[38;2;106;48;38m×/)
})

test('every decorated tool exposes its useful argument', () => {
  assert.deepEqual(summarizeToolCall('read', { path: 'src/a.ts' }, '/repo'), {
    action: 'read', subject: 'src/a.ts',
  })
  assert.deepEqual(summarizeToolCall('edit', { path: 'src/a.ts' }, '/repo'), {
    action: 'edit', subject: 'src/a.ts',
  })
  assert.deepEqual(summarizeToolCall('write', { path: 'src/a.ts' }, '/repo'), {
    action: 'write', subject: 'src/a.ts',
  })
  assert.deepEqual(summarizeToolCall('bash', { command: 'node --test' }, '/repo'), {
    action: 'bash', subject: 'node --test',
  })
  assert.deepEqual(summarizeToolCall('grep', { pattern: 'needle', path: 'src' }, '/repo'), {
    action: 'grep', subject: '/needle/ in src',
  })
  assert.deepEqual(summarizeToolCall('find', { pattern: '**/*.ts', path: 'src' }, '/repo'), {
    action: 'find', subject: '**/*.ts in src',
  })
  assert.deepEqual(summarizeToolCall('ls', { path: 'src' }, '/repo'), {
    action: 'ls', subject: 'src',
  })
})

test('tool summaries remove terminal controls and normalize line breaks', () => {
  const summary = summarizeToolCall('bash', {
    command: 'printf one\n\x1b[31mprintf two\x1b[0m',
  }, '/repo')
  assert.equal(summary.subject, 'printf one ↵ printf two')
  assert.ok(!summary.subject.includes('\n'))
  assert.ok(!summary.subject.includes('\x1b'))
})

test('collapsed previews apply tool-specific visual-line limits', () => {
  const lines = Array.from({ length: 9 }, (_, index) => `line ${index + 1}`)
  assert.deepEqual(selectPreviewLines('read', lines, false).lines, lines.slice(0, 5))
  assert.deepEqual(selectPreviewLines('grep', lines, false).lines, lines.slice(0, 5))
  assert.deepEqual(selectPreviewLines('find', lines, false).lines, lines.slice(0, 5))
  assert.deepEqual(selectPreviewLines('ls', lines, false).lines, lines.slice(0, 5))
  assert.deepEqual(selectPreviewLines('bash', lines, false).lines, lines.slice(-5))
  assert.deepEqual(selectPreviewLines('read', lines, true).lines, lines)
})

test('collapsed edit output counts ANSI-prefixed changed lines', () => {
  const color = '\x1b[31m'
  const reset = '\x1b[39m'
  const lines = [
    ' context', `${color}- one${reset}`, `${color}+ two${reset}`,
    `${color}- three${reset}`, `${color}+ four${reset}`, `${color}- five${reset}`,
    `${color}+ six${reset}`, `${color}- seven${reset}`,
  ]
  const selected = selectPreviewLines('edit', lines, false)
  const changed = selected.lines.filter((line) => /^[+-]/.test(stripTerminalSequences(line)))
  assert.equal(changed.length, 6)
  assert.equal(selected.omitted, 1)
})

test('ANSI fitting closes all state and respects visible width', () => {
  const fitted = fitAnsi('\x1b[31m\x1b[48;2;1;2;3m\x1b[1m\x1b[7mabcdefgh', 5)
  assert.ok(visibleWidth(fitted) <= 5)
  assert.match(fitted, /\x1b\[22m\x1b\[27m\x1b\[39m\x1b\[49m$/)
})

test('background stripping keeps foreground color for every supported background mode', () => {
  assert.equal(
    stripBackgroundAnsi('\x1b[48;2;1;2;3m\x1b[31m-added\x1b[49m'),
    '\x1b[31m-added',
  )
  assert.equal(stripBackgroundAnsi('\x1b[48;5;123mvalue\x1b[49m'), 'value')
  assert.equal(stripBackgroundAnsi('\x1b[40mvalue\x1b[49m'), 'value')
  assert.equal(stripBackgroundAnsi('\x1b[104mvalue\x1b[49m'), 'value')
})

test('ledger expansion controls semantic write previews once', () => {
  const semanticBody = new Text([
    'write src/file.ts', '', ...Array.from({ length: 8 }, (_, index) => `line ${index + 1}`),
  ].join('\n'), 0, 0)
  const input = {
    name: 'write' as const,
    args: { path: 'src/file.ts' },
    cwd: '/repo',
    isPartial: false,
    isError: false,
    theme,
    semanticBody,
    expansionHint: 'custom expand hint',
  }
  const collapsed = new ToolLedgerComponent({ ...input, expanded: false }).render(40)
    .map(stripTerminalSequences).join('\n')
  const expanded = new ToolLedgerComponent({ ...input, expanded: true }).render(40)
    .map(stripTerminalSequences).join('\n')
  assert.match(collapsed, /line 6/)
  assert.doesNotMatch(collapsed, /line 7/)
  assert.match(collapsed, /custom expand hint/)
  assert.doesNotMatch(collapsed, /ctrl\+o/)
  assert.match(expanded, /line 8/)
  assert.doesNotMatch(expanded, /expand hint/)
})

test('edge output preserves meaningful leading indentation', () => {
  const edge = new EdgeOutputComponent({
    name: 'read',
    inner: new Text('  indented\nplain', 0, 0),
    expanded: true,
    theme,
    expansionHint: 'ctrl+o to expand',
  })
  const lines = edge.render(20).map(stripTerminalSequences)
  assert.match(lines[0]!, /^│   indented/)
  assert.match(lines[1]!, /^│ plain/)
})

test('edit ledger removes only the original shell padding cell', () => {
  const semanticBody = new Box(1, 1, (text) => `\x1b[48;2;1;2;3m${text}\x1b[49m`)
  semanticBody.addChild(new Text([
    'edit src/file.ts', '', '\x1b[31m- one\x1b[39m', '  context', '\x1b[32m+ two\x1b[39m',
  ].join('\n'), 0, 0))
  const lines = new ToolLedgerComponent({
    name: 'edit',
    args: { path: 'src/file.ts' },
    cwd: '/repo',
    expanded: true,
    isPartial: false,
    isError: false,
    theme,
    expansionHint: 'expand',
    semanticBody,
  }).render(30)
  const plain = lines.map(stripTerminalSequences)
  assert.match(plain.join('\n'), /│ - one/)
  assert.match(plain.join('\n'), /│   context/)
  assert.match(plain.join('\n'), /│ \+ two/)
  assert.ok(lines.every((line) => !line.includes('\x1b[48;2;1;2;3m')))
})

test('summary and preview policies do not mutate caller data', () => {
  const args = Object.freeze({ command: 'printf ok' })
  const lines = Object.freeze(['one', 'two', 'three'])
  assert.deepEqual(summarizeToolCall('bash', args, '/repo'), {
    action: 'bash', subject: 'printf ok',
  })
  assert.deepEqual(selectPreviewLines('read', lines as unknown as string[], false), {
    lines: ['one', 'two', 'three'], omitted: 0,
  })
  assert.deepEqual(lines, ['one', 'two', 'three'])
})

test('ledger and edge components never exceed supplied width', () => {
  const ledger = new ToolLedgerComponent({
    name: 'read', args: { path: 'a/very/long/path/to/file.ts' }, cwd: '/repo',
    expanded: false, isPartial: false, isError: false, theme, expansionHint: 'expand',
  })
  const edge = new EdgeOutputComponent({
    name: 'read', inner: new Text(Array.from({ length: 9 }, (_, i) => `output ${i}`).join('\n'), 0, 0),
    expanded: false, theme, expansionHint: 'ctrl+o to expand',
  })
  for (const width of [1, 12, 40, 80, 120, 160]) {
    for (const line of [...ledger.render(width), ...edge.render(width)]) {
      assert.ok(visibleWidth(line) <= width, `${visibleWidth(line)} > ${width}`)
    }
  }
})
