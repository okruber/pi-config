import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  IMETO_COLORS,
  hexToBg,
  hexToFg,
  readThemeHex,
} from '../extensions/imeto-style.ts'

const EXPECTED = {
  oxblood: '#6a3026',
  bone: '#e9e3df',
  darkSpruce: '#1c1e1b',
  deepNavy: '#04162a',
  mossGreen: '#3e4739',
  mauveTaupe: '#907062',
  cloudPetal: '#fbf9f7',
  sageGrey: '#89897c',
  dustyBlue: '#8894a0',
  terracotta: '#a56148',
} as const

test('sampled Imeto palette remains exact', () => {
  assert.deepEqual(IMETO_COLORS, EXPECTED)
})

test('hex helpers emit truecolor ANSI sequences', () => {
  assert.equal(hexToFg('#6a3026'), '\x1b[38;2;106;48;38m')
  assert.equal(hexToBg('#e9e3df'), '\x1b[48;2;233;227;223m')
})

test('theme lookup uses the first matching valid hex value', () => {
  const dir = mkdtempSync(join(tmpdir(), 'imeto-theme-'))
  const sourcePath = join(dir, 'theme.json')
  writeFileSync(sourcePath, JSON.stringify({ vars: { accent: '#123456', fallback: 'invalid' } }))
  assert.equal(readThemeHex(sourcePath, ['missing', 'accent']), '#123456')
  assert.equal(readThemeHex(sourcePath, ['fallback']), undefined)
})

test('theme lookup tolerates a missing source file', () => {
  assert.equal(readThemeHex('/missing/theme.json', ['accent']), undefined)
  assert.equal(readThemeHex(undefined, ['accent']), undefined)
})
