import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";

/**
 * git-freshness-check — warn when the local branch is behind its upstream so
 * neither user nor agent trusts a stale tree.
 *
 * Non-obvious choices:
 * - Compares HEAD against its OWN upstream (@{u}), not origin/main, so feature
 *   branches legitimately behind main don't trigger it.
 * - Fetch runs with no credential prompt and a timeout; on failure it degrades
 *   to "freshness unverified" rather than hanging startup.
 * - Warning is injected into the first agent turn, not just shown in the widget.
 */

const FETCH_TIMEOUT_MS = 15_000;
const WIDGET_KEY = "git-freshness";

type Drift = {
  branch: string;
  upstream: string;
  behind: number;
  ahead: number;
  dirty: boolean;
  fetchFailed: boolean;
  fetchError?: string;
};

let drift: Drift | null = null;
let injected = false;

function git(
  args: string[],
  cwd: string,
  timeoutMs = 5_000,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      {
        cwd,
        timeout: timeoutMs,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_SSH_COMMAND: "ssh -o BatchMode=yes",
        },
      },
      (err, stdout, stderr) => {
        const code =
          err && typeof (err as { code?: unknown }).code === "number"
            ? (err as { code: number }).code
            : err
              ? 1
              : 0;
        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code });
      },
    );
  });
}

async function checkFreshness(cwd: string): Promise<Drift | null> {
  // Must be inside a work tree.
  const inTree = await git(["rev-parse", "--is-inside-work-tree"], cwd);
  if (inTree.code !== 0 || inTree.stdout !== "true") return null;

  // Current branch (skip if detached — no meaningful upstream).
  const branchRes = await git(["symbolic-ref", "--short", "-q", "HEAD"], cwd);
  const branch = branchRes.stdout;
  if (branchRes.code !== 0 || !branch) return null;

  // Upstream (e.g. "origin/main"). No upstream => nothing to compare against.
  const upRes = await git(
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    cwd,
  );
  const upstream = upRes.stdout;
  if (upRes.code !== 0 || !upstream || !upstream.includes("/")) return null;

  const remote = upstream.slice(0, upstream.indexOf("/"));
  const remoteBranch = upstream.slice(upstream.indexOf("/") + 1);

  // Fetch just this branch's remote ref. Non-fatal on failure.
  const fetchRes = await git(
    ["fetch", "--quiet", "--no-tags", remote, remoteBranch],
    cwd,
    FETCH_TIMEOUT_MS,
  );
  const fetchFailed = fetchRes.code !== 0;

  const behindRes = await git(["rev-list", "--count", "HEAD..@{u}"], cwd);
  const aheadRes = await git(["rev-list", "--count", "@{u}..HEAD"], cwd);
  const behind = Number.parseInt(behindRes.stdout || "0", 10) || 0;
  const ahead = Number.parseInt(aheadRes.stdout || "0", 10) || 0;

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
}

function isSafeToSync(d: Drift): boolean {
  return d.behind > 0 && d.ahead === 0 && !d.dirty && !d.fetchFailed;
}

async function syncFastForward(
  cwd: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await git(["pull", "--ff-only"], cwd, FETCH_TIMEOUT_MS);
  if (res.code === 0) return { ok: true };
  return { ok: false, error: res.stderr.split("\n")[0] || "pull failed" };
}

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

export default function (pi: ExtensionAPI) {
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

  // Make the AGENT itself aware on the first turn, so it refuses to act on a
  // stale tree rather than relying on the human to notice the widget.
  pi.on("before_agent_start", async (event, _ctx) => {
    if (injected || !drift) return;
    if (drift.behind === 0 && !drift.fetchFailed) return;
    injected = true;
    const warning =
      drift.behind > 0
        ? `The local working tree is STALE: ${summarize(drift)} Do not trust file contents, reviews, or diffs from this checkout until it is synced.`
        : `Repo freshness is UNVERIFIED: ${summarize(drift)} Warn the user before relying on repo state.`;
    return {
      systemPrompt: `${event.systemPrompt}\n\n[git-freshness-check] ${warning}`,
    };
  });
}
