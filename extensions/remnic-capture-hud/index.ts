// remnic-capture-hud — highlight in the TUI whenever Remnic captures a memory.
//
// Why a separate extension (not a patch to `extensions/remnic/`): the remnic
// extension dir is generated/vendored by `remnic connectors install pi`, so a
// remnic upgrade would clobber edits there. This companion is upgrade-safe.
//
// How it works (zero turn-path latency): Remnic's extraction runs asynchronously
// inside the local daemon, ~15-20s AFTER a turn, and writes each captured memory
// as a markdown file under the memory dir. We watch that dir recursively and
// surface new captures via a toast + a persistent widget. No polling of the model,
// no blocking of the turn — the OS filesystem event fires exactly when a memory
// lands, across every namespace (default + project namespaces under `namespaces/`).
//
// Config (all optional, env overrides):
//   REMNIC_MEMORY_DIR   memory dir to watch (default: read from
//                       ~/.config/remnic/config.json → remnic.memoryDir,
//                       else ~/.remnic/memory)
//   REMNIC_HUD_MAX_LIST widget rows to show (default 6)
//   REMNIC_HUD_CATEGORIES comma list to include (default the "interesting" set)

import { existsSync, readFileSync, statSync, watch as fsWatch, type FSWatcher } from "node:fs";
import { join, sep } from "node:path";
import { homedir } from "node:os";

const WIDGET_ID = "remnic-hud";
const MAX_LIST = Math.max(1, Number(process.env.REMNIC_HUD_MAX_LIST || 6));
const BATCH_MS = 1200; // coalesce the burst of files one extraction pass writes

// category-dir (plural, on disk) -> { label, icon }
const CATEGORY: Record<string, { label: string; icon: string }> = {
  decisions: { label: "decision", icon: "🧭" },
  facts: { label: "fact", icon: "📌" },
  questions: { label: "question", icon: "❓" },
  entities: { label: "entity", icon: "🔗" },
  corrections: { label: "correction", icon: "✏️" },
  preferences: { label: "preference", icon: "⭐" },
};

// Categories we surface by default. `artifacts` is skipped: Remnic dual-writes
// each decision as an artifact mirror, so including it would double every hit.
// summaries / reasoning-traces / transcripts / procedures / identity / state /
// profile are derived or internal churn, not discrete "captures".
const DEFAULT_INCLUDE = new Set(["decisions", "facts", "questions", "entities", "corrections", "preferences"]);
const INCLUDE = process.env.REMNIC_HUD_CATEGORIES
  ? new Set(process.env.REMNIC_HUD_CATEGORIES.split(",").map((s) => s.trim()).filter(Boolean))
  : DEFAULT_INCLUDE;

function resolveMemoryDir(): string {
  if (process.env.REMNIC_MEMORY_DIR) return process.env.REMNIC_MEMORY_DIR;
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), ".config", "remnic", "config.json"), "utf8"));
    const dir = cfg?.remnic?.memoryDir;
    if (typeof dir === "string" && dir) return dir;
  } catch {
    // fall through to default
  }
  return join(homedir(), ".remnic", "memory");
}

// Derive { categoryDir, namespace } from a memory-dir-relative path.
//   decisions/2026-07-08/id.md            -> { decisions, default }
//   namespaces/<ns>/decisions/.../id.md   -> { decisions, <ns> }
function classify(relPath: string): { categoryDir: string; namespace: string } | null {
  const parts = relPath.split(sep).filter(Boolean);
  if (parts.length < 2) return null;
  if (parts[0] === "namespaces") {
    if (parts.length < 4) return null;
    return { categoryDir: parts[2], namespace: parts[1] };
  }
  return { categoryDir: parts[0], namespace: "default" };
}

// Pull a short human preview out of a memory markdown file.
function previewOf(absPath: string, categoryDir: string): string {
  let text = "";
  try {
    text = readFileSync(absPath, "utf8");
  } catch {
    return "";
  }
  // strip leading YAML frontmatter (--- ... ---)
  let body = text;
  if (text.startsWith("---")) {
    const end = text.indexOf("\n---", 3);
    if (end !== -1) body = text.slice(end + 4);
  }
  // first meaningful body line
  const line =
    body
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith("[Attributes:") && !l.startsWith("**Context:**") && !l.startsWith("#")) || "";
  const clean = line.replace(/\s+/g, " ").trim();
  return clean.length > 72 ? clean.slice(0, 71) + "…" : clean;
}

type Captured = { icon: string; label: string; preview: string; ns: string };

export default function (pi: any): void {
  let watcher: FSWatcher | null = null;
  let ui: any = null;
  const seen = new Set<string>(); // absolute paths already surfaced
  const pending = new Set<string>(); // absolute paths awaiting the debounce flush
  const captured: Captured[] = []; // this session, newest first
  let batchTimer: ReturnType<typeof setTimeout> | null = null;

  function renderWidget(): void {
    if (!ui || captured.length === 0) return;
    const header = `🧠 Remnic — ${captured.length} captured this session`;
    const rows = captured.slice(0, MAX_LIST).map((c) => ` ${c.icon} [${c.label}] ${c.preview}`);
    try {
      ui.setWidget(WIDGET_ID, [header, ...rows]);
      ui.setStatus(WIDGET_ID, `🧠 remnic: ${captured.length}`);
    } catch {
      // UI teardown races — ignore
    }
  }

  function flushBatch(): void {
    batchTimer = null;
    const paths = [...pending];
    pending.clear();
    const fresh: Captured[] = [];
    for (const abs of paths) {
      if (seen.has(abs)) continue;
      if (!existsSync(abs)) continue; // moved/deleted before we read it
      // memory-dir-relative path for classification
      const rel = abs.startsWith(memoryDir) ? abs.slice(memoryDir.length).replace(/^[/\\]+/, "") : abs;
      const c = classify(rel);
      if (!c || !INCLUDE.has(c.categoryDir)) continue;
      const meta = CATEGORY[c.categoryDir] || { label: c.categoryDir.replace(/s$/, ""), icon: "•" };
      const preview = previewOf(abs, c.categoryDir);
      if (!preview) continue;
      seen.add(abs);
      fresh.push({ icon: meta.icon, label: meta.label, preview, ns: c.namespace });
    }
    if (fresh.length === 0) return;
    // newest first in the session list
    captured.unshift(...fresh.reverse());
    // toast: one line, summarized if the pass wrote several
    if (ui) {
      try {
        if (fresh.length === 1) {
          const f = fresh[0];
          const nsTag = f.ns !== "default" ? ` (${f.ns})` : "";
          ui.notify(`🧠 Remnic captured ${f.icon} [${f.label}]${nsTag}: ${f.preview}`, "info");
        } else {
          const counts = new Map<string, number>();
          for (const f of fresh) counts.set(f.label, (counts.get(f.label) || 0) + 1);
          const breakdown = [...counts].map(([k, n]) => `${n} ${k}${n > 1 ? "s" : ""}`).join(", ");
          ui.notify(`🧠 Remnic captured ${fresh.length} memories (${breakdown})`, "info");
        }
      } catch {
        // ignore UI races
      }
    }
    renderWidget();
  }

  function onEvent(_ev: string, filename: string | null): void {
    if (!filename || !filename.endsWith(".md")) return;
    if (filename.includes(`${sep}state${sep}`) || filename.startsWith(`state${sep}`)) return;
    const abs = join(memoryDir, filename);
    if (seen.has(abs)) return;
    // Only care about files that currently exist (creation/write, not deletion).
    try {
      if (!statSync(abs).isFile()) return;
    } catch {
      return;
    }
    pending.add(abs);
    if (batchTimer) clearTimeout(batchTimer);
    batchTimer = setTimeout(flushBatch, BATCH_MS);
    if (typeof (batchTimer as any)?.unref === "function") (batchTimer as any).unref();
  }

  let memoryDir = resolveMemoryDir();

  function start(ctx: any): void {
    stop(); // idempotent: handles reload/resume cleanly
    if (!ctx?.hasUI) return; // print/json mode — nothing to highlight
    ui = ctx.ui;
    memoryDir = resolveMemoryDir();
    if (!existsSync(memoryDir)) return; // remnic not set up here — stay silent
    try {
      // Recursive watch: fires only for changes AFTER this point, so existing
      // memories are never mis-announced as fresh captures (no baseline needed).
      watcher = fsWatch(memoryDir, { recursive: true }, onEvent);
    } catch {
      watcher = null; // watch unsupported — degrade silently
    }
  }

  function stop(): void {
    if (batchTimer) {
      clearTimeout(batchTimer);
      batchTimer = null;
    }
    if (watcher) {
      try {
        watcher.close();
      } catch {
        // ignore
      }
      watcher = null;
    }
    pending.clear();
    // keep `captured`/`seen` only for the life of a session; reset on (re)start
    seen.clear();
    captured.length = 0;
    ui = null;
  }

  pi.on("session_start", async (_event: any, ctx: any) => {
    start(ctx);
  });
  pi.on("session_shutdown", async () => {
    stop();
  });
}
