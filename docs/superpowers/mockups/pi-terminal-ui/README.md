# Pi terminal UI mockups

These HTML fragments preserve the design comparisons used for the Pi Terminal UI center column.

The fragments are designed for the Superpowers visual companion. The companion supplies the outer frame and selection behavior. The inline styles and terminal previews remain editable without rebuilding the implementation.

## Selected direction

Iteration 1 approval (2026-08-26): flat ledger with a signal-colored symbol, a mauve edge carrying content preview lines, a Sage `OUTPUT · <meta>` row, and bands reserved for diff rows only. The user message renders as a quiet raised field with no label and no edge. Dock slots follow signal-red / signal-blue / signal-green / signal-orange with a yellow→orange→red context threshold.

- `01-tool-call-grammar.html`: Inline ledger.
- `02-expanded-output-treatment.html`: Edge only.
- `03-message-hierarchy.html`: Editorial page.
- `04-editor-status-composition.html`: Powerline dock.
- `05-selected-center-column.html`: Combined acceptance target.

The unselected variants remain part of the design record so later iterations can revisit them.
