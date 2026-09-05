import assert from 'node:assert/strict'
import test from 'node:test'
import imetoStatusExtension from '../extensions/imeto-status.ts'
import imetoStyleExtension from '../extensions/imeto-style.ts'
import imetoToolUiExtension from '../extensions/imeto-tool-ui.ts'

test('top-level Im­eto helper modules are valid Pi extension entrypoints', () => {
  assert.equal(typeof imetoStatusExtension, 'function')
  assert.equal(typeof imetoStyleExtension, 'function')
  assert.equal(typeof imetoToolUiExtension, 'function')
  assert.doesNotThrow(() => imetoStatusExtension({} as any))
  assert.doesNotThrow(() => imetoStyleExtension({} as any))
  assert.doesNotThrow(() => imetoToolUiExtension({} as any))
})
