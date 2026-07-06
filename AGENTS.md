# Global pi instructions

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
