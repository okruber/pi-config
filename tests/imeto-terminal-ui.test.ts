import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  IMETO_COLORS,
  hexToBg,
  hexToFg,
  readThemeHex,
} from '../extensions/imeto-style.ts'
import {
  contextRole,
  fitStatusWidths,
  statusHex,
  statusText,
} from '../extensions/imeto-status.ts'

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

const REQUIRED_THEME_TOKENS = [
  'accent', 'border', 'borderAccent', 'borderMuted', 'success', 'error',
  'warning', 'muted', 'dim', 'text', 'thinkingText', 'selectedBg',
  'userMessageBg', 'userMessageText', 'customMessageBg', 'customMessageText',
  'customMessageLabel', 'toolPendingBg', 'toolSuccessBg', 'toolErrorBg',
  'toolTitle', 'toolOutput', 'mdHeading', 'mdLink', 'mdLinkUrl', 'mdCode',
  'mdCodeBlock', 'mdCodeBlockBorder', 'mdQuote', 'mdQuoteBorder', 'mdHr',
  'mdListBullet', 'toolDiffAdded', 'toolDiffRemoved', 'toolDiffContext',
  'syntaxComment', 'syntaxKeyword', 'syntaxFunction', 'syntaxVariable',
  'syntaxString', 'syntaxNumber', 'syntaxType', 'syntaxOperator',
  'syntaxPunctuation', 'thinkingOff', 'thinkingMinimal', 'thinkingLow',
  'thinkingMedium', 'thinkingHigh', 'thinkingXhigh', 'bashMode',
] as const

test('Pi theme defines every required token and exact brand variables', () => {
  const theme = JSON.parse(readFileSync(new URL('../themes/imeto-bone.json', import.meta.url), 'utf8'))
  assert.equal(theme.name, 'imeto-bone')
  for (const [name, hex] of Object.entries(IMETO_COLORS)) assert.equal(theme.vars[name], hex)
  for (const token of REQUIRED_THEME_TOKENS) assert.equal(typeof theme.colors[token], 'string', token)
})

test('terminal theme pairs Bone background with Deep Navy foreground', () => {
  const yaml = readFileSync(new URL('../themes/imeto-bone.terminal.yaml', import.meta.url), 'utf8')
  assert.match(yaml, /^name: Imeto Bone$/m)
  assert.match(yaml, /^background: "#e9e3df"$/m)
  assert.match(yaml, /^foreground: "#04162a"$/m)
  assert.match(yaml, /^selection: "#907062"$/m)
})

test('status roles map to the approved Imeto palette', () => {
  assert.equal(statusHex('identity'), IMETO_COLORS.oxblood)
  assert.equal(statusHex('model'), IMETO_COLORS.dustyBlue)
  assert.equal(statusHex('reasoning'), IMETO_COLORS.mossGreen)
  assert.equal(statusHex('path'), IMETO_COLORS.terracotta)
  assert.equal(statusHex('context'), IMETO_COLORS.mauveTaupe)
  assert.equal(statusHex('danger'), IMETO_COLORS.oxblood)
})

test('status roles honor matching variables from the active theme', () => {
  const dir = mkdtempSync(join(tmpdir(), 'imeto-status-'))
  const sourcePath = join(dir, 'theme.json')
  writeFileSync(sourcePath, JSON.stringify({ vars: { oxblood: '#123456' } }))
  assert.equal(statusHex('identity', sourcePath), '#123456')
  assert.equal(statusHex('model', sourcePath), IMETO_COLORS.dustyBlue)
})

test('context pressure selects neutral, warning, and danger roles', () => {
  assert.equal(contextRole(null), 'muted')
  assert.equal(contextRole(69.9), 'context')
  assert.equal(contextRole(70), 'path')
  assert.equal(contextRole(89.9), 'path')
  assert.equal(contextRole(90), 'danger')
})

test('status text closes bold and foreground ANSI state', () => {
  const text = statusText('identity', 'π')
  assert.match(text, /^\x1b\[38;2;106;48;38m\x1b\[1mπ/)
  assert.match(text, /\x1b\[22m\x1b\[39m$/)
})

test('status widths fit wide and narrow terminals', () => {
  assert.deepEqual(fitStatusWidths(70, 20, 80), { left: 70, right: 7, gap: 3 })
  assert.deepEqual(fitStatusWidths(70, 20, 40), { left: 37, right: 0, gap: 3 })
  assert.deepEqual(fitStatusWidths(12, 0, 20), { left: 12, right: 0, gap: 8 })
})
