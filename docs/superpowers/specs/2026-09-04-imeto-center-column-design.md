# Im­eto center column for Pi

Date: 2026-09-04
Status: approved design, pending written-spec review
Owning repo: `okruber/pi-config`

## Relationship to the first stage

This design extends `2026-09-04-imeto-terminal-ui-design.md`.

The first stage established the Im­eto palette and the Pi theme. The first stage also established the Orca terminal theme and status-line colors. Live inspection showed that those changes mostly recolored Pi's existing interface. The result did not carry enough of the approved OMP hierarchy into the transcript. Tool calls and their output retained Pi's existing structure. Diffs and the editor dock also retained too much of that structure.

The existing implementation commits remain useful inputs. They are not accepted as the complete visual result.

## Goal

The first high-fidelity pass will create a terminal-native center column that resembles the approved Im­eto mockups. The pass will improve transcript hierarchy. The pass will improve built-in tool rendering. The pass will improve expanded output and diffs. The pass will replace the editor dock treatment. The pass will not add persistent side regions.

## Non-goals

- The pass will not add a persistent left rail.
- The pass will not add a persistent right context pane.
- The pass will not add browser styling.
- The pass will not fork Pi core.
- The pass will not replace arbitrary custom or MCP tool renderers.
- The pass will not change tool behavior, model behavior, or session data.
- The pass will not hide Pi diagnostics by changing unrelated startup settings.

## Saved mockups

The editable comparison sources live in `docs/superpowers/mockups/imeto-terminal-ui/`.

- `01-tool-call-grammar.html` compares inline ledger, editorial block, and activity rail treatments.
- `02-expanded-output-treatment.html` compares edge-only, semantic inset, and line-band output treatments.
- `03-message-hierarchy.html` compares editorial page, role gutter, and message slab hierarchies.
- `04-editor-status-composition.html` compares border ledger, prompt rail, and powerline dock editors.
- `05-selected-center-column.html` combines the selected treatments at representative widths.

## Approved visual system

### Transcript

User messages use a raised warm surface. Each user message includes a compact `YOU` label and a restrained left edge.

Assistant prose remains unboxed. Markdown headings use Oxblood. Body text uses Deep Navy.

Thinking remains visually subordinate. Thinking uses Sage Grey text and a thin structural edge.

### Tool calls

Built-in tools use a compact inline ledger. Each tool begins with one summary line.

Pending tools use `◌` with Terracotta. Successful tools use `✓` with Moss Green. Failed tools use `×` with Oxblood.

The summary shows the most useful argument for each tool. Read, edit, and write show a path. Bash shows a command. Grep shows a pattern and scope. Find shows a path pattern. Ls shows a directory.

### Tool output

Expanded output uses a thin Mauve Taupe edge. Expanded output does not use a filled card.

Collapsed read, grep, find, and ls output shows at most five visual lines. Collapsed bash output shows its final five visual lines. Collapsed edit output shows at most six changed lines. Every collapsed result includes an expansion hint when more output exists.

Expanded output preserves syntax highlighting. Expanded output preserves images. Expanded output preserves streaming updates and diff coloring.

Added diff lines use Moss Green. Removed diff lines use Oxblood. Context lines remain muted.

### Editor dock

The editor uses the approved powerline dock. The dock uses inverse color segments on one compact row.

The dock orders fields by semantic priority. Pi identity appears first. Model and reasoning follow. Path and context follow those required fields. Cost or subscription state follows context. Cache state and session name appear last.

The editor body uses Cloud Petal with an Oxblood prompt edge. The keybinding hint and token rate remain quiet footer information.

## Responsive behavior

The dock preserves semantic priority as width decreases.

At approximately 160 columns, the dock may show every field. At approximately 120 columns, the dock keeps path and context while dropping lower-priority metadata when required. At approximately 80 columns, the dock keeps Pi identity, model, and reasoning.

The path truncates before required fields disappear. Context, cost, cache, and session fields disappear from right to left.

Every renderer measures visible width after removing ANSI sequences. Every truncated fragment closes its foreground and background state. The fragment also closes its bold and inverse state. No rendered line may exceed the width supplied by Pi.

## Architecture

### Shared palette

`extensions/imeto-style.ts` remains the canonical palette source. Renderers resolve matching variables from the active theme before using exact Im­eto fallbacks.

### Tool UI module

A new `extensions/imeto-tool-ui.ts` module owns the terminal components and pure formatting policy.

The module selects tool states and formats summaries. The module renders output edges and truncates previews. The module fits ANSI content to visible widths. The module selects responsive status fields.

Tool-specific adapters provide concise summaries for every decorated tool. The decorated tools are `read`, `bash`, `edit`, `write`, `grep`, `find`, and `ls`.

The module has no execution responsibility.

### Transcript extension

A new `extensions/imeto-transcript.ts` extension installs the transcript treatment in TUI mode.

The extension registers a Markdown transformer for user and thinking display. The user transform adds the `YOU` label and a quoted structural edge. The thinking transform adds a quiet quoted edge. The transformer does not alter persisted messages or model context.

The extension decorates built-in tool definitions during `session_start`. Each decorated definition starts from Pi's exported `create*ToolDefinition` result for `ctx.cwd`.

The read definition receives the active image resize setting. The bash definition receives the active command prefix and shell path. The extension obtains those values from a `SettingsManager` created for `ctx.cwd` and the active agent directory.

Each decorated definition preserves its name and label. Each definition preserves its description and parameters. Each definition preserves its prompt snippet and prompt guidelines. Each definition preserves argument preparation and execution mode. Each definition preserves its execution function and result details. The decorator changes only the render shell and render functions.

The decorator uses `renderShell: "self"` so Pi does not add its default filled tool box. The custom call renderer creates the ledger header. The custom result renderer places output behind the thin edge.

A tool adapter may wrap Pi's original renderer when the original component owns important semantics. This rule applies to syntax rendering, edit previews, unified diffs, images, and streaming output. The adapter must not duplicate those semantics unless a focused test proves the replacement equivalent.

### Chatbox and token status

`extensions/omp-chatbox.ts` continues to own the custom editor and status bridge. Its visual structure changes from the border ledger to the powerline dock.

`extensions/token-speed.ts` continues to calculate token rate and cache state. It publishes those values through `Symbol.for('omp.footer.statuses.v1')` without changing the bridge version.

### Custom and MCP tools

Custom and MCP tools retain their registered renderers or Pi's default fallback renderer. The Im­eto theme continues to provide readable pending, success, error, title, output, and diff colors for those rows.

## Data flow

1. Pi loads `imeto-transcript.ts` with the other configured extensions.
2. The `session_start` handler exits when `ctx.mode` is not `tui`.
3. The handler reads runtime settings for `ctx.cwd`.
4. The handler creates and decorates the seven built-in tool definitions.
5. Pi keeps the same active tool names and execution paths.
6. A tool call sends its arguments and render context to the ledger header adapter.
7. A tool result sends its content, details, state, and expansion flag to the edge-output adapter.
8. The adapter delegates semantic content rendering to the original Pi renderer where required.
9. The component measures the supplied width and clips every rendered row safely.
10. The chatbox reads current status fields on each render.
11. The dock drops fields according to the responsive priority before rendering the editor.

## Failure behavior

A renderer exception must not affect tool execution. Pi's standard fallback renderer remains the recovery path.

A missing theme variable uses the exact Im­eto fallback. A malformed theme file does not prevent the extension from loading.

A missing runtime setting uses Pi's factory default. The extension does not write settings while constructing tool definitions.

Pi may report that an extension overrides built-in tools. The implementation will not suppress that diagnostic through unrelated configuration. Live acceptance will determine where the diagnostic appears when registration occurs during `session_start`.

## Testing

### Pure formatting tests

Unit tests cover state symbols and semantic colors. Unit tests cover tool summaries and field priorities. Unit tests cover visible widths, ANSI resets, and truncation.

Tests cover terminal widths near 80, 120, and 160 columns. Tests verify that no rendered line exceeds its supplied width.

### Component tests

Component tests render pending and streaming rows. Component tests render successful and failed rows. Component tests cover collapsed and expanded output.

Tool-specific tests cover `read`, `bash`, `edit`, `write`, `grep`, `find`, and `ls`. Diff tests include added, removed, and context lines.

Transcript tests cover the user label, thinking annotation, assistant Markdown, and long wrapped content.

### Contract tests

Contract tests compare each decorated definition with its Pi factory definition. The tests verify preserved schema and description. The tests verify preserved prompt metadata and argument preparation. The tests verify preserved execution mode and execution function. The tests verify unchanged result behavior.

Tests verify that custom and MCP tools remain untouched.

### Integration tests

An isolated Pi directory loads the Im­eto theme, chatbox, token-speed extension, and transcript extension. Smoke checks verify extension loading without repository changes.

Live acceptance exercises long user content and every thinking level. Live acceptance exercises pending, successful, and failed tools. Live acceptance exercises collapsed and expanded output. Live acceptance exercises syntax, images, and diffs. Live acceptance repeats representative states near 80, 120, and 160 columns.

The paired Orca theme and Pi theme must be active during visual acceptance. The live result must be compared with `05-selected-center-column.html`.

## Rollout

The existing feature branch remains unmerged during implementation. Runtime files created by isolated Pi sessions must be removed before review.

The work will use test-driven development and task-level review. A final reviewer will inspect the complete branch against this design and the implementation plan.

The main checkout's unrelated `settings.json` changes must remain unchanged. No implementation commit will be pushed until automated verification, live acceptance, and final review pass.
