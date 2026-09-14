import assert from 'node:assert/strict'
import test from 'node:test'
import { stripTerminalSequences, visibleWidth } from '@earendil-works/pi-tui'
import { OSSEO_COLORS, hexToBg, hexToFg } from '../extensions/osseo-style.ts'
import {
  MemoComponent,
  countUnit,
  moreLine,
  normalizeInline,
  renderFrame,
  resolveFrameColors,
  resultText,
  statusHeader,
  stripNoticeFooter,
  tailWindow,
  treeList,
} from '../extensions/osseo-frame.ts'
import { fakeTheme } from './osseo-test-utils.ts'

const theme = fakeTheme()

test('top bar embeds the header and spans the width', () => {
  const colors = resolveFrameColors(theme, 'success')
  const lines = renderFrame({ header: '✓ Read: a.ts', state: 'success', sections: [], width: 40 }, colors)
  assert.equal(lines.length, 2)
  const top = lines[0]
  assert.equal(visibleWidth(top), 40)
  const plain = top.replace(/\x1b\[[0-9;]*m/g, '')
  assert.ok(plain.startsWith('╭─── ✓ Read: a.ts '))
  assert.ok(plain.endsWith('╮'))
  assert.ok(plain.includes('─'.repeat(10)))
})

test('headerless top bar is a continuous rule', () => {
  const colors = resolveFrameColors(theme, 'pending')
  const lines = renderFrame({ state: 'pending', sections: [], width: 20 }, colors)
  const plain = lines[0].replace(/\x1b\[[0-9;]*m/g, '')
  assert.equal(plain, `╭${'─'.repeat(18)}╮`)
})

test('content rows are bordered, padded, and filled to width', () => {
  const colors = resolveFrameColors(theme, 'success')
  const lines = renderFrame(
    { state: 'success', sections: [{ lines: ['hi', ''] }], width: 20 },
    colors,
  )
  for (const line of lines) assert.equal(visibleWidth(line), 20)
  const body = lines[1].replace(/\x1b\[[0-9;]*m/g, '')
  assert.equal(body, `│ hi${' '.repeat(15)}│`)
  const blank = lines[2].replace(/\x1b\[[0-9;]*m/g, '')
  assert.equal(blank, `│${' '.repeat(18)}│`)
})

test('labeled section draws a divider bar', () => {
  const colors = resolveFrameColors(theme, 'success')
  const lines = renderFrame(
    { state: 'success', sections: [{ lines: ['a'] }, { label: 'Output', lines: ['b'] }], width: 30 },
    colors,
  )
  const divider = lines[2].replace(/\x1b\[[0-9;]*m/g, '')
  assert.ok(divider.startsWith('├─── Output '))
  assert.ok(divider.endsWith('┤'))
})

test('long content wraps inside the borders', () => {
  const colors = resolveFrameColors(theme, 'success')
  const lines = renderFrame({ state: 'success', sections: [{ lines: ['x'.repeat(30)] }], width: 20 }, colors)
  assert.equal(lines.length, 4)
  for (const line of lines) assert.equal(visibleWidth(line), 20)
})

test('state resolves border, fill, and symbol colors from osseo vars', () => {
  const pending = resolveFrameColors(fakeTheme(), 'pending')
  assert.ok(pending.line('x').includes(hexToFg(OSSEO_COLORS.framePendingLine)))
  assert.ok(pending.symbol('x').includes(hexToFg(OSSEO_COLORS.signalOrange)))
  const success = resolveFrameColors(fakeTheme(), 'success')
  assert.ok(success.line('x').includes(hexToFg(OSSEO_COLORS.frameLine)))
  const error = resolveFrameColors(fakeTheme(), 'error')
  assert.ok(error.line('x').includes(hexToFg(OSSEO_COLORS.frameErrorLine)))
  assert.ok(error.fill('x').includes(hexToBg(OSSEO_COLORS.toolErrorBg)))
})

test('fill re-applies the background after inner SGR resets', () => {
  const colors = resolveFrameColors(fakeTheme(), 'success')
  const fillAnsi = hexToBg(OSSEO_COLORS.toolSuccessBg)
  const out = colors.fill(`a\x1b[0mb`)
  assert.ok(out.includes(`\x1b[0m${fillAnsi}`))
  assert.ok(out.startsWith(fillAnsi))
  assert.ok(out.endsWith('\x1b[49m'))
})

test('statusHeader composes symbol, title, subject, and meta', () => {
  const colors = resolveFrameColors(fakeTheme(), 'success')
  assert.equal(stripTerminalSequences(statusHeader({ state: 'success', title: 'Grep', subject: '/foo/ in .', meta: ['2 matches'] }, colors)), '✓ Grep: /foo/ in . · 2 matches')
  assert.equal(stripTerminalSequences(statusHeader({ state: 'pending', title: 'Ls' }, colors)), '◌ Ls')
})

test('normalizeInline collapses whitespace and control characters', () => {
  assert.equal(normalizeInline('a\nb\tc'), 'a ↵ b c')
  assert.equal(normalizeInline('   '), '…')
})

test('countUnit pluralizes', () => {
  assert.equal(countUnit(1, 'match'), '1 match')
  assert.equal(countUnit(2, 'match'), '2 matches')
  assert.equal(countUnit(3, 'entry'), '3 entries')
})

test('moreLine carries the expand hint', () => {
  const colors = resolveFrameColors(fakeTheme(), 'success')
  const line = moreLine(5, 'line', colors)
  assert.ok(line.startsWith('… 5 more lines ('))
  assert.ok(line.includes('to expand'))
})

test('treeList caps collapsed items and marks the last branch', () => {
  const colors = resolveFrameColors(fakeTheme(), 'success')
  const items = Array.from({ length: 10 }, (_, i) => `f${i}`)
  const collapsed = treeList(items, { expanded: false, maxCollapsed: 8, unit: 'file' }, colors)
  assert.equal(collapsed.length, 9)
  assert.ok(collapsed[0].startsWith('├─ f0'))
  assert.ok(collapsed[7].startsWith('├─ f7'))
  assert.ok(collapsed[8].startsWith('… 2 more files ('))
  const expanded = treeList(items, { expanded: true, maxCollapsed: 8, unit: 'file' }, colors)
  assert.equal(expanded.length, 10)
  assert.ok(expanded[9].startsWith('└─ f9'))
})

test('tailWindow keeps the tail and counts skipped visual lines', () => {
  const colors = resolveFrameColors(fakeTheme(), 'success')
  const text = Array.from({ length: 30 }, (_, i) => `line${i}`).join('\n')
  const lines = tailWindow(text, 10, 80, colors)
  assert.equal(lines.length, 11)
  assert.ok(lines[0].startsWith('… (20 earlier lines, '))
  assert.equal(lines[10].trimEnd(), 'line29')
  const short = tailWindow('a\nb', 10, 80, colors)
  assert.deepEqual(short.map((line) => line.trimEnd()), ['a', 'b'])
})

test('stripNoticeFooter removes a trailing bracket notice', () => {
  const { body, notice } = stripNoticeFooter('out\n\n[Truncated: showing 1 of 2 lines]')
  assert.equal(body, 'out')
  assert.equal(notice, '[Truncated: showing 1 of 2 lines]')
  assert.deepEqual(stripNoticeFooter('plain'), { body: 'plain', notice: undefined })
})

test('resultText joins text blocks', () => {
  assert.equal(resultText({ content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }] }), 'a\nb')
  assert.equal(resultText(undefined), '')
})

test('MemoComponent caches by width and deps', () => {
  let builds = 0
  let tick = 0
  const component = new MemoComponent(
    (width) => {
      builds += 1
      return [`w${width}`]
    },
    () => `${tick}`,
  )
  assert.deepEqual(component.render(80), ['w80'])
  component.render(80)
  assert.equal(builds, 1)
  tick = 1
  component.render(80)
  assert.equal(builds, 2)
  component.render(40)
  assert.equal(builds, 3)
})
