# Osseo iteration 2

Date: 2026-09-14
Status: approved acceptance target
Owning repo: `okruber/pi-config`
Supersedes: `2026-08-26-osseo-iteration-1-design.md` (tool callout sections only)

## Acceptance target

Tool callouts render as framed blocks modeled on oh-my-pi's `renderOutputBlock`
(`packages/coding-agent/src/tui/output-block.ts` in `can1357/oh-my-pi`). The
iteration 1 rule "Full-width boxes or frames are forbidden" is reversed for tool
callouts and stays reversed nowhere else: user messages, thinking, and assistant
prose keep their iteration 1 treatments.

A frame is a full-width rounded box drawn with `╭ ╮ ╰ ╯ ─ │ ├ ┤`. The header
sits inside the top border as `╭─── <symbol> <Title>: <subject> · <meta> ───╮`.
Content rows are `│ <text> │` with one space of padding inside each border.
Sections divide with `├─── <label> ────┤`. The bottom bar is `╰───...───╯`.
Every row is padded to the full render width and filled with the state
background, with inner SGR resets re-stabilized so the fill survives nested
color codes.

Collapsed example, settled bash call:

```
╭────────────────────────────────────────────╮
│ $ npm test                                 │
├─── Output ─────────────────────────────────┤
│ … (18 earlier lines, ctrl+o to expand)     │
│ 12 passing                                 │
│ [Took 4.2s]                                │
╰────────────────────────────────────────────╯
```

Collapsed example, settled read call:

```
╭─── ✓ Read: src/foo.ts:1-12 ────────────────╮
│  1 export const x = 1                      │
│  2 ...                                     │
│ … 40 more lines (ctrl+o to expand)         │
╰────────────────────────────────────────────╯
```

Search-family tools (grep, find, ls) never frame. They render a status header
plus a tree list, matching omp's `inline: true` family:

```
✓ Grep: /renderFrame/ in extensions · 2 matches
├─ extensions/osseo-frame.ts:101: export function renderFrame(
└─ extensions/osseo-tools.ts:42:   return renderFrame(
```

## State mapping

Frame state is `pending | success | error`, derived from pi's render context
(`isPartial`, `isError`, presence of a result). State resolves to osseo-bone
vars, all already present in `themes/osseo-bone.json`:

| State | Border | Fill | Symbol |
|---|---|---|---|
| pending | `framePendingLine` | `toolPendingBg` | `signalOrange` `◌` |
| success | `frameLine` | `toolSuccessBg` | `signalGreen` `✓` |
| error | `frameErrorLine` | `toolErrorBg` | `signalRed` `✗` |

Fills come from the `tool*Bg` vars so custom and MCP tools rendered by pi's
own shell share the same background. `framePendingFill` and `frameErrorFill`
stay reserved and unused. Text slots come from pi's theme: title `toolTitle`
bold, subject `muted`, meta `dim`, body `toolOutput`, diff `toolDiffAdded` /
`toolDiffRemoved`. Status symbols stay `◌`, `✓`, `✗` per the iteration 1
contract; omp's per-tool identity glyphs are not adopted.

## Merge model

Pi renders the call slot and the result slot as siblings and re-invokes both
renderers on every update. The result renderer sets `state.resultPresent` on
pi's shared per-call renderer state; the call component reads the flag at
render time and emits zero lines once it is set. The effect is omp's
`mergeCallAndResult`: one card per tool call, never a call card stacked on a
result card.

While a bash call executes, a 1-second interval invalidates the component so
the elapsed line ticks, mirroring pi's own bash renderer. The interval clears
when the result settles.

## Per-tool formats

Collapsed caps: bash output tail 10 visual lines, code body 12 lines, search
lists 8 items, diff body 40 lines. `ctrl+o` expansion uncaps the same
component; the iteration 1 behavior of delegating expansion to pi's original
renderer is removed.

- bash: headerless frame, both phases. Body section one is the command as a
  dim `$ ` prefix plus `highlightCode(command, 'bash')`. Section two is
  labeled `Output` and holds the tail-windowed output, a
  `… (N earlier lines, ctrl+o to expand)` marker when capped, a dim
  `[Took Xs]` / `[Elapsed Xs]` stats line, and truncation notices from
  `details.truncation` / `details.fullOutputPath` in warning. While executing,
  a dim `running · Ns` line rides inside the pending frame.
- read: pending is a flat `◌ Read: path:L1-L20` line, unframed like omp. The
  result frames as a code cell: hyperlinked path with `:L1-L20` suffix in the
  header, body syntax-highlighted via `getLanguageFromPath` + `highlightCode`
  with a dim line-number gutter starting at `args.offset ?? 1`. Image results
  render a header plus a dim `(image)` body; pi appends the image itself
  below. A stripped `[Truncated: …]` notice becomes a warning line in a
  labeled `Output` section.
- write: framed both phases. Header `Write: path` with `· N lines` meta once
  settled. Body is the syntax-highlighted content, tail-windowed while
  streaming with a trailing dim `(streaming…)` line until `argsComplete`,
  top-anchored after the result.
- edit: framed both phases. Pending body is a dim `N edits pending` line;
  pi does not export `computeEditsDiff`, so no streaming preview diff. The
  settled header carries inline stats, `✓ Edit: path +A -R`, computed from
  `details.diff`. Body is `renderDiff(details.diff, { filePath })` capped at
  40 lines.
- grep / find / ls: flat in both phases. Pending is the status line. The
  result is a status header with counts (`· N matches`, `· N files`,
  `· N entries`) plus a tree list using `├─` / `└─` branches and a
  `… N more <unit> (ctrl+o to expand)` tail. Zero results render
  `· 0 matches` plus a dim `(no matches)` line. Error renders the header in
  error state plus one error-colored line.

All seven tools strip pi's `\n\n[...]` notice footer from result text and
re-render it as a styled line instead of letting it leak into body rows.

## Palette

No new colors. The frame consumes the staged `frameLine`, `framePendingLine`,
`frameErrorLine`, `toolPendingBg`, `toolSuccessBg`, `toolErrorBg`, and the
signal hues, resolved through `resolveThemeVar` with `OSSEO_COLORS` fallbacks,
exactly as iteration 1.

## Testing

- Pure formatting: frame geometry at fixed widths, header embedding, section
  dividers, full-width fill, SGR-reset stabilization, state-to-var resolution
  against a real theme JSON fixture.
- Components: pending suppression via `resultPresent`, expansion uncapping,
  tail-window markers, tree-list caps, elapsed ticking state, error states.
- Contract: all seven built-in definitions keep schema, execute, and labels;
  `renderShell` is `self`; the deleted ledger module leaves no imports.
- Manual acceptance at 80, 120, and 160 columns: one call per tool in
  pending, success, and error states; expanded and collapsed; an image read;
  a long streaming bash command.

## Scope decisions

- The Pi core remains untouched. Extension API only.
- Custom and MCP tools keep their Pi renderers; only the seven built-ins are
  re-skinned.
- `extensions/osseo-call-line.ts` and its test are deleted. The new modules
  are `extensions/osseo-frame.ts` (primitives) and `extensions/osseo-tools.ts`
  (per-tool renderers), wired by `extensions/osseo-transcript.ts`.
- Search-list bodies are plain styled text in this iteration; OSC 8 links
  appear only on read/edit/write header paths.
- The diff body caps at lines only; omp's hunk-count cap is not ported.
