# Global pi instructions

## No em-dashes in prose

Do not use em-dashes (—) in generated prose or output. Use a hyphen (-), a
comma, parentheses, or rephrase. This covers chat replies, summaries, commit
messages, and doc prose.

Filenames and note titles are exempt. The Obsidian vault task system uses
` — ` separators on purpose. Leave them intact.

## Code comments — minimal, never prose

Keep comments in code to a minimum. Never write prose in code. A comment earns
its place only when it removes ambiguity the code cannot: the *why* behind a
counter-intuitive choice, a workaround for a known bug, a deliberate
anti-pattern, or a constraint not visible nearby.

Do not restate the line below. Do not explain how a tool or pattern works. Do
not write tutorial notes for a hypothetical reader. A stale comment is worse
than no comment, so delete rather than let it rot.

## Load these before you act

- Writing a README, runbook, guide, PR description, issue, release note, doc, or
  step-by-step instructions for me? Read
  `~/.agents/skills/technical-writing/SKILL.md` first.
- Editing anything under `~/.pi/agent/` or `~/.agents/skills/`? Read
  `~/.agents/skills/config-repos/SKILL.md` first. Both trees are git-backed and
  your edit is not saved until you commit and push.
