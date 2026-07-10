# git-freshness safe auto-sync + widget polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `git-freshness-check` auto-pull when it is provably safe, surface a concrete next step when it is not, and polish the widget (no suffix, subtle yellow tint).

**Architecture:** Single existing pi extension, `extensions/git-freshness-check.ts`. Extend the freshness probe to detect a dirty working tree, add a decision step at `session_start` that runs a silent `git pull --ff-only` only in the provably-safe case, and route every blocked case to a case-specific message shown in the widget and injected into the agent's first turn. No new files.

**Tech Stack:** TypeScript, pi Extension API (`@earendil-works/pi-coding-agent`), `git` via `node:child_process.execFile`.

## Global Constraints

- Target file only: `extensions/git-freshness-check.ts` (in repo `okruber/pi-config`, live via symlink at `~/.pi/agent/extensions`). No new files.
- "Provably safe" = `behind > 0` AND `ahead == 0` AND clean tree AND fetch succeeded. Every other `behind > 0` state is "blocked" — surface only, never mutate the tree.
- No auto-stash, auto-rebase, or auto-merge. Ever.
- Safe case runs silently (no confirmation prompt).
- All git calls use the existing no-prompt env (`GIT_TERMINAL_PROMPT=0`, `GIT_SSH_COMMAND="ssh -o BatchMode=yes"`) and a bounded timeout.
- Compare against HEAD's own upstream `@{u}`, never a hardcoded `origin/main`.
- Widget text: `⚠ N behind <upstream>` — no `— sync before trusting` suffix. Tint via `theme.fg("warning", …)` (resolves to yellow in catppuccin-frappe). Single foreground tint, no background.
- No automated test harness exists; verification is manual in a scratch git repo, then restart a pi session in that repo and observe.
- Code comments stay minimal per repo AGENTS.md — only comment non-obvious *why*.
- Close-out: `git add -A && git commit && git push` in `pi-config`.

---

### Task 1: Detect dirty working tree in the freshness probe

**Files:**
- Modify: `extensions/git-freshness-check.ts` — `Drift` type (approx. lines 20-27) and `checkFreshness()` (approx. lines 62-108).

**Interfaces:**
- Consumes: existing `git(args, cwd, timeoutMs)` helper.
- Produces: `Drift` gains `dirty: boolean`. `checkFreshness()` populates it. A derived helper `isSafeToSync(d: Drift): boolean` returns `d.behind > 0 && d.ahead === 0 && !d.dirty && !d.fetchFailed`.

- [ ] **Step 1: Add `dirty` to the `Drift` type**

```typescript
type Drift = {
  branch: string;
  upstream: string;
  behind: number;
  ahead: number;
  dirty: boolean;
  fetchFailed: boolean;
  fetchError?: string;
};
```

- [ ] **Step 2: Compute dirty state in `checkFreshness()` and include it in the returned object**

Add the status probe just before the `return` in `checkFreshness()` (after the ahead/behind counts are computed):

```typescript
  const statusRes = await git(["status", "--porcelain"], cwd);
  const dirty = statusRes.code === 0 && statusRes.stdout.length > 0;

  return {
    branch,
    upstream,
    behind,
    ahead,
    dirty,
    fetchFailed,
    fetchError: fetchFailed ? fetchRes.stderr.split("\n")[0] : undefined,
  };
```

- [ ] **Step 3: Add the `isSafeToSync` helper**

Place it next to `summarize()`:

```typescript
function isSafeToSync(d: Drift): boolean {
  return d.behind > 0 && d.ahead === 0 && !d.dirty && !d.fetchFailed;
}
```

- [ ] **Step 4: Sanity-check that the file still parses**

Run: `node -e "require('fs').readFileSync('extensions/git-freshness-check.ts','utf8')" && echo readable`
Expected: prints `readable` (no crash). Full type validity is confirmed by the manual session run in later tasks.

- [ ] **Step 5: Commit**

```bash
git add extensions/git-freshness-check.ts
git commit -m "git-freshness: detect dirty tree + isSafeToSync helper"
```

---

### Task 2: Silent fast-forward auto-pull in the safe case

**Files:**
- Modify: `extensions/git-freshness-check.ts` — the `session_start` handler (approx. lines 158-170) and add a `syncFastForward()` helper.

**Interfaces:**
- Consumes: `isSafeToSync(d)` from Task 1, `git()` helper, `FETCH_TIMEOUT_MS`, `WIDGET_KEY`, module-level `drift`/`injected`.
- Produces: `syncFastForward(cwd): Promise<{ ok: boolean; error?: string }>` runs `git pull --ff-only`. On success it mutates the in-memory `drift` to the post-sync state (`behind = 0`, `dirty` unchanged) so downstream injection logic treats the tree as fresh.

- [ ] **Step 1: Add the `syncFastForward` helper**

```typescript
async function syncFastForward(
  cwd: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await git(["pull", "--ff-only"], cwd, FETCH_TIMEOUT_MS);
  if (res.code === 0) return { ok: true };
  return { ok: false, error: res.stderr.split("\n")[0] || "pull failed" };
}
```

- [ ] **Step 2: In `session_start`, attempt the safe sync before notifying**

Replace the body of the `session_start` handler so it: probes, and if safe, pulls silently; on success shows a transient confirmation and skips the warning path; on failure falls through to the blocked path.

```typescript
  pi.on("session_start", async (_event, ctx) => {
    drift = null;
    injected = false;
    try {
      drift = await checkFreshness(ctx.cwd);
    } catch {
      drift = null;
    }
    if (!drift) return;

    if (isSafeToSync(drift)) {
      const synced = drift.behind;
      const res = await syncFastForward(ctx.cwd);
      if (res.ok) {
        drift = { ...drift, behind: 0, ahead: 0 };
        if (ctx.hasUI) {
          try {
            ctx.ui.notify(`✓ Synced ${synced} commit(s) from upstream`, "info");
            ctx.ui.setWidget(WIDGET_KEY, []);
          } catch {
            // best-effort
          }
        }
        return;
      }
      // Fall through: pull failed unexpectedly (e.g. upstream advanced past ff).
    }

    if (drift.behind > 0 || drift.fetchFailed) {
      notify(drift, ctx);
    }
  });
```

- [ ] **Step 3: Manual verification — safe case pulls silently**

Set up a scratch repo where local is a pure fast-forward behind its upstream:

```bash
tmp=$(mktemp -d); cd "$tmp"
git init -q remote.git --bare
git clone -q remote.git work && cd work
git commit -q --allow-empty -m c1 && git push -q origin HEAD:main
git branch -q -u origin/main 2>/dev/null || git push -q -u origin HEAD:main
# advance the remote by one commit, then rewind local so it is 1 behind, clean
git commit -q --allow-empty -m c2 && git push -q origin HEAD:main
git reset -q --hard HEAD~1
git rev-list --count HEAD..@{u}   # expect: 1
git status --porcelain            # expect: empty
```

Start a pi session in `$tmp/work` and confirm: the "✓ Synced 1 commit(s)…" notice appears, the widget shows no warning, and `git rev-list --count HEAD..@{u}` is now `0`. Restore your normal cwd afterward.

- [ ] **Step 4: Commit**

```bash
git add extensions/git-freshness-check.ts
git commit -m "git-freshness: silent ff-only auto-pull when provably safe"
```

---

### Task 3: Widget polish + per-case remediation messages

**Files:**
- Modify: `extensions/git-freshness-check.ts` — `summarize()` (approx. lines 111-124), `notify()` (approx. lines 126-146), and the `before_agent_start` injection (approx. lines 174-189).

**Interfaces:**
- Consumes: `Drift` (with `dirty`), `theme.fg` via the widget render-function form.
- Produces: `notify()` renders the tinted, suffix-free widget; `summarize()` returns case-specific remediation; injection carries the same remediation.

- [ ] **Step 1: Case-specific remediation in `summarize()`**

```typescript
function summarize(d: Drift): string {
  if (d.behind > 0 && d.dirty) {
    return `${d.branch} is ${d.behind} commit(s) behind ${d.upstream}, but the working tree has uncommitted changes. Commit or git stash, then git pull --ff-only.`;
  }
  if (d.behind > 0 && d.ahead > 0) {
    return `${d.branch} has diverged from ${d.upstream} (${d.behind} behind, ${d.ahead} ahead). Reconcile with git pull --rebase, or review before merging.`;
  }
  if (d.behind > 0) {
    return `${d.branch} is ${d.behind} commit(s) behind ${d.upstream}. Sync before trusting the tree: git pull --ff-only.`;
  }
  if (d.fetchFailed) {
    return `Could not fetch ${d.upstream} (freshness unverified): ${d.fetchError ?? "fetch failed"}. Check auth/network before trusting the tree.`;
  }
  return `${d.branch} is up to date with ${d.upstream}.`;
}
```

- [ ] **Step 2: Tinted, suffix-free widget in `notify()`**

Replace the widget lines. Use the render-function form so the tint follows the theme; drop the `— sync before trusting` suffix:

```typescript
function notify(d: Drift, ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  const msg = summarize(d);
  try {
    if (d.behind > 0) {
      ctx.ui.notify(`⚠ Stale tree: ${msg}`, "warning");
      ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => ({
        render: () => [theme.fg("warning", `⚠ ${d.behind} behind ${d.upstream}`)],
        invalidate: () => {},
      }));
    } else if (d.fetchFailed) {
      ctx.ui.notify(`⚠ ${msg}`, "warning");
      ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => ({
        render: () => [theme.fg("warning", `⚠ ${d.upstream}: fetch failed`)],
        invalidate: () => {},
      }));
    } else {
      ctx.ui.setWidget(WIDGET_KEY, []);
    }
  } catch {
    // best-effort
  }
}
```

- [ ] **Step 3: Carry the remediation into the agent injection**

In `before_agent_start`, the stale-tree branch already calls `summarize(drift)`, so it now inherits the case-specific text automatically. Confirm the branch reads:

```typescript
    const warning =
      drift.behind > 0
        ? `The local working tree is STALE: ${summarize(drift)} Do not trust file contents, reviews, or diffs from this checkout until it is synced.`
        : `Repo freshness is UNVERIFIED: ${summarize(drift)} Warn the user before relying on repo state.`;
```

- [ ] **Step 4: Manual verification — the three blocked cases**

Reuse the scratch repo from Task 2.

Dirty case: make the local tree dirty while behind, restart a pi session in the repo, confirm no pull happens, the widget shows `⚠ 1 behind origin/main` in yellow, and the agent's first turn is told to commit/stash first.

```bash
echo x >> file && git add file   # tree now dirty
git rev-list --count HEAD..@{u}   # still 1 behind
```

Diverged case: give local its own commit so it is both ahead and behind, restart the session, confirm the injection suggests `git pull --rebase` / review and no pull happens.

```bash
git stash -q 2>/dev/null; git commit -q --allow-empty -m local-only
git rev-list --count HEAD..@{u}   # behind >0
git rev-list --count @{u}..HEAD   # ahead >0
```

Fetch-failed case: point the remote at a dead URL, restart the session, confirm the "freshness unverified" widget/injection is intact.

```bash
git remote set-url origin /no/such/path
```

- [ ] **Step 5: Commit**

```bash
git add extensions/git-freshness-check.ts
git commit -m "git-freshness: per-case remediation + tinted suffix-free widget"
```

---

### Task 4: Final verification and push

**Files:**
- No code changes — housekeeping only.

- [ ] **Step 1: Re-read the full extension for stray dead code / stale comments**

Run: `cat extensions/git-freshness-check.ts`
Confirm: no reference to the removed `— sync before trusting` widget string, the module header comment still matches actual behavior (mentions the auto-pull), no leftover unused variables.

- [ ] **Step 2: Update the module header comment to reflect auto-pull**

The header comment block (top of file) currently describes warn-only behavior. Adjust the bullet about warning so it states the current behavior: provably-safe drift is auto-pulled with `--ff-only`; everything else surfaces with a case-specific next step. Keep it terse (why, not narration) per AGENTS.md.

- [ ] **Step 3: Verify a real up-to-date repo shows nothing**

Start a pi session in a repo you know is current; confirm no widget and no injected warning appear.

- [ ] **Step 4: Commit and push**

```bash
git add extensions/git-freshness-check.ts
git commit -m "git-freshness: refresh header comment for auto-sync behavior"
git push
```

---

## Self-Review

**Spec coverage:**
- Dirty-tree detection → Task 1. ✓
- Provably-safe silent ff-only pull → Task 2. ✓
- Safe-pull failure fallback to blocked path → Task 2, Step 2 (fall-through). ✓
- Per-case remediation (dirty / diverged / fetch-failed) → Task 3, Step 1 + injection Step 3. ✓
- Widget suffix removed + yellow tint → Task 3, Step 2. ✓
- Preserved edge cases (no worktree / detached / no upstream / `@{u}`) → unchanged code paths in `checkFreshness`, not modified. ✓
- Manual scratch-repo testing across states → Tasks 2-4. ✓
- Commit + push close-out → Task 4. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; every verification step has exact commands and expected values. ✓

**Type consistency:** `dirty: boolean` defined in Task 1 and consumed in `isSafeToSync`, `summarize`, `notify`. `isSafeToSync` / `syncFastForward` signatures match their call sites. Widget render-function form matches the `{ render, invalidate }` shape documented in tui.md. ✓
