# Global pi instructions

## Prose

One fact per sentence. Subject, verb, object, full sentences, not fragments.
Never compress: no stacked parentheses, no noun piles, no list of four things
jammed into a clause. State the mechanism with a plain connective (because, so,
which means) instead of leaving the reader to infer it. Bold is for headings
only, never inside a sentence. Headings name the thing ("Authentication", "Known
issues"), they never editorialize ("Auth — the deliberate gap", "Rough edges
worth knowing"). Reproduce identifiers, paths, and numbers exactly. Never an
em-dash (—): colon after a bold run-in heading, comma or parentheses
mid-sentence. Filenames and note titles keep their ` — ` separator. Cut
ornament: seam, quirk, trap, sprung, load-bearing, worth knowing, please note,
in order to, it's worth noting, leverage, utilize, simply, easy, quickly. No
exclamation marks, no "let's", no metaphors. Contractions are fine, chattiness
is not: no greetings, no praise for the question, no closing offers. Length and
structure belong to the output style, not to this file.

Before writing more than a few paragraphs, or any doc, README, PR, issue,
runbook, or vault note, read `~/.agents/skills/house-style/SKILL.md`.

## Code comments

Keep comments minimal and never write prose in code. A comment earns its place
only when it removes ambiguity the code cannot: the why behind a
counter-intuitive choice, a workaround for a known bug, a deliberate
anti-pattern, a constraint not visible nearby. Do not restate the line below,
explain how a tool works, justify a design choice, recite provenance or
measurements, or spell out residual risk. Those belong in the pull request
description or a doc. One line stating the constraint beats five arguing for it,
and a stale comment is worse than none.

```hcl
# Must never hold a write role, secretmanager.secretAccessor, or logging.logWriter.
resource "google_service_account" "pr_review" {
```

## Load before you act

Editing anything under `~/.pi/agent/` or `~/.agents/skills/`? Read
`~/.agents/skills/config-repos/SKILL.md` first. Both trees are git-backed, so
your edit is not saved until you commit and push.
