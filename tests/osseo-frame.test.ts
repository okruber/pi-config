import assert from 'node:assert/strict'
import test from 'node:test'
import { visibleWidth } from '@earendil-works/pi-tui'
import { OSSEO_COLORS, hexToBg, hexToFg } from '../extensions/osseo-style.ts'
import { renderFrame, resolveFrameColors } from '../extensions/osseo-frame.ts'
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
