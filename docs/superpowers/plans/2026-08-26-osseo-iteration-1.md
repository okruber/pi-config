# Osseo Iteration 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild osseo's tool callouts to the approved flat geometry (single summary line + Mauve edge detail + signal-colored states + faint highlight bands), add the signal-five palette, move the dock's rainbow onto theme resolution, flatten the user row, and re-record the mockups to the new acceptance target.

**Architecture:** `extensions/osseo-call-line.ts` keeps the component structure (ledger per tool, edge output wrapper) but replaces the rainbow/rainbow-frame helpers with the flat treatment. `themes/osseo-bone.json` gains named signal accents. `extensions/omp-chatbox.ts` resolves each dock slot through theme with the brick fallback. `extensions/osseo-transcript.ts` quiets the user treatment. `docs/superpowers/mockups/pi-terminal-ui/` gets refreshed to match.

**Tech Stack:** Pi extension APIs, TypeScript, `node:test`, 24-bit ANSI, existing `tests/run-osseo-tests.sh` launcher.

**Spec:** `docs/superpowers/specs/2026-08-26-osseo-iteration-1-design.md`

## Global Constraints

- The Pi core remains untouched. No fork.
- No standalone application, browser runtime, or browser styling.
- No changes to tool behavior, model behavior, or session data.
- The decorated tools remain `read`, `bash`, `edit`, `write`, `grep`, `find`, and `ls`.
- `renderShell: "self"` remains so Pi never adds its default filled box.
- Every renderer measures visible width after removing ANSI sequences.
- Every truncated fragment closes bold, inverse, foreground, and background.
- No rendered line may exceed the width supplied by Pi.
- Theme resolution uses `resolveThemeVar` then exact fallbacks.
- The `toolSuccessBg` and `toolErrorBg` theme tokens define band fills when present. The literal CSS mixes are the contract when absent: `rgba(11,140,80,0.16)` over Bone, `rgba(183,51,61,0.14)` over Bone.
- `tests/run-osseo-tests.sh` is the test entrypoint.

---

### Task 1: Signal palette anchors in osseo-bone.json

**Files:**
- Modify: `themes/osseo-bone.json` (vars block)

Commits the five named signal accents and leaves existing aliases and colors untouched.

- [ ] **Step 1: Edit theme vars**

In `themes/osseo-bone.json` under `vars`, after the existing `terracotta` entry, add:

```json
"signalRed": "#B7333D",
"signalOrange": "#B85E14",
"signalYellow": "#8A6D00",
"signalGreen": "#0B8C50",
"signalBlue": "#2072B2",
```

- [ ] **Step 2: Verify**

Run: `python3 -c "import json; json.load(open('themes/osseo-bone.json'))"`
Expected: no output, valid JSON.

- [ ] **Step 3: Commit**

```bash
git add themes/osseo-bone.json
git commit -m "osseo: add five signal accents to bone theme"
```

---

### Task 2: Rewrite `osseo-call-line.ts` rendering to flat geometry

**Files:**
- Modify: `extensions/osseo-call-line.ts`
- Test: `tests/osseo-call-line.test.ts` (all updates in Task 5)

`TOOL_ACCENTS`, `frameDetail`, `accentLine`, `writeSizeLine`, per-tool detail builders, and the frame surface (`MIN_FRAME_WIDTH`, frame vars, `fillColor`/`borderColor` resolution) are removed. `ToolLedgerComponent` and `EdgeOutputComponent` stay but produce only the summary line and the edge-nested detail rows. `buildToolDetail` keeps its role as pure detail formatter.

- [ ] **Step 1: Rewrite helpers and add band painting**

Replace the file's `TOOL_ACCENTS`, `ANSI_CLOSE`, `STATE_COLOR_VAR`, and the whole frame block with the flat helpers:

```typescript
export const STATE_COLOR_VAR: Record<ToolVisualState, OsseoColorName> = {
  pending: 'signalOrange',
  success: 'signalGreen',
  error: 'signalRed',
}

const MUTED_VARS: Record<BuiltInToolName, OsseoColorName> = {
  bash: 'sageGrey',
  read: 'dustyBlue',
  write: 'dustyBlue',
  edit: 'dustyBlue',
  grep: 'dustyBlue',
  find: 'dustyBlue',
  ls: 'dustyBlue',
}

function subjectFg(name: BuiltInToolName, sourcePath: string | undefined, text: string): string {
  return hexToFg(resolveThemeVar(sourcePath, MUTED_VARS[name])) + text + '\x1b[39m'
}

function band(sourcePath: string | undefined, state: 'success' | 'error', text: string): string {
  const fg = resolveThemeVar(sourcePath, state === 'success' ? 'mossGreen' : 'signalRed')
  const bg = resolveThemeVar(sourcePath, state === 'success' ? 'toolSuccessBg' : 'toolErrorBg')
  return `${hexToBg(bg)}${hexToFg(fg)}${text}${ANSI_CLOSE}`
}

function edgeLine(sourcePath: string | undefined): string {
  return `${hexToFg(resolveThemeVar(sourcePath, 'mauveTaupe'))}│ \x1b[39m`
}
```

Remove `TOOL_ACCENTS`, `MIN_FRAME_WIDTH`, `frameDetail`, and all frame-variable names. Keep `ANSI_CLOSE`.

- [ ] **Step 2: Rewrite `buildToolDetail` paths**

Remove the frame and `accentLine` machinery. Each returned row is plain text or a `band(...)` (success meta rows for non-edit success, error content rows for errors, add/remove bands for edits). Keep the line-count caps (3 tail lines for read/grep/find/ls/bash, 3 change rows for edit) and the sage `hintLine` for omitted content.

- [ ] **Step 3: Replace `frameDetail` with a flat detail emitter**

```typescript
export function flatDetail(detail: string[], width: number, sourcePath: string | undefined): string[] {
  if (width <= 0) return []
  const inner = Math.max(1, width - 2)
  return detail.map((line) =>
    fitAnsi(`${edgeLine(sourcePath)}${line}`, width),
  )
}
```

- [ ] **Step 4: Patch `osseo-style.ts` export**

Append `signalRed`, `signalOrange`, `signalYellow`, `signalGreen`, and `signalBlue` to `OSSEO_COLORS` and the fallback map in `extensions/osseo-style.ts` so `resolveThemeVar` finds them.

- [ ] **Step 5: Update `ToolLedgerComponent.render`**

Keep the summary line, remove the `pending` frame path. Render exactly one row:

```typescript
const summary = summarizeToolCall(this.input.name, this.input.args)
const symbol = `${hexToFg(resolveThemeVar(this.input.theme.sourcePath, STATE_COLOR_VAR[state]))}${toolStateSymbol(state)}\x1b[39m`
const action = `${this.input.theme.bold(this.input.name)}\x1b[22m`
const subject = subjectFg(this.input.name, this.input.theme.sourcePath, summary.subject)
return [fitAnsi(`${symbol} ${action} ${subject}`, width)]
```

Drop the pending-frame cache key; cache on `width` and `state` and arguments.

- [ ] **Step 6: Update `EdgeOutputComponent.render`**

For unexpanded: replace `frameDetail(...)` with `flatDetail(buildToolDetail(detail), width, sourcePath)`. For expanded: keep the edge-prefixed inner rendering.

- [ ] **Step 7: Tidy types and exports**

Remove `frameDetail` export; add `flatDetail` export. Remove `TOOL_ACCENTS` from module exports; keep `BUILTIN_TOOL_NAMES`, `summarizeToolCall`, `toolVisualState`, `toolStateSymbol`, `buildToolDetail`, `fitAnsi`, and the two components.

- [ ] **Step 8: Commit**

```bash
git add extensions/osseo-call-line.ts extensions/osseo-style.ts
git commit -m "osseo: flat callout geometry replaces frames and rainbow accents"
```

---

### Task 3: Rewrite `osseo-transcript.ts` decorator

**Files:**
- Modify: `extensions/osseo-transcript.ts`

The decorator keeps its registration logic. Its call and result render functions stay thin: they build the `ToolLedgerComponent` and `EdgeOutputComponent`, no longer the frame material. Adjust the `OsseoRendererState` type (still `osseoResultPresent` to coordinate) and the pending-detail snapshot so partials render as the edge-nested detail, not a frame. Remove imports of removed helpers; import `flatDetail` instead.

- [ ] **Step 1: Update imports and component assembly**

Edit the import to drop `TOOL_ACCENTS` and the frame path. In `renderCall`, construct the ledger with `pending` set only when the runtime reports partial state; the pending slot should resolve to the new detail emitter via `EdgeOutputComponent.detail` or stay absent until result. Keep `state.osseoResultPresent` as written.

- [ ] **Step 2: Commit**

```bash
git add extensions/osseo-transcript.ts
git commit -m "osseo: decorator renders pending via flat detail, drops frame"
```

---

### Task 4: Recolor `omp-chatbox.ts` dock slots

**Files:**
- Modify: `extensions/omp-chatbox.ts`

Introduce a `resolveSlot(theme, names, fallbackHex)` helper. Replace the five hardcoded `RAINBOW` foregrounds with theme resolution, fallback to the new literal hexes.

- [ ] **Step 1: Add the resolver**

Near `STATUS_BRIDGE` add:

```typescript
function resolveSlot(theme: any, names: string[], fallbackHex: string): string {
  const sourcePath = (theme as any)?.sourcePath
  for (const name of names) {
    const value = resolveThemeVar(sourcePath, name as any)
    if (value !== FALLBACK[name as keyof typeof OSSEO_COLORS]) return value
  }
  return fallbackHex
}
```

- [ ] **Step 2: Replace slot painting**

In the editor render:

```typescript
const slotPi = resolveSlot(theme, ['signalRed', 'oxblood'], '#B7333D')
const slotModel = resolveSlot(theme, ['signalBlue', 'accent'], '#2072B2')
const slotThink = resolveSlot(theme, ['signalGreen', 'mossGreen'], '#0B8C50')
const slotPath = resolveSlot(theme, ['signalOrange', 'warning'], '#B85E14')
const ctxCaution = resolveSlot(theme, ['signalYellow'], '#8A6D00')
```

Use `vivid(slotPi, 'π')`, `vivid(slotModel, ...)`, `vivid(slotThink, ...)`, `vivid(slotPath, ...)`. In `contextSegment`, use `slotRed` for percent ≥ 90, `slotOrange` for ≥ 70, `ctxCaution` when non-null otherwise. Keep the `RAINBOW` const only for `contextSegment`'s internal legacy until mapped; otherwise remove it.

- [ ] **Step 3: Commit**

```bash
git add extensions/omp-chatbox.ts
git commit -m "osseo: dock slots resolve signal accents from theme (brick pi)"
```

---

### Task 5: Update tests to the new output shape

**Files:**
- Modify: `tests/osseo-call-line.test.ts`

- [ ] **Step 1: Swap color helpers**

`accentOf` and the `OX_FG`/`MOSS_FG` constants depend on removed names. Replace them with the same-shape helpers that resolve `sageGrey`/`dustyBlue`/`mossGreen`/`signalRed`/`signalOrange`/`signalGreen`. Keep every test's structure so failures are localized to color or geometry changes.

- [ ] **Step 2: Fix expectations for the new geometry**

Any expectation on frame characters (`╭`, `╯`), rainbow hexes, or per-tool accent colors must flip to the new assertions: no frame glyphs appear; `edgeLine`'s `│` appears on detail rows; summary line uses Deep Navy bold for the name.

- [ ] **Step 3: Run tests**

```bash
bash tests/run-osseo-tests.sh
```
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add tests/osseo-call-line.test.ts
git commit -m "osseo: update tests for flat geometry and signal slots"
```

---

### Task 6: Re-record mockups and reference

**Files:**
- Modify: `docs/superpowers/mockups/pi-terminal-ui/01-tool-call-grammar.html`
- Modify: `docs/superpowers/mockups/pi-terminal-ui/05-selected-center-column.html`
- Modify: `docs/superpowers/mockups/pi-terminal-ui/README.md`

Update the selected variants so the mockups match the new acceptance target: callouts with flat edge and signal-colored symbols, user row without band/label, dock's red slot muted toward brick.

- [ ] **Step 1: Mockup edits**
- [ ] **Step 2: README tweak (point readers at the new iteration direction)**

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/mockups/pi-terminal-ui/
git commit -m "osseo: mockups record the approved iteration 1 target"
```

---

### Task 7: Isolate and live-verify

**Files:** none (verification task)

- [ ] **Step 1: Create isolated Pi config** (temp dir, symlink `extensions`, `themes`, `agents`, `prompts`).
- [ ] **Step 2: Select `osseo-bone` and launch Pi in TUI.**
- [ ] **Step 3: Exercise three widths near 80, 120, 160 columns:** success callout, pending bash, error bash; expanded vs collapsed read; a JPEG read; verify no frame glyphs appear; confirm dock slots map; confirm user row; confirm thinking edge.
- [ ] **Step 4: Screenshot comparison** with `final-composite.html` in the visual companion.
- [ ] **Step 5: Remove the isolated runtime files**; leave git state clean.
- [ ] **Step 6: Commit acceptance notes** (optional commit for `docs/superpowers/mockups/pi-terminal-ui/06-iteration-1-accepted.html` if useful).
