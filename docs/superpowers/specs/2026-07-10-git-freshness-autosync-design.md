# git-freshness-check: safe auto-sync + widget polish

Date: 2026-07-10
Status: approved (pending implementation)
Owning repo: `okruber/pi-config`
Target file: `extensions/git-freshness-check.ts` (modify in place)

## Problem

The `git-freshness-check` extension already detects when the local branch is
behind its upstream, shows a widget, and injects a "don't trust this stale tree"
warning into the agent's first turn. But it stops at warning. When the sync is
provably safe (a plain fast-forward with a clean tree), a human or agent still
has to notice the widget and run the pull by hand. And when the sync is *not*
safe, the surfaced message is generic - it does not name what is blocking the
sync or how to move forward.

## Goals

1. Perform the sync automatically, but only when it is provably safe.
2. When it is not safe, surface exactly what is blocking it, with a concrete
   next step per case.
3. Polish the widget: drop the `— sync before trusting` suffix and give it a
   subtle color tint so it stands out without shouting.

## Non-goals

- No auto-stash / auto-rebase / auto-merge. Anything that can conflict or lose
  work is out of scope; those cases surface for the human to resolve.
- No confirmation prompt for the safe case (it is provably safe, so friction
  adds nothing).
- No new files, no test harness (none exists in pi-config); verification is
  manual in a scratch repo.

## Definitions

"Provably safe" means all of:
- `behind > 0` (there is something to pull),
- `ahead == 0` (no divergence - a pure fast-forward is possible),
- working tree is clean (`git status --porcelain` is empty),
- the upstream fetch succeeded.

Any other state with `behind > 0` is "blocked" and only surfaces.

## New input: dirty-tree detection

Add a `git status --porcelain` check to the freshness probe. Its emptiness is
the clean/dirty signal, and it is the missing input needed to judge safety.
Store it on the `Drift` record (e.g. `dirty: boolean`).

## Decision logic (at `session_start`, after fetch + behind/ahead computed)

| State (`behind > 0`)                     | Action |
|------------------------------------------|--------|
| clean tree, `ahead == 0` (pure ff)       | **Silent `git pull --ff-only`.** On success, widget briefly reports `✓ synced N commits`, then clears; no agent injection (tree is now fresh). |
| dirty tree                               | Surface only. Suggest: commit or `git stash`, then pull. |
| diverged (`ahead > 0` and `behind > 0`)  | Surface only. Suggest: `git pull --rebase` (or review before merging). |
| fetch failed                             | Surface only. "freshness unverified"; suggest check auth/network, then retry. |

`behind == 0` and clean: widget clears (up to date), as today.

### Safe-pull failure fallback

If the silent `git pull --ff-only` fails unexpectedly (e.g. a race where the
upstream advanced to a non-fast-forwardable state between fetch and pull),
degrade to the blocked path: surface the drift + inject the warning, rather than
erroring out. The pull uses the same no-prompt env and a bounded timeout as the
existing git calls.

## Surfacing (all blocked cases)

Two channels, both already present in the extension:

1. **Widget** (`ctx.ui.setWidget`): text becomes `⚠ N behind <upstream>` -
   the `— sync before trusting` suffix is removed. Rendered via the
   render-function form `(_tui, theme) => theme.fg("warning", line)` so it picks
   up the theme's warning color. In catppuccin-frappe `warning` resolves to
   `yellow` (`#e5c890`) - palette-native, theme-portable, semantically a "heads
   up". Keep it a single foreground tint, no background.
2. **Agent injection** (`before_agent_start`): keep the existing "the local
   working tree is STALE ... do not trust file contents/reviews/diffs until
   synced" guard, plus the case-specific remediation from the table above. The
   safe case does not inject (already synced). The fetch-failed case keeps the
   existing "freshness unverified" injection.

## Preserved edge cases (unchanged from current code)

- Not inside a work tree -> do nothing.
- Detached HEAD (no branch) -> do nothing.
- No upstream configured -> do nothing.
- Compare against HEAD's own upstream (`@{u}`), never a hardcoded `origin/main`,
  so feature branches legitimately behind `main` do not trigger it.

## Testing (manual, scratch repo)

Exercise each state and confirm widget + injection + side effect:
1. behind + clean + not diverged -> silent ff pull happens, widget shows the
   synced confirmation then clears, no injection.
2. behind + dirty -> no pull, widget tinted, injection names the dirty-tree
   remediation.
3. diverged (ahead and behind) -> no pull, injection suggests rebase/review.
4. fetch failure (bad remote / offline) -> "freshness unverified" path intact.
5. up to date -> widget clears, no injection.

## Close-out

Extension lives under `~/.pi/agent/extensions` via symlink to this repo.
After implementation: `git add -A && git commit && git push` in `pi-config`.
