# Global pi instructions

## Output style — no em-dashes in prose

Do not use em-dashes (—) in generated prose or output. Use a regular hyphen
(-), a comma, parentheses, or rephrase instead. This applies to writing meant
for a human to read (chat replies, summaries, commit messages, doc prose).

This rule is about prose only. Do **not** change filename or note-title
conventions: the Obsidian vault task-system deliberately uses ` — ` (em-dash)
separators in note titles and filenames, and those must stay intact.

## Obsidian vault file references — render as clickable links

When replying inside the OEK Obsidian vault (cwd under `.../Oek Vault`) and I
reference a specific vault file, render it as a clickable Markdown link:

```
[Note title](http://127.0.0.1:51888/o?file=<url-encoded-vault-relative-path>)
```

URL-encode the path (spaces `%20`, `—` etc.); keep the `.md` extension. Do **not**
use a bare `obsidian://` URL as the link target: Orca's terminal strips non-http
schemes on click, so those are not clickable. The `obsidian-links` extension
forces pi's OSC 8 hyperlink capability on and runs a localhost redirector on
`127.0.0.1:51888` that execs `open obsidian://…`, so an http link to `/o?file=`
opens the note in Obsidian on click. The redirector only runs while pi is open.
If a click does not open Obsidian, use the `open_in_obsidian` tool as a fallback.
Only linkify real, specific vault files, not every path mentioned.

## Code comments — minimal, never prose

Keep inline comments in code modules to a minimum. Never write prose in code.
A comment only earns its place when it removes ambiguity that the code itself
cannot: the *why* behind a non-obvious or counter-intuitive choice, a workaround
for a known bug, an intentional anti-pattern adopted for a specific reason, or a
constraint that is not visible in the surrounding code.

Do **not** write:
- Prose paragraphs explaining what the code does (the code already says it).
- "Tips and tricks" or general background about how a tool/pattern works.
- Comments that restate the line below them.
- Tutorial-style notes for a hypothetical reader.

The goal is to reduce ambiguity, not to narrate. When in doubt, leave it out.

Whatever you do keep must be factually correct and up to date. A stale or
misleading comment is worse than no comment - delete rather than let it rot.

Counter-example — this comment should never exist; it is prose plus general
tips that add nothing the code doesn't already convey:

```hcl
# Self-impersonation token-creator is needed by ad-hoc scripts that follow
# the same pattern as scripts/enable-ge-observability.sh (gcloud auth
# print-access-token under impersonation). Cheap to grant; harmless without
# a separate principal allowed to impersonate.
resource "google_project_iam_member" "ci_token_creator" {
  project = var.project_id
  role    = "roles/iam.serviceAccountTokenCreator"
  member  = "serviceAccount:${google_service_account.ci.email}"
}
```

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
