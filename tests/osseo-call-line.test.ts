import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { visibleWidth, type Component } from '@earendil-works/pi-tui'
import {
  EdgeOutputComponent,
  ToolLedgerComponent,
  summarizeToolCall,
  toolStateSymbol,
  toolVisualState,
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
  bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
} as any

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
    { isPartial: true, isError: false, glyph: '◌', sgr: '\x1b[38;2;165;97;72m' },
    { isPartial: false, isError: false, glyph: '✓', sgr: '\x1b[38;2;62;71;57m' },
    { isPartial: false, isError: true, glyph: '✗', sgr: '\x1b[38;2;106;48;38m' },
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

test('collapsed edge renderer passes the inner component through untouched', () => {
  const lines = new EdgeOutputComponent({
    inner: new StubComponent(['plain result']),
    expanded: false,
    theme,
  }).render(80)
  assert.deepEqual(lines, ['plain result'])
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

test('osseo helper modules are valid extension entrypoints', () => {
  for (const extension of [osseoStyleExtension, osseoCallLineExtension, osseoTranscriptExtension]) {
    assert.equal(typeof extension, 'function')
    const stub = { on: () => {}, registerTool: () => {} } as never
    assert.doesNotThrow(() => extension(stub))
  }
})
