# Osseo iteration 1

Date: 2026-08-26
Status: approved acceptance target
Owning repo: `okruber/pi-config`
Supersedes: `2026-09-04-pi-terminal-ui-center-column-design.md`

## Acceptance target

From the approved composite at `.superpowers/brainstorm/34317-1789042333/content/final-composite.html`.

Tool callouts use one summary line plus a detail column. The summary holds a colored status symbol, the tool name in Deep Navy bold, and the subject argument in Dusty Blue for paths or Sage for plain text. Detail rows sit under a thin Mauve Taupe edge (`│ ` prefix). Meaningful detail rows carry a faint tinted band in the signal hue at roughly 14 to 16 percent alpha. Meta rows (collapsed hints, counts, titles) stay quiet in Sage Grey. Full-width boxes or frames are forbidden.

The dock composition (identity π, model, thinking, path:branch, context, optional cost-subscription or cache, optional session name separated by `›`) is preserved. The π field renders in softened brick red. Remaining slots map to signal colors. Line truncation contracts right-to-left; ANSI resets close after every render.

The user message becomes a raised field with no edge and no label. Thinking remains a quiet Mauve edge. Assistant prose remains unboxed with Oxblood headings. This iteration is scoped to callouts, the transcript treatment, and the dock.

## Palette

`themes/osseo-bone.json` adds five signal accents in addition to the existing eleven named colors.

| Name | Hex | Use |
|---|---|---|
| Signal red | `#B7333D` | Error slots in dock and callouts, brick pi field |
| Signal orange | `#B85E14` | Pending slots, threshold scene changer |
| Signal yellow | `#8A6D00` | Context caution slot |
| Signal green | `#0B8C50` | Success slots |
| Signal blue | `#2072B2` | Model slot |

Semantic palette stays: Oxblood `#6a3026` for brand and assistant headings, Moss `#3e4739` covered by Signal green for success, Terracotta `#a56148` for warning. The palette's `red`, `green`, `yellow`, `blue`, and `peach` alias entries are left untouched for other dependents.

Resolution rule: renderers resolve `<name>` from the active theme when the theme defines it, otherwise they use the signal fallback hex. `resolveThemeVar` handles the fallback today.

## State mapping

Tool visual state maps to signal slots:

- Pending registers Signal orange (`#B85E14`).
- Success registers Signal green (`#0B8C50`).
- Error registers Signal red (`#B7333D`).

Status symbols stay `◌`, `✓`, and `×` or `✗`. The `TOOL_ACCENTS` per-tool rainbow is removed from osseo's render code. Tool names are painted in Deep Navy bold.

## Surface geometry

Calling components emit at most one summary line in the ledger. Unless the result is expanded, the detail column never renders a frame or rounded box. Maximum detail lines are preserved from the current pending path: three tails for read/grep/find/ls, three tails for bash, and up to three added or removed bands for edit. Anything with omitted content appends one Sage hint.

Highlight bands: success meta, error text, and edit add/remove rows use the signal hue at approximately 14 to 16 percent alpha against the page. Pi's theme's `toolSuccessBg` and `toolErrorBg` define the fill colors already; when the active theme lacks them, the literal CSS-mixed values `rgba(11,140,80,0.16)` over Bone or `rgba(183,51,61,0.14)` over Bone reference the contract.

## Editor dock

`omp-chatbox.ts` resolves each slot from the active theme with this mapping:

- π: `signalRed` before `oxblood`.
- Model: `signalBlue` before `accent`.
- Thinking: `signalGreen` before `mossGreen`.
- Path/branch: `signalOrange` before `warning`.
- Context: `signalYellow` (percent null), `signalOrange` (percent ≥ 70), `signalRed` (percent ≥ 90).
- Cost (or cache): `accent` before `customMessageLabel`.
- Session: `accent` before `customMessageLabel`.

The `RAINBOW` constant falls back to `#B7333D`, `#2072B2`, `#0B8C50`, `#B85E14`, and `#8A6D00`. All other dock behavior (edit separators, truncation, expansion) stays as-is.

## Transcript

`osseo-transcript.ts` keeps the register of user and thinking transforms. The user treatment becomes a flat raised field with no Oxblood edge and no label. Thinking keeps a quiet Mauve left edge. Both continue to operate at the Markdown render; the markdown hierarchy part of the target is still subject to Pi's published transformer and is implemented when Pi allows it.

## Testing

- Pure formatting: symbol and signal resolve; subject summary; banded detail rows; bounded line counts; ANSI closing to width; theme fallback.
- Contract: tool definitions preserve schema, execution, and render behavior for all seven built-in tools.
- Dock: slot resolution follows the theme hierarchy; all generated lines fit the supplied width; context thresholds paint yellow/orange/red in sequence.
- Isolated TUI acceptance at 80, 120, and 160 columns: exercise success, pending, and error callouts; expanded and collapsed output; a JPEG image result; the dock at wide and narrow widths; comparison against the approved composite.

## Scope decisions

- The Pi core remains untouched. No fork.
- No standalone app or browser runtime.
- Custom and MCP tools keep their Pi renderers with adjusted theme tokens.
- The approved composite in `final-composite.html` is the acceptance reference.
- `.superpowers/` should be added to `.gitignore`.
