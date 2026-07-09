# Global pi instructions

## Output style — no em-dashes in prose

Do not use em-dashes (—) in generated prose or output. Use a regular hyphen
(-), a comma, parentheses, or rephrase instead. This applies to writing meant
for a human to read (chat replies, summaries, commit messages, doc prose).

This rule is about prose only. Do **not** change filename or note-title
conventions: the Obsidian vault task-system deliberately uses ` — ` (em-dash)
separators in note titles and filenames, and those must stay intact.

## Git-backed config & skills — commit and push after edits

Two personal repos back parts of this environment. When you edit files under
either tree, the change is live via symlink but **not yet saved**. Before ending
the turn, commit and push in the owning repo (and remind me):

| You edited a file under… | Owning repo | Action |
| --- | --- | --- |
| `~/.pi/agent/` (settings, models, themes, extensions, this file) | `~/Documents/Personal/pi-config` → `okruber/pi-config` | `git add -A && git commit && git push` |
| `~/.agents/skills/<name>` (authored: resolves to the skills repo) | `~/Documents/Personal/skills` → `okruber/skills` | `git add -A && git commit && git push` |

Notes:
- Authored skills in `~/.agents/skills` are symlinks into the skills repo; edits
  there are edits to that repo. Consumed (third-party) skills are not tracked —
  don't commit them.
- `~/.pi/agent/{auth,telegram}.json`, `sessions/`, `npm/`, `git/`, `bin/` are
  intentionally untracked — never add them to a repo.
- If a commit+push isn't wanted yet, say so; otherwise treat it as the default
  close-out for config/skill edits.
