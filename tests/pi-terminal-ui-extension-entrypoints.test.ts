import assert from 'node:assert/strict'
import test from 'node:test'
import terminalUiStatusExtension from '../extensions/pi-terminal-ui-status.ts'
import terminalUiStyleExtension from '../extensions/pi-terminal-ui-style.ts'
import terminalUiToolsExtension from '../extensions/pi-terminal-ui-tools.ts'

test('top-level Pi Terminal UI helper modules are valid Pi extension entrypoints', () => {
  assert.equal(typeof terminalUiStatusExtension, 'function')
  assert.equal(typeof terminalUiStyleExtension, 'function')
  assert.equal(typeof terminalUiToolsExtension, 'function')
  assert.doesNotThrow(() => terminalUiStatusExtension({} as any))
  assert.doesNotThrow(() => terminalUiStyleExtension({} as any))
  assert.doesNotThrow(() => terminalUiToolsExtension({} as any))
})
