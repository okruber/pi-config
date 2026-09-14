import assert from 'node:assert/strict'
import test from 'node:test'
import { createOsseoRenderers } from '../extensions/osseo-tools.ts'
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
