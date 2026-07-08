import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";

/**
 * git-freshness-check
 *
 * Sync-before-trust guardrail. On session start it fetches the current branch's
 * upstream and, if the local branch is behind, warns loudly — so neither the
 * user nor the agent acts on a stale working tree (the "main was 59 commits
 * behind" failure mode).
 *
 * Design notes:
 * - Compares HEAD against its OWN upstream (@{u}), not against origin/main.
 *   That precisely catches "local main behind origin/main" without firing on
 *   feature branches that are legitimately behind main.
 * - Never prompts for credentials (GIT_TERMINAL_PROMPT=0, SSH BatchMode) and
 *   bounds the fetch with a timeout, so a private/unauthenticated repo degrades
 *   to a "freshness unverified" warning instead of hanging startup.
 * - Injects the warning into the first agent turn so the model itself refuses
 *   to trust the tree, not just the human.
 */

const FETCH_TIMEOUT_MS = 15_000;
const WIDGET_KEY = "git-freshness";

type Drift = {
  branch: string;
  upstream: string;
  behind: number;
  ahead: number;
  fetchFailed: boolean;
  fetchError?: string;
};

// Session-scoped state.
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

  return {
    branch,
    upstream,
    behind,
    ahead,
    fetchFailed,
    fetchError: fetchFailed ? fetchRes.stderr.split("\n")[0] : undefined,
  };
}

function summarize(d: Drift): string {
  if (d.behind > 0) {
    const aheadNote = d.ahead > 0 ? ` (and ${d.ahead} ahead — diverged)` : "";
    return `${d.branch} is ${d.behind} commit(s) behind ${d.upstream}${aheadNote}. Sync before trusting the tree: git pull --ff-only (or rebase).`;
  }
  if (d.fetchFailed) {
    return `Could not fetch ${d.upstream} (freshness unverified): ${d.fetchError ?? "fetch failed"}. Check auth before trusting the tree.`;
  }
  return `${d.branch} is up to date with ${d.upstream}.`;
}

function notify(d: Drift, ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  const msg = summarize(d);
  try {
    if (d.behind > 0) {
      ctx.ui.notify(`⚠ Stale tree: ${msg}`, "warning");
      ctx.ui.setWidget(WIDGET_KEY, [`⚠ ${d.behind} behind ${d.upstream} — sync before trusting`]);
    } else if (d.fetchFailed) {
      ctx.ui.notify(`⚠ ${msg}`, "warning");
      ctx.ui.setWidget(WIDGET_KEY, [`⚠ ${d.upstream}: fetch failed — freshness unverified`]);
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
    if (drift && (drift.behind > 0 || drift.fetchFailed)) {
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
        ? `The local working tree is STALE: ${summarize(drift)} Do not trust file contents, reviews, or diffs from this checkout until it is synced. If your task depends on repo state, sync first (git pull --ff-only) or tell the user.`
        : `Repo freshness is UNVERIFIED: ${summarize(drift)} Warn the user before relying on repo state.`;
    return {
      systemPrompt: `${event.systemPrompt}\n\n[git-freshness-check] ${warning}`,
    };
  });
}
