import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { visibleWidth, type Component } from '@earendil-works/pi-tui'
import {
  EdgeOutputComponent,
  ToolLedgerComponent,
  buildToolDetail,
  flatDetail,
  summarizeToolCall,
  toolStateSymbol,
  toolVisualState,
  type DetailInput,
  type PendingDetailSource,
  type ToolResultContent,
} from '../extensions/osseo-call-line.ts'
import {
  OSSEO_COLORS,
  hexToBg,
  hexToFg,
  resolveThemeVar,
} from '../extensions/osseo-style.ts'
import osseoCallLineExtension from '../extensions/osseo-call-line.ts'
import osseoStyleExtension from '../extensions/osseo-style.ts'
import osseoTranscriptExtension from '../extensions/osseo-transcript.ts'

const theme = {
  sourcePath: undefined,
  fg: (_name: string, text: string) => text,
  bold: (text: string) => `\x1b[1m${hexToFg(OSSEO_COLORS.deepNavy)}${text}\x1b[22m\x1b[39m`,
} as any

function textResult(lines: string[], details?: Record<string, unknown>): ToolResultContent {
  return { content: [{ type: 'text', text: lines.join('\n') }], details }
}

function settledDetail(
  name: DetailInput['name'],
  args: Record<string, unknown>,
  result: ToolResultContent,
  extra: Partial<DetailInput> = {},
): DetailInput {
  return {
    name,
    args,
    result,
    isPartial: false,
    isError: false,
    elapsedMs: undefined,
    sourcePath: undefined,
    ...extra,
  }
}

function pendingSource(
  name: DetailInput['name'],
  args: Record<string, unknown>,
  extra: Partial<DetailInput> = {},
  isSettled = false,
): PendingDetailSource {
  return {
    isSettled: () => isSettled,
    snapshot: () => ({
      name,
      args,
      result: undefined,
      isPartial: true,
      isError: false,
      elapsedMs: undefined,
      sourcePath: undefined,
      ...extra,
    }),
  }
}

const ANSI_CLOSE = '\x1b[22m\x1b[27m\x1b[39m\x1b[49m'
const PENDING_FG = hexToFg(OSSEO_COLORS.signalOrange)
const SUCCESS_STATE_FG = hexToFg(OSSEO_COLORS.signalGreen)
const ERROR_STATE_FG = hexToFg(OSSEO_COLORS.signalRed)
const SAGE_FG = hexToFg(OSSEO_COLORS.sageGrey)
const BAND_SUCCESS = `${hexToBg(OSSEO_COLORS.toolSuccessBg)}${hexToFg(OSSEO_COLORS.mossGreen)}`
const BAND_ERROR = `${hexToBg(OSSEO_COLORS.toolErrorBg)}${hexToFg(OSSEO_COLORS.signalRed)}`

test('tool state maps to pending, success, and error', () => {
  assert.equal(toolVisualState(true, false), 'pending')
  assert.equal(toolVisualState(false, true), 'error')
  assert.equal(toolVisualState(false, false), 'success')
  assert.equal(toolVisualState(true, true), 'pending')
})

test('state glyphs are pending ring, success check, error cross', () => {
  assert.equal(toolStateSymbol('pending'), '◌')
  assert.equal(toolStateSymbol('success'), '✓')
  assert.equal(toolStateSymbol('error'), '✗')
})

test('subject mapping follows the osseo call-line contract', () => {
  assert.deepEqual(summarizeToolCall('bash', { command: 'npm test' }), {
    action: 'bash',
    subject: 'npm test',
  })
  assert.deepEqual(summarizeToolCall('read', { path: '/tmp/x.md' }), {
    action: 'read',
    subject: '/tmp/x.md',
  })
  assert.deepEqual(summarizeToolCall('edit', { path: 'src/a.ts' }), {
    action: 'edit',
    subject: 'src/a.ts',
  })
  assert.deepEqual(summarizeToolCall('write', { path: 'notes.md' }), {
    action: 'write',
    subject: 'notes.md',
  })
  assert.deepEqual(summarizeToolCall('grep', { pattern: 'TODO', path: 'src' }), {
    action: 'grep',
    subject: '/TODO/ in src',
  })
  assert.deepEqual(summarizeToolCall('grep', { pattern: 'TODO' }), {
    action: 'grep',
    subject: '/TODO/ in .',
  })
  assert.deepEqual(summarizeToolCall('find', { pattern: 'call-line', path: 'ext' }), {
    action: 'find',
    subject: 'call-line in ext',
  })
  assert.deepEqual(summarizeToolCall('ls', { path: '.' }), {
    action: 'ls',
    subject: '.',
  })
})

test('subjects normalize control characters, newlines, and runs of spaces', () => {
  assert.deepEqual(summarizeToolCall('bash', { command: 'echo a\necho\tb' }), {
    action: 'bash',
    subject: 'echo a ↵ echo b',
  })
  assert.deepEqual(summarizeToolCall('read', { path: 'a  b' }), {
    action: 'read',
    subject: 'a b',
  })
  assert.deepEqual(summarizeToolCall('read', {}), {
    action: 'read',
    subject: '…',
  })
})

test('ledger renders one width-safe line per state color', () => {
  const cases = [
    { isPartial: true, isError: false, glyph: '◌', sgr: PENDING_FG },
    { isPartial: false, isError: false, glyph: '✓', sgr: SUCCESS_STATE_FG },
    { isPartial: false, isError: true, glyph: '✗', sgr: ERROR_STATE_FG },
  ] as const
  for (const { isPartial, isError, glyph, sgr } of cases) {
    const lines = new ToolLedgerComponent({
      name: 'bash',
      args: { command: 'npm test' },
      isPartial,
      isError,
      theme,
    }).render(80)
    assert.equal(lines.length, 1)
    assert.ok(lines[0]!.includes(glyph))
    assert.ok(lines[0]!.includes(sgr))
    assert.ok(lines[0]!.includes('bash'))
    assert.ok(lines[0]!.includes('npm test'))
    assert.ok(visibleWidth(lines[0]!) <= 80)
  }
})

test('ledger respects width and returns nothing at width zero', () => {
  const ledger = new ToolLedgerComponent({
    name: 'read',
    args: { path: '/very/long/path/that/keeps/going/on/and/on/forever/and/ever.md' },
    isPartial: false,
    isError: false,
    theme,
  })
  assert.deepEqual(ledger.render(0), [])
  for (const width of [1, 5, 20, 40, 80]) {
    for (const line of ledger.render(width)) {
      assert.ok(visibleWidth(line) <= width, `width ${width}: ${JSON.stringify(line)}`)
      assert.ok(line.endsWith('\x1b[22m\x1b[27m\x1b[39m\x1b[49m'))
    }
  }
})

class StubComponent implements Component {
  private readonly lines: string[]

  constructor(lines: string[]) {
    this.lines = lines
  }

  render(): string[] {
    return [...this.lines]
  }

  invalidate(): void {}
}

test('expanded edge renderer prefixes every inner line with the gutter', () => {
  const lines = new EdgeOutputComponent({
    inner: new StubComponent(['alpha', 'beta']),
    expanded: true,
    theme,
  }).render(80)
  assert.equal(lines.length, 2)
  for (const line of lines) {
    assert.ok(line.includes('│'))
    assert.ok(line.includes('\x1b[38;2;144;112;98m'))
    assert.ok(visibleWidth(line) <= 80)
  }
})

test('collapsed edge renderer shows the flat detail and drops passthrough', () => {
  const lines = new EdgeOutputComponent({
    inner: new StubComponent(['plain result']),
    expanded: false,
    theme,
    detail: settledDetail('read', { path: '/tmp/x.md' }, textResult(['a', 'b', 'c'])),
  }).render(80)
  assert.equal(lines.length, 1)
  assert.ok(lines[0]!.includes('3 lines') && lines[0]!.includes('L1–3'))
  assert.ok(lines[0]!.includes('│'))
  assert.ok(lines.every((line) => !/[╭╮╰╯▌]/.test(line)))
  assert.ok(!lines.includes('plain result'))
})

test('flatDetail prefixes the mauve edge and closes every line', () => {
  const lines = flatDetail(['alpha', 'beta'], 60, undefined)
  assert.equal(lines.length, 2)
  for (const line of lines) {
    assert.ok(line.includes(`${hexToFg(OSSEO_COLORS.mauveTaupe)}│ \x1b[39m`))
    assert.ok(line.endsWith(ANSI_CLOSE))
    assert.ok(visibleWidth(line) <= 60)
  }
  assert.deepEqual(flatDetail(['x'], 0, undefined), [])
})

test('collapsed edge renderer without detail renders nothing', () => {
  assert.deepEqual(
    new EdgeOutputComponent({ inner: new StubComponent(['plain']), expanded: false, theme }).render(80),
    [],
  )
})

test('edge renderer handles a missing inner component', () => {
  assert.deepEqual(
    new EdgeOutputComponent({ inner: undefined, expanded: true, theme }).render(80),
    [],
  )
})

test('ledger and edge renderer stay inside every supplied width', () => {
  for (const width of [1, 2, 10, 40, 120]) {
    const rows = [
      ...new ToolLedgerComponent({
        name: 'grep',
        args: { pattern: 'osseo', path: 'extensions' },
        isPartial: true,
        isError: false,
        theme,
      }).render(width),
      ...new EdgeOutputComponent({
        inner: new StubComponent(['out ' + 'x'.repeat(width)]),
        expanded: true,
        theme,
      }).render(width),
    ]
    for (const row of rows) assert.ok(visibleWidth(row) <= width)
  }
})

test('hex helpers emit exact SGR sequences and reject bad hex', () => {
  assert.equal(hexToFg('#a56148'), '\x1b[38;2;165;97;72m')
  assert.equal(hexToBg('#3e4739'), '\x1b[48;2;62;71;57m')
  assert.throws(() => hexToFg('#a5614'), /Invalid RGB hex/)
})

test('resolveThemeVar falls back to the osseo palette without a source', () => {
  for (const name of Object.keys(OSSEO_COLORS) as (keyof typeof OSSEO_COLORS)[]) {
    assert.equal(resolveThemeVar(undefined, name), OSSEO_COLORS[name])
  }
})

test('resolveThemeVar reads a theme file once and serves later lookups from cache', () => {
  const dir = mkdtempSync(join(tmpdir(), 'osseo-style-'))
  const file = join(dir, 'theme.json')
  writeFileSync(file, JSON.stringify({ vars: { terracotta: '#a56148' } }))
  assert.equal(resolveThemeVar(file, 'terracotta'), '#a56148')
  writeFileSync(file, JSON.stringify({ vars: { terracotta: '#111111' } }))
  assert.equal(resolveThemeVar(file, 'terracotta'), '#a56148')
})

test('resolveThemeVar falls back to the palette for unknown vars and broken files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'osseo-style-'))
  const broken = join(dir, 'broken.json')
  writeFileSync(broken, '{ not json')
  const partial = join(dir, 'partial.json')
  writeFileSync(partial, JSON.stringify({ vars: { dustyBlue: '#8894a0' } }))
  assert.equal(resolveThemeVar(join(dir, 'missing.json'), 'mossGreen'), OSSEO_COLORS.mossGreen)
  assert.equal(resolveThemeVar(broken, 'mossGreen'), OSSEO_COLORS.mossGreen)
  assert.equal(resolveThemeVar(partial, 'dustyBlue'), '#8894a0')
  assert.equal(resolveThemeVar(partial, 'mossGreen'), OSSEO_COLORS.mossGreen)
})

test('detail builders band the per-tool preview', () => {
  const read = buildToolDetail(settledDetail('read', { path: '/tmp/x.md' }, textResult(['a', 'b', 'c'])))
  assert.deepEqual(read, [`${BAND_SUCCESS}3 lines · L1–3${ANSI_CLOSE}`])

  const readRange = buildToolDetail(
    settledDetail('read', { path: '/tmp/x.md', offset: 10, limit: 5 }, textResult(['a', 'b', 'c'])),
  )
  assert.deepEqual(readRange, [`${BAND_SUCCESS}3 lines · L10–14${ANSI_CLOSE}`])

  const write = buildToolDetail(settledDetail('write', { path: 'notes.md', content: 'a\nb' }, textResult([])))
  assert.deepEqual(write, [`${BAND_SUCCESS}3 B · 2 lines${ANSI_CLOSE}`])
  const grep = buildToolDetail(
    settledDetail('grep', { pattern: 'x', path: 'src' }, textResult([
      'osseo-call-line.ts:118: renderResult',
      'osseo-call-line.ts:121: renderCall',
      'osseo-transcript.ts:44: renderResult',
    ])),
  )
  assert.deepEqual(grep, [
    `${BAND_SUCCESS}3 matches · first: osseo-call-line.ts:118${ANSI_CLOSE}`,
    'osseo-call-line.ts:121 · osseo-transcript.ts:44',
  ])

  const find = buildToolDetail(
    settledDetail('find', { pattern: 'osseo', path: 'ext' }, textResult(['osseo-style.ts', 'osseo-call-line.ts', 'osseo-transcript.ts'])),
  )
  assert.deepEqual(find, [
    `${BAND_SUCCESS}3 files · osseo-style.ts · osseo-call-line.ts · osseo-transcript.ts${ANSI_CLOSE}`,
  ])

  const ls = buildToolDetail(
    settledDetail('ls', { path: '.' }, textResult(['a.ts', 'b.ts', 'dir1/', 'dir2/', 'e.md'])),
  )
  assert.deepEqual(ls, [`${BAND_SUCCESS}5 entries · 2 dirs${ANSI_CLOSE}`])
})

test('bash settled detail shows the last three lines and a truncation hint', () => {
  const ten = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`)
  const detail = buildToolDetail(settledDetail('bash', { command: 'npm test' }, textResult(ten)))
  assert.equal(detail.length, 4)
  assert.equal(detail[0], 'line 8')
  assert.equal(detail[1], 'line 9')
  assert.equal(detail[2], 'line 10')
  assert.ok(detail[3]!.includes('… +7 more'))
  assert.ok(detail[3]!.includes(SAGE_FG))

  const short = buildToolDetail(settledDetail('bash', { command: 'npm test' }, textResult(['only line'])))
  assert.deepEqual(short, ['only line'])

  const empty = buildToolDetail(settledDetail('bash', { command: 'true' }, textResult([])))
  assert.deepEqual(empty, [`${BAND_SUCCESS}no output${ANSI_CLOSE}`])
})

test('edit settled detail caps changes and hints the rest', () => {
  const changes: string[] = []
  for (let i = 1; i <= 5; i++) {
    changes.push(`- 10 old ${i}`, `+ 10 new ${i}`)
  }
  const detail = buildToolDetail(
    settledDetail('edit', { path: 'a.ts' }, textResult([], { diff: changes.join('\n') })),
  )
  assert.equal(detail.length, 4)
  assert.ok(detail[0]!.startsWith(`${BAND_ERROR}− old 1${ANSI_CLOSE}`))
  assert.ok(detail[1]!.startsWith(`${BAND_SUCCESS}+ new 1${ANSI_CLOSE}`))
  assert.ok(detail[3]!.includes('… +7 more changes'))
})

test('grep and find details cap locations and hint remaining files', () => {
  const matches = Array.from({ length: 5 }, (_, i) => `f${i}.ts:${i + 1}: hit`)
  const grep = buildToolDetail(settledDetail('grep', { pattern: 'x' }, textResult(matches)))
  assert.equal(grep.length, 2)
  assert.ok(grep[0]!.includes('5 matches'))
  assert.ok(grep[1]!.includes('… +2 file'))

  const files = Array.from({ length: 5 }, (_, i) => `f${i}.ts`)
  const find = buildToolDetail(settledDetail('find', { pattern: 'x' }, textResult(files)))
  assert.equal(find.length, 1)
  assert.ok(find[0]!.includes('5 files'))
  assert.ok(find[0]!.includes('f0.ts · f1.ts · f2.ts'))
  assert.ok(find[0]!.includes('… +2 more'))
})

test('pending detail derives from args for every tool', () => {
  const bash = buildToolDetail({
    name: 'bash', args: { command: 'npm test' }, result: undefined,
    isPartial: true, isError: false, elapsedMs: 2100, sourcePath: undefined,
  })
  assert.deepEqual(bash, [`${PENDING_FG}running · 2.1 s\x1b[39m`])

  const edit = buildToolDetail({
    name: 'edit', args: { path: 'a.ts', edits: [{ oldText: 'x', newText: 'y' }, { oldText: 'p', newText: 'q' }] },
    result: undefined, isPartial: true, isError: false, elapsedMs: undefined, sourcePath: undefined,
  })
  assert.deepEqual(edit, [`${PENDING_FG}2 edits pending\x1b[39m`])

  const write = buildToolDetail({
    name: 'write', args: { path: 'n.md', content: 'hello' },
    result: undefined, isPartial: true, isError: false, elapsedMs: undefined, sourcePath: undefined,
  })
  assert.deepEqual(write, [`${PENDING_FG}5 B · 1 line\x1b[39m`])

  const read = buildToolDetail({
    name: 'read', args: { path: 'x.md', offset: 4, limit: 10 },
    result: undefined, isPartial: true, isError: false, elapsedMs: undefined, sourcePath: undefined,
  })
  assert.deepEqual(read, [`${PENDING_FG}reading · L4–13\x1b[39m`])

  const grep = buildToolDetail({
    name: 'grep', args: { pattern: 'x', path: 'src' },
    result: undefined, isPartial: true, isError: false, elapsedMs: undefined, sourcePath: undefined,
  })
  assert.deepEqual(grep, [`${PENDING_FG}searching · src\x1b[39m`])

  const ls = buildToolDetail({
    name: 'ls', args: { path: 'tests/' },
    result: undefined, isPartial: true, isError: false, elapsedMs: undefined, sourcePath: undefined,
  })
  assert.deepEqual(ls, [`${PENDING_FG}listing · tests/\x1b[39m`])
})

test('error detail bands the failure body and keeps the status line sage', () => {
  const editError = buildToolDetail(
    settledDetail('edit', { path: 'a.ts' }, textResult(['oldText match failed at line 118']), { isError: true }),
  )
  assert.deepEqual(editError, [`${BAND_ERROR}oldText match failed at line 118${ANSI_CLOSE}`])

  const bashError = buildToolDetail(
    settledDetail(
      'bash',
      { command: 'npm test' },
      textResult(['boom', 'Command exited with code 2']),
      { isError: true },
    ),
  )
  assert.deepEqual(bashError, [
    `${BAND_ERROR}boom${ANSI_CLOSE}`,
    `${SAGE_FG}Command exited with code 2\x1b[39m`,
  ])

  const longBashError = buildToolDetail(
    settledDetail(
      'bash',
      { command: 'npm test' },
      textResult(['l1', 'l2', 'l3', 'l4', 'Command exited with code 1']),
      { isError: true },
    ),
  )
  assert.equal(longBashError.length, 4)
  assert.ok(longBashError[0]!.includes('l3'))
  assert.ok(longBashError[1]!.includes('l4'))
  assert.ok(longBashError[2]!.includes('… +2 more'))
  assert.ok(longBashError[3]!.includes(SAGE_FG))
  assert.ok(longBashError[3]!.includes('Command exited with code 1'))
  assert.ok(!longBashError[3]!.includes(hexToBg(OSSEO_COLORS.toolErrorBg)))
})

test('bash pending detail live-tails the streamed output', () => {
  const detail = buildToolDetail(
    settledDetail(
      'bash',
      { command: 'npm test' },
      textResult(['t1', 't2', 't3', 't4']),
      { isPartial: true, elapsedMs: 2100 },
    ),
  )
  assert.deepEqual(detail, [`${PENDING_FG}running · 2.1 s\x1b[39m`, 't2', 't3', 't4'])
})

test('ledger names render bold in deep navy via theme.bold', () => {
  const cases = [
    { name: 'read' as const, args: { path: 'x.md' } },
    { name: 'bash' as const, args: { command: 'true' } },
    { name: 'edit' as const, args: { path: 'a.ts' } },
    { name: 'write' as const, args: { path: 'n.md' } },
    { name: 'grep' as const, args: { pattern: 'x' } },
  ]
  for (const { name, args } of cases) {
    const lines = new ToolLedgerComponent({
      name,
      args,
      isPartial: false,
      isError: false,
      theme,
    }).render(80)
    assert.ok(lines[0]!.includes(`\x1b[1m${hexToFg(OSSEO_COLORS.deepNavy)}${name}\x1b[22m\x1b[39m`))
    assert.ok(visibleWidth(lines[0]!) <= 80)
  }
})

test('ledger renders one line; pending detail flows through the edge component', () => {
  const pendingArgs = { path: 'a.ts', edits: [{ oldText: 'x', newText: 'y' }] }
  const ledger = new ToolLedgerComponent({
    name: 'edit',
    args: pendingArgs,
    isPartial: true,
    isError: false,
    theme,
    expanded: false,
    pending: pendingSource('edit', pendingArgs),
  })
  const lines = ledger.render(80)
  assert.equal(lines.length, 1)
  assert.ok(lines[0]!.includes('edit'))

  const settledLedger = new ToolLedgerComponent({
    name: 'edit',
    args: { path: 'a.ts' },
    isPartial: true,
    isError: false,
    theme,
    expanded: false,
    pending: pendingSource('edit', { path: 'a.ts' }, {}, true),
  })
  assert.equal(settledLedger.render(80).length, 1)

  const expandedLedger = new ToolLedgerComponent({
    name: 'edit',
    args: { path: 'a.ts' },
    isPartial: true,
    isError: false,
    theme,
    expanded: true,
    pending: pendingSource('edit', { path: 'a.ts' }),
  })
  assert.equal(expandedLedger.render(80).length, 1)

  const pendingDetail: DetailInput = {
    name: 'edit',
    args: pendingArgs,
    result: undefined,
    isPartial: true,
    isError: false,
    elapsedMs: undefined,
    sourcePath: undefined,
  }
  const edge = new EdgeOutputComponent({
    inner: undefined,
    expanded: false,
    theme,
    detail: pendingDetail,
  })
  const rows = edge.render(80)
  assert.equal(rows.length, 1)
  assert.ok(rows[0]!.includes('1 edit pending'))
  assert.ok(rows[0]!.includes('│'))
  assert.ok(rows[0]!.includes(PENDING_FG))
  assert.ok(rows[0]!.endsWith(ANSI_CLOSE))
})

test('edge and ledger renders cache on width and content version', () => {
  const detail = settledDetail('bash', { command: 'npm test' }, textResult(['a', 'b']))
  const edge = new EdgeOutputComponent({ inner: undefined, expanded: false, theme, detail })
  const first = edge.render(80)
  const second = edge.render(80)
  assert.equal(first, second)
  const changed = new EdgeOutputComponent({
    inner: undefined, expanded: false, theme,
    detail: settledDetail('bash', { command: 'npm test' }, textResult(['a', 'b', 'c'])),
  }).render(80)
  assert.notDeepEqual(first, changed)
})

test('ledger and flat detail stay inside every supplied width', () => {
  for (const width of [1, 2, 10, 12, 40, 120]) {
    const rows = [
      ...new ToolLedgerComponent({
        name: 'grep',
        args: { pattern: 'osseo', path: 'extensions' },
        isPartial: true,
        isError: false,
        theme,
        expanded: false,
        pending: pendingSource('grep', { pattern: 'osseo', path: 'extensions' }),
      }).render(width),
      ...new EdgeOutputComponent({
        inner: new StubComponent(['out ' + 'x'.repeat(width)]),
        expanded: false,
        theme,
        detail: settledDetail(
          'bash',
          { command: 'npm test' },
          textResult(['l1', 'out ' + 'x'.repeat(width), 'l3', 'l4', 'l5']),
        ),
      }).render(width),
    ]
    for (const row of rows) assert.ok(visibleWidth(row) <= width, `width ${width}: ${JSON.stringify(row)}`)
  }
})

test('osseo helper modules are valid extension entrypoints', () => {
  for (const extension of [osseoStyleExtension, osseoCallLineExtension, osseoTranscriptExtension]) {
    assert.equal(typeof extension, 'function')
    const stub = { on: () => {}, registerTool: () => {} } as never
    assert.doesNotThrow(() => extension(stub))
  }
})
