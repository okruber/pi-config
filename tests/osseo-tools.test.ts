import assert from 'node:assert/strict'
import test from 'node:test'
import { createOsseoRenderers, editDiffStats, readCodeLines } from '../extensions/osseo-tools.ts'
import { resolveFrameColors } from '../extensions/osseo-frame.ts'
import { fakeContext, fakeTheme, renderStripped, textResult } from './osseo-test-utils.ts'

function bashCall(contextOverrides: Record<string, unknown> = {}, args: Record<string, unknown> = { command: 'npm test' }) {
  const context = fakeContext({ args, ...contextOverrides })
  const renderers = createOsseoRenderers('bash')
  const component = renderers.renderCall!(args, fakeTheme(), context)
  return { context, renderers, component }
}

test('bash pending frame is headerless and shows the command', () => {
  const { component } = bashCall()
  const lines = renderStripped(component, 40)
  assert.equal(lines[0], `╭${'─'.repeat(38)}╮`)
  assert.ok(lines.some((line) => line.includes('$ npm test')))
  assert.equal(lines.at(-1), `╰${'─'.repeat(38)}╯`)
})

test('bash pending frame shows a running line once execution starts', () => {
  const { context, component } = bashCall({ executionStarted: true })
  const lines = renderStripped(component, 40)
  assert.ok(lines.some((line) => line.includes('running · 0s')))
  clearInterval(context.state.interval)
})

test('bash call slot suppresses itself once the result slot ran', () => {
  const { context, renderers, component } = bashCall()
  renderers.renderResult!(textResult(['ok']), { expanded: false, isPartial: false }, fakeTheme(), context)
  assert.deepEqual(renderStripped(component, 40), [])
})

test('bash result frames command, output section, and stats', () => {
  const context = fakeContext({ args: { command: 'npm test' }, executionStarted: true })
  const renderers = createOsseoRenderers('bash')
  renderers.renderCall!({ command: 'npm test' }, fakeTheme(), context)
  const result = renderers.renderResult!(textResult(['12 passing']), { expanded: false, isPartial: false }, fakeTheme(), context)
  const lines = renderStripped(result, 50)
  assert.ok(lines.some((line) => line.includes('$ npm test')))
  assert.ok(lines.some((line) => line.startsWith('├─── Output ')))
  assert.ok(lines.some((line) => line.includes('12 passing')))
  assert.ok(lines.some((line) => line.includes('[Took ')))
  clearInterval(context.state.interval)
})

test('bash result tail-windows long output with a skip marker', () => {
  const context = fakeContext({ args: { command: 'yes' } })
  const renderers = createOsseoRenderers('bash')
  const output = Array.from({ length: 30 }, (_, i) => `line${i}`)
  const result = renderers.renderResult!(textResult(output), { expanded: false, isPartial: false }, fakeTheme(), context)
  const lines = renderStripped(result, 50)
  assert.ok(lines.some((line) => line.includes('… (20 earlier lines, ')))
  assert.ok(lines.some((line) => line.includes('line29')))
  assert.ok(!lines.some((line) => line.includes('line5')))
  const expanded = renderers.renderResult!(textResult(output), { expanded: true, isPartial: false }, fakeTheme(), context)
  assert.ok(renderStripped(expanded, 50).some((line) => line.includes('line5')))
})

test('bash error result keeps output and renders the error frame', () => {
  const context = fakeContext({ args: { command: 'false' }, isError: true })
  const renderers = createOsseoRenderers('bash')
  const result = renderers.renderResult!(
    textResult(['boom', 'Command exited with code 1']),
    { expanded: false, isPartial: false },
    fakeTheme(),
    context,
  )
  const lines = renderStripped(result, 50)
  assert.ok(lines.some((line) => line.includes('boom')))
})

test('read pending is a flat status line', () => {
  const context = fakeContext({ args: { path: 'src/a.ts', offset: 10, limit: 20 } })
  const renderers = createOsseoRenderers('read')
  const component = renderers.renderCall!({ path: 'src/a.ts', offset: 10, limit: 20 }, fakeTheme(), context)
  const lines = renderStripped(component, 60)
  assert.deepEqual(lines, ['◌ Read: src/a.ts:10-29'])
})

test('read result frames a code cell with a line-number gutter', () => {
  const body = Array.from({ length: 20 }, (_, i) => `const v${i} = ${i}`)
  const context = fakeContext({ args: { path: 'src/a.ts' } })
  const renderers = createOsseoRenderers('read')
  const result = renderers.renderResult!(textResult(body), { expanded: false, isPartial: false }, fakeTheme(), context)
  const lines = renderStripped(result, 60)
  assert.ok(lines[0].startsWith('╭─── ✓ Read: src/a.ts '))
  assert.ok(lines.some((line) => line.includes(' 1 const v0 = 0')))
  assert.ok(lines.some((line) => line.includes('12 const v11 = 11')))
  assert.ok(lines.some((line) => line.includes('… 8 more lines (')))
  assert.ok(!lines.some((line) => line.includes('const v12')))
})

test('read gutter starts at the requested offset', () => {
  const colors = resolveFrameColors(fakeTheme(), 'success')
  const lines = readCodeLines('alpha\nbeta', 'typescript', 41, false, colors)
  assert.ok(lines[0].startsWith('41 '))
  assert.ok(lines[1].startsWith('42 '))
})

test('read error result renders the error frame', () => {
  const context = fakeContext({ args: { path: 'nope.ts' }, isError: true })
  const renderers = createOsseoRenderers('read')
  const result = renderers.renderResult!(textResult(['Error: ENOENT']), { expanded: false, isPartial: false }, fakeTheme(), context)
  const lines = renderStripped(result, 50)
  assert.ok(lines[0].startsWith('╭─── ✗ Read: nope.ts '))
  assert.ok(lines.some((line) => line.includes('Error: ENOENT')))
})

test('read image result renders a placeholder body', () => {
  const context = fakeContext({ args: { path: 'pic.png' } })
  const renderers = createOsseoRenderers('read')
  const result = renderers.renderResult!(
    { content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }] },
    { expanded: false, isPartial: false },
    fakeTheme(),
    context,
  )
  const lines = renderStripped(result, 50)
  assert.ok(lines.some((line) => line.includes('(image)')))
})

test('write pending frames streaming content with a streaming marker', () => {
  const content = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n')
  const context = fakeContext({ args: { path: 'out.ts', content }, argsComplete: false })
  const renderers = createOsseoRenderers('write')
  const component = renderers.renderCall!({ path: 'out.ts', content }, fakeTheme(), context)
  const lines = renderStripped(component, 50)
  assert.ok(lines[0].startsWith('╭─── ◌ Write: out.ts '))
  assert.ok(lines.some((line) => line.includes('… 8 earlier lines')))
  assert.ok(lines.some((line) => line.includes('line19')))
  assert.ok(lines.some((line) => line.includes('(streaming…)')))
})

test('write result shows line count meta and a capped preview', () => {
  const content = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n')
  const context = fakeContext({ args: { path: 'out.ts', content } })
  const renderers = createOsseoRenderers('write')
  const result = renderers.renderResult!(textResult(['ok']), { expanded: false, isPartial: false }, fakeTheme(), context)
  const lines = renderStripped(result, 50)
  assert.ok(lines[0].startsWith('╭─── ✓ Write: out.ts '))
  assert.ok(lines[0].includes('· 20 lines'))
  assert.ok(lines.some((line) => line.includes('line0')))
  assert.ok(lines.some((line) => line.includes('… 8 more lines (')))
})

test('write error renders the error frame', () => {
  const context = fakeContext({ args: { path: 'out.ts', content: 'x' }, isError: true })
  const renderers = createOsseoRenderers('write')
  const result = renderers.renderResult!(textResult(['Error: EACCES']), { expanded: false, isPartial: false }, fakeTheme(), context)
  const lines = renderStripped(result, 50)
  assert.ok(lines[0].startsWith('╭─── ✗ Write: out.ts '))
  assert.ok(lines.some((line) => line.includes('Error: EACCES')))
})

const SAMPLE_DIFF = [
  '+ 2 const added = true',
  '+ 3 const kept = 1',
  '- 2 const removed = false',
  '  4 const context = 0',
].join('\n')

test('editDiffStats counts added and removed lines', () => {
  assert.deepEqual(editDiffStats(SAMPLE_DIFF), { added: 2, removed: 1 })
})

test('edit pending frames the pending edit count', () => {
  const args = { path: 'a.ts', edits: [{ oldText: 'a', newText: 'b' }, { oldText: 'c', newText: 'd' }] }
  const context = fakeContext({ args })
  const renderers = createOsseoRenderers('edit')
  const component = renderers.renderCall!(args, fakeTheme(), context)
  const lines = renderStripped(component, 50)
  assert.ok(lines[0].startsWith('╭─── ◌ Edit: a.ts '))
  assert.ok(lines.some((line) => line.includes('2 edits pending')))
})

test('edit result shows stats in the header and the colored diff capped', () => {
  const bigDiff = Array.from({ length: 60 }, (_, i) => `+ ${i + 1} line${i}`).join('\n')
  const context = fakeContext({ args: { path: 'a.ts' } })
  const renderers = createOsseoRenderers('edit')
  const result = renderers.renderResult!(
    textResult(['ok'], { diff: bigDiff, patch: '' }),
    { expanded: false, isPartial: false },
    fakeTheme(),
    context,
  )
  const lines = renderStripped(result, 60)
  assert.ok(lines[0].startsWith('╭─── ✓ Edit: a.ts '))
  assert.ok(lines[0].includes('+60'))
  assert.ok(lines.some((line) => line.includes('… 20 more diff lines (')))
  const expanded = renderers.renderResult!(
    textResult(['ok'], { diff: bigDiff, patch: '' }),
    { expanded: true, isPartial: false },
    fakeTheme(),
    context,
  )
  assert.ok(renderStripped(expanded, 60).some((line) => line.includes('line59')))
})

test('edit error renders the error frame', () => {
  const context = fakeContext({ args: { path: 'a.ts' }, isError: true })
  const renderers = createOsseoRenderers('edit')
  const result = renderers.renderResult!(textResult(['Error: oldText not found']), { expanded: false, isPartial: false }, fakeTheme(), context)
  const lines = renderStripped(result, 60)
  assert.ok(lines[0].startsWith('╭─── ✗ Edit: a.ts '))
  assert.ok(lines.some((line) => line.includes('Error: oldText not found')))
})

test('grep pending is a flat status line', () => {
  const context = fakeContext({ args: { pattern: 'renderFrame', path: 'extensions' } })
  const renderers = createOsseoRenderers('grep')
  const component = renderers.renderCall!({ pattern: 'renderFrame', path: 'extensions' }, fakeTheme(), context)
  assert.deepEqual(renderStripped(component, 60), ['◌ Grep: /renderFrame/ in extensions'])
})

test('grep result renders a capped tree list with counts', () => {
  const matches = Array.from({ length: 10 }, (_, i) => `src/f${i}.ts:${i + 1}: match`)
  const context = fakeContext({ args: { pattern: 'match' } })
  const renderers = createOsseoRenderers('grep')
  const result = renderers.renderResult!(textResult(matches), { expanded: false, isPartial: false }, fakeTheme(), context)
  const lines = renderStripped(result, 60)
  assert.equal(lines[0], '✓ Grep: /match/ in . · 10 matches')
  assert.ok(lines[1].startsWith('├─ src/f0.ts:1: match'))
  assert.ok(lines.some((line) => line.startsWith('… 2 more matches (')))
})

test('grep zero matches renders the empty marker', () => {
  const context = fakeContext({ args: { pattern: 'zzz' } })
  const renderers = createOsseoRenderers('grep')
  const result = renderers.renderResult!(textResult([]), { expanded: false, isPartial: false }, fakeTheme(), context)
  const lines = renderStripped(result, 60)
  assert.equal(lines[0], '✓ Grep: /zzz/ in . · 0 matches')
  assert.deepEqual(lines[1], '(no matches)')
})

test('grep error renders the error header and message', () => {
  const context = fakeContext({ args: { pattern: '(' }, isError: true })
  const renderers = createOsseoRenderers('grep')
  const result = renderers.renderResult!(textResult(['Error: invalid regex']), { expanded: false, isPartial: false }, fakeTheme(), context)
  const lines = renderStripped(result, 60)
  assert.equal(lines[0], '✗ Grep: /(/ in .')
  assert.deepEqual(lines[1], 'Error: invalid regex')
})

test('find result lists files with counts', () => {
  const context = fakeContext({ args: { pattern: '*.ts', path: 'src' } })
  const renderers = createOsseoRenderers('find')
  const result = renderers.renderResult!(textResult(['a.ts', 'b.ts']), { expanded: false, isPartial: false }, fakeTheme(), context)
  const lines = renderStripped(result, 60)
  assert.equal(lines[0], '✓ Find: *.ts in src · 2 files')
  assert.ok(lines[1].startsWith('├─ a.ts'))
  assert.ok(lines[2].startsWith('└─ b.ts'))
})

test('ls result lists entries', () => {
  const context = fakeContext({ args: { path: 'src' } })
  const renderers = createOsseoRenderers('ls')
  const result = renderers.renderResult!(textResult(['a.ts', 'lib/']), { expanded: false, isPartial: false }, fakeTheme(), context)
  const lines = renderStripped(result, 60)
  assert.equal(lines[0], '✓ Ls: src · 2 entries')
})

test('search results mark truncation in the meta', () => {
  const context = fakeContext({ args: { pattern: '*.ts' } })
  const renderers = createOsseoRenderers('find')
  const result = renderers.renderResult!(
    textResult(['a.ts'], { resultLimitReached: 100 }),
    { expanded: false, isPartial: false },
    fakeTheme(),
    context,
  )
  assert.equal(renderStripped(result, 60)[0], '✓ Find: *.ts in . · 1 file · truncated')
})
