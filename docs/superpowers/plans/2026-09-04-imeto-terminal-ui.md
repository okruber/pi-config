# Im­eto Terminal UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Bone Editorial visual profile as a terminal-native Pi theme and restyle the existing OMP editor status surfaces with Im­eto colors.

**Architecture:** A shared dependency-free module owns the sampled Im­eto palette and theme-file lookup. Pi consumes the palette through a complete theme JSON, while Orca consumes a paired Warp-format terminal YAML. Existing chatbox and token-speed extensions keep their behavior and replace only their color policy.

**Tech Stack:** Pi theme JSON, Warp-compatible terminal YAML, TypeScript extensions, Node.js `node:test`, 24-bit ANSI color.

**Spec:** `docs/superpowers/specs/2026-09-04-imeto-terminal-ui-design.md`

## Global Constraints

- The result remains a terminal-native TUI.
- The first stage stays inside `okruber/pi-config`.
- The first stage does not add a persistent left rail or right context pane.
- The first stage does not create a Pi core fork.
- The implementation uses the sampled Im­eto colors exactly.
- Every rendered line must respect the width supplied by Pi.
- `Symbol.for('omp.footer.statuses.v1')` and its version remain unchanged.
- The custom editor continues to extend `CustomEditor` and delegate input handling to Pi.
- `settings.json` has pre-existing user changes and must not be staged wholesale.
- Only the approved `theme` line may be committed from `settings.json`.
- Git commands must add named files rather than using `git add -A`.
- The optional custom header is omitted because the current first-stage surfaces already provide the brand identity without consuming transcript height.

---

### Task 1: Shared palette and test harness

**Files:**
- Create: `extensions/imeto-style.ts`
- Create: `tests/imeto-terminal-ui.test.ts`

**Interfaces:**
- Produces: `IMETO_COLORS`, a readonly map of palette names to six-digit hex strings.
- Produces: `ImetoColorName`, the key union for `IMETO_COLORS`.
- Produces: `hexToFg(hex: string): string`.
- Produces: `hexToBg(hex: string): string`.
- Produces: `readThemeHex(sourcePath: string | undefined, names: readonly string[]): string | undefined`.
- Consumes: Only Node.js built-ins.

- [ ] **Step 1: Write the failing palette tests**

Create `tests/imeto-terminal-ui.test.ts` with the imports and tests below.

```ts
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

test('sampled Im­eto palette remains exact', () => {
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
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run:

```bash
cd ~/Documents/Personal/pi-config
node --test tests/imeto-terminal-ui.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `extensions/imeto-style.ts`.

- [ ] **Step 3: Implement the dependency-free palette module**

Create `extensions/imeto-style.ts` with the following implementation.

```ts
import { readFileSync } from 'node:fs'

export const IMETO_COLORS = {
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

export type ImetoColorName = keyof typeof IMETO_COLORS

function rgb(hex: string): [number, number, number] {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`Invalid RGB hex: ${hex}`)
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ]
}

export function hexToFg(hex: string): string {
  const [r, g, b] = rgb(hex)
  return `\x1b[38;2;${r};${g};${b}m`
}

export function hexToBg(hex: string): string {
  const [r, g, b] = rgb(hex)
  return `\x1b[48;2;${r};${g};${b}m`
}

export function readThemeHex(
  sourcePath: string | undefined,
  names: readonly string[],
): string | undefined {
  if (!sourcePath) return undefined
  try {
    const parsed = JSON.parse(readFileSync(sourcePath, 'utf8')) as {
      vars?: Record<string, unknown>
    }
    for (const name of names) {
      const value = parsed.vars?.[name]
      if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) return value
    }
  } catch {
    return undefined
  }
  return undefined
}
```

- [ ] **Step 4: Run the palette tests**

Run:

```bash
cd ~/Documents/Personal/pi-config
node --test tests/imeto-terminal-ui.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit the shared palette**

```bash
cd ~/Documents/Personal/pi-config
git add extensions/imeto-style.ts tests/imeto-terminal-ui.test.ts
git commit -m "test: define imeto terminal palette"
```

---

### Task 2: Pi and Orca theme pair

**Files:**
- Create: `themes/imeto-bone.json`
- Create: `themes/imeto-bone.terminal.yaml`
- Modify: `tests/imeto-terminal-ui.test.ts`

**Interfaces:**
- Consumes: `IMETO_COLORS` from `extensions/imeto-style.ts` as the canonical sampled palette.
- Produces: Pi theme named `imeto-bone`.
- Produces: Orca terminal theme named `Imeto Bone`.

- [ ] **Step 1: Add failing theme-contract tests**

Append these constants and tests to `tests/imeto-terminal-ui.test.ts`. Add `readFileSync` to the existing `node:fs` import.

```ts
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
```

- [ ] **Step 2: Run the tests and verify both theme files are missing**

Run:

```bash
cd ~/Documents/Personal/pi-config
node --test tests/imeto-terminal-ui.test.ts
```

Expected: FAIL with `ENOENT` for `themes/imeto-bone.json`.

- [ ] **Step 3: Create the complete Pi theme**

Create `themes/imeto-bone.json`. Use this variable block and token mapping.

```json
{
  "$schema": "https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/src/modes/interactive/theme/theme-schema.json",
  "name": "imeto-bone",
  "vars": {
    "oxblood": "#6a3026",
    "bone": "#e9e3df",
    "darkSpruce": "#1c1e1b",
    "deepNavy": "#04162a",
    "mossGreen": "#3e4739",
    "mauveTaupe": "#907062",
    "cloudPetal": "#fbf9f7",
    "sageGrey": "#89897c",
    "dustyBlue": "#8894a0",
    "terracotta": "#a56148",
    "red": "#6a3026",
    "green": "#3e4739",
    "yellow": "#a56148",
    "blue": "#6f7f90",
    "teal": "#58716b",
    "peach": "#a56148",
    "selectedBg": "#d8cdc7",
    "userBg": "#ddd4ce",
    "toolPendingBg": "#f3efec",
    "toolSuccessBg": "#e1e6de",
    "toolErrorBg": "#efe0dc"
  },
  "colors": {
    "accent": "oxblood",
    "border": "mauveTaupe",
    "borderAccent": "oxblood",
    "borderMuted": "sageGrey",
    "success": "mossGreen",
    "error": "oxblood",
    "warning": "terracotta",
    "muted": "#5f6570",
    "dim": "#73747a",
    "text": "deepNavy",
    "thinkingText": "#4f5964",
    "selectedBg": "selectedBg",
    "scrollbarThumb": "sageGrey",
    "searchMatchBg": "#d8cdc7",
    "searchMatchText": "deepNavy",
    "userMessageBg": "userBg",
    "userMessageText": "deepNavy",
    "customMessageBg": "cloudPetal",
    "customMessageText": "deepNavy",
    "customMessageLabel": "oxblood",
    "toolPendingBg": "toolPendingBg",
    "toolSuccessBg": "toolSuccessBg",
    "toolErrorBg": "toolErrorBg",
    "toolTitle": "deepNavy",
    "toolOutput": "#4f5964",
    "mdHeading": "oxblood",
    "mdLink": "#52677d",
    "mdLinkUrl": "#73747a",
    "mdCode": "terracotta",
    "mdCodeBlock": "darkSpruce",
    "mdCodeBlockBorder": "mauveTaupe",
    "mdQuote": "#4f5964",
    "mdQuoteBorder": "mauveTaupe",
    "mdHr": "sageGrey",
    "mdListBullet": "mossGreen",
    "toolDiffAdded": "mossGreen",
    "toolDiffRemoved": "oxblood",
    "toolDiffContext": "#5f6570",
    "syntaxComment": "#6f7168",
    "syntaxKeyword": "oxblood",
    "syntaxFunction": "#7b503f",
    "syntaxVariable": "deepNavy",
    "syntaxString": "mossGreen",
    "syntaxNumber": "#52677d",
    "syntaxType": "#52677d",
    "syntaxOperator": "darkSpruce",
    "syntaxPunctuation": "#5f6570",
    "thinkingOff": "sageGrey",
    "thinkingMinimal": "mauveTaupe",
    "thinkingLow": "#6f7f90",
    "thinkingMedium": "#58716b",
    "thinkingHigh": "mossGreen",
    "thinkingXhigh": "terracotta",
    "thinkingMax": "oxblood",
    "bashMode": "mossGreen"
  },
  "export": {
    "pageBg": "bone",
    "cardBg": "cloudPetal",
    "infoBg": "userBg"
  }
}
```

- [ ] **Step 4: Create the Orca terminal companion**

Create `themes/imeto-bone.terminal.yaml` with this content.

```yaml
# Terminal companion to imeto-bone.json. Pi cannot paint the terminal
# background, so the Bone ground comes from the terminal itself.
# Warp-format YAML, which is what Orca's "Import from YAML" reads.
name: Imeto Bone
details: lighter
background: "#e9e3df"
foreground: "#04162a"
accent: "#6a3026"
cursor: "#6a3026"
# Orca's Warp importer ignores these keys. Selection colors live only in the
# stored theme, so importing this file does not guarantee the selection pair.
selection: "#907062"
selectionText: "#fbf9f7"
terminal_colors:
  normal:
    black: "#1c1e1b"
    red: "#6a3026"
    green: "#3e4739"
    yellow: "#a56148"
    blue: "#6f7f90"
    magenta: "#907062"
    cyan: "#58716b"
    white: "#d8cdc7"
  bright:
    black: "#73747a"
    red: "#8b4b3f"
    green: "#61705a"
    yellow: "#bd795e"
    blue: "#8894a0"
    magenta: "#a48a7e"
    cyan: "#718985"
    white: "#fbf9f7"
```

- [ ] **Step 5: Run the theme tests and parse the JSON independently**

Run:

```bash
cd ~/Documents/Personal/pi-config
node --test tests/imeto-terminal-ui.test.ts
python3 -m json.tool themes/imeto-bone.json >/dev/null
```

Expected: 6 tests pass. The JSON parser exits with status 0.

- [ ] **Step 6: Commit the theme pair**

```bash
cd ~/Documents/Personal/pi-config
git add themes/imeto-bone.json themes/imeto-bone.terminal.yaml tests/imeto-terminal-ui.test.ts
git commit -m "feat: add imeto bone theme pair"
```

---

### Task 3: Im­eto chatbox status treatment

**Files:**
- Create: `extensions/imeto-status.ts`
- Modify: `extensions/omp-chatbox.ts`
- Modify: `tests/imeto-terminal-ui.test.ts`

**Interfaces:**
- Consumes: `IMETO_COLORS`, `hexToFg`, and `readThemeHex` from `extensions/imeto-style.ts`.
- Produces: `StatusRole`, the semantic color roles used by the editor status line.
- Produces: `statusHex(role: StatusRole, sourcePath?: string): string`.
- Produces: `statusText(role: StatusRole, text: string, bold?: boolean, sourcePath?: string): string`.
- Produces: `contextRole(percent: number | null): StatusRole`.
- Produces: `fitStatusWidths(leftWidth: number, rightWidth: number, width: number): StatusWidths`.
- Preserves: `Symbol.for('omp.footer.statuses.v1')` and `StatusBridge.version: 1`.

- [ ] **Step 1: Add failing semantic-status tests**

Append the import and tests below to `tests/imeto-terminal-ui.test.ts`.

```ts
import {
  contextRole,
  fitStatusWidths,
  statusHex,
  statusText,
} from '../extensions/imeto-status.ts'

test('status roles map to the approved Im­eto palette', () => {
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
```

- [ ] **Step 2: Run the tests and verify the missing status module failure**

Run:

```bash
cd ~/Documents/Personal/pi-config
node --test tests/imeto-terminal-ui.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `extensions/imeto-status.ts`.

- [ ] **Step 3: Implement semantic status roles and width fitting**

Create `extensions/imeto-status.ts` with this implementation.

```ts
import { hexToFg, IMETO_COLORS, readThemeHex } from './imeto-style.ts'

export type StatusRole =
  | 'identity'
  | 'model'
  | 'reasoning'
  | 'path'
  | 'context'
  | 'muted'
  | 'danger'

export type StatusWidths = { left: number; right: number; gap: number }

const STATUS_HEX: Record<StatusRole, string> = {
  identity: IMETO_COLORS.oxblood,
  model: IMETO_COLORS.dustyBlue,
  reasoning: IMETO_COLORS.mossGreen,
  path: IMETO_COLORS.terracotta,
  context: IMETO_COLORS.mauveTaupe,
  muted: IMETO_COLORS.sageGrey,
  danger: IMETO_COLORS.oxblood,
}

const STATUS_VAR: Record<StatusRole, string> = {
  identity: 'oxblood',
  model: 'dustyBlue',
  reasoning: 'mossGreen',
  path: 'terracotta',
  context: 'mauveTaupe',
  muted: 'sageGrey',
  danger: 'oxblood',
}

export function statusHex(role: StatusRole, sourcePath?: string): string {
  return readThemeHex(sourcePath, [STATUS_VAR[role]]) ?? STATUS_HEX[role]
}

export function statusText(
  role: StatusRole,
  text: string,
  bold = true,
  sourcePath?: string,
): string {
  return `${hexToFg(statusHex(role, sourcePath))}${bold ? '\x1b[1m' : ''}${text}${bold ? '\x1b[22m' : ''}\x1b[39m`
}

export function contextRole(percent: number | null): StatusRole {
  if (percent === null) return 'muted'
  if (percent >= 90) return 'danger'
  if (percent >= 70) return 'path'
  return 'context'
}

export function fitStatusWidths(
  leftWidth: number,
  rightWidth: number,
  width: number,
): StatusWidths {
  let left = Math.max(0, leftWidth)
  let right = Math.max(0, rightWidth)
  const minimumGap = right > 0 ? 3 : 0
  let overflow = Math.max(0, left + right + minimumGap - Math.max(0, width))
  const trimRight = Math.min(right, overflow)
  right -= trimRight
  overflow -= trimRight
  left = Math.max(0, left - overflow)
  return { left, right, gap: Math.max(0, width - left - right) }
}
```

- [ ] **Step 4: Replace the rainbow policy in `omp-chatbox.ts`**

Add this import.

```ts
import {
  contextRole,
  fitStatusWidths,
  statusText,
  type StatusRole,
} from './imeto-status.ts'
```

Delete `RAINBOW`, `sgrFg()`, and the old `vivid()`. Add this theme-aware wrapper.

```ts
function vivid(
  theme: StatusTheme,
  role: StatusRole,
  text: string,
  bold = true,
): string {
  return statusText(role, text, bold, theme.sourcePath)
}
```

Replace `fitStatusLine()` with this version.

```ts
function fitStatusLine(
  left: string,
  right: string,
  width: number,
  border: (text: string) => string,
): string {
  if (width <= 0) return ''
  const fitted = fitStatusWidths(visibleWidth(left), visibleWidth(right), width)
  const leftText = truncateToWidth(left, fitted.left, '')
  const rightText = truncateToWidth(right, fitted.right, '')
  return leftText + border('─'.repeat(fitted.gap)) + rightText
}
```

Replace `contextSegment()` with this version.

```ts
function contextSegment(ctx: ExtensionContext): string {
  const text = formatContext(ctx)
  const percent = ctx.getContextUsage()?.percent ?? null
  return vivid(ctx.ui.theme, contextRole(percent), text, percent !== null)
}
```

Replace the status field construction with semantic roles.

```ts
const parts = [
  pad(vivid(theme, 'identity', 'π')),
  pad(`${vivid(theme, 'model', '✺')} ${vivid(theme, 'model', modelLabel(ctx))}`),
  pad(vivid(theme, 'reasoning', `● ${thinking === 'off' ? 'off' : thinking}`)),
  pad(
    `${quiet(theme, 'dim', '⌘')} ${vivid(theme, 'path', compactPath(ctx.cwd))}${
      branch ? quiet(theme, 'muted', `:${branch}`) : ''
    }`,
  ),
  pad(contextSegment(ctx)),
]
```

Add `if (ctx.mode !== 'tui') return` as the first statement in the `session_start` handler. Keep the existing cost, subscription, editor-border, branch refresh, status bridge, and lifecycle code unchanged. Remove the obsolete comments about the vivid rainbow.

- [ ] **Step 5: Run unit tests and a Pi extension load check**

Run:

```bash
cd ~/Documents/Personal/pi-config
node --test tests/imeto-terminal-ui.test.ts
pi --no-extensions -e ./extensions/omp-chatbox.ts -p "reply with ok" >/tmp/imeto-chatbox-smoke.txt
```

Expected: 11 tests pass. Pi exits with status 0. `/tmp/imeto-chatbox-smoke.txt` contains a model response and no extension load error.

- [ ] **Step 6: Verify the status bridge and removed rainbow mechanically**

Run:

```bash
cd ~/Documents/Personal/pi-config
rg "omp\.footer\.statuses\.v1|version: 1" extensions/omp-chatbox.ts
! rg "RAINBOW|#D92534|#2072B2|#0B8C50|#B85E14|#8A6D00" extensions/omp-chatbox.ts
```

Expected: the first command prints the bridge symbol and version. The second command exits with status 0 and prints nothing.

- [ ] **Step 7: Commit the chatbox treatment**

```bash
cd ~/Documents/Personal/pi-config
git add extensions/imeto-status.ts extensions/omp-chatbox.ts tests/imeto-terminal-ui.test.ts
git commit -m "feat: restyle pi chatbox with imeto colors"
```

---

### Task 4: Im­eto token-speed powerline

**Files:**
- Modify: `extensions/token-speed.ts`
- Modify: `tests/imeto-terminal-ui.test.ts`

**Interfaces:**
- Consumes: `hexToBg`, `hexToFg`, and `readThemeHex` from `extensions/imeto-style.ts`.
- Preserves: `themeColor(theme: Theme, ...varNames: string[]): Color`.
- Preserves: cache shard aggregation, token-rate calculation, status bridge lookup, and Powerline layout.

- [ ] **Step 1: Add a failing source contract for the preferred Im­eto roles**

Append this test to `tests/imeto-terminal-ui.test.ts`.

```ts
test('token-speed prefers semantic Im­eto variables', () => {
  const source = readFileSync(new URL('../extensions/token-speed.ts', import.meta.url), 'utf8')
  assert.match(source, /themeColor\(theme, "mossGreen", "teal", "cyan"\)/)
  assert.match(source, /themeColor\(theme, "oxblood", "peach", "red"\)/)
  assert.match(source, /themeColor\(theme, "terracotta", "yellow", "olive"\)/)
})
```

- [ ] **Step 2: Run the test and verify the old variable order fails**

Run:

```bash
cd ~/Documents/Personal/pi-config
node --test tests/imeto-terminal-ui.test.ts
```

Expected: FAIL in `token-speed prefers semantic Im­eto variables`.

- [ ] **Step 3: Reuse the shared theme-file reader**

Change the imports at the top of `extensions/token-speed.ts`.

```ts
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { hexToBg, hexToFg, readThemeHex } from "./imeto-style.ts";
```

Replace `themeColor()` with the version below.

```ts
export function themeColor(theme: Theme, ...varNames: string[]): Color {
  const hex = readThemeHex(theme.sourcePath, varNames)
  if (hex) return { fg: hexToFg(hex), bg: hexToBg(hex) }
  return { fg: theme.getFgAnsi("accent") }
}
```

This removes the duplicated theme JSON parsing while retaining the existing fallback.

- [ ] **Step 4: Prefer Im­eto variables when creating Powerline colors**

Replace the lazy color initialization inside the widget renderer.

```ts
colors = {
  teal: themeColor(theme, "mossGreen", "teal", "cyan"),
  peach: themeColor(theme, "oxblood", "peach", "red"),
  yellow: themeColor(theme, "terracotta", "yellow", "olive"),
}
```

The internal keys stay unchanged because they are private implementation labels. The rendered meaning changes to Moss Green for speed, Oxblood for session cache, and Terracotta for daily cache.

- [ ] **Step 5: Run unit tests and extension smoke checks**

Run:

```bash
cd ~/Documents/Personal/pi-config
node --test tests/imeto-terminal-ui.test.ts
pi --no-extensions -e ./extensions/omp-chatbox.ts -e ./extensions/token-speed.ts -p "reply with ok" >/tmp/imeto-ui-smoke.txt
```

Expected: 12 tests pass. Pi exits with status 0. `/tmp/imeto-ui-smoke.txt` contains a model response and no extension load error.

- [ ] **Step 6: Commit the Powerline treatment**

```bash
cd ~/Documents/Personal/pi-config
git add extensions/token-speed.ts tests/imeto-terminal-ui.test.ts
git commit -m "feat: align token status with imeto palette"
```

---

### Task 5: Live terminal acceptance and rollout

**Files:**
- Modify: `README.md`
- Modify and partially stage: `settings.json`

**Interfaces:**
- Consumes: Pi theme `imeto-bone` and Orca terminal theme `Imeto Bone`.
- Produces: Persistent Pi theme selection and documented activation steps.

- [ ] **Step 1: Add activation documentation**

Append this section to `README.md`.

```md
## Im­eto terminal UI

The Pi theme and terminal-emulator theme must be used together.

1. Import `themes/imeto-bone.terminal.yaml` into Orca as a custom terminal theme.
2. Select `Imeto Bone` for the Orca terminal.
3. Run `/reload` in Pi.

The terminal supplies the Bone background. Pi supplies message, tool, Markdown,
diff, syntax, and status colors. The first stage intentionally omits the mockup's
persistent side rails because Pi extensions cannot reserve those columns.
```

- [ ] **Step 2: Run all automated verification**

Run:

```bash
cd ~/Documents/Personal/pi-config
node --test tests/imeto-terminal-ui.test.ts
python3 -m json.tool themes/imeto-bone.json >/dev/null
pi --no-extensions -e ./extensions/omp-chatbox.ts -e ./extensions/token-speed.ts -p "reply with ok" >/tmp/imeto-ui-final-smoke.txt
git diff --check
```

Expected: 12 tests pass. Every command exits with status 0.

- [ ] **Step 3: Change only the working-tree theme selection**

Use a precise edit in `settings.json`.

```json
"theme": "imeto-bone",
```

Preserve every pre-existing model and scope change in the file.

- [ ] **Step 4: Build a clean staged settings blob from `HEAD`**

Run:

```bash
cd ~/Documents/Personal/pi-config
base=$(mktemp)
next=$(mktemp)
git show HEAD:settings.json >"$base"
python3 - "$base" "$next" <<'PY'
from pathlib import Path
import sys
source = Path(sys.argv[1]).read_text()
old = '  "theme": "parchment",\n'
new = '  "theme": "imeto-bone",\n'
if source.count(old) != 1:
    raise SystemExit('expected one parchment theme line in HEAD')
Path(sys.argv[2]).write_text(source.replace(old, new))
PY
mode=$(git ls-files -s settings.json | awk '{print $1}')
blob=$(git hash-object -w "$next")
git update-index --cacheinfo "$mode,$blob,settings.json"
rm -f "$base" "$next"
git add README.md
git diff --cached -- settings.json README.md
```

Expected: the cached diff contains the README section and only the `theme` line from `settings.json`. The model and scope edits do not appear in the cached diff.

- [ ] **Step 5: Commit activation without absorbing user changes**

Run:

```bash
cd ~/Documents/Personal/pi-config
git commit -m "docs: activate imeto terminal theme"
git status --short
git diff -- settings.json
```

Expected: `settings.json` remains modified only for the pre-existing model and scope changes. Its working-tree theme value is `imeto-bone`.

- [ ] **Step 6: Import and select the terminal theme**

Use Orca's terminal theme settings to import `themes/imeto-bone.terminal.yaml`. Select `Imeto Bone` for the active terminal.

Expected: the terminal background changes to Bone `#e9e3df`. The terminal foreground changes to Deep Navy `#04162a`.

- [ ] **Step 7: Reload the running Pi session**

Run `/reload` in Pi. Confirm that `/settings` reports `imeto-bone` as the active theme.

Expected: Pi hot-reloads the theme. User messages use the warm Bone surface. Tool output uses Cloud Petal or semantic success and error surfaces. The editor status line uses Oxblood, Dusty Blue, Moss Green, Terracotta, Mauve Taupe, and Sage Grey.

- [ ] **Step 8: Verify representative terminal states**

In one live Pi session, exercise these states:

```text
1. Send a long user message that wraps across multiple lines.
2. Run a read tool and a bash tool.
3. Apply a small edit that produces added and removed diff lines.
4. Expand and collapse a tool result.
5. Set a long session name.
6. Open the session near 80, 120, and 160 columns.
```

Expected: no rendered line exceeds the terminal width. Text remains readable. ANSI color does not leak into adjacent rows. The editor continues to accept text and Pi keybindings.

- [ ] **Step 9: Compare with the approved mockup**

Compare the live terminal with the approved Bone Editorial terminal-native mockup. Record only extension-boundary differences in the commit notes.

Expected accepted differences: there is no persistent left rail, no persistent right context pane, and no browser styling. The palette, hierarchy, compact status fields, editor border, and terminal-native character remain recognizable.

- [ ] **Step 10: Push the implementation commits**

Run:

```bash
cd ~/Documents/Personal/pi-config
git log --oneline --decorate -7
git status --short
git push
```

Expected: the implementation commits reach `origin/main`. Only the pre-existing model and scope changes remain in the working tree.
