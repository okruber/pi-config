# Osseo Iteration 2: omp-Style Framed Tool Callouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace osseo's flat ledger/edge tool-call rendering with omp-style full-width framed blocks for the seven built-in tools.

**Architecture:** Two new extension modules: `osseo-frame.ts` (frame primitive plus shared format helpers) and `osseo-tools.ts` (per-tool renderer pairs). `osseo-transcript.ts` keeps owning registration and delegates rendering to `osseo-tools.ts`. The ledger module `osseo-call-line.ts` and its test are deleted. Everything runs through pi's extension API (`renderShell: 'self'`, `renderCall`/`renderResult`); pi core is untouched.

**Tech Stack:** TypeScript loaded directly by pi (no build step), `node --test` with the existing symlink harness in `tests/run-osseo-tests.sh`, imports only from `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, and node builtins.

**Spec:** `docs/superpowers/specs/2026-09-14-osseo-iteration-2-design.md`

## Global Constraints

- Extension API only. Never edit anything under `/opt/homebrew/lib/node_modules/`.
- The source of truth is `~/Documents/Personal/pi-config` (paths under `~/.pi/agent/` are symlinks into it). All commits happen there.
- Never stage `auth.json`, `telegram.json`, `sessions/`, `npm/`, `git/`, `bin/`. Commit only with explicit paths: `git add extensions tests docs`.
- No new dependencies and no new color values. Styling resolves through `resolveThemeVar` (osseo vars) or `theme.fg` slots only.
- Tests run via `tests/run-osseo-tests.sh` (node's built-in runner, type stripping). No bun, no tsc gate.
- Reference implementation for the visuals: `can1357/oh-my-pi` files `packages/coding-agent/src/tui/output-block.ts`, `src/tui/status-line.ts`, `src/tools/{bash,read-renderer,write,grep,glob}.ts`, `src/edit/renderer.ts`.

---

### Task 1: Test harness and shared test utilities

**Files:**
- Create: `tests/osseo-test-utils.ts`
- Modify: `tests/run-osseo-tests.sh`

**Interfaces:**
- Produces: `fakeTheme(sourcePath?: string): any`, `fakeContext(overrides?: Record<string, unknown>): any`, `renderStripped(component: Component, width: number): string[]`, `textResult(lines: string[], details?: Record<string, unknown>): any`. Every later test file imports these.
- The runner accepts optional test file arguments; without arguments it runs `tests/*.test.ts`.

- [ ] **Step 1: Write the shared utilities**

```ts
import { initTheme } from '@earendil-works/pi-coding-agent'
import { stripTerminalSequences, type Component } from '@earendil-works/pi-tui'

// keyHint, renderDiff, and highlightCode read pi's global theme proxy, which
// throws until initTheme has run once in this process.
let themeReady = false
function ensureGlobalTheme(): void {
  if (themeReady) return
  try {
    initTheme('osseo-bone')
  } catch {
    initTheme('dark')
  }
  themeReady = true
}
ensureGlobalTheme()

export function fakeTheme(sourcePath?: string): any {
  return {
    sourcePath,
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  }
}

export function fakeContext(overrides: Record<string, unknown> = {}): any {
  return {
    args: {},
    toolCallId: 'call-1',
    invalidate: () => {},
    lastComponent: undefined,
    state: {},
    cwd: '/repo',
    executionStarted: false,
    argsComplete: true,
    isPartial: true,
    expanded: false,
    showImages: false,
    isError: false,
    ...overrides,
  }
}

export function renderStripped(component: Component, width: number): string[] {
  return component.render(width).map((line) => stripTerminalSequences(line))
}

export function textResult(lines: string[], details?: Record<string, unknown>): any {
  return { content: [{ type: 'text', text: lines.join('\n') }], details }
}
```

- [ ] **Step 2: Update the runner**

Replace the final line `node --test tests/osseo-call-line.test.ts` of `tests/run-osseo-tests.sh` with:

```bash
if [ "$#" -gt 0 ]; then
  node --test "$@"
else
  node --test tests/*.test.ts
fi
```

- [ ] **Step 3: Verify the harness still runs the existing suite**

Run: `tests/run-osseo-tests.sh`
Expected: PASS (the existing `osseo-call-line.test.ts` runs via the glob; it is deleted only in Task 9).

- [ ] **Step 4: Commit**

```bash
cd ~/Documents/Personal/pi-config && git add tests && git commit -m "test: share osseo test utilities and glob runner"
```

---

### Task 2: Frame primitive in `osseo-frame.ts`

**Files:**
- Create: `extensions/osseo-frame.ts`
- Test: `tests/osseo-frame.test.ts`

**Interfaces:**
- Consumes: `hexToBg`, `hexToFg`, `resolveThemeVar`, `OsseoColorName` from `extensions/osseo-style.ts` (unchanged).
- Produces:
  - `type FrameState = 'pending' | 'success' | 'error'`
  - `const STATE_SYMBOL: Record<FrameState, '◌' | '✓' | '✗'>`
  - `type ThemeSlice = Pick<Theme, 'sourcePath' | 'fg' | 'bold'>`
  - `type FrameColors = { line, fill, symbol, title, subject, meta, body, errorText, added, removed, warning: (text: string) => string }`
  - `resolveFrameColors(theme: ThemeSlice, state: FrameState): FrameColors`
  - `type FrameSection = { label?: string; lines: readonly string[] }`
  - `renderFrame(options: { header?: string; state: FrameState; sections?: readonly FrameSection[]; width: number }, colors: FrameColors): string[]`
- Notes: `truncateToWidth(text, width, ellipsis, pad)` pads only when `pad` is `true` (verified in pi-tui `utils.js`). Border glyphs are hardcoded constants; pi's `Theme` exposes no box symbols.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `tests/run-osseo-tests.sh tests/osseo-frame.test.ts`
Expected: FAIL with `Cannot find module '../extensions/osseo-frame.ts'`.

- [ ] **Step 3: Implement the frame primitive**

Create `extensions/osseo-frame.ts`:

```ts
import { keyHint, truncateToVisualLines, type Theme } from '@earendil-works/pi-coding-agent'
import {
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
} from '@earendil-works/pi-tui'
import { hexToBg, hexToFg, resolveThemeVar, type OsseoColorName } from './osseo-style.ts'

export type FrameState = 'pending' | 'success' | 'error'

const BOX = { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│', teeR: '├', teeL: '┤' } as const
const BAR_RUN = BOX.h.repeat(3)

const FRAME_LINE_VAR: Record<FrameState, OsseoColorName> = {
  pending: 'framePendingLine',
  success: 'frameLine',
  error: 'frameErrorLine',
}

const FRAME_FILL_VAR: Record<FrameState, OsseoColorName> = {
  pending: 'toolPendingBg',
  success: 'toolSuccessBg',
  error: 'toolErrorBg',
}

const STATE_SYMBOL_VAR: Record<FrameState, OsseoColorName> = {
  pending: 'signalOrange',
  success: 'signalGreen',
  error: 'signalRed',
}

export const STATE_SYMBOL: Record<FrameState, '◌' | '✓' | '✗'> = {
  pending: '◌',
  success: '✓',
  error: '✗',
}

export type ThemeSlice = Pick<Theme, 'sourcePath' | 'fg' | 'bold'>

export type FrameColors = {
  line: (text: string) => string
  fill: (text: string) => string
  symbol: (text: string) => string
  title: (text: string) => string
  subject: (text: string) => string
  meta: (text: string) => string
  body: (text: string) => string
  errorText: (text: string) => string
  added: (text: string) => string
  removed: (text: string) => string
  warning: (text: string) => string
}

export function resolveFrameColors(theme: ThemeSlice, state: FrameState): FrameColors {
  const sourcePath = theme.sourcePath
  const fillAnsi = hexToBg(resolveThemeVar(sourcePath, FRAME_FILL_VAR[state]))
  return {
    line: (text) => `${hexToFg(resolveThemeVar(sourcePath, FRAME_LINE_VAR[state]))}${text}\x1b[39m`,
    fill: (text) => {
      const stabilized = text
        .replace(/\x1b\[(?:0)?m/g, (match) => `${match}${fillAnsi}`)
        .replace(/\x1b\[49m/g, (match) => `${match}${fillAnsi}`)
      return `${fillAnsi}${stabilized}\x1b[49m`
    },
    symbol: (text) => `${hexToFg(resolveThemeVar(sourcePath, STATE_SYMBOL_VAR[state]))}${text}\x1b[39m`,
    title: (text) => theme.fg('toolTitle', theme.bold(text)),
    subject: (text) => theme.fg('muted', text),
    meta: (text) => theme.fg('dim', text),
    body: (text) => theme.fg('toolOutput', text),
    errorText: (text) => theme.fg('error', text),
    added: (text) => theme.fg('toolDiffAdded', text),
    removed: (text) => theme.fg('toolDiffRemoved', text),
    warning: (text) => theme.fg('warning', text),
  }
}

export type FrameSection = { label?: string; lines: readonly string[] }

export type FrameOptions = {
  header?: string
  state: FrameState
  sections?: readonly FrameSection[]
  width: number
}

function bar(
  leftGlyph: string,
  rightGlyph: string,
  label: string | undefined,
  width: number,
  colors: FrameColors,
): string {
  const left = `${leftGlyph}${BAR_RUN}`
  const budget = Math.max(0, width - visibleWidth(left) - visibleWidth(rightGlyph))
  if (!label) {
    return colors.line(`${left}${BOX.h.repeat(budget)}${rightGlyph}`)
  }
  const trimmed = truncateToWidth(` ${label} `, budget, '')
  const fill = BOX.h.repeat(Math.max(0, budget - visibleWidth(trimmed)))
  return `${colors.line(left)}${trimmed}${colors.line(`${fill}${rightGlyph}`)}`
}

export function renderFrame(options: FrameOptions, colors: FrameColors): string[] {
  const { header, width } = options
  if (width <= 0) return []
  const contentWidth = Math.max(1, width - 4)
  const rows: string[] = [bar(BOX.tl, BOX.tr, header, width, colors)]
  for (const [index, section] of (options.sections ?? []).entries()) {
    if (section.label || index > 0) {
      rows.push(bar(BOX.teeR, BOX.teeL, section.label, width, colors))
    }
    for (const line of section.lines) {
      const trimmed = line.trimEnd()
      const wrapped = trimmed === '' ? [''] : wrapTextWithAnsi(trimmed, contentWidth)
      for (const row of wrapped) {
        const padded = `${row}${' '.repeat(Math.max(0, contentWidth - visibleWidth(row)))}`
        rows.push(`${colors.line(BOX.v)} ${padded} ${colors.line(BOX.v)}`)
      }
    }
  }
  rows.push(bar(BOX.bl, BOX.br, undefined, width, colors))
  return rows.map((row) => colors.fill(truncateToWidth(row, width, '', true)))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `tests/run-osseo-tests.sh tests/osseo-frame.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/Personal/pi-config && git add extensions tests && git commit -m "feat: osseo frame primitive with state-colored borders and fills"
```

---

### Task 3: Shared format helpers in `osseo-frame.ts`

**Files:**
- Modify: `extensions/osseo-frame.ts` (append)
- Test: `tests/osseo-frame.test.ts` (append)

**Interfaces:**
- Produces (all consumed by `osseo-tools.ts` in Tasks 4-8):
  - `statusHeader(options: { state: FrameState; title: string; subject?: string; meta?: readonly string[] }, colors: FrameColors): string` — `<symbol> <Title>: <subject> · <meta…>`; `subject` is styled with `colors.subject`, so callers needing hyperlinks compose headers manually instead.
  - `normalizeInline(value: string, fallback?: string): string` — collapses newlines/tabs/control chars to one line.
  - `expandHint(colors: FrameColors): string` — `(ctrl+o to expand)` honoring the user's keybinding via `keyHint('app.tools.expand', 'to expand')`.
  - `countUnit(count: number, unit: string): string` — `12 matches`, `1 file`.
  - `moreLine(count: number, unit: string, colors: FrameColors): string` — `… N more <unit> (ctrl+o to expand)`.
  - `treeList(items: readonly string[], options: { expanded: boolean; maxCollapsed: number; unit: string }, colors: FrameColors): string[]`
  - `tailWindow(styledText: string, maxLines: number, width: number, colors: FrameColors): string[]` — ANSI-aware tail truncation via pi's `truncateToVisualLines`.
  - `stripNoticeFooter(text: string): { body: string; notice?: string }` — removes pi's trailing `\n\n[...]` notice.
  - `resultText(result: { content?: Array<{ type?: string; text?: unknown }> } | undefined): string`
  - `class MemoComponent implements Component` — `new MemoComponent(frame: (width: number) => string[], deps: () => string)`; re-renders only when `width` or `deps()` changes; `invalidate()` clears the cache.

- [ ] **Step 1: Write the failing tests**

Append to `tests/osseo-frame.test.ts`:

```ts
import {
  MemoComponent,
  countUnit,
  moreLine,
  normalizeInline,
  resultText,
  statusHeader,
  stripNoticeFooter,
  tailWindow,
  treeList,
} from '../extensions/osseo-frame.ts'

test('statusHeader composes symbol, title, subject, and meta', () => {
  const colors = resolveFrameColors(fakeTheme(), 'success')
  assert.equal(statusHeader({ state: 'success', title: 'Grep', subject: '/foo/ in .', meta: ['2 matches'] }, colors), '✓ Grep: /foo/ in . · 2 matches')
  assert.equal(statusHeader({ state: 'pending', title: 'Ls' }, colors), '◌ Ls')
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
  assert.equal(lines[10], 'line29')
  const short = tailWindow('a\nb', 10, 80, colors)
  assert.deepEqual(short, ['a', 'b'])
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `tests/run-osseo-tests.sh tests/osseo-frame.test.ts`
Expected: FAIL with named exports not found (`statusHeader`, …).

- [ ] **Step 3: Implement the helpers**

Append to `extensions/osseo-frame.ts`:

```ts
export function statusHeader(
  options: { state: FrameState; title: string; subject?: string; meta?: readonly string[] },
  colors: FrameColors,
): string {
  let line = `${colors.symbol(STATE_SYMBOL[options.state])} ${colors.title(options.title)}`
  if (options.subject) line += `: ${colors.subject(options.subject)}`
  const meta = (options.meta ?? []).filter((item) => item.length > 0)
  if (meta.length > 0) line += colors.meta(` · ${meta.join(' · ')}`)
  return line
}

export function normalizeInline(value: string, fallback = '…'): string {
  const normalized = stripTerminalSequences(value)
    .replace(/\r\n|\r|\n/g, ' ↵ ')
    .replace(/\t/g, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/ +/g, ' ')
    .trim()
  return normalized || fallback
}

export function expandHint(colors: FrameColors): string {
  return `${colors.meta('(')}${keyHint('app.tools.expand', 'to expand')}${colors.meta(')')}`
}

function plural(unit: string, count: number): string {
  if (count === 1) return unit
  if (/[^aeiou]y$/.test(unit)) return `${unit.slice(0, -1)}ies`
  if (/(?:ch|sh|s|x|z)$/.test(unit)) return `${unit}es`
  return `${unit}s`
}

export function countUnit(count: number, unit: string): string {
  return `${count} ${plural(unit, count)}`
}

export function moreLine(count: number, unit: string, colors: FrameColors): string {
  return `${colors.meta(`… ${count} more ${plural(unit, count)} `)}${expandHint(colors)}`
}

export function treeList(
  items: readonly string[],
  options: { expanded: boolean; maxCollapsed: number; unit: string },
  colors: FrameColors,
): string[] {
  const shown = options.expanded ? items : items.slice(0, options.maxCollapsed)
  const truncated = !options.expanded && items.length > shown.length
  const rows = shown.map((item, index) => {
    const last = index === shown.length - 1 && !truncated
    return `${colors.meta(last ? '└─' : '├─')} ${item}`
  })
  if (truncated) rows.push(moreLine(items.length - shown.length, options.unit, colors))
  return rows
}

export function tailWindow(styledText: string, maxLines: number, width: number, colors: FrameColors): string[] {
  const result = truncateToVisualLines(styledText, maxLines, width)
  if (result.skippedCount <= 0) return result.visualLines
  return [
    `${colors.meta(`… (${result.skippedCount} earlier lines, `)}${keyHint('app.tools.expand', 'to expand')}${colors.meta(')')}`,
    ...result.visualLines,
  ]
}

export function stripNoticeFooter(text: string): { body: string; notice?: string } {
  const trimmed = text.trimEnd()
  if (!trimmed.endsWith(']')) return { body: trimmed }
  const start = trimmed.lastIndexOf('\n\n[')
  if (start === -1) return { body: trimmed }
  return { body: trimmed.slice(0, start), notice: trimmed.slice(start + 2) }
}

export function resultText(result: { content?: Array<{ type?: string; text?: unknown }> } | undefined): string {
  if (!result?.content) return ''
  const parts: string[] = []
  for (const block of result.content) {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

export class MemoComponent implements Component {
  #key: string | undefined
  #lines: string[] | undefined
  readonly #frame: (width: number) => string[]
  readonly #deps: () => string

  constructor(frame: (width: number) => string[], deps: () => string) {
    this.#frame = frame
    this.#deps = deps
  }

  render(width: number): string[] {
    const key = `${width}|${this.#deps()}`
    if (key === this.#key && this.#lines !== undefined) return this.#lines
    this.#key = key
    this.#lines = this.#frame(width)
    return this.#lines
  }

  invalidate(): void {
    this.#key = undefined
    this.#lines = undefined
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `tests/run-osseo-tests.sh tests/osseo-frame.test.ts`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/Personal/pi-config && git add extensions tests && git commit -m "feat: osseo status, list, and truncation format helpers"
```

---

### Task 4: `osseo-tools.ts` skeleton and the bash renderer

**Files:**
- Create: `extensions/osseo-tools.ts`
- Test: `tests/osseo-tools.test.ts`

**Interfaces:**
- Consumes: everything from Task 2-3 (`renderFrame`, `resolveFrameColors`, `statusHeader`, `tailWindow`, `stripNoticeFooter`, `resultText`, `countUnit`, `expandHint`, `moreLine`, `treeList`, `normalizeInline`, `MemoComponent`, `STATE_SYMBOL`, `FrameColors`, `FrameSection`, `FrameState`).
- Produces:
  - `const BUILTIN_TOOL_NAMES: readonly ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls']`
  - `type BuiltInToolName`
  - `type ToolRendererPair = Pick<ToolDefinition<any, any, any>, 'renderCall' | 'renderResult'>`
  - `createOsseoRenderers(name: BuiltInToolName): ToolRendererPair` (only the `bash` branch lands in this task; later tasks add branches).
- pi-specific facts baked in: pi's `ToolExecutionComponent` calls `renderResult({ content, details }, …)` without `isError` on the result object; error state comes from `context.isError`. `context.state` is shared between the call and result slots of one tool call. pi's own bash renderer drives its elapsed timer with `state.interval = setInterval(() => context.invalidate(), 1000)`; this renderer mirrors that.

- [ ] **Step 1: Write the failing tests**

Create `tests/osseo-tools.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `tests/run-osseo-tests.sh tests/osseo-tools.test.ts`
Expected: FAIL with `Cannot find module '../extensions/osseo-tools.ts'`.

- [ ] **Step 3: Implement the skeleton and bash renderer**

Create `extensions/osseo-tools.ts`:

```ts
import {
  getLanguageFromPath,
  highlightCode,
  renderDiff,
  type Theme,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { hyperlink, truncateToWidth, type Component } from '@earendil-works/pi-tui'
import { resolve as resolvePath } from 'node:path'
import {
  MemoComponent,
  STATE_SYMBOL,
  countUnit,
  expandHint,
  moreLine,
  normalizeInline,
  renderFrame,
  resolveFrameColors,
  resultText,
  statusHeader,
  stripNoticeFooter,
  tailWindow,
  treeList,
  type FrameColors,
  type FrameSection,
  type FrameState,
} from './osseo-frame.ts'

export const BUILTIN_TOOL_NAMES = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'] as const
export type BuiltInToolName = (typeof BUILTIN_TOOL_NAMES)[number]

type AnyToolDefinition = ToolDefinition<any, any, any>
export type ToolRendererPair = Pick<AnyToolDefinition, 'renderCall' | 'renderResult'>

type FrameRenderState = {
  resultPresent?: boolean
  startedAt?: number
  endedAt?: number
  interval?: ReturnType<typeof setInterval>
}

type RenderContextLike = {
  args: Record<string, unknown>
  state: FrameRenderState
  cwd: string
  executionStarted: boolean
  argsComplete: boolean
  isPartial: boolean
  expanded: boolean
  isError: boolean
  invalidate: () => void
}

const BASH_OUTPUT_PREVIEW_LINES = 10
const CODE_PREVIEW_LINES = 12
const LIST_PREVIEW_ITEMS = 8
const DIFF_PREVIEW_LINES = 40

function ensureTimer(state: FrameRenderState, context: RenderContextLike): void {
  if (state.interval !== undefined) return
  state.interval = setInterval(() => context.invalidate(), 1000)
}

function stopTimer(state: FrameRenderState): void {
  if (state.interval === undefined) return
  clearInterval(state.interval)
  state.interval = undefined
}

function elapsedMs(state: FrameRenderState): number | undefined {
  if (state.startedAt === undefined) return undefined
  return (state.endedAt ?? Date.now()) - state.startedAt
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

function argsKey(args: unknown): string {
  try {
    return JSON.stringify(args) ?? ''
  } catch {
    return ''
  }
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function pathArg(args: Record<string, unknown>): string {
  return stringArg(args, 'path') ?? stringArg(args, 'file_path') ?? ''
}

function linkedPath(display: string, cwd: string, colors: FrameColors): string {
  const styled = colors.subject(display)
  if (display.length === 0 || display === '…') return styled
  return hyperlink(styled, `file://${resolvePath(cwd, display)}`)
}

function truncationWarning(
  details: Record<string, unknown> | undefined,
  notice: string | undefined,
): string | undefined {
  const truncation = details?.truncation as
    | { truncated?: boolean; outputLines?: number; totalLines?: number }
    | undefined
  if (
    truncation?.truncated &&
    typeof truncation.outputLines === 'number' &&
    typeof truncation.totalLines === 'number'
  ) {
    return `[Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines]`
  }
  return notice
}

function errorLines(result: unknown, colors: FrameColors): string[] {
  return resultText(result as { content?: Array<{ type?: string; text?: unknown }> })
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => colors.errorText(line))
}

function bashCommandLines(args: Record<string, unknown>, colors: FrameColors): string[] {
  const command = stringArg(args, 'command') ?? '…'
  const highlighted = highlightCode(command, 'bash')
  const prefix = colors.meta('$ ')
  return highlighted.map((line, index) => (index === 0 ? `${prefix}${line}` : line))
}

function bashRenderers(): ToolRendererPair {
  return {
    renderCall(args, theme, context) {
      const ctx = context as unknown as RenderContextLike
      const state = ctx.state
      if (ctx.executionStarted && state.startedAt === undefined) state.startedAt = Date.now()
      if (ctx.executionStarted) ensureTimer(state, ctx)
      return new MemoComponent(
        (width) => {
          if (state.resultPresent) return []
          const colors = resolveFrameColors(theme, 'pending')
          const lines = bashCommandLines(ctx.args, colors)
          const elapsed = elapsedMs(state)
          if (ctx.executionStarted && elapsed !== undefined) {
            lines.push(colors.meta(`running · ${Math.floor(elapsed / 1000)}s`))
          }
          return renderFrame({ state: 'pending', sections: [{ lines }], width }, colors)
        },
        () =>
          [
            state.resultPresent === true,
            ctx.executionStarted,
            Math.floor((elapsedMs(state) ?? 0) / 1000),
            argsKey(args),
          ].join('|'),
      )
    },
    renderResult(result, options, theme, context) {
      const ctx = context as unknown as RenderContextLike
      const state = ctx.state
      state.resultPresent = true
      if (!options.isPartial || ctx.isError) {
        state.endedAt ??= Date.now()
        stopTimer(state)
      }
      return new MemoComponent(
        (width) => {
          const frameState: FrameState = ctx.isError ? 'error' : options.isPartial ? 'pending' : 'success'
          const colors = resolveFrameColors(theme, frameState)
          const sections: FrameSection[] = [{ lines: bashCommandLines(ctx.args, colors) }]
          const { body, notice } = stripNoticeFooter(resultText(result))
          const outputLines: string[] = []
          if (body.trim().length > 0) {
            const styled = body
              .split('\n')
              .map((line) => colors.body(line))
              .join('\n')
            if (options.expanded) {
              outputLines.push(...styled.split('\n'))
            } else {
              outputLines.push(...tailWindow(styled, BASH_OUTPUT_PREVIEW_LINES, Math.max(1, width - 4), colors))
            }
          } else {
            outputLines.push(colors.meta('(no output)'))
          }
          const elapsed = elapsedMs(state)
          if (elapsed !== undefined) {
            outputLines.push(colors.meta(`[${options.isPartial ? 'Elapsed' : 'Took'} ${formatDuration(elapsed)}]`))
          }
          const warning = truncationWarning(
            (result as { details?: Record<string, unknown> }).details,
            notice,
          )
          if (warning) outputLines.push(colors.warning(warning))
          sections.push({ label: colors.title('Output'), lines: outputLines })
          return renderFrame({ state: frameState, sections, width }, colors)
        },
        () =>
          [
            ctx.isError,
            options.isPartial,
            options.expanded,
            resultText(result).length,
            Math.floor((elapsedMs(state) ?? 0) / 1000),
          ].join('|'),
      )
    },
  }
}

export function createOsseoRenderers(name: BuiltInToolName): ToolRendererPair {
  switch (name) {
    case 'bash':
      return bashRenderers()
    default:
      throw new Error(`osseo renderer not implemented yet: ${name}`)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `tests/run-osseo-tests.sh tests/osseo-tools.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/Personal/pi-config && git add extensions tests && git commit -m "feat: osseo bash framed renderer"
```

---

### Task 5: read renderer

**Files:**
- Modify: `extensions/osseo-tools.ts`
- Test: `tests/osseo-tools.test.ts` (append)

**Interfaces:**
- Consumes: Task 4 skeleton (`linkedPath`, `pathArg`, `stringArg`, `errorLines`, `truncationWarning`, helpers).
- Produces: `readCodeLines(text: string, language: string | undefined, startLine: number, expanded: boolean, colors: FrameColors): string[]` (exported for tests); `createOsseoRenderers('read')` branch. Header composition is manual (not `statusHeader`) because the path is an OSC 8 hyperlink: `✓ Read: <linked path>:L1-L20`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/osseo-tools.test.ts`:

```ts
import { createOsseoRenderers, readCodeLines } from '../extensions/osseo-tools.ts'
import { resolveFrameColors } from '../extensions/osseo-frame.ts'

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `tests/run-osseo-tests.sh tests/osseo-tools.test.ts`
Expected: FAIL with `createOsseoRenderers('read')` throwing `osseo renderer not implemented yet: read`.

- [ ] **Step 3: Implement the read renderer**

Append to `extensions/osseo-tools.ts` (before `createOsseoRenderers`):

```ts
function readSubjectParts(args: Record<string, unknown>): { path: string; suffix: string; startLine: number } {
  const path = pathArg(args)
  const offset = typeof args.offset === 'number' ? args.offset : undefined
  const limit = typeof args.limit === 'number' ? args.limit : undefined
  const startLine = offset ?? 1
  const suffix =
    offset !== undefined || limit !== undefined
      ? `:${startLine}${limit !== undefined ? `-${startLine + limit - 1}` : ''}`
      : ''
  return { path: path || '…', suffix, startLine }
}

export function readCodeLines(
  text: string,
  language: string | undefined,
  startLine: number,
  expanded: boolean,
  colors: FrameColors,
): string[] {
  const raw = text.split('\n')
  while (raw.length > 0 && raw[raw.length - 1] === '') raw.pop()
  if (raw.length === 0) return [colors.meta('(empty file)')]
  const shown = expanded ? raw : raw.slice(0, CODE_PREVIEW_LINES)
  const highlighted = highlightCode(shown.join('\n'), language)
  const gutterWidth = Math.max(2, String(startLine + shown.length - 1).length)
  const lines = highlighted.map((line, index) => {
    const gutter = String(startLine + index).padStart(gutterWidth, ' ')
    return `${colors.meta(`${gutter} `)}${line}`
  })
  if (!expanded && raw.length > shown.length) {
    lines.push(`${colors.meta(`… ${raw.length - shown.length} more lines `)}${expandHint(colors)}`)
  }
  return lines
}

function readRenderers(): ToolRendererPair {
  const header = (state: FrameState, args: Record<string, unknown>, cwd: string, colors: FrameColors): string => {
    const { path, suffix } = readSubjectParts(args)
    return `${colors.symbol(STATE_SYMBOL[state])} ${colors.title('Read')}: ${linkedPath(path, cwd, colors)}${colors.subject(suffix)}`
  }
  return {
    renderCall(args, theme, context) {
      const ctx = context as unknown as RenderContextLike
      const state = ctx.state
      return new MemoComponent(
        (width) => {
          if (state.resultPresent) return []
          const colors = resolveFrameColors(theme, 'pending')
          return [truncateToWidth(header('pending', ctx.args, ctx.cwd, colors), width, '')]
        },
        () => [state.resultPresent === true, argsKey(args)].join('|'),
      )
    },
    renderResult(result, options, theme, context) {
      const ctx = context as unknown as RenderContextLike
      const state = ctx.state
      state.resultPresent = true
      return new MemoComponent(
        (width) => {
          const frameState: FrameState = ctx.isError ? 'error' : 'success'
          const colors = resolveFrameColors(theme, frameState)
          const head = header(frameState, ctx.args, ctx.cwd, colors)
          if (ctx.isError) {
            return renderFrame({ header: head, state: 'error', sections: [{ lines: errorLines(result, colors) }], width }, colors)
          }
          const content = (result as { content?: Array<{ type?: string }> }).content ?? []
          if (content.some((block) => block?.type === 'image')) {
            return renderFrame({ header: head, state: frameState, sections: [{ lines: [colors.meta('(image)')] }], width }, colors)
          }
          const { body, notice } = stripNoticeFooter(resultText(result))
          const { startLine } = readSubjectParts(ctx.args)
          const sections: FrameSection[] = [
            { lines: readCodeLines(body, getLanguageFromPath(pathArg(ctx.args)), startLine, options.expanded, colors) },
          ]
          const warning = truncationWarning((result as { details?: Record<string, unknown> }).details, notice)
          if (warning) sections.push({ label: colors.title('Output'), lines: [colors.warning(warning)] })
          return renderFrame({ header: head, state: frameState, sections, width }, colors)
        },
        () => [ctx.isError, options.expanded, resultText(result).length].join('|'),
      )
    },
  }
}
```

Add the branch to `createOsseoRenderers`:

```ts
    case 'read':
      return readRenderers()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `tests/run-osseo-tests.sh tests/osseo-tools.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/Personal/pi-config && git add extensions tests && git commit -m "feat: osseo read framed code-cell renderer"
```

---

### Task 6: write renderer

**Files:**
- Modify: `extensions/osseo-tools.ts`
- Test: `tests/osseo-tools.test.ts` (append)

**Interfaces:**
- Consumes: Task 4-5 internals.
- Produces: `createOsseoRenderers('write')` branch. Pending frame body is the tail window of `args.content` plus a `(streaming…)` line until `context.argsComplete`; settled body is top-anchored with `· N lines` meta in the header.

- [ ] **Step 1: Write the failing tests**

Append to `tests/osseo-tools.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `tests/run-osseo-tests.sh tests/osseo-tools.test.ts`
Expected: FAIL with `osseo renderer not implemented yet: write`.

- [ ] **Step 3: Implement the write renderer**

Append to `extensions/osseo-tools.ts` (before `createOsseoRenderers`):

```ts
function writeRenderers(): ToolRendererPair {
  const contentOf = (args: Record<string, unknown>): string => stringArg(args, 'content') ?? ''
  const head = (
    state: FrameState,
    args: Record<string, unknown>,
    cwd: string,
    colors: FrameColors,
    meta?: string,
  ): string => {
    let line = `${colors.symbol(STATE_SYMBOL[state])} ${colors.title('Write')}: ${linkedPath(pathArg(args) || '…', cwd, colors)}`
    if (meta) line += colors.meta(` · ${meta}`)
    return line
  }
  return {
    renderCall(args, theme, context) {
      const ctx = context as unknown as RenderContextLike
      const state = ctx.state
      return new MemoComponent(
        (width) => {
          if (state.resultPresent) return []
          const colors = resolveFrameColors(theme, 'pending')
          const content = contentOf(ctx.args)
          const language = getLanguageFromPath(pathArg(ctx.args))
          const lines: string[] = []
          if (content.length > 0) {
            const raw = content.split('\n')
            const tail = raw.length > CODE_PREVIEW_LINES
            const shown = tail ? raw.slice(-CODE_PREVIEW_LINES) : raw
            if (tail) lines.push(colors.meta(`… ${raw.length - shown.length} earlier lines`))
            lines.push(...highlightCode(shown.join('\n'), language))
          }
          if (!ctx.argsComplete) lines.push(colors.meta('(streaming…)'))
          return renderFrame(
            { header: head('pending', ctx.args, ctx.cwd, colors), state: 'pending', sections: [{ lines }], width },
            colors,
          )
        },
        () => [state.resultPresent === true, ctx.argsComplete, contentOf(ctx.args).length].join('|'),
      )
    },
    renderResult(result, options, theme, context) {
      const ctx = context as unknown as RenderContextLike
      const state = ctx.state
      state.resultPresent = true
      return new MemoComponent(
        (width) => {
          if (ctx.isError) {
            const colors = resolveFrameColors(theme, 'error')
            return renderFrame(
              { header: head('error', ctx.args, ctx.cwd, colors), state: 'error', sections: [{ lines: errorLines(result, colors) }], width },
              colors,
            )
          }
          const colors = resolveFrameColors(theme, 'success')
          const content = contentOf(ctx.args)
          const raw = content.split('\n')
          const language = getLanguageFromPath(pathArg(ctx.args))
          const shown = options.expanded ? raw : raw.slice(0, CODE_PREVIEW_LINES)
          const lines = highlightCode(shown.join('\n'), language)
          if (!options.expanded && raw.length > shown.length) {
            lines.push(`${colors.meta(`… ${raw.length - shown.length} more lines `)}${expandHint(colors)}`)
          }
          return renderFrame(
            {
              header: head('success', ctx.args, ctx.cwd, colors, countUnit(raw.length, 'line')),
              state: 'success',
              sections: [{ lines }],
              width,
            },
            colors,
          )
        },
        () => [ctx.isError, options.expanded, contentOf(ctx.args).length].join('|'),
      )
    },
  }
}
```

Add the branch to `createOsseoRenderers`:

```ts
    case 'write':
      return writeRenderers()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `tests/run-osseo-tests.sh tests/osseo-tools.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/Personal/pi-config && git add extensions tests && git commit -m "feat: osseo write framed renderer"
```

---

### Task 7: edit renderer

**Files:**
- Modify: `extensions/osseo-tools.ts`
- Test: `tests/osseo-tools.test.ts` (append)

**Interfaces:**
- Consumes: Task 4-6 internals; pi's exported `renderDiff(diffText, { filePath })` for the colored diff body. pi's `EditToolDetails` is `{ diff: string; patch: string; firstChangedLine?: number }`; pi does not export `computeEditsDiff`, so the pending phase shows no preview diff (spec scope decision).
- Produces: `editDiffStats(diff: string): { added: number; removed: number }` (exported for tests); `createOsseoRenderers('edit')` branch. Settled header: `✓ Edit: <linked path> +A -R`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/osseo-tools.test.ts`:

```ts
import { createOsseoRenderers, editDiffStats, readCodeLines } from '../extensions/osseo-tools.ts'

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `tests/run-osseo-tests.sh tests/osseo-tools.test.ts`
Expected: FAIL with `osseo renderer not implemented yet: edit`.

- [ ] **Step 3: Implement the edit renderer**

Append to `extensions/osseo-tools.ts` (before `createOsseoRenderers`):

```ts
export function editDiffStats(diff: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+')) added += 1
    else if (line.startsWith('-')) removed += 1
  }
  return { added, removed }
}

function editRenderers(): ToolRendererPair {
  const head = (
    state: FrameState,
    args: Record<string, unknown>,
    cwd: string,
    colors: FrameColors,
    diff?: string,
  ): string => {
    let line = `${colors.symbol(STATE_SYMBOL[state])} ${colors.title('Edit')}: ${linkedPath(pathArg(args) || '…', cwd, colors)}`
    if (diff) {
      const stats = editDiffStats(diff)
      const parts: string[] = []
      if (stats.added > 0) parts.push(colors.added(`+${stats.added}`))
      if (stats.removed > 0) parts.push(colors.removed(`-${stats.removed}`))
      if (parts.length > 0) line += ` ${parts.join(' ')}`
    }
    return line
  }
  return {
    renderCall(args, theme, context) {
      const ctx = context as unknown as RenderContextLike
      const state = ctx.state
      return new MemoComponent(
        (width) => {
          if (state.resultPresent) return []
          const colors = resolveFrameColors(theme, 'pending')
          const edits = Array.isArray(ctx.args.edits) ? ctx.args.edits.length : 1
          const lines = [colors.meta(`${countUnit(edits, 'edit')} pending`)]
          return renderFrame(
            { header: head('pending', ctx.args, ctx.cwd, colors), state: 'pending', sections: [{ lines }], width },
            colors,
          )
        },
        () => [state.resultPresent === true, argsKey(args)].join('|'),
      )
    },
    renderResult(result, options, theme, context) {
      const ctx = context as unknown as RenderContextLike
      const state = ctx.state
      state.resultPresent = true
      return new MemoComponent(
        (width) => {
          if (ctx.isError) {
            const colors = resolveFrameColors(theme, 'error')
            return renderFrame(
              { header: head('error', ctx.args, ctx.cwd, colors), state: 'error', sections: [{ lines: errorLines(result, colors) }], width },
              colors,
            )
          }
          const colors = resolveFrameColors(theme, 'success')
          const details = (result as { details?: { diff?: unknown } }).details
          const diff = typeof details?.diff === 'string' ? details.diff : ''
          const body =
            diff.length > 0
              ? renderDiff(diff, { filePath: pathArg(ctx.args) }).split('\n')
              : [colors.meta('(no changes)')]
          const shown = options.expanded ? body : body.slice(0, DIFF_PREVIEW_LINES)
          const lines = [...shown]
          if (!options.expanded && body.length > shown.length) {
            lines.push(moreLine(body.length - shown.length, 'diff line', colors))
          }
          return renderFrame(
            {
              header: head('success', ctx.args, ctx.cwd, colors, diff || undefined),
              state: 'success',
              sections: [{ lines }],
              width,
            },
            colors,
          )
        },
        () => {
          const details = (result as { details?: { diff?: unknown } }).details
          return [ctx.isError, options.expanded, typeof details?.diff === 'string' ? details.diff.length : 0].join('|')
        },
      )
    },
  }
}
```

Add the branch to `createOsseoRenderers`:

```ts
    case 'edit':
      return editRenderers()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `tests/run-osseo-tests.sh tests/osseo-tools.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/Personal/pi-config && git add extensions tests && git commit -m "feat: osseo edit framed diff renderer"
```

---

### Task 8: grep, find, and ls renderers (inline search family)

**Files:**
- Modify: `extensions/osseo-tools.ts`
- Test: `tests/osseo-tools.test.ts` (append)

**Interfaces:**
- Consumes: Task 4-7 internals; `statusHeader`, `treeList`, `countUnit`, `stripNoticeFooter`.
- Produces: `createOsseoRenderers('grep' | 'find' | 'ls')` branches via one shared `searchListRenderers(config: { title: string; unit: string; emptyText: string; subject: (args: Record<string, unknown>) => string }): ToolRendererPair`. These never frame; the result is a status header plus a tree list. Counts derive from non-empty body lines; `details.truncation.truncated`, `details.matchLimitReached`, `details.resultLimitReached`, and `details.entryLimitReached` add a dim `truncated` meta.

- [ ] **Step 1: Write the failing tests**

Append to `tests/osseo-tools.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `tests/run-osseo-tests.sh tests/osseo-tools.test.ts`
Expected: FAIL with `osseo renderer not implemented yet: grep`.

- [ ] **Step 3: Implement the search-list renderers**

Append to `extensions/osseo-tools.ts` (before `createOsseoRenderers`):

```ts
type SearchListConfig = {
  title: string
  unit: string
  emptyText: string
  subject: (args: Record<string, unknown>) => string
}

function searchListRenderers(config: SearchListConfig): ToolRendererPair {
  return {
    renderCall(args, theme, context) {
      const ctx = context as unknown as RenderContextLike
      const state = ctx.state
      return new MemoComponent(
        (width) => {
          if (state.resultPresent) return []
          const colors = resolveFrameColors(theme, 'pending')
          return [truncateToWidth(statusHeader({ state: 'pending', title: config.title, subject: config.subject(ctx.args) }, colors), width, '')]
        },
        () => [state.resultPresent === true, argsKey(args)].join('|'),
      )
    },
    renderResult(result, options, theme, context) {
      const ctx = context as unknown as RenderContextLike
      const state = ctx.state
      state.resultPresent = true
      return new MemoComponent(
        (width) => {
          const subject = config.subject(ctx.args)
          if (ctx.isError) {
            const colors = resolveFrameColors(theme, 'error')
            return [
              statusHeader({ state: 'error', title: config.title, subject }, colors),
              ...errorLines(result, colors),
            ].map((line) => truncateToWidth(line, width, ''))
          }
          const colors = resolveFrameColors(theme, 'success')
          const { body } = stripNoticeFooter(resultText(result))
          const items = body.split('\n').filter((line) => line.trim().length > 0)
          const meta = [countUnit(items.length, config.unit)]
          const details = (result as { details?: Record<string, unknown> }).details ?? {}
          if (
            (details.truncation as { truncated?: boolean } | undefined)?.truncated === true ||
            details.matchLimitReached !== undefined ||
            details.resultLimitReached !== undefined ||
            details.entryLimitReached !== undefined
          ) {
            meta.push('truncated')
          }
          const header = statusHeader({ state: 'success', title: config.title, subject, meta }, colors)
          const rows =
            items.length === 0
              ? [colors.meta(`(${config.emptyText})`)]
              : treeList(
                  items.map((line) => colors.body(line)),
                  { expanded: options.expanded, maxCollapsed: LIST_PREVIEW_ITEMS, unit: config.unit },
                  colors,
                )
          return [header, ...rows].map((line) => truncateToWidth(line, width, ''))
        },
        () => [ctx.isError, options.expanded, resultText(result).length].join('|'),
      )
    },
  }
}
```

Replace the `default` branch of `createOsseoRenderers` with the remaining cases:

```ts
export function createOsseoRenderers(name: BuiltInToolName): ToolRendererPair {
  switch (name) {
    case 'bash':
      return bashRenderers()
    case 'read':
      return readRenderers()
    case 'write':
      return writeRenderers()
    case 'edit':
      return editRenderers()
    case 'grep':
      return searchListRenderers({
        title: 'Grep',
        unit: 'match',
        emptyText: 'no matches',
        subject: (args) => `/${normalizeInline(stringArg(args, 'pattern') ?? '?')}/ in ${normalizeInline(stringArg(args, 'path') ?? '.')}`,
      })
    case 'find':
      return searchListRenderers({
        title: 'Find',
        unit: 'file',
        emptyText: 'no files found',
        subject: (args) => `${normalizeInline(stringArg(args, 'pattern') ?? '…')} in ${normalizeInline(stringArg(args, 'path') ?? '.')}`,
      })
    case 'ls':
      return searchListRenderers({
        title: 'Ls',
        unit: 'entry',
        emptyText: 'empty directory',
        subject: (args) => normalizeInline(stringArg(args, 'path') ?? '.'),
      })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `tests/run-osseo-tests.sh tests/osseo-tools.test.ts`
Expected: PASS, 25 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/Personal/pi-config && git add extensions tests && git commit -m "feat: osseo inline search-family renderers"
```

---

### Task 9: Wire the transcript and delete the ledger

**Files:**
- Modify: `extensions/osseo-transcript.ts`
- Delete: `extensions/osseo-call-line.ts`, `tests/osseo-call-line.test.ts`
- Test: `tests/osseo-transcript.test.ts`

**Interfaces:**
- Consumes: `BUILTIN_TOOL_NAMES`, `BuiltInToolName`, `createOsseoRenderers` from `extensions/osseo-tools.ts`.
- Produces: `createRuntimeToolDefinitions(cwd, settings): AnyToolDefinition[]` (unchanged signature), `decorateBuiltInTool(definition): AnyToolDefinition` (now returns `{ ...definition, renderShell: 'self', ...createOsseoRenderers(definition.name) }`). The default export and its `session_start` registration are unchanged.

- [ ] **Step 1: Write the failing test**

Create `tests/osseo-transcript.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRuntimeToolDefinitions, decorateBuiltInTool } from '../extensions/osseo-transcript.ts'
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `tests/run-osseo-tests.sh tests/osseo-transcript.test.ts`
Expected: FAIL — the current `decorateBuiltInTool` returns components from the ledger module, so the identity assertions on `renderShell` pass but the suppression test renders ledger lines instead of `[]`, and `decorateBuiltInTool` still works only because `osseo-call-line.ts` exists. (The point of the step is watching it flip after the rewrite.)

- [ ] **Step 3: Rewrite `osseo-transcript.ts`**

Replace the whole file with:

```ts
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  getAgentDir,
  SettingsManager,
  type ExtensionAPI,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { BUILTIN_TOOL_NAMES, createOsseoRenderers, type BuiltInToolName } from './osseo-tools.ts'

type AnyToolDefinition = ToolDefinition<any, any, any>
export type RuntimeToolSettings = Pick<
  SettingsManager,
  'getImageAutoResize' | 'getShellCommandPrefix' | 'getShellPath'
>

export function createRuntimeToolDefinitions(
  cwd: string,
  settings: RuntimeToolSettings,
): AnyToolDefinition[] {
  return [
    createReadToolDefinition(cwd, { autoResizeImages: settings.getImageAutoResize() }),
    createBashToolDefinition(cwd, {
      commandPrefix: settings.getShellCommandPrefix(),
      shellPath: settings.getShellPath(),
    }),
    createEditToolDefinition(cwd),
    createWriteToolDefinition(cwd),
    createGrepToolDefinition(cwd),
    createFindToolDefinition(cwd),
    createLsToolDefinition(cwd),
  ]
}

function isBuiltInToolName(name: string): name is BuiltInToolName {
  return BUILTIN_TOOL_NAMES.some((candidate) => candidate === name)
}

export function decorateBuiltInTool(definition: AnyToolDefinition): AnyToolDefinition {
  if (!isBuiltInToolName(definition.name)) {
    throw new Error(`Cannot decorate non-built-in tool: ${definition.name}`)
  }
  return { ...definition, renderShell: 'self', ...createOsseoRenderers(definition.name) }
}

export default function (pi: ExtensionAPI) {
  pi.on('session_start', (_event, ctx) => {
    if (ctx.mode !== 'tui') return
    const settings = SettingsManager.create(ctx.cwd, getAgentDir(), {
      projectTrusted: ctx.isProjectTrusted(),
    })
    for (const definition of createRuntimeToolDefinitions(ctx.cwd, settings)) {
      pi.registerTool(decorateBuiltInTool(definition))
    }
  })
}
```

- [ ] **Step 4: Delete the ledger module and its test**

```bash
cd ~/Documents/Personal/pi-config && git rm extensions/osseo-call-line.ts tests/osseo-call-line.test.ts
```

- [ ] **Step 5: Verify no stale imports remain**

Run: `grep -rn "osseo-call-line" extensions tests || true`
Expected: no output.

- [ ] **Step 6: Run the full suite**

Run: `tests/run-osseo-tests.sh`
Expected: PASS, 28 tests across `osseo-frame.test.ts`, `osseo-tools.test.ts`, `osseo-transcript.test.ts`.

- [ ] **Step 7: Commit**

```bash
cd ~/Documents/Personal/pi-config && git add extensions tests && git commit -m "feat: wire osseo framed renderers into the transcript, drop the ledger"
```

---

### Task 10: Manual acceptance and close-out

**Files:**
- Modify: none (verification only)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Smoke-run a real pi session**

In a scratch directory with a few files, start `pi` (theme `osseo-bone` is already the default in `settings.json`) and run one prompt per check:

1. `read package.json` then `read package.json offset 5 limit 10` — framed code cell, gutter starts at 5, path is a clickable link.
2. `run npm --version in bash` — headerless frame, `$ npm --version`, `Output` section, `[Took …]` line.
3. `run bash -c 'seq 1 40' in bash` — collapsed tail window with `… (30 earlier lines, ctrl+o to expand)`; press `ctrl+o` on the block to uncap.
4. `write a file demo.ts with 30 lines` — pending frame streams content, settled header shows `· 30 lines`.
5. `edit demo.ts changing line 2` — header shows `+1 -1`, colored diff body.
6. `grep for "line" in .` — flat header with counts, tree list, `… N more matches` hint.
7. `find *.ts in .` and `ls .` — flat headers, tree lists.
8. Force an error: `read /nonexistent` — error frame with `✗` and red fill; `bash false` — error frame with exit output.
9. Resize the terminal to 80, 120, and 160 columns during the above — every frame row stays exactly full width with no ragged right border.
10. Read an image file — header plus `(image)` body, image renders below the frame.

- [ ] **Step 2: Run the full suite one last time**

Run: `tests/run-osseo-tests.sh`
Expected: PASS.

- [ ] **Step 3: Final commit and push**

```bash
cd ~/Documents/Personal/pi-config && git add extensions tests docs && git commit -m "docs: osseo iteration 2 acceptance" --allow-empty && git push
```

Tell Olle the push landed.

---

## Self-review notes

- Spec coverage: frame geometry (Task 2), state mapping (Task 2 Step 3 `FRAME_LINE_VAR`/`FRAME_FILL_VAR`/`STATE_SYMBOL_VAR`), merge model (Task 4 `resultPresent` pattern, Task 9 suppression test), per-tool formats (Tasks 4-8), palette rule (Task 2 uses only existing vars), testing (Tasks 2-10), scope decisions (Task 9 deletes the ledger; search bodies stay plain; no hunk cap — Task 7 caps lines only).
- Type consistency: `FrameColors`, `FrameSection`, `FrameState`, `STATE_SYMBOL`, `MemoComponent`, `ToolRendererPair`, `createOsseoRenderers`, `readCodeLines`, `editDiffStats` are used with the same names and signatures in every task that references them.
- Assumptions the executor should treat as exceptions to investigate, not silently patch: `highlightCode` returns one string per input line; `wrapTextWithAnsi` handles ANSI-containing diff lines; `keyHint('app.tools.expand', …)` resolves from pi-tui's default keybindings in both the TUI and the test process (the test utils initialize the global theme for exactly this reason).
