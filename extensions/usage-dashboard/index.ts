import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { aggregateUsage, cacheRequestRate, cacheTokenShare } from "./aggregate.ts";
import { renderReport } from "./render.ts";

const DEFAULT_WINDOW_DAYS = 30;
const WINDOW_SUGGESTIONS = ["7", "14", "30", "90", "all"];

function parseWindow(args: string): number | "all" | undefined {
  const arg = args.trim().toLowerCase();
  if (arg === "") return DEFAULT_WINDOW_DAYS;
  if (arg === "all") return "all";
  const days = Number(arg);
  if (!Number.isInteger(days) || days < 1) return undefined;
  return days;
}

// getSessionDir() returns the per-cwd subdirectory (sessions/--path--) and is ""
// for --no-session, so the dashboard scans the sessions root instead. A custom
// --session-dir root is added as a second candidate; entry dedupe absorbs overlap.
function sessionRoots(currentSessionDir: string | undefined): string[] {
  const roots = [join(getAgentDir(), "sessions")];
  if (currentSessionDir) roots.push(dirname(currentSessionDir));
  return [...new Set(roots)].filter((dir) => existsSync(dir));
}

function openCommand(): { command: string; args: string[] } {
  if (process.platform === "darwin") return { command: "open", args: [] };
  if (process.platform === "win32") return { command: "cmd", args: ["/c", "start", ""] };
  return { command: "xdg-open", args: [] };
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("usage", {
    description: "Token, cost and cache usage dashboard across all sessions (HTML)",
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const items = WINDOW_SUGGESTIONS.filter((value) => value.startsWith(prefix.trim())).map((value) => ({
        value,
        label: value === "all" ? "all history" : `last ${value} days`,
      }));
      return items.length > 0 ? items : null;
    },
    handler: async (args, ctx) => {
      const window = parseWindow(args ?? "");
      if (window === undefined) {
        ctx.ui.notify("Usage: /usage [days|all], for example /usage 90", "warning");
        return;
      }

      const roots = sessionRoots(ctx.sessionManager?.getSessionDir?.());
      if (roots.length === 0) {
        ctx.ui.notify("No session directory found to scan", "warning");
        return;
      }
      let report: ReturnType<typeof aggregateUsage>;
      try {
        report = aggregateUsage(roots, window);
      } catch (error) {
        ctx.ui.notify(`Usage scan failed: ${error instanceof Error ? error.message : String(error)}`, "error");
        return;
      }

      if (report.days.length === 0) {
        ctx.ui.notify(`No usage found in ${window === "all" ? "session history" : `the last ${window} days`}`, "warning");
        return;
      }

      const stamp = new Date().toISOString().slice(0, 10);
      const file = join(tmpdir(), `pi-usage-${window === "all" ? "all" : `${window}d`}-${stamp}.html`);
      try {
        writeFileSync(file, renderReport(report), "utf8");
      } catch (error) {
        ctx.ui.notify(`Could not write report: ${error instanceof Error ? error.message : String(error)}`, "error");
        return;
      }

      const { command, args: openArgs } = openCommand();
      const result = await pi.exec(command, [...openArgs, file], { timeout: 10000 });

      const totals = report.totals;
      const summary = [
        `${(totals.totalTokens / 1e6).toFixed(1)}M tokens`,
        `$${totals.cost.toFixed(2)}`,
        `cache ${(cacheTokenShare(totals) * 100).toFixed(1)}% tokens / ${(cacheRequestRate(totals) * 100).toFixed(1)}% requests`,
        `${report.days.length} days`,
      ].join(" · ");

      if (result.code === 0) {
        ctx.ui.notify(`${summary} — opened ${file}`, "info");
      } else {
        ctx.ui.notify(`${summary} — report at ${file} (could not open browser: ${result.stderr.trim()})`, "warning");
      }
    },
  });
}
