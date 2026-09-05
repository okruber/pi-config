# Im­eto Center Column Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the approved terminal-native Im­eto center column for Pi, including transcript hierarchy, compact built-in tool ledgers, edge-only tool output, and the responsive powerline editor dock.

**Architecture:** `extensions/imeto-tool-ui.ts` owns pure rendering policy, width safety, tool ledger components, output wrappers, and responsive dock selection. `extensions/imeto-transcript.ts` applies display-only Markdown transforms and decorates Pi's seven built-in tool definitions while preserving their execution contracts. `extensions/omp-chatbox.ts` renders the powerline dock and editor body, while `extensions/token-speed.ts` publishes cache and token-rate values through the existing footer-status bridge.

**Tech Stack:** Pi `0.84.3` extension APIs, TypeScript, `@earendil-works/pi-tui`, Node.js `node:test`, 24-bit ANSI color, Orca terminal theme.

**Spec:** `docs/superpowers/specs/2026-09-04-imeto-center-column-design.md`

## Global Constraints

- The pass will not add a persistent left rail.
- The pass will not add a persistent right context pane.
- The pass will not add browser styling.
- The pass will not fork Pi core.
- The pass will not replace arbitrary custom or MCP tool renderers.
- The pass will not change tool behavior, model behavior, or session data.
- The pass will not hide Pi diagnostics by changing unrelated startup settings.
- `extensions/imeto-style.ts` remains the canonical palette source.
- The decorated tools are `read`, `bash`, `edit`, `write`, `grep`, `find`, and `ls`.
- Every renderer measures visible width after removing ANSI sequences.
- Every truncated fragment closes foreground, background, bold, and inverse state.
- No rendered line may exceed the width supplied by Pi.
- `Symbol.for('omp.footer.statuses.v1')` and bridge version `1` remain unchanged.
- Custom and MCP tools retain their registered renderers or Pi's default fallback renderer.
- Terminal-only setup exits when `ctx.mode !== 'tui'`.
- The read tool receives the active image auto-resize setting.
- The bash tool receives the active command prefix and shell path.
- The implementation uses test-driven development and task-level review.
- The feature branch remains unmerged during implementation.
- Runtime files created by isolated Pi sessions are removed before review.
- The main checkout's unrelated `settings.json` changes remain unchanged.
- No implementation commit is pushed until automated verification, live acceptance, and final review pass.

## Approved execution-review amendments

These amendments override narrower snippets below when they conflict.

- The custom preview policy receives semantic output from Pi's original renderer in expanded mode. This prevents Pi from hiding or truncating content before the Im­eto policy runs.
- The tool ledger receives the current expansion state because edit and write previews live in the call slot.
- Summary subjects remove terminal control sequences and normalize line breaks so each ledger header remains one visual row.
- Diff classification removes terminal sequences before counting changed lines.
- Output normalization preserves source indentation. It removes a leading cell only from components with a known outer padding cell.
- Background removal applies only to known filled renderer shells. It does not remove intentional styling from arbitrary semantic content.
- The user quote restores Oxblood upright text for the `YOU` label and Deep Navy upright text for the body. Rendered-component tests verify that Pi's blockquote style does not override those roles.
- Actual built-in renderer tests cover collapsed and expanded behavior for all seven decorated tools. The tests also cover streaming, errors, indentation, ANSI state, and multiline summaries.
- Token and cache statuses refresh after the cache settle delay and after `model_select`.
- The implementation plan is included in the Task 1 commit.

---

### Task 1: Rendering policy and terminal components

**Files:**
- Create: `extensions/imeto-tool-ui.ts`
- Create: `tests/imeto-tool-ui.test.ts`
- Create: `tests/run-imeto-center-column-tests.sh`

**Interfaces:**
- Consumes: `IMETO_COLORS`, `hexToBg`, `hexToFg`, and `readThemeHex` from `extensions/imeto-style.ts`.
- Consumes: `Component`, `Theme`, `truncateToWidth`, and `visibleWidth` from `@earendil-works/pi-tui`.
- Produces: `BUILTIN_TOOL_NAMES`, the readonly tuple `['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls']`.
- Produces: `BuiltInToolName`, the union derived from `BUILTIN_TOOL_NAMES`.
- Produces: `ToolVisualState`, the union `'pending' | 'success' | 'error'`.
- Produces: `toolVisualState(isPartial: boolean, isError: boolean): ToolVisualState`.
- Produces: `toolStateSymbol(state: ToolVisualState): '◌' | '✓' | '×'`.
- Produces: `summarizeToolCall(name: BuiltInToolName, args: Record<string, unknown>, cwd: string): ToolSummary`.
- Produces: `fitAnsi(text: string, width: number): string`.
- Produces: `stripBackgroundAnsi(text: string): string`.
- Produces: `selectPreviewLines(name: BuiltInToolName, lines: string[], expanded: boolean): PreviewSelection`.
- Produces: `ToolLedgerComponent` and `EdgeOutputComponent`, which implement Pi's `Component` contract.

- [x] **Step 1: Add the global-Pi test launcher**

Create `tests/run-imeto-center-column-tests.sh` with this content.

```bash
#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

if [ -e node_modules ]; then
  echo "refusing to replace existing node_modules" >&2
  exit 1
fi

global_root="$(npm root -g)"
pi_root="$global_root/@earendil-works/pi-coding-agent"
if [ ! -d "$pi_root" ]; then
  echo "global Pi package not found under $global_root" >&2
  exit 1
fi

cleanup() {
  rm -rf "$repo/node_modules"
}
trap cleanup EXIT INT TERM

mkdir -p node_modules/@earendil-works
ln -s "$pi_root" node_modules/@earendil-works/pi-coding-agent
ln -s "$pi_root/node_modules/@earendil-works/pi-tui" node_modules/@earendil-works/pi-tui

node --test tests/imeto-*.test.ts
```

Run:

```bash
chmod +x tests/run-imeto-center-column-tests.sh
```

Expected: the script is executable. The `trap` removes the temporary root `node_modules` directory on success, failure, or interruption.

- [x] **Step 2: Write failing rendering-policy tests**

Create `tests/imeto-tool-ui.test.ts` with the imports and focused tests below.

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { Text, visibleWidth } from '@earendil-works/pi-tui'
import {
  EdgeOutputComponent,
  ToolLedgerComponent,
  fitAnsi,
  selectPreviewLines,
  stripBackgroundAnsi,
  summarizeToolCall,
  toolStateSymbol,
  toolVisualState,
} from '../extensions/imeto-tool-ui.ts'

const theme = {
  sourcePath: undefined,
  fg: (_name: string, text: string) => text,
  bg: (_name: string, text: string) => text,
  bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
} as any

test('tool states use the approved symbols', () => {
  assert.equal(toolStateSymbol(toolVisualState(true, false)), '◌')
  assert.equal(toolStateSymbol(toolVisualState(false, false)), '✓')
  assert.equal(toolStateSymbol(toolVisualState(false, true)), '×')
})

test('every decorated tool exposes its useful argument', () => {
  assert.deepEqual(summarizeToolCall('read', { path: 'src/a.ts' }, '/repo'), {
    action: 'read', subject: 'src/a.ts',
  })
  assert.deepEqual(summarizeToolCall('edit', { path: 'src/a.ts' }, '/repo'), {
    action: 'edit', subject: 'src/a.ts',
  })
  assert.deepEqual(summarizeToolCall('write', { path: 'src/a.ts' }, '/repo'), {
    action: 'write', subject: 'src/a.ts',
  })
  assert.deepEqual(summarizeToolCall('bash', { command: 'node --test' }, '/repo'), {
    action: 'bash', subject: 'node --test',
  })
  assert.deepEqual(summarizeToolCall('grep', { pattern: 'needle', path: 'src' }, '/repo'), {
    action: 'grep', subject: '/needle/ in src',
  })
  assert.deepEqual(summarizeToolCall('find', { pattern: '**/*.ts', path: 'src' }, '/repo'), {
    action: 'find', subject: '**/*.ts in src',
  })
  assert.deepEqual(summarizeToolCall('ls', { path: 'src' }, '/repo'), {
    action: 'ls', subject: 'src',
  })
})

test('collapsed previews apply tool-specific visual-line limits', () => {
  const lines = Array.from({ length: 9 }, (_, index) => `line ${index + 1}`)
  assert.deepEqual(selectPreviewLines('read', lines, false).lines, lines.slice(0, 5))
  assert.deepEqual(selectPreviewLines('grep', lines, false).lines, lines.slice(0, 5))
  assert.deepEqual(selectPreviewLines('find', lines, false).lines, lines.slice(0, 5))
  assert.deepEqual(selectPreviewLines('ls', lines, false).lines, lines.slice(0, 5))
  assert.deepEqual(selectPreviewLines('bash', lines, false).lines, lines.slice(-5))
  assert.deepEqual(selectPreviewLines('read', lines, true).lines, lines)
})

test('collapsed edit output contains at most six changed lines', () => {
  const lines = [' context', '- one', '+ two', '- three', '+ four', '- five', '+ six', '- seven']
  const selected = selectPreviewLines('edit', lines, false)
  const changed = selected.lines.filter((line) => /^[+-]/.test(line))
  assert.equal(changed.length, 6)
  assert.equal(selected.omitted, 1)
})

test('ANSI fitting closes all state and respects visible width', () => {
  const fitted = fitAnsi('\x1b[31m\x1b[48;2;1;2;3m\x1b[1m\x1b[7mabcdefgh', 5)
  assert.ok(visibleWidth(fitted) <= 5)
  assert.match(fitted, /\x1b\[22m\x1b\[27m\x1b\[39m\x1b\[49m$/)
})

test('background stripping keeps foreground diff color', () => {
  assert.equal(
    stripBackgroundAnsi('\x1b[48;2;1;2;3m\x1b[31m-added\x1b[49m'),
    '\x1b[31m-added',
  )
})

test('ledger and edge components never exceed supplied width', () => {
  const ledger = new ToolLedgerComponent({
    name: 'read', args: { path: 'a/very/long/path/to/file.ts' }, cwd: '/repo',
    isPartial: false, isError: false, theme,
  })
  const edge = new EdgeOutputComponent({
    name: 'read', inner: new Text(Array.from({ length: 9 }, (_, i) => `output ${i}`).join('\n'), 0, 0),
    expanded: false, theme, expansionHint: 'ctrl+o expands output',
  })
  for (const width of [12, 40, 80, 120, 160]) {
    for (const line of [...ledger.render(width), ...edge.render(width)]) {
      assert.ok(visibleWidth(line) <= width, `${visibleWidth(line)} > ${width}`)
    }
  }
})
```

- [x] **Step 3: Run the tests and verify the missing module failure**

Run:

```bash
./tests/run-imeto-center-column-tests.sh
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `extensions/imeto-tool-ui.ts`.

- [x] **Step 4: Implement the pure state, summary, preview, and ANSI policy**

Create `extensions/imeto-tool-ui.ts`. Use these public types and constants.

```ts
import type { Theme } from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'
import { hexToFg, IMETO_COLORS, readThemeHex } from './imeto-style.ts'

export const BUILTIN_TOOL_NAMES = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'] as const
export type BuiltInToolName = (typeof BUILTIN_TOOL_NAMES)[number]
export type ToolVisualState = 'pending' | 'success' | 'error'
export type ToolSummary = { action: BuiltInToolName; subject: string }
export type PreviewSelection = { lines: string[]; omitted: number }

export const TOKEN_RATE_STATUS_KEY = 'imeto-token-rate'
export const TOKEN_CACHE_STATUS_KEY = 'imeto-cache-state'

const ANSI_CLOSE = '\x1b[22m\x1b[27m\x1b[39m\x1b[49m'
const ANSI_BG_RE = /\x1b\[(?:4[0-9]|10[0-7]|48;[^m]*)m/g
const ANSI_BG_RESET_RE = /\x1b\[49m/g
const CHANGED_LINE_RE = /^[+-](?![+-])/

export function toolVisualState(isPartial: boolean, isError: boolean): ToolVisualState {
  if (isPartial) return 'pending'
  return isError ? 'error' : 'success'
}

export function toolStateSymbol(state: ToolVisualState): '◌' | '✓' | '×' {
  if (state === 'pending') return '◌'
  return state === 'success' ? '✓' : '×'
}

function stringArg(args: Record<string, unknown>, key: string, fallback: string): string {
  const value = args[key]
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

export function summarizeToolCall(
  name: BuiltInToolName,
  args: Record<string, unknown>,
  _cwd: string,
): ToolSummary {
  if (name === 'bash') return { action: name, subject: stringArg(args, 'command', '…') }
  if (name === 'grep') {
    const pattern = stringArg(args, 'pattern', '')
    return { action: name, subject: `/${pattern}/ in ${stringArg(args, 'path', '.')}` }
  }
  if (name === 'find') {
    return { action: name, subject: `${stringArg(args, 'pattern', '…')} in ${stringArg(args, 'path', '.')}` }
  }
  if (name === 'ls') return { action: name, subject: stringArg(args, 'path', '.') }
  return { action: name, subject: stringArg(args, 'path', '…') }
}

export function fitAnsi(text: string, width: number): string {
  if (width <= 0) return ''
  return `${truncateToWidth(text, width, '')}${ANSI_CLOSE}`
}

export function stripBackgroundAnsi(text: string): string {
  return text.replace(ANSI_BG_RE, '').replace(ANSI_BG_RESET_RE, '')
}

export function selectPreviewLines(
  name: BuiltInToolName,
  lines: string[],
  expanded: boolean,
): PreviewSelection {
  if (expanded) return { lines: [...lines], omitted: 0 }
  if (name === 'bash') return { lines: lines.slice(-5), omitted: Math.max(0, lines.length - 5) }
  if (name === 'edit') {
    const selected: string[] = []
    let changed = 0
    for (const line of lines) {
      if (CHANGED_LINE_RE.test(line)) {
        if (changed === 6) break
        changed += 1
      }
      selected.push(line)
    }
    return { lines: selected, omitted: lines.length - selected.length }
  }
  const limit = name === 'write' ? 6 : 5
  return { lines: lines.slice(0, limit), omitted: Math.max(0, lines.length - limit) }
}
```

The functions must not mutate `args` or `lines`.

- [x] **Step 5: Implement the ledger and edge components**

Add these component input contracts to `extensions/imeto-tool-ui.ts`.

```ts
type ToolTheme = Pick<Theme, 'sourcePath' | 'fg' | 'bold'>

export type ToolLedgerInput = {
  name: BuiltInToolName
  args: Record<string, unknown>
  cwd: string
  isPartial: boolean
  isError: boolean
  theme: ToolTheme
  semanticBody?: Component
}

export type EdgeOutputInput = {
  name: BuiltInToolName
  inner?: Component
  expanded: boolean
  theme: ToolTheme
  expansionHint: string
  stripInnerBackground?: boolean
  dropInnerHeader?: boolean
}
```

Implement state color resolution with exact theme variables and fallbacks.

```ts
function stateHex(state: ToolVisualState, sourcePath: string | undefined): string {
  const variable = state === 'pending' ? 'terracotta' : state === 'success' ? 'mossGreen' : 'oxblood'
  const fallback = state === 'pending'
    ? IMETO_COLORS.terracotta
    : state === 'success'
      ? IMETO_COLORS.mossGreen
      : IMETO_COLORS.oxblood
  return readThemeHex(sourcePath, [variable]) ?? fallback
}

function edgeHex(sourcePath: string | undefined): string {
  return readThemeHex(sourcePath, ['mauveTaupe']) ?? IMETO_COLORS.mauveTaupe
}

function isBlankAnsi(line: string): boolean {
  return visibleWidth(line.trim()) === 0
}

function semanticBodyLines(lines: string[], dropHeader: boolean): string[] {
  const body = lines.map(stripBackgroundAnsi)
  while (body.length > 0 && isBlankAnsi(body[0]!)) body.shift()
  while (body.length > 0 && isBlankAnsi(body.at(-1)!)) body.pop()
  if (dropHeader && body.length > 0) body.shift()
  while (body.length > 0 && isBlankAnsi(body[0]!)) body.shift()
  return body.map((line) => line.startsWith(' ') ? line.slice(1) : line)
}
```

`ToolLedgerComponent.render(width)` must perform these operations in order.

```ts
const state = toolVisualState(this.input.isPartial, this.input.isError)
const summary = summarizeToolCall(this.input.name, this.input.args, this.input.cwd)
const symbol = `${hexToFg(stateHex(state, this.input.theme.sourcePath))}${toolStateSymbol(state)}\x1b[39m`
const action = this.input.theme.fg('toolTitle', this.input.theme.bold(summary.action))
const subject = this.input.theme.fg(this.input.name === 'bash' ? 'muted' : 'accent', summary.subject)
const header = fitAnsi(`${symbol} ${action} ${subject}`, width)
```

Return only `header` when `semanticBody` is absent. When `semanticBody` exists, render it at `Math.max(1, width - 2)`, remove the original renderer's first content line with `semanticBodyLines(lines, true)`, pass the remaining lines through `selectPreviewLines()`, and prefix each row with a Mauve Taupe `│ `. Append the expansion hint only when `omitted > 0`.

`EdgeOutputComponent.render(width)` must render `inner` at `Math.max(1, width - 2)`. It must normalize blank edges with `semanticBodyLines()`. It must apply `selectPreviewLines()`. It must prefix each row with a Mauve Taupe `│ `. It must append `expansionHint` when rows were omitted. It must call `fitAnsi()` on every returned row.

Both classes must clear cached width and lines in `invalidate()`. Both classes must call `inner.invalidate()` when an inner component exists.

- [x] **Step 6: Run the focused test file**

Run:

```bash
./tests/run-imeto-center-column-tests.sh 2>&1 | tee /tmp/imeto-center-column-task-1.txt
```

Expected: every existing test passes.

- [x] **Step 7: Commit the rendering core**

```bash
git add \
  docs/superpowers/plans/2026-09-04-imeto-center-column.md \
  extensions/imeto-tool-ui.ts \
  tests/imeto-tool-ui.test.ts \
  tests/run-imeto-center-column-tests.sh
git commit -m "feat: add imeto tool rendering core"
```

---

### Task 2: Transcript message hierarchy

**Files:**
- Create: `extensions/imeto-transcript.ts`
- Create: `tests/imeto-transcript.test.ts`

**Interfaces:**
- Consumes: `ExtensionAPI` from `@earendil-works/pi-coding-agent`.
- Produces: `transformTranscriptMarkdown(markdown: string, context: TranscriptTransformContext): string`.
- Registers: one synchronous display-only Markdown transformer.
- Preserves: assistant Markdown without changes.
- Preserves: persisted messages and model context because Pi applies the transformer only during rendering.

- [ ] **Step 1: Write failing transcript-transform tests**

Create `tests/imeto-transcript.test.ts` with this initial content.

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { transformTranscriptMarkdown } from '../extensions/imeto-transcript.ts'

test('user Markdown receives the YOU label and quoted structural edge', () => {
  assert.equal(
    transformTranscriptMarkdown('Inspect `theme.json`.\n\nKeep the diff small.', {
      messageType: 'user', isStreaming: false, availableWidth: 80,
    }),
    '> **YOU**\n>\n> Inspect `theme.json`.\n>\n> Keep the diff small.',
  )
})

test('thinking receives only the quiet quoted edge', () => {
  assert.equal(
    transformTranscriptMarkdown('Checking the contract.\nThen running tests.', {
      messageType: 'assistant-thinking', isStreaming: true, availableWidth: 80,
    }),
    '> Checking the contract.\n> Then running tests.',
  )
})

test('assistant Markdown remains unchanged during streaming and final render', () => {
  const markdown = '## Result\n\nBody with `code`.'
  assert.equal(transformTranscriptMarkdown(markdown, {
    messageType: 'assistant', isStreaming: true, availableWidth: 80,
  }), markdown)
  assert.equal(transformTranscriptMarkdown(markdown, {
    messageType: 'assistant', isStreaming: false, availableWidth: 80,
  }), markdown)
})

test('blank and long user content remain valid quoted Markdown', () => {
  const long = `first\n\n${'long '.repeat(80).trim()}`
  const transformed = transformTranscriptMarkdown(long, {
    messageType: 'user', isStreaming: false, availableWidth: 40,
  })
  assert.ok(transformed.startsWith('> **YOU**\n>\n> first\n>\n> long'))
  assert.equal(transformTranscriptMarkdown('', {
    messageType: 'user', isStreaming: false, availableWidth: 40,
  }), '> **YOU**\n>\n> ')
})
```

- [ ] **Step 2: Run the tests and verify the missing export failure**

Run:

```bash
./tests/run-imeto-center-column-tests.sh
```

Expected: FAIL because `extensions/imeto-transcript.ts` does not exist.

- [ ] **Step 3: Implement and register the Markdown transformer**

Create `extensions/imeto-transcript.ts` with this first implementation.

```ts
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

export type TranscriptTransformContext = {
  messageType: 'user' | 'assistant' | 'assistant-thinking'
  isStreaming: boolean
  availableWidth: number
}

function quoteMarkdown(markdown: string): string {
  return markdown.split('\n').map((line) => `> ${line}`).join('\n')
}

export function transformTranscriptMarkdown(
  markdown: string,
  context: TranscriptTransformContext,
): string {
  if (context.messageType === 'assistant') return markdown
  const quoted = quoteMarkdown(markdown)
  return context.messageType === 'user' ? `> **YOU**\n>\n${quoted}` : quoted
}

export default function (pi: ExtensionAPI) {
  pi.registerMarkdownTransformer(transformTranscriptMarkdown)
}
```

Do not style assistant prose directly. The active Im­eto theme already maps `mdHeading` to Oxblood, `text` to Deep Navy, `mdQuote` to quiet text, and `mdQuoteBorder` to Mauve Taupe.

- [ ] **Step 4: Run transcript and existing theme tests**

Run:

```bash
./tests/run-imeto-center-column-tests.sh
```

Expected: every current test passes.

- [ ] **Step 5: Smoke-load the transcript extension in non-TUI mode**

Run:

```bash
pi --no-extensions -e ./extensions/imeto-transcript.ts -p "reply with ok" >/tmp/imeto-transcript-smoke.txt
```

Expected: Pi exits with status `0`. The output contains a model response. No extension load error appears.

- [ ] **Step 6: Commit the transcript hierarchy**

```bash
git add extensions/imeto-transcript.ts tests/imeto-transcript.test.ts
git commit -m "feat: add imeto transcript hierarchy"
```

---

### Task 3: Contract-preserving built-in tool decoration

**Files:**
- Modify: `extensions/imeto-transcript.ts`
- Modify: `tests/imeto-transcript.test.ts`

**Interfaces:**
- Consumes: `SettingsManager.create(ctx.cwd, getAgentDir(), { projectTrusted: ctx.isProjectTrusted() })`.
- Consumes: `createReadToolDefinition`, `createBashToolDefinition`, `createEditToolDefinition`, `createWriteToolDefinition`, `createGrepToolDefinition`, `createFindToolDefinition`, and `createLsToolDefinition`.
- Consumes: `ToolLedgerComponent`, `EdgeOutputComponent`, and `BUILTIN_TOOL_NAMES` from `extensions/imeto-tool-ui.ts`.
- Produces: `createRuntimeToolDefinitions(cwd: string, settings: RuntimeToolSettings): AnyToolDefinition[]`.
- Produces: `decorateBuiltInTool(definition: AnyToolDefinition): AnyToolDefinition`.
- Preserves: `name`, `label`, `description`, `parameters`, `promptSnippet`, `promptGuidelines`, `constrainedSampling`, `prepareArguments`, `executionMode`, `execute`, result content, and result details.
- Changes: only `renderShell`, `renderCall`, and `renderResult`.

- [ ] **Step 1: Add failing factory-option and definition-contract tests**

Append these imports and tests to `tests/imeto-transcript.test.ts`.

```ts
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import {
  createRuntimeToolDefinitions,
  decorateBuiltInTool,
} from '../extensions/imeto-transcript.ts'

const factories = [
  createReadToolDefinition,
  createBashToolDefinition,
  createEditToolDefinition,
  createWriteToolDefinition,
  createGrepToolDefinition,
  createFindToolDefinition,
  createLsToolDefinition,
] as const

test('decorators preserve every non-rendering contract field', () => {
  for (const factory of factories) {
    const original = factory('/repo') as any
    const decorated = decorateBuiltInTool(original) as any
    for (const key of [
      'name', 'label', 'description', 'parameters', 'promptSnippet',
      'promptGuidelines', 'constrainedSampling', 'prepareArguments',
      'executionMode', 'execute',
    ]) {
      assert.equal(decorated[key], original[key], `${original.name}.${key}`)
    }
    assert.equal(decorated.renderShell, 'self')
    assert.notEqual(decorated.renderCall, original.renderCall)
    assert.notEqual(decorated.renderResult, original.renderResult)
  }
})

test('runtime factories keep active read and bash settings', () => {
  const settings = SettingsManager.inMemory({
    images: { autoResize: false },
    shellCommandPrefix: 'source ~/.profile',
    shellPath: '/bin/zsh',
  })
  const definitions = createRuntimeToolDefinitions('/repo', settings as any)
  assert.deepEqual(definitions.map((definition) => definition.name), [
    'read', 'bash', 'edit', 'write', 'grep', 'find', 'ls',
  ])
  assert.match(definitions[0]!.description, /Supports text files and images/)
  assert.match(definitions[1]!.description, /Returns stdout and stderr/)
})

test('the decorator retains the original execute function and result shape', async () => {
  const original = createReadToolDefinition('/repo', {
    operations: {
      access: async () => undefined,
      readFile: async () => Buffer.from('one\ntwo'),
      detectImageMimeType: async () => undefined,
    },
  }) as any
  const decorated = decorateBuiltInTool(original) as any
  const context = { model: undefined }
  const result = await decorated.execute('call-1', { path: 'file.txt' }, undefined, undefined, context)
  assert.equal(decorated.execute, original.execute)
  assert.deepEqual(result, { content: [{ type: 'text', text: 'one\ntwo' }], details: undefined })
})

test('registration covers only Pi built-ins', () => {
  const registered: string[] = []
  const fakePi = { registerTool: (definition: any) => registered.push(definition.name) }
  const definitions = createRuntimeToolDefinitions('/repo', SettingsManager.inMemory() as any)
  for (const definition of definitions) fakePi.registerTool(decorateBuiltInTool(definition))
  assert.deepEqual(registered, ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'])
  assert.ok(!registered.includes('ask_user_question'))
  assert.ok(!registered.some((name) => name.startsWith('mcp')))
})
```

- [ ] **Step 2: Run the tests and verify the missing exports**

Run:

```bash
./tests/run-imeto-center-column-tests.sh
```

Expected: FAIL because `createRuntimeToolDefinitions` and `decorateBuiltInTool` are not exported.

- [ ] **Step 3: Add runtime settings and built-in factories**

Extend the imports in `extensions/imeto-transcript.ts`.

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
  keyHint,
  SettingsManager,
  type ExtensionAPI,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import {
  EdgeOutputComponent,
  ToolLedgerComponent,
  type BuiltInToolName,
} from './imeto-tool-ui.ts'
```

Use these internal types and factory function.

```ts
type AnyToolDefinition = ToolDefinition<any, any, any>
type AnyRenderContext = Parameters<NonNullable<AnyToolDefinition['renderCall']>>[2]
type RuntimeToolSettings = Pick<
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
```

The factory must not call a settings setter or `flush()`.

- [ ] **Step 4: Implement renderer delegation without changing execution**

Use renderer state to retain Pi's original components across streaming updates.

```ts
type DecoratorState = {
  originalCall?: import('@earendil-works/pi-tui').Component
  originalResult?: import('@earendil-works/pi-tui').Component
}

function originalContext(
  context: AnyRenderContext,
  lastComponent: import('@earendil-works/pi-tui').Component | undefined,
): AnyRenderContext {
  return { ...context, lastComponent }
}

function hasSemanticCallBody(name: string): boolean {
  return name === 'edit' || name === 'write'
}
```

Implement `decorateBuiltInTool()` by spreading the original definition first. This retains every contract field and function reference.

```ts
export function decorateBuiltInTool(definition: AnyToolDefinition): AnyToolDefinition {
  const name = definition.name as BuiltInToolName
  const originalCall = definition.renderCall
  const originalResult = definition.renderResult

  return {
    ...definition,
    renderShell: 'self',
    renderCall(args, theme, context) {
      const state = context.state as DecoratorState
      let semanticBody
      if (hasSemanticCallBody(name) && originalCall) {
        semanticBody = originalCall(args, theme, originalContext(context, state.originalCall))
        state.originalCall = semanticBody
      }
      return new ToolLedgerComponent({
        name,
        args: args as Record<string, unknown>,
        cwd: context.cwd,
        isPartial: context.isPartial,
        isError: context.isError,
        theme,
        semanticBody,
      })
    },
    renderResult(result, options, theme, context) {
      const state = context.state as DecoratorState
      let inner
      if (originalResult) {
        inner = originalResult(result, options, theme, originalContext(context, state.originalResult))
        state.originalResult = inner
      }
      return new EdgeOutputComponent({
        name,
        inner,
        expanded: options.expanded,
        theme,
        expansionHint: keyHint('app.tools.expand', 'to expand'),
        stripInnerBackground: name === 'edit',
      })
    },
  }
}
```

When the built-in edit result renderer updates its call-side preview through shared state, `state.originalCall` must remain the same component instance. Do not replace Pi's original renderer state object with a new object between `renderCall` and `renderResult`.

- [ ] **Step 5: Register the decorated definitions during TUI session start**

Replace the default export body with one that retains the Markdown transformer and adds TUI-only registration.

```ts
export default function (pi: ExtensionAPI) {
  pi.registerMarkdownTransformer(transformTranscriptMarkdown)

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

Do not call `pi.setActiveTools()`. Registration replaces only same-named built-ins and preserves the current active tool set.

- [ ] **Step 6: Add renderer contract tests for semantic delegation**

Append tests that instantiate the decorated `write` and `edit` definitions with a fake theme and render context. Verify these facts:

```ts
assert.match(writeLines.join('\n'), /✓ write src\/file\.ts/)
assert.match(writeLines.join('\n'), /const answer = 42/)
assert.match(editLines.join('\n'), /✓ edit src\/file\.ts/)
assert.ok(editLines.filter((line) => /│ [+-](?![+-])/.test(line.replace(/\x1b\[[0-9;]*m/g, ''))).length <= 6)
```

Use a temporary file for the edit preview. Run the original `renderCall`, wait for the asynchronous preview to settle through the supplied `invalidate()` callback, then render again. Verify that the custom ledger does not change `execute`, `parameters`, or `prepareArguments`.

- [ ] **Step 7: Run all automated tests and the extension smoke check**

Run:

```bash
./tests/run-imeto-center-column-tests.sh
pi --no-extensions -e ./extensions/imeto-transcript.ts -p "reply with ok" >/tmp/imeto-transcript-contract-smoke.txt
git diff --check
```

Expected: all tests pass. Pi exits with status `0`. `git diff --check` prints nothing.

- [ ] **Step 8: Commit built-in tool decoration**

```bash
git add extensions/imeto-transcript.ts tests/imeto-transcript.test.ts
git commit -m "feat: decorate pi built-in tool rendering"
```

---

### Task 4: Responsive powerline dock and status publication

**Files:**
- Modify: `extensions/imeto-tool-ui.ts`
- Modify: `extensions/omp-chatbox.ts:1-235`
- Modify: `extensions/token-speed.ts:1-320`
- Modify: `tests/imeto-tool-ui.test.ts`
- Modify: `tests/imeto-terminal-ui.test.ts`

**Interfaces:**
- Produces: `DockFieldId`, `DockField`, `selectDockFields(fields: DockField[], width: number): DockField[]`, and `renderDock(fields: DockField[], width: number, sourcePath?: string): string`.
- Produces: `paintEditorBody(line: string, width: number, sourcePath?: string): string`.
- Produces: `renderQuietFooter(hint: string, rate: string | undefined, width: number): string`.
- Produces: `TOKEN_RATE_STATUS_KEY = 'imeto-token-rate'` and `TOKEN_CACHE_STATUS_KEY = 'imeto-cache-state'` from `imeto-tool-ui.ts`.
- Produces: plain status values from `token-speed.ts` through `ctx.ui.setStatus()`.
- Consumes: footer statuses through `Symbol.for('omp.footer.statuses.v1')`.
- Preserves: `StatusBridge.version: 1`, cache shard aggregation, streaming-rate calculation, branch refresh, context thresholds, editor input handling, and Pi keybindings.

- [ ] **Step 1: Add failing responsive dock tests**

Append these imports and tests to `tests/imeto-tool-ui.test.ts`.

```ts
import {
  paintEditorBody,
  renderDock,
  renderQuietFooter,
  selectDockFields,
  type DockField,
} from '../extensions/imeto-tool-ui.ts'

const dockFields: DockField[] = [
  { id: 'identity', text: 'π', role: 'identity', required: true },
  { id: 'model', text: '✺ claude-opus-5', role: 'model', required: true },
  { id: 'reasoning', text: '● high', role: 'reasoning', required: true },
  { id: 'path', text: '⌘ ~/a/very/long/project/path:imeto-terminal-ui', role: 'path', required: false },
  { id: 'context', text: '31%/200k', role: 'context', required: false },
  { id: 'cost', text: '$0.420', role: 'cost', required: false },
  { id: 'cache', text: 'cache 96.1% · day 94.2%', role: 'cache', required: false },
  { id: 'session', text: 'imeto visual acceptance', role: 'session', required: false },
]

test('dock fields degrade in semantic priority order', () => {
  assert.deepEqual(selectDockFields(dockFields, 160).map((field) => field.id), [
    'identity', 'model', 'reasoning', 'path', 'context', 'cost', 'cache', 'session',
  ])
  const standard = selectDockFields(dockFields, 120).map((field) => field.id)
  assert.ok(standard.includes('path'))
  assert.ok(standard.includes('context'))
  assert.ok(!standard.includes('session'))
  assert.deepEqual(selectDockFields(dockFields, 80).map((field) => field.id), [
    'identity', 'model', 'reasoning',
  ])
})

test('dock, editor body, and quiet footer respect every supplied width', () => {
  for (const width of [20, 40, 80, 120, 160]) {
    const rows = [
      renderDock(dockFields, width),
      paintEditorBody('editor content that is intentionally long', width),
      renderQuietFooter('esc interrupts · ctrl+o expands · / commands', '12 tok/s', width),
    ]
    for (const row of rows) assert.ok(visibleWidth(row) <= width)
    assert.match(rows[0]!, /\x1b\[22m\x1b\[27m\x1b\[39m\x1b\[49m$/)
  }
})

test('editor body restores Cloud Petal after cursor resets', () => {
  const row = paintEditorBody('before\x1b[0mafter', 40)
  assert.match(row, /\x1b\[0m\x1b\[48;2;251;249;247mafter/)
  assert.match(row, /\x1b\[49m$/)
})
```

- [ ] **Step 2: Replace the obsolete token-speed source contract**

In `tests/imeto-terminal-ui.test.ts`, replace `token-speed prefers semantic Im­eto variables` with this test.

```ts
test('token-speed publishes dock statuses without a second powerline widget', () => {
  const source = readFileSync(new URL('../extensions/token-speed.ts', import.meta.url), 'utf8')
  assert.match(source, /TOKEN_CACHE_STATUS_KEY/)
  assert.match(source, /TOKEN_RATE_STATUS_KEY/)
  assert.match(source, /ctx\.ui\.setStatus/)
  assert.doesNotMatch(source, /ctx\.ui\.setWidget/)
})
```

- [ ] **Step 3: Run the tests and verify missing dock exports**

Run:

```bash
./tests/run-imeto-center-column-tests.sh
```

Expected: FAIL because the dock functions are not exported. The token-speed source contract also fails because it still registers a widget.

- [ ] **Step 4: Implement responsive field selection and ANSI-safe dock rows**

Add these types to `extensions/imeto-tool-ui.ts`.

```ts
export type DockFieldId =
  | 'identity' | 'model' | 'reasoning' | 'path'
  | 'context' | 'cost' | 'cache' | 'session'
export type DockRole = DockFieldId
export type DockField = {
  id: DockFieldId
  text: string
  role: DockRole
  required: boolean
}
```

Use this drop order and palette mapping.

```ts
const DOCK_DROP_ORDER: DockFieldId[] = ['session', 'cache', 'cost', 'context', 'path']
const DOCK_ROLE_VAR: Record<DockRole, keyof typeof IMETO_COLORS> = {
  identity: 'oxblood',
  model: 'dustyBlue',
  reasoning: 'mossGreen',
  path: 'terracotta',
  context: 'mauveTaupe',
  cost: 'deepNavy',
  cache: 'mossGreen',
  session: 'sageGrey',
}
```

`selectDockFields()` must include two cells of padding per field. It must include one Powerline separator cell between adjacent fields. It must first remove `session`, `cache`, `cost`, and `context` until the row fits. It must then truncate `path` with an ellipsis to the remaining width. It may remove `path` when fewer than four visible cells remain for it. If the required fields alone exceed the width, it must truncate model text before reasoning text. It must never remove identity, model, or reasoning.

`renderDock()` must call `selectDockFields()`. It must render explicit 24-bit foreground and background sequences using the selected role color and Cloud Petal text. It must use the Powerline separator `\uE0B0` between segments. It must call `fitAnsi()` on the final row.

Implement the editor and footer helpers with these color rules.

```ts
export function paintEditorBody(line: string, width: number, sourcePath?: string): string {
  if (width <= 0) return ''
  const cloud = readThemeHex(sourcePath, ['cloudPetal']) ?? IMETO_COLORS.cloudPetal
  const oxblood = readThemeHex(sourcePath, ['oxblood']) ?? IMETO_COLORS.oxblood
  const bg = hexToBg(cloud)
  const restored = line
    .replaceAll('\x1b[0m', `\x1b[0m${bg}`)
    .replaceAll('\x1b[49m', `\x1b[49m${bg}`)
  const prefix = `${hexToFg(oxblood)}│\x1b[39m `
  const content = truncateToWidth(restored, Math.max(0, width - 2), '')
  const padding = ' '.repeat(Math.max(0, width - 2 - visibleWidth(content)))
  return `${prefix}${bg}${content}${padding}\x1b[22m\x1b[27m\x1b[39m\x1b[49m`
}

export function renderQuietFooter(
  hint: string,
  rate: string | undefined,
  width: number,
): string {
  const right = rate ?? ''
  const gap = Math.max(1, width - visibleWidth(hint) - visibleWidth(right))
  return fitAnsi(`${hint}${' '.repeat(gap)}${right}`, width)
}
```

- [ ] **Step 5: Publish cache and token rate through footer statuses**

Modify `extensions/token-speed.ts` to import `TOKEN_CACHE_STATUS_KEY` and `TOKEN_RATE_STATUS_KEY` from `imeto-tool-ui.ts`.

Retain `readStats()`, `usableCounters()`, `hitPercent()`, `currentRate()`, and the stream timers. Replace `buildSegments()`, `renderRow()`, the below-editor widget, and `themeColor()` with plain status formatting.

```ts
export function cacheStatusLabel(
  session: CacheCounters | undefined,
  total: CacheCounters | undefined,
  warned: boolean,
): string | undefined {
  if (!session && !total) return undefined
  const parts: string[] = []
  if (session) parts.push(`cache ${hitPercent(session)}`)
  if (total) parts.push(`day ${hitPercent(total)}`)
  return `${parts.join(' · ')}${warned ? ' ⚠' : ''}`
}

export function tokenRateStatusLabel(isStreaming: boolean, rate: number): string {
  return `${isStreaming ? formatRate(rate) : '0'} tok/s`
}
```

Add one function that reads the active model's counters and publishes both fields.

```ts
function publishStatuses(ctx: ExtensionContext): void {
  const model = ctx.model
  const modelKey = model ? `${model.provider}/${model.id}` : undefined
  let cache: string | undefined
  if (modelKey) {
    const today = localDay()
    const stats = readStats(today)
    const session = usableCounters(
      sessionHash ? stats.sessions?.[sessionHash]?.[modelKey] : undefined,
      today,
    )
    const total = usableCounters(stats.totalsByModel?.[modelKey], today)
    cache = cacheStatusLabel(session, total, readCacheStatus()?.includes('⚠') ?? false)
  }
  ctx.ui.setStatus(TOKEN_CACHE_STATUS_KEY, cache)
  ctx.ui.setStatus(TOKEN_RATE_STATUS_KEY, tokenRateStatusLabel(streaming, currentRate()))
}
```

Call `publishStatuses(ctx)` on `session_start`, each render timer tick, each `message_update`, `message_end`, and `agent_end`. Clear both statuses on `session_shutdown`. Do not register a widget.

- [ ] **Step 6: Replace the border ledger with the approved dock**

Modify `extensions/omp-chatbox.ts` to import the dock helpers and status keys.

```ts
import { keyHint, rawKeyHint } from '@earendil-works/pi-coding-agent'
import {
  TOKEN_CACHE_STATUS_KEY,
  TOKEN_RATE_STATUS_KEY,
  paintEditorBody,
  renderDock,
  renderQuietFooter,
  type DockField,
} from './imeto-tool-ui.ts'
```

Keep `EmptyFooter`, `STATUS_BRIDGE`, `StatusBridge.version: 1`, branch refresh, model lookup, context lookup, cost lookup, subscription lookup, and `CustomEditor` inheritance.

Build dock fields in this exact order.

```ts
const statuses = ((globalThis as Record<symbol, unknown>)[STATUS_BRIDGE] as StatusBridge | undefined)
  ?.getStatuses() ?? new Map<string, string>()
const fields: DockField[] = [
  { id: 'identity', text: 'π', role: 'identity', required: true },
  { id: 'model', text: `✺ ${modelLabel(ctx)}`, role: 'model', required: true },
  { id: 'reasoning', text: `● ${thinking}`, role: 'reasoning', required: true },
  { id: 'path', text: `⌘ ${compactPath(ctx.cwd)}${branch ? `:${branch}` : ''}`, role: 'path', required: false },
  { id: 'context', text: formatContext(ctx), role: 'context', required: false },
]
if (cost > 0 || usingSub) fields.push({
  id: 'cost',
  text: usingSub ? `sub${subscriptionLabel(ctx) ? `: ${subscriptionLabel(ctx)}` : ''}` : `$${cost.toFixed(cost >= 10 ? 2 : 3)}`,
  role: 'cost',
  required: false,
})
const cache = statuses.get(TOKEN_CACHE_STATUS_KEY)
if (cache) fields.push({ id: 'cache', text: cache, role: 'cache', required: false })
const sessionName = ctx.sessionManager.getSessionName()
if (sessionName) fields.push({ id: 'session', text: sessionName, role: 'session', required: false })
```

Render `super.render(innerWidth)` once. Remove its top and bottom border rows. Preserve every editor content row and every autocomplete row. Paint editor content rows with `paintEditorBody()`. Leave autocomplete rows on the terminal background with a two-cell inset.

Return rows in this order:

```ts
const hint = ctx.ui.theme.fg('dim', [
  rawKeyHint('esc', 'interrupts'),
  keyHint('app.tools.expand', 'expands'),
  rawKeyHint('/', 'commands'),
].join(' · '))
const rate = statuses.get(TOKEN_RATE_STATUS_KEY)
return [
  renderDock(fields, width, ctx.ui.theme.sourcePath),
  ...editorRows.map((line) => paintEditorBody(line, width, ctx.ui.theme.sourcePath)),
  renderQuietFooter(hint, rate ? ctx.ui.theme.fg('dim', rate) : undefined, width),
  ...autocompleteRows.map((line) => fitAnsi(`  ${line}`, width)),
]
```

Keep `setPaddingX(): void {}` because Pi copies the default editor padding into custom editors after construction. Keep `super.handleInput()` unchanged through `CustomEditor` inheritance.

- [ ] **Step 7: Run dock, status, and smoke verification**

Run:

```bash
./tests/run-imeto-center-column-tests.sh
pi --no-extensions \
  -e ./extensions/omp-chatbox.ts \
  -e ./extensions/token-speed.ts \
  -e ./extensions/imeto-transcript.ts \
  -p "reply with ok" >/tmp/imeto-center-column-smoke.txt
git diff --check
```

Expected: all tests pass. Pi exits with status `0`. The source contract confirms that `token-speed.ts` does not call `ctx.ui.setWidget()`.

- [ ] **Step 8: Verify the bridge and status cleanup mechanically**

Run:

```bash
rg "omp\.footer\.statuses\.v1|version: 1" extensions/omp-chatbox.ts
rg "TOKEN_CACHE_STATUS_KEY|TOKEN_RATE_STATUS_KEY|setStatus" extensions/token-speed.ts
! rg "setWidget|buildSegments|renderRow" extensions/token-speed.ts
```

Expected: the first command prints the unchanged bridge symbol and version. The second command prints publication and cleanup sites. The third command exits with status `0` and prints nothing.

- [ ] **Step 9: Commit the powerline dock**

```bash
git add \
  extensions/imeto-tool-ui.ts \
  extensions/omp-chatbox.ts \
  extensions/token-speed.ts \
  tests/imeto-tool-ui.test.ts \
  tests/imeto-terminal-ui.test.ts
git commit -m "feat: add responsive imeto editor dock"
```

---

### Task 5: Isolated integration and live visual acceptance

**Files:**
- Modify: `README.md:24-37`
- Verify without modifying: `settings.json`
- Verify without modifying: `themes/imeto-bone.json`
- Verify without modifying: `themes/imeto-bone.terminal.yaml`
- Verify against: `docs/superpowers/mockups/imeto-terminal-ui/05-selected-center-column.html`

**Interfaces:**
- Consumes: the Im­eto Pi theme, paired Orca terminal theme, chatbox, token-speed extension, and transcript extension.
- Produces: documented activation and acceptance evidence.
- Preserves: the working tree's existing untracked runtime files and the main checkout's unrelated `settings.json` changes.

- [ ] **Step 1: Update activation documentation**

Replace the final paragraph of `README.md` with this text.

```md
The terminal supplies the Bone background. Pi supplies transcript, Markdown,
tool, diff, syntax, editor, and status colors. `imeto-transcript.ts` decorates
only Pi's seven built-in tools. Custom and MCP tools retain their own renderers.
The center column intentionally omits persistent side regions.
```

- [ ] **Step 2: Run the full automated verification suite**

Run:

```bash
./tests/run-imeto-center-column-tests.sh
python3 -m json.tool themes/imeto-bone.json >/dev/null
pi --no-extensions \
  -e ./extensions/omp-chatbox.ts \
  -e ./extensions/token-speed.ts \
  -e ./extensions/imeto-transcript.ts \
  -p "reply with ok" >/tmp/imeto-center-column-final-smoke.txt
git diff --check
test ! -e node_modules
```

Expected: every test passes. The theme parses. Pi exits with status `0`. No root `node_modules` remains.

- [ ] **Step 3: Create an isolated Pi directory for TUI acceptance**

Run:

```bash
isolated="$(mktemp -d /tmp/imeto-center-column.XXXXXX)"
mkdir -p "$isolated/extensions" "$isolated/themes"
cp extensions/imeto-style.ts "$isolated/extensions/"
cp extensions/imeto-status.ts "$isolated/extensions/"
cp extensions/imeto-tool-ui.ts "$isolated/extensions/"
cp extensions/imeto-transcript.ts "$isolated/extensions/"
cp extensions/omp-chatbox.ts "$isolated/extensions/"
cp extensions/token-speed.ts "$isolated/extensions/"
cp themes/imeto-bone.json "$isolated/themes/"
ln -s "$HOME/.pi/agent/auth.json" "$isolated/auth.json"
printf '{"theme":"imeto-bone"}\n' >"$isolated/settings.json"
printf '%s\n' "$isolated"
```

Expected: the printed directory contains the copied extension files, the theme, isolated settings, and a symlink to the machine's existing `auth.json`. Do not copy repository `auth.json`, `sessions/`, `npm/`, `git/`, `bin/`, or `models-store.json`.

- [ ] **Step 4: Start live acceptance with the paired Orca and Pi themes**

Select `Imeto Bone` for the active Orca terminal. Start Pi with the isolated agent directory while retaining normal authentication through the active machine setup.

```bash
PI_CODING_AGENT_DIR="$isolated" pi --use-theme imeto-bone
```

Expected: Pi loads the center-column extensions in TUI mode. Pi may show the built-in tool override diagnostic. Do not suppress it through `quietStartup` or another unrelated setting.

- [ ] **Step 5: Exercise transcript and thinking states**

In the live session, perform these checks.

```text
1. Send a user message that wraps across at least four terminal rows.
2. Render assistant prose with one Markdown heading, one list, and one code span.
3. Exercise thinking at off, minimal, low, medium, high, xhigh, and max.
4. Resize the terminal near 80, 120, and 160 columns after each representative state.
```

Expected: user messages have the `YOU` label, the raised warm surface, and the structural edge. Assistant prose remains unboxed. Thinking remains visually subordinate. No transformed text enters model context or the saved message body.

- [ ] **Step 6: Exercise every decorated tool state**

Use safe temporary files under `/tmp/imeto-center-column-acceptance`. Exercise all seven tools.

```text
1. read: text, syntax-highlighted code, a long collapsed result, an expanded result, and one image.
2. bash: pending streaming output, final success, final failure, collapsed tail, and expanded output.
3. edit: pending preview, successful unified diff, failed replacement, collapse, and expansion.
4. write: syntax-highlighted content preview, success, and a write error.
5. grep: zero matches, more than five visual lines, collapse, and expansion.
6. find: zero results, more than five visual lines, collapse, and expansion.
7. ls: empty directory, more than five entries, collapse, and expansion.
```

Expected: each tool has one compact ledger header. Pending tools use `◌` in Terracotta. Successful tools use `✓` in Moss Green. Failed tools use `×` in Oxblood. Expanded output has only a Mauve Taupe edge. Syntax, images, streaming updates, and diff colors remain intact.

- [ ] **Step 7: Exercise dock degradation and editor behavior**

Set a long session name. Use a long working path. Generate non-zero cost or subscription state and cache state. Enter multi-line editor text. Open autocomplete.

Expected near 160 columns: identity, model, reasoning, path, context, cost or subscription, cache, and session can appear.

Expected near 120 columns: identity, model, reasoning, path, and context remain. Lower-priority fields may disappear.

Expected near 80 columns: identity, model, and reasoning remain. Required fields never disappear. The path truncates or disappears before a required field.

Expected at every width: the editor accepts text, cursor rendering remains correct, autocomplete remains usable, Pi keybindings work, the quiet footer contains the keybinding hint and token rate, and no ANSI color leaks to later rows.

- [ ] **Step 8: Compare the live result with the selected mockup**

Open `docs/superpowers/mockups/imeto-terminal-ui/05-selected-center-column.html` and compare the live TUI with its representative transcript, tool, diff, and dock states.

Expected accepted differences: the TUI has no persistent left rail, no persistent right context pane, and no browser styling. Custom and MCP tools keep their own renderers. Pi may display the built-in override diagnostic.

Any other visible difference requires a focused failing test before correction.

- [ ] **Step 9: Remove isolated runtime files**

Exit the isolated Pi session, then run:

```bash
rm -rf "$isolated" /tmp/imeto-center-column-acceptance
test ! -e "$isolated"
```

Expected: both temporary directories are absent.

- [ ] **Step 10: Commit the acceptance documentation**

```bash
git add README.md
git commit -m "docs: document imeto center column"
```

- [ ] **Step 11: Run final branch verification**

Run:

```bash
./tests/run-imeto-center-column-tests.sh
python3 -m json.tool themes/imeto-bone.json >/dev/null
git diff --check
git status --short
git log --oneline --decorate origin/main..HEAD
```

Expected: every automated check passes. No temporary `node_modules` or isolated Pi runtime file exists. `settings.json` has no new diff from this center-column pass. The known untracked worktree runtime paths remain untracked and unstaged.

- [ ] **Step 12: Request final review against the specification**

The reviewer must read both files.

```text
docs/superpowers/specs/2026-09-04-imeto-center-column-design.md
docs/superpowers/plans/2026-09-04-imeto-center-column.md
```

The reviewer must inspect contract preservation, custom and MCP tool isolation, image and diff behavior, width safety, ANSI reset safety, responsive field order, isolated-runtime cleanup, and the live comparison with `05-selected-center-column.html`.

Expected: the reviewer reports no blocking specification gap. Any blocking gap returns to the relevant task with a failing test.

- [ ] **Step 13: Push only after every gate passes**

Run:

```bash
git status --short
git log --oneline --decorate origin/main..HEAD
git push
```

Expected: all implementation commits reach the feature branch remote only after automated verification, live acceptance, and final review pass. The branch remains unmerged.
