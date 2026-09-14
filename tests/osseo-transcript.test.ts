import assert from 'node:assert/strict'
import test from 'node:test'
import { createRuntimeToolDefinitions, decorateBuiltInTool } from '../extensions/osseo-transcript.ts'
import osseoFrameExtension from '../extensions/osseo-frame.ts'
import osseoStyleExtension from '../extensions/osseo-style.ts'
import osseoToolsExtension from '../extensions/osseo-tools.ts'
import osseoTranscriptExtension from '../extensions/osseo-transcript.ts'
import { fakeContext, fakeTheme, renderStripped, textResult } from './osseo-test-utils.ts'

const settings = {
  getImageAutoResize: () => true,
  getShellCommandPrefix: () => undefined,
  getShellPath: () => undefined,
} as any

test('all seven built-in definitions decorate without losing identity', () => {
  const definitions = createRuntimeToolDefinitions('/repo', settings)
  assert.deepEqual(
    definitions.map((definition) => definition.name),
    ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'],
  )
  for (const definition of definitions) {
    const decorated = decorateBuiltInTool(definition)
    assert.equal(decorated.name, definition.name)
    assert.equal(decorated.label, definition.label)
    assert.equal(decorated.description, definition.description)
    assert.equal(decorated.parameters, definition.parameters)
    assert.equal(decorated.execute, definition.execute)
    assert.equal(decorated.renderShell, 'self')
    assert.equal(typeof decorated.renderCall, 'function')
    assert.equal(typeof decorated.renderResult, 'function')
  }
})

test('osseo modules are valid extension entrypoints', () => {
  for (const factory of [osseoFrameExtension, osseoStyleExtension, osseoToolsExtension, osseoTranscriptExtension]) {
    assert.equal(typeof factory, 'function')
  }
})

test('decorate rejects non-built-in tools', () => {
  assert.throws(() => decorateBuiltInTool({ name: 'custom' } as any), /non-built-in/)
})

test('call slot suppresses itself after the result slot renders', () => {
  const [read] = createRuntimeToolDefinitions('/repo', settings)
  const decorated = decorateBuiltInTool(read)
  const context = fakeContext({ args: { path: 'a.ts' } })
  const call = decorated.renderCall!({ path: 'a.ts' }, fakeTheme(), context)
  assert.ok(renderStripped(call, 80).length > 0)
  decorated.renderResult!(textResult(['x']), { expanded: false, isPartial: false }, fakeTheme(), context)
  assert.deepEqual(renderStripped(call, 80), [])
})
