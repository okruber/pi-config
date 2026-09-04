# Im­eto terminal UI for Pi

Date: 2026-09-04
Status: approved visual direction, pending implementation plan
Owning repo: `okruber/pi-config`
Target files: `themes/imeto-bone.json`, `themes/imeto-bone.terminal.yaml`, `extensions/omp-chatbox.ts`, `extensions/token-speed.ts`
Optional target: `extensions/imeto-header.ts`

## Problem

The current Pi interface uses the Parchment theme and an OMP-inspired editor status line. The interface is readable, but its colors do not match Im­eto's visual profile. The status line also uses a vivid rainbow that competes with the surrounding content.

The desired interface combines three references. Pi supplies the interaction model. OMP supplies the compact technical hierarchy. Im­eto supplies the palette and editorial tone.

The result must remain a terminal-native TUI. The browser mockup is a design reference only. The implementation must not create a standalone desktop application.

## Goals

1. Add an Im­eto light theme that maps the approved Bone Editorial direction to Pi's theme tokens.
2. Add a matching terminal-emulator theme because Pi cannot paint the terminal background.
3. Restyle the existing OMP chatbox with Im­eto colors while preserving its current behavior.
4. Restyle the token-speed powerline so it belongs to the same palette.
5. Preserve legibility for prose, tools, diffs, syntax, status, and selected states.
6. Keep the implementation inside `pi-config` for the first stage.

## Non-goals

- No standalone application.
- No browser runtime.
- No Pi core fork in the first stage.
- No persistent left navigation rail in the first stage.
- No persistent right context pane in the first stage.
- No image or texture rendering inside the terminal.
- No changes to agent behavior, tool execution, session data, or model selection.

## Palette

The palette was sampled from the supplied Im­eto header assets.

| Name | Hex | Primary use |
|---|---|---|
| Oxblood | `#6a3026` | Brand mark, strongest focus, errors |
| Bone | `#e9e3df` | Terminal background |
| Dark spruce | `#1c1e1b` | Dark contrast and code emphasis |
| Deep navy | `#04162a` | Main text and dark status fields |
| Moss green | `#3e4739` | Success and active reasoning |
| Mauve taupe | `#907062` | Secondary structure and metadata |
| Cloud petal | `#fbf9f7` | Raised message and tool surfaces |
| Sage grey | `#89897c` | Muted text and neutral states |
| Dusty blue | `#8894a0` | Links, model metadata, and cool accents |
| Terracotta | `#a56148` | Warnings, progress, and warm accents |

## Visual system

The terminal background uses Bone. The default foreground uses Deep Navy. User messages and tool blocks use Cloud Petal or a slightly darkened Bone mixture. Borders use Mauve Taupe at reduced visual weight.

Oxblood marks the Pi identity and the strongest active state. Moss Green marks successful work and active reasoning. Terracotta marks warnings and progress. Dusty Blue marks links and model metadata. Sage Grey carries low-priority information.

Color must reinforce meaning rather than decorate every field. The first-stage status line therefore replaces the current rainbow with a small set of semantic Im­eto colors.

## Terminal constraints

The implementation uses 24-bit ANSI colors. The implementation uses monospaced cells and box-drawing glyphs. Every rendered line must respect the width supplied by Pi.

The design may use foreground colors, background colors, bold text, inverse fields, and Powerline separators. The design must not depend on proportional typography, blur, gradients, arbitrary pixel positioning, or rounded browser cards.

The terminal emulator supplies the Bone page background. Pi supplies content backgrounds through theme tokens. The terminal theme and Pi theme must therefore ship as a pair.

## Stage one

### Pi theme

Create `themes/imeto-bone.json` with all required Pi theme tokens. Reuse named variables from the Im­eto palette. Add compatibility aliases that existing extensions can resolve without special cases.

The theme must cover these states:

- Default and selected text.
- User and custom messages.
- Pending, successful, and failed tools.
- Markdown structure.
- Added and removed diff lines.
- Syntax highlighting.
- Every reasoning level.
- Bash mode.
- HTML export.

### Terminal theme

Create `themes/imeto-bone.terminal.yaml` in the same Warp-compatible format as `themes/parchment.terminal.yaml`. Use Bone as the background and Deep Navy as the foreground. Map ANSI colors to the nearest semantic Im­eto colors.

Document the same Orca importer limitation that affects selection colors. Do not change the existing Parchment patch script in this stage.

### Chatbox

Update `extensions/omp-chatbox.ts` in place. Preserve its custom editor border, path compaction, model label, reasoning level, context usage, cost display, session name, and status bridge.

Replace the hardcoded rainbow with semantic Im­eto colors. Resolve colors from the active theme when possible. Keep direct truecolor fallbacks for themes that do not expose the expected variables.

The status sequence remains compact:

1. Pi identity.
2. Model.
3. Reasoning level.
4. Working directory and branch.
5. Context usage.
6. Cost or subscription state.
7. Session name.

Narrow terminals must truncate from the right without exceeding the available width. Existing editor input behavior must remain unchanged.

### Token speed

Update `extensions/token-speed.ts` so its powerline resolves Im­eto variable names first. Keep its existing fallbacks for Catppuccin and Parchment. Preserve cache aggregation, token-rate calculation, layout, and status bridge behavior.

Use Oxblood for the session cache field. Use Terracotta for the daily cache field. Use Moss Green or Dusty Blue for token speed. The exact assignment must preserve readable contrast when inverse video paints a segment background.

### Header

A minimal custom header is optional. It may identify `π imeto / pi` and show the Pi version in one or two terminal rows. It must not imitate a desktop title bar. It must not consume substantial transcript height.

The implementation plan may omit this file if the existing startup header already fits the theme after live testing.

## Stage two

Stage two starts only after the first-stage interface has been used in real sessions.

A right context pane may be prototyped as an optional overlay on terminals at least 140 columns wide. The overlay must remain unfocused during normal editing. It must hide cleanly on narrow terminals. It must not obscure information that Pi does not also expose elsewhere.

A persistent left rail requires a Pi core layout hook that extensions do not currently provide. That work needs a separate design and a separate decision about maintaining a Pi fork. Stage one does not prepare or assume that fork.

## Compatibility

`omp-chatbox.ts` currently replaces Pi's footer with an empty footer. It republishes extension statuses through `Symbol.for('omp.footer.statuses.v1')`. `token-speed.ts` depends on that bridge. The refactor must preserve the symbol and its version.

The custom editor must continue to extend `CustomEditor`. It must continue to delegate input handling to Pi. It must continue to rebuild themed output on render or invalidation.

Terminal-only behavior must be guarded by `ctx.mode === 'tui'` where the API requires that distinction.

## Activation

The implementation must not overwrite unrelated edits in `settings.json`. That file was already modified before this work began.

After the files are installed, select `imeto-bone` through `/settings`. Import `themes/imeto-bone.terminal.yaml` into Orca and select it for the terminal. Run `/reload` after extension changes.

## Testing

The first stage needs automated checks for pure formatting logic and live terminal verification for rendered output.

Automated checks must cover:

1. Status fields use Im­eto colors rather than the previous rainbow.
2. Status lines never exceed the supplied terminal width.
3. Narrow widths retain valid ANSI resets after truncation.
4. Context thresholds keep distinct normal, warning, and error treatments.
5. Token-speed color resolution prefers Im­eto variables and retains fallbacks.
6. The theme defines every required token.

Live checks must cover:

1. A new empty session.
2. A long user message.
3. Assistant thinking at each reasoning level.
4. Pending, successful, and failed tools.
5. Expanded and collapsed tool output.
6. Added and removed diff lines.
7. A long path and a named session.
8. Terminal widths near 80, 120, and 160 columns.
9. The Orca terminal theme and Pi theme used together.

## Rollout

Commit the new theme files and extension changes without staging the pre-existing `settings.json` edits. Push the implementation to `okruber/pi-config` after verification.

The first live session is the acceptance check. A screenshot should be compared with the approved Bone Editorial terminal mockup. Differences caused by Pi's extension boundary should be documented rather than hidden.
