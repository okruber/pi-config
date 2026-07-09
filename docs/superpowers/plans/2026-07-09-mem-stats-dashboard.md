# /mem-stats Memory Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, browser-based, rating-only dashboard (launched from pi via `/mem-stats`) to browse, monitor, and rate captured Remnic memories during the Phase-1 trial.

**Architecture:** A companion pi extension (`extensions/remnic-mem-stats/`) registers a `/mem-stats` command that boots a loopback-only, key-gated Node `http` server. The server reads memory markdown files + the daemon health endpoint (never mutating the store) and serves a single-page app (Layout A: overview strip + two-pane browse). The only write target is a local ratings JSONL file.

**Tech Stack:** TypeScript (loaded by pi via jiti; run under Node ≥ 22 with native type-stripping), Node built-in `http`/`fs`/`child_process` (zero runtime deps), vanilla HTML/CSS/JS frontend (no build step), Node built-in test runner (`node --test`).

## Global Constraints

- **Rating-only:** the dashboard MUST NOT mutate the memory store. The only write target is `~/.remnic/mem-stats/ratings.jsonl`.
- **Loopback + key-gated:** server binds `127.0.0.1` on an ephemeral port; every HTTP request must present the session key (query `?key=` or cookie) or get `403`.
- **No secrets in the repo:** the daemon auth token is read at runtime from `~/.config/remnic/config.json`; never embedded, logged, or committed.
- **No runtime dependencies:** use only Node built-ins. No npm packages added to the extension.
- **Namespace-aware:** default namespace at `‹cat›/‹date›/‹id›.md`; project namespaces at `namespaces/‹ns›/‹cat›/‹date›/‹id›.md`.
- **Upgrade-safe placement:** all files live under `extensions/remnic-mem-stats/`, separate from the vendored `extensions/remnic/`.
- **Memory dir resolution order:** env `REMNIC_MEMORY_DIR` → `~/.config/remnic/config.json → remnic.memoryDir` → `~/.remnic/memory`.
- **Ratings path:** env `REMNIC_MEMSTATS_RATINGS` → `~/.remnic/mem-stats/ratings.jsonl`.
- **Test command:** `node --test extensions/remnic-mem-stats/<file>.test.ts` (run from repo root `~/Documents/Personal/pi-config`).

---

### Task 1: Config resolution helpers

**Files:**
- Create: `extensions/remnic-mem-stats/config.ts`
- Test: `extensions/remnic-mem-stats/config.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `resolveMemoryDir(env?: NodeJS.ProcessEnv, configPath?: string): string`
  - `resolveDaemon(env?: NodeJS.ProcessEnv, configPath?: string): { url: string; token: string }`
  - `resolveRatingsPath(env?: NodeJS.ProcessEnv): string`
  - `readJsonSafe(path: string): any | null`

- [ ] **Step 1: Write the failing test**

```ts
// extensions/remnic-mem-stats/config.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveMemoryDir, resolveDaemon, resolveRatingsPath, readJsonSafe } from "./config.ts";

test("resolveMemoryDir prefers env override", () => {
  assert.equal(resolveMemoryDir({ REMNIC_MEMORY_DIR: "/x/mem" }, "/nope.json"), "/x/mem");
});

test("resolveMemoryDir reads remnic.memoryDir from config", () => {
  const dir = mkdtempSync(join(tmpdir(), "cfg-"));
  const cfg = join(dir, "config.json");
  writeFileSync(cfg, JSON.stringify({ remnic: { memoryDir: "/from/config" } }));
  assert.equal(resolveMemoryDir({}, cfg), "/from/config");
  rmSync(dir, { recursive: true, force: true });
});

test("resolveMemoryDir falls back to ~/.remnic/memory", () => {
  const r = resolveMemoryDir({ HOME: "/home/olle" }, "/missing.json");
  assert.equal(r, "/home/olle/.remnic/memory");
});

test("resolveDaemon reads server.authToken and defaults url", () => {
  const dir = mkdtempSync(join(tmpdir(), "cfg-"));
  const cfg = join(dir, "config.json");
  writeFileSync(cfg, JSON.stringify({ server: { authToken: "tok123" } }));
  const d = resolveDaemon({}, cfg);
  assert.equal(d.token, "tok123");
  assert.equal(d.url, "http://127.0.0.1:4318");
  rmSync(dir, { recursive: true, force: true });
});

test("resolveRatingsPath uses env override then HOME default", () => {
  assert.equal(resolveRatingsPath({ REMNIC_MEMSTATS_RATINGS: "/r.jsonl" }), "/r.jsonl");
  assert.equal(resolveRatingsPath({ HOME: "/home/olle" }), "/home/olle/.remnic/mem-stats/ratings.jsonl");
});

test("readJsonSafe returns null on missing/invalid", () => {
  assert.equal(readJsonSafe("/definitely/missing.json"), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test extensions/remnic-mem-stats/config.test.ts`
Expected: FAIL — cannot find module `./config.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// extensions/remnic-mem-stats/config.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export function readJsonSafe(path: string): any | null {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function home(env: NodeJS.ProcessEnv): string {
  return env.HOME || env.USERPROFILE || homedir();
}

function defaultConfigPath(env: NodeJS.ProcessEnv): string {
  return env.REMNIC_CONFIG_PATH || join(home(env), ".config", "remnic", "config.json");
}

export function resolveMemoryDir(env: NodeJS.ProcessEnv = process.env, configPath?: string): string {
  if (env.REMNIC_MEMORY_DIR) return env.REMNIC_MEMORY_DIR;
  const cfg = readJsonSafe(configPath ?? defaultConfigPath(env));
  const fromCfg = cfg?.remnic?.memoryDir;
  if (typeof fromCfg === "string" && fromCfg) return fromCfg;
  return join(home(env), ".remnic", "memory");
}

export function resolveDaemon(
  env: NodeJS.ProcessEnv = process.env,
  configPath?: string,
): { url: string; token: string } {
  const cfg = readJsonSafe(configPath ?? defaultConfigPath(env));
  const url = (env.REMNIC_DAEMON_URL || cfg?.server?.url || "http://127.0.0.1:4318").replace(/\/$/, "");
  const token = env.REMNIC_PI_AUTH_TOKEN || cfg?.server?.authToken || "";
  return { url, token };
}

export function resolveRatingsPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.REMNIC_MEMSTATS_RATINGS) return env.REMNIC_MEMSTATS_RATINGS;
  return join(home(env), ".remnic", "mem-stats", "ratings.jsonl");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test extensions/remnic-mem-stats/config.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add extensions/remnic-mem-stats/config.ts extensions/remnic-mem-stats/config.test.ts
git commit -m "feat(mem-stats): config/path resolution helpers"
```

---

### Task 2: Memory scanning + frontmatter parsing

**Files:**
- Create: `extensions/remnic-mem-stats/data.ts`
- Test: `extensions/remnic-mem-stats/data.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (all exported from `data.ts`):
  - `type Verdict = "good" | "junk" | "miscategorized"`
  - `interface MemoryRecord { id: string; category: string; namespace: string; created: string; updated: string; tags: string[]; confidence: number | null; status: string | null; lifecycleState: string | null; path: string; preview: string }`
  - `parseFrontmatter(text: string): { fm: Record<string, any>; body: string }`
  - `classifyPath(relPath: string): { categoryDir: string; namespace: string } | null`
  - `parseMemoryFile(absPath: string, memoryDir: string): MemoryRecord | null`
  - `scanMemories(memoryDir: string): MemoryRecord[]`
  - `readMemoryBody(absPath: string): string`
  - `dirSizeBytes(memoryDir: string): number` (total bytes of all `.md` memory files)
  - `const CATEGORY_DIRS: string[]` (plural dir names treated as memories)

- [ ] **Step 1: Write the failing test**

```ts
// extensions/remnic-mem-stats/data.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFrontmatter, classifyPath, parseMemoryFile, scanMemories } from "./data.ts";

function fixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  mkdirSync(join(dir, "decisions", "2026-07-08"), { recursive: true });
  writeFileSync(
    join(dir, "decisions", "2026-07-08", "d1.md"),
    `---\nid: d1\ncategory: decision\ncreated: 2026-07-08T10:00:00.000Z\nupdated: 2026-07-08T10:00:00.000Z\nconfidence: 0.95\nstatus: active\ntags: [trial, remnic]\n---\n\nInitiating a two-week trial of remnic.\n[Attributes: x: y]\n`,
  );
  mkdirSync(join(dir, "namespaces", "proj", "facts", "2026-07-09"), { recursive: true });
  writeFileSync(
    join(dir, "namespaces", "proj", "facts", "2026-07-09", "f1.md"),
    `---\nid: f1\ncategory: fact\ncreated: 2026-07-09T09:00:00.000Z\n---\n\nqmd needs local GGUF models.\n`,
  );
  // noise that must be skipped
  mkdirSync(join(dir, "state"), { recursive: true });
  writeFileSync(join(dir, "state", "meta.md"), "not a memory");
  writeFileSync(join(dir, "profile.md"), "profile");
  return dir;
}

test("parseFrontmatter splits fm and body, parses inline array", () => {
  const { fm, body } = parseFrontmatter("---\nid: a\ntags: [x, y]\n---\n\nhello\n");
  assert.equal(fm.id, "a");
  assert.deepEqual(fm.tags, ["x", "y"]);
  assert.equal(body.trim(), "hello");
});

test("classifyPath handles default and namespaced paths", () => {
  assert.deepEqual(classifyPath(join("decisions", "2026-07-08", "d1.md")), { categoryDir: "decisions", namespace: "default" });
  assert.deepEqual(classifyPath(join("namespaces", "proj", "facts", "2026-07-09", "f1.md")), { categoryDir: "facts", namespace: "proj" });
  assert.equal(classifyPath(join("state", "meta.md")), null);
});

test("parseMemoryFile extracts fields + clean preview", () => {
  const dir = fixtureDir();
  const rec = parseMemoryFile(join(dir, "decisions", "2026-07-08", "d1.md"), dir);
  assert.ok(rec);
  assert.equal(rec!.id, "d1");
  assert.equal(rec!.category, "decision");
  assert.equal(rec!.namespace, "default");
  assert.equal(rec!.confidence, 0.95);
  assert.deepEqual(rec!.tags, ["trial", "remnic"]);
  assert.equal(rec!.preview, "Initiating a two-week trial of remnic.");
  rmSync(dir, { recursive: true, force: true });
});

test("scanMemories finds memories across namespaces, skips state/profile", () => {
  const dir = fixtureDir();
  const recs = scanMemories(dir);
  const ids = recs.map((r) => r.id).sort();
  assert.deepEqual(ids, ["d1", "f1"]);
  const f1 = recs.find((r) => r.id === "f1")!;
  assert.equal(f1.namespace, "proj");
  assert.equal(f1.category, "fact");
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test extensions/remnic-mem-stats/data.test.ts`
Expected: FAIL — cannot find module `./data.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// extensions/remnic-mem-stats/data.ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";

export type Verdict = "good" | "junk" | "miscategorized";

export interface MemoryRecord {
  id: string;
  category: string;
  namespace: string;
  created: string;
  updated: string;
  tags: string[];
  confidence: number | null;
  status: string | null;
  lifecycleState: string | null;
  path: string;
  preview: string;
}

// Plural on-disk category dirs treated as discrete memories.
export const CATEGORY_DIRS = [
  "decisions", "facts", "questions", "entities", "corrections",
  "preferences", "principles", "rules", "commitments", "artifacts", "procedures",
];

const SKIP_DIRS = new Set(["state", ".registry", "config", "identity", "summaries", "reasoning-traces", "transcripts", "checkpoints"]);

export function parseFrontmatter(text: string): { fm: Record<string, any>; body: string } {
  const fm: Record<string, any> = {};
  let body = text;
  if (text.startsWith("---")) {
    const end = text.indexOf("\n---", 3);
    if (end !== -1) {
      const block = text.slice(3, end);
      body = text.slice(end + 4);
      let lastKey: string | null = null;
      for (const raw of block.split(/\r?\n/)) {
        const line = raw.replace(/\r$/, "");
        const listItem = line.match(/^\s*-\s+(.*)$/);
        if (listItem && lastKey) {
          if (!Array.isArray(fm[lastKey])) fm[lastKey] = [];
          fm[lastKey].push(stripQuotes(listItem[1].trim()));
          continue;
        }
        const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
        if (!m) continue;
        const key = m[1];
        const val = m[2].trim();
        lastKey = key;
        if (val === "") { fm[key] = fm[key] ?? []; continue; }
        if (val.startsWith("[") && val.endsWith("]")) {
          fm[key] = val.slice(1, -1).split(",").map((s) => stripQuotes(s.trim())).filter(Boolean);
        } else {
          fm[key] = stripQuotes(val);
        }
      }
    }
  }
  return { fm, body };
}

function stripQuotes(s: string): string {
  return s.replace(/^["']|["']$/g, "");
}

export function classifyPath(relPath: string): { categoryDir: string; namespace: string } | null {
  const parts = relPath.split(sep).filter(Boolean);
  if (parts.length < 2) return null;
  let categoryDir: string;
  let namespace: string;
  if (parts[0] === "namespaces") {
    if (parts.length < 4) return null;
    namespace = parts[1];
    categoryDir = parts[2];
  } else {
    namespace = "default";
    categoryDir = parts[0];
  }
  if (SKIP_DIRS.has(categoryDir)) return null;
  if (!CATEGORY_DIRS.includes(categoryDir)) return null;
  return { categoryDir, namespace };
}

function singular(categoryDir: string): string {
  return categoryDir.replace(/s$/, "");
}

function cleanPreview(body: string): string {
  const line = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("[Attributes:") && !l.startsWith("**Context:**") && !l.startsWith("#")) || "";
  return line.replace(/\s+/g, " ").trim();
}

export function parseMemoryFile(absPath: string, memoryDir: string): MemoryRecord | null {
  const rel = absPath.startsWith(memoryDir) ? absPath.slice(memoryDir.length).replace(/^[/\\]+/, "") : absPath;
  const cls = classifyPath(rel);
  if (!cls) return null;
  let text: string;
  try {
    text = readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
  const { fm, body } = parseFrontmatter(text);
  const conf = fm.confidence != null && fm.confidence !== "" ? Number(fm.confidence) : null;
  return {
    id: String(fm.id || rel),
    category: typeof fm.category === "string" && fm.category ? fm.category : singular(cls.categoryDir),
    namespace: cls.namespace,
    created: String(fm.created || ""),
    updated: String(fm.updated || fm.created || ""),
    tags: Array.isArray(fm.tags) ? fm.tags : [],
    confidence: Number.isFinite(conf as number) ? (conf as number) : null,
    status: fm.status ? String(fm.status) : null,
    lifecycleState: fm.lifecycleState ? String(fm.lifecycleState) : (fm.lifecycle_state ? String(fm.lifecycle_state) : null),
    path: absPath,
    preview: cleanPreview(body),
  };
}

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) out.push(...walk(full));
    else if (name.endsWith(".md")) out.push(full);
  }
  return out;
}

export function scanMemories(memoryDir: string): MemoryRecord[] {
  const out: MemoryRecord[] = [];
  for (const file of walk(memoryDir)) {
    const rec = parseMemoryFile(file, memoryDir);
    if (rec) out.push(rec);
  }
  return out;
}

export function readMemoryBody(absPath: string): string {
  try {
    return parseFrontmatter(readFileSync(absPath, "utf8")).body.trim();
  } catch {
    return "";
  }
}

export function dirSizeBytes(memoryDir: string): number {
  let total = 0;
  for (const file of walk(memoryDir)) {
    try { total += statSync(file).size; } catch { /* skip */ }
  }
  return total;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test extensions/remnic-mem-stats/data.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add extensions/remnic-mem-stats/data.ts extensions/remnic-mem-stats/data.test.ts
git commit -m "feat(mem-stats): memory scan + frontmatter parsing"
```

---

### Task 3: Stats aggregation

**Files:**
- Modify: `extensions/remnic-mem-stats/data.ts` (append)
- Test: `extensions/remnic-mem-stats/stats.test.ts`

**Interfaces:**
- Consumes: `MemoryRecord` from Task 2.
- Produces:
  - `interface Stats { total: number; byCategory: Record<string, number>; byNamespace: Record<string, number>; byDay: { day: string; count: number }[]; last24h: number; lastCaptureAt: string | null; categories: number; namespaces: number }`
  - `aggregateStats(records: MemoryRecord[], now?: number): Stats`

- [ ] **Step 1: Write the failing test**

```ts
// extensions/remnic-mem-stats/stats.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateStats } from "./data.ts";
import type { MemoryRecord } from "./data.ts";

function rec(over: Partial<MemoryRecord>): MemoryRecord {
  return {
    id: "x", category: "fact", namespace: "default", created: "2026-07-09T00:00:00.000Z",
    updated: "2026-07-09T00:00:00.000Z", tags: [], confidence: null, status: null,
    lifecycleState: null, path: "/x", preview: "", ...over,
  };
}

test("aggregateStats counts totals, categories, namespaces, day buckets, last24h", () => {
  const now = Date.parse("2026-07-09T12:00:00.000Z");
  const recs = [
    rec({ id: "a", category: "decision", created: "2026-07-09T11:00:00.000Z" }),
    rec({ id: "b", category: "fact", namespace: "proj", created: "2026-07-09T01:00:00.000Z" }),
    rec({ id: "c", category: "fact", created: "2026-07-07T10:00:00.000Z" }),
  ];
  const s = aggregateStats(recs, now);
  assert.equal(s.total, 3);
  assert.equal(s.categories, 2);
  assert.equal(s.namespaces, 2);
  assert.equal(s.byCategory.fact, 2);
  assert.equal(s.byNamespace.proj, 1);
  assert.equal(s.last24h, 2);
  assert.equal(s.lastCaptureAt, "2026-07-09T11:00:00.000Z");
  assert.equal(s.byDay.find((d) => d.day === "2026-07-09")!.count, 2);
});

test("aggregateStats handles empty store", () => {
  const s = aggregateStats([], Date.parse("2026-07-09T12:00:00.000Z"));
  assert.equal(s.total, 0);
  assert.equal(s.lastCaptureAt, null);
  assert.deepEqual(s.byCategory, {});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test extensions/remnic-mem-stats/stats.test.ts`
Expected: FAIL — `aggregateStats` is not exported.

- [ ] **Step 3: Write minimal implementation (append to `data.ts`)**

```ts
// --- append to extensions/remnic-mem-stats/data.ts ---
export interface Stats {
  total: number;
  byCategory: Record<string, number>;
  byNamespace: Record<string, number>;
  byDay: { day: string; count: number }[];
  last24h: number;
  lastCaptureAt: string | null;
  categories: number;
  namespaces: number;
}

export function aggregateStats(records: MemoryRecord[], now: number = Date.now()): Stats {
  const byCategory: Record<string, number> = {};
  const byNamespace: Record<string, number> = {};
  const dayMap = new Map<string, number>();
  let last24h = 0;
  let lastCaptureAt: string | null = null;
  let lastMs = -Infinity;
  const cutoff = now - 24 * 60 * 60 * 1000;

  for (const r of records) {
    byCategory[r.category] = (byCategory[r.category] || 0) + 1;
    byNamespace[r.namespace] = (byNamespace[r.namespace] || 0) + 1;
    const ms = Date.parse(r.created);
    if (Number.isFinite(ms)) {
      const day = r.created.slice(0, 10);
      dayMap.set(day, (dayMap.get(day) || 0) + 1);
      if (ms >= cutoff && ms <= now) last24h++;
      if (ms > lastMs) { lastMs = ms; lastCaptureAt = r.created; }
    }
  }
  const byDay = [...dayMap.entries()].map(([day, count]) => ({ day, count })).sort((a, b) => a.day.localeCompare(b.day));
  return {
    total: records.length,
    byCategory,
    byNamespace,
    byDay,
    last24h,
    lastCaptureAt,
    categories: Object.keys(byCategory).length,
    namespaces: Object.keys(byNamespace).length,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test extensions/remnic-mem-stats/stats.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add extensions/remnic-mem-stats/data.ts extensions/remnic-mem-stats/stats.test.ts
git commit -m "feat(mem-stats): stats aggregation"
```

---

### Task 4: Ratings read/append + accuracy summary

**Files:**
- Modify: `extensions/remnic-mem-stats/data.ts` (append)
- Test: `extensions/remnic-mem-stats/ratings.test.ts`

**Interfaces:**
- Consumes: `MemoryRecord`, `Verdict` from Task 2.
- Produces:
  - `interface RatingRecord { memoryId: string; verdict: Verdict; note: string; ts: string; category: string; namespace: string }`
  - `readRatings(ratingsPath: string): Map<string, RatingRecord>` (latest-wins per memoryId)
  - `appendRating(ratingsPath: string, rec: RatingRecord): void`
  - `accuracySummary(records: MemoryRecord[], ratings: Map<string, RatingRecord>): string`

- [ ] **Step 1: Write the failing test**

```ts
// extensions/remnic-mem-stats/ratings.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRatings, appendRating, accuracySummary } from "./data.ts";
import type { MemoryRecord, RatingRecord } from "./data.ts";

function tmpRatings(): string {
  return join(mkdtempSync(join(tmpdir(), "rate-")), "sub", "ratings.jsonl");
}
function rec(over: Partial<MemoryRecord>): MemoryRecord {
  return { id: "x", category: "fact", namespace: "default", created: "", updated: "", tags: [], confidence: null, status: null, lifecycleState: null, path: "/x", preview: "", ...over };
}

test("appendRating creates dirs and readRatings returns latest-wins", () => {
  const p = tmpRatings();
  appendRating(p, { memoryId: "m1", verdict: "junk", note: "", ts: "2026-07-09T10:00:00Z", category: "fact", namespace: "default" });
  appendRating(p, { memoryId: "m1", verdict: "good", note: "changed mind", ts: "2026-07-09T11:00:00Z", category: "fact", namespace: "default" });
  appendRating(p, { memoryId: "m2", verdict: "miscategorized", note: "", ts: "2026-07-09T10:30:00Z", category: "decision", namespace: "proj" });
  const map = readRatings(p);
  assert.equal(map.get("m1")!.verdict, "good");
  assert.equal(map.get("m1")!.note, "changed mind");
  assert.equal(map.get("m2")!.verdict, "miscategorized");
  assert.ok(readFileSync(p, "utf8").trim().split("\n").length === 3);
  rmSync(join(p, "..", ".."), { recursive: true, force: true });
});

test("readRatings on missing file returns empty map", () => {
  assert.equal(readRatings("/missing/ratings.jsonl").size, 0);
});

test("accuracySummary reports totals and per-category rates", () => {
  const recs = [rec({ id: "m1", category: "fact" }), rec({ id: "m2", category: "decision" }), rec({ id: "m3", category: "fact" })];
  const ratings = new Map<string, RatingRecord>([
    ["m1", { memoryId: "m1", verdict: "good", note: "", ts: "", category: "fact", namespace: "default" }],
    ["m2", { memoryId: "m2", verdict: "junk", note: "", ts: "", category: "decision", namespace: "default" }],
  ]);
  const md = accuracySummary(recs, ratings);
  assert.match(md, /Rated:\s*2\s*\/\s*3/);
  assert.match(md, /good/i);
  assert.match(md, /junk/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test extensions/remnic-mem-stats/ratings.test.ts`
Expected: FAIL — exports not defined.

- [ ] **Step 3: Write minimal implementation (append to `data.ts`)**

```ts
// --- append to extensions/remnic-mem-stats/data.ts ---
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface RatingRecord {
  memoryId: string;
  verdict: Verdict;
  note: string;
  ts: string;
  category: string;
  namespace: string;
}

export function readRatings(ratingsPath: string): Map<string, RatingRecord> {
  const map = new Map<string, RatingRecord>();
  let text: string;
  try {
    text = readFileSync(ratingsPath, "utf8");
  } catch {
    return map;
  }
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      const rec = JSON.parse(t) as RatingRecord;
      if (rec && rec.memoryId) map.set(rec.memoryId, rec); // later lines overwrite → latest-wins
    } catch {
      // skip malformed line
    }
  }
  return map;
}

export function appendRating(ratingsPath: string, rec: RatingRecord): void {
  mkdirSync(dirname(ratingsPath), { recursive: true });
  appendFileSync(ratingsPath, JSON.stringify(rec) + "\n", "utf8");
}

export function accuracySummary(records: MemoryRecord[], ratings: Map<string, RatingRecord>): string {
  const total = records.length;
  const rated = ratings.size;
  const counts: Record<Verdict, number> = { good: 0, junk: 0, miscategorized: 0 };
  const byCat: Record<string, Record<Verdict, number>> = {};
  for (const r of records) {
    const v = ratings.get(r.id)?.verdict;
    if (!v) continue;
    counts[v]++;
    (byCat[r.category] ??= { good: 0, junk: 0, miscategorized: 0 })[v]++;
  }
  const pct = (n: number) => (rated ? Math.round((n / rated) * 100) : 0);
  const lines: string[] = [];
  lines.push(`## Remnic capture-accuracy rollup (${new Date().toISOString().slice(0, 10)})`);
  lines.push("");
  lines.push(`- Rated: ${rated} / ${total} memories`);
  lines.push(`- 👍 good: ${counts.good} (${pct(counts.good)}%)`);
  lines.push(`- 👎 junk: ${counts.junk} (${pct(counts.junk)}%)`);
  lines.push(`- ⚠ miscategorized: ${counts.miscategorized} (${pct(counts.miscategorized)}%)`);
  lines.push("");
  lines.push("| Category | good | junk | miscat |");
  lines.push("| --- | --- | --- | --- |");
  for (const cat of Object.keys(byCat).sort()) {
    const c = byCat[cat];
    lines.push(`| ${cat} | ${c.good} | ${c.junk} | ${c.miscategorized} |`);
  }
  return lines.join("\n") + "\n";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test extensions/remnic-mem-stats/ratings.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add extensions/remnic-mem-stats/data.ts extensions/remnic-mem-stats/ratings.test.ts
git commit -m "feat(mem-stats): ratings persistence + accuracy summary"
```

---

### Task 5: Daemon health client

**Files:**
- Create: `extensions/remnic-mem-stats/health.ts`
- Test: `extensions/remnic-mem-stats/health.test.ts`

**Interfaces:**
- Consumes: `resolveDaemon` shape `{ url, token }` (Task 1).
- Produces:
  - `interface HealthInfo { reachable: boolean; searchBackend?: string; qmdActive?: boolean; qmdDegraded?: boolean; embeddingFresh?: boolean | null; memoryDir?: string; raw?: any }`
  - `async function getHealth(daemon: { url: string; token: string }, fetchImpl?: typeof fetch): Promise<HealthInfo>`

- [ ] **Step 1: Write the failing test**

```ts
// extensions/remnic-mem-stats/health.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { getHealth } from "./health.ts";

function fakeFetch(payload: any, ok = true): typeof fetch {
  return (async () => ({ ok, json: async () => payload })) as unknown as typeof fetch;
}

test("getHealth maps daemon payload", async () => {
  const h = await getHealth(
    { url: "http://127.0.0.1:4318", token: "t" },
    fakeFetch({ ok: true, searchBackend: "qmd", memoryDir: "/m", qmd: { active: true, degraded: false } }),
  );
  assert.equal(h.reachable, true);
  assert.equal(h.searchBackend, "qmd");
  assert.equal(h.qmdActive, true);
  assert.equal(h.qmdDegraded, false);
  assert.equal(h.memoryDir, "/m");
});

test("getHealth returns unreachable on throw", async () => {
  const throwing = (async () => { throw new Error("conn refused"); }) as unknown as typeof fetch;
  const h = await getHealth({ url: "http://127.0.0.1:4318", token: "t" }, throwing);
  assert.equal(h.reachable, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test extensions/remnic-mem-stats/health.test.ts`
Expected: FAIL — cannot find module `./health.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// extensions/remnic-mem-stats/health.ts
export interface HealthInfo {
  reachable: boolean;
  searchBackend?: string;
  qmdActive?: boolean;
  qmdDegraded?: boolean;
  embeddingFresh?: boolean | null;
  memoryDir?: string;
  raw?: any;
}

export async function getHealth(
  daemon: { url: string; token: string },
  fetchImpl: typeof fetch = fetch,
): Promise<HealthInfo> {
  try {
    const res = await fetchImpl(`${daemon.url}/engram/v1/health`, {
      headers: { Authorization: `Bearer ${daemon.token}` },
    });
    if (!res.ok) return { reachable: false };
    const raw: any = await res.json();
    return {
      reachable: true,
      searchBackend: raw.searchBackend,
      qmdActive: raw.qmd?.active,
      qmdDegraded: raw.qmd?.degraded,
      embeddingFresh: raw.qmd?.embeddingFresh ?? null,
      memoryDir: raw.memoryDir,
      raw,
    };
  } catch {
    return { reachable: false };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test extensions/remnic-mem-stats/health.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add extensions/remnic-mem-stats/health.ts extensions/remnic-mem-stats/health.test.ts
git commit -m "feat(mem-stats): daemon health client"
```

---

### Task 6: HTTP server (loopback, key-gated, JSON API + static)

**Files:**
- Create: `extensions/remnic-mem-stats/server.ts`
- Test: `extensions/remnic-mem-stats/server.test.ts`

**Interfaces:**
- Consumes: `scanMemories`, `aggregateStats`, `readRatings`, `appendRating`, `accuracySummary`, `readMemoryBody`, `MemoryRecord`, `RatingRecord`, `Verdict` (data.ts); `getHealth` (health.ts).
- Produces:
  - `interface ServerOpts { memoryDir: string; ratingsPath: string; daemon: { url: string; token: string }; publicDir: string; key: string }`
  - `async function startServer(opts: ServerOpts): Promise<{ url: string; port: number; close: () => Promise<void> }>` (binds 127.0.0.1, port 0)
  - Routes: `GET /?key=` and `/index.html` (static shell); `/app.js`, `/styles.css` (static); `GET /api/stats`; `GET /api/memories`; `GET /api/memory?id=`; `GET /api/health`; `POST /api/rate`; `GET /api/accuracy-summary`. All API routes require a valid key (query or `mskey` cookie) → else `403`.

- [ ] **Step 1: Write the failing test**

```ts
// extensions/remnic-mem-stats/server.test.ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./server.ts";

let dir: string, srv: { url: string; port: number; close: () => Promise<void> }, base: string, key = "secretkey";

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "srv-"));
  mkdirSync(join(dir, "mem", "decisions", "2026-07-08"), { recursive: true });
  writeFileSync(join(dir, "mem", "decisions", "2026-07-08", "d1.md"), `---\nid: d1\ncategory: decision\ncreated: 2026-07-08T10:00:00.000Z\n---\n\nTrial decision body.\n`);
  mkdirSync(join(dir, "public"), { recursive: true });
  writeFileSync(join(dir, "public", "index.html"), "<html>ok</html>");
  writeFileSync(join(dir, "public", "app.js"), "// app");
  writeFileSync(join(dir, "public", "styles.css"), "body{}");
  srv = await startServer({
    memoryDir: join(dir, "mem"),
    ratingsPath: join(dir, "ratings.jsonl"),
    daemon: { url: "http://127.0.0.1:59999", token: "x" }, // unreachable on purpose
    publicDir: join(dir, "public"),
    key,
  });
  base = `http://127.0.0.1:${srv.port}`;
});

after(async () => {
  await srv.close();
  rmSync(dir, { recursive: true, force: true });
});

test("rejects API without key (403)", async () => {
  const r = await fetch(`${base}/api/stats`);
  assert.equal(r.status, 403);
});

test("serves stats with key", async () => {
  const r = await fetch(`${base}/api/stats?key=${key}`);
  assert.equal(r.status, 200);
  const s = await r.json();
  assert.equal(s.total, 1);
  assert.equal(s.byCategory.decision, 1);
});

test("lists memories and reads one with body", async () => {
  const list = await (await fetch(`${base}/api/memories?key=${key}`)).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, "d1");
  const one = await (await fetch(`${base}/api/memory?key=${key}&id=d1`)).json();
  assert.match(one.body, /Trial decision body/);
});

test("POST /api/rate persists and shows on memories verdict", async () => {
  const r = await fetch(`${base}/api/rate?key=${key}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ memoryId: "d1", verdict: "good", note: "solid" }),
  });
  assert.equal(r.status, 200);
  const list = await (await fetch(`${base}/api/memories?key=${key}`)).json();
  assert.equal(list[0].verdict, "good");
});

test("health endpoint reports unreachable daemon gracefully", async () => {
  const h = await (await fetch(`${base}/api/health?key=${key}`)).json();
  assert.equal(h.reachable, false);
});

test("serves static shell with key", async () => {
  const r = await fetch(`${base}/?key=${key}`);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /ok/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test extensions/remnic-mem-stats/server.test.ts`
Expected: FAIL — cannot find module `./server.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// extensions/remnic-mem-stats/server.ts
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join, normalize } from "node:path";
import {
  scanMemories, aggregateStats, readRatings, appendRating, accuracySummary, readMemoryBody, dirSizeBytes,
  type MemoryRecord, type RatingRecord, type Verdict,
} from "./data.ts";
import { getHealth } from "./health.ts";

export interface ServerOpts {
  memoryDir: string;
  ratingsPath: string;
  daemon: { url: string; token: string };
  publicDir: string;
  key: string;
}

const VERDICTS: Verdict[] = ["good", "junk", "miscategorized"];
const STATIC: Record<string, string> = { "/app.js": "text/javascript", "/styles.css": "text/css" };

function hasKey(req: IncomingMessage, url: URL, key: string): boolean {
  if (url.searchParams.get("key") === key) return true;
  const cookie = req.headers.cookie || "";
  return cookie.split(";").some((c) => c.trim() === `mskey=${key}`);
}

function sendJson(res: ServerResponse, status: number, body: any): void {
  const s = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(s) });
  res.end(s);
}

function listRows(records: MemoryRecord[], ratings: Map<string, RatingRecord>) {
  return records
    .slice()
    .sort((a, b) => (b.created || "").localeCompare(a.created || ""))
    .map((r) => ({
      id: r.id, category: r.category, namespace: r.namespace, created: r.created,
      preview: r.preview, tags: r.tags, verdict: ratings.get(r.id)?.verdict ?? null,
    }));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export async function startServer(opts: ServerOpts): Promise<{ url: string; port: number; close: () => Promise<void> }> {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      const path = url.pathname;

      if (!hasKey(req, url, opts.key)) {
        sendJson(res, 403, { error: "forbidden" });
        return;
      }

      // static shell (set cookie so subsequent asset/API calls work without ?key)
      if (path === "/" || path === "/index.html") {
        const html = readFileSync(join(opts.publicDir, "index.html"), "utf8");
        res.writeHead(200, { "content-type": "text/html", "set-cookie": `mskey=${opts.key}; Path=/; SameSite=Strict` });
        res.end(html);
        return;
      }
      if (STATIC[path]) {
        const safe = normalize(path).replace(/^(\.\.[/\\])+/, "");
        res.writeHead(200, { "content-type": STATIC[path] });
        res.end(readFileSync(join(opts.publicDir, safe)));
        return;
      }

      if (path === "/api/stats") {
        const records = scanMemories(opts.memoryDir);
        sendJson(res, 200, { ...aggregateStats(records), sizeBytes: dirSizeBytes(opts.memoryDir) });
        return;
      }
      if (path === "/api/memories") {
        const records = scanMemories(opts.memoryDir);
        sendJson(res, 200, listRows(records, readRatings(opts.ratingsPath)));
        return;
      }
      if (path === "/api/memory") {
        const id = url.searchParams.get("id") || "";
        const rec = scanMemories(opts.memoryDir).find((r) => r.id === id);
        if (!rec) { sendJson(res, 404, { error: "not found" }); return; }
        sendJson(res, 200, { ...rec, body: readMemoryBody(rec.path), verdict: readRatings(opts.ratingsPath).get(id)?.verdict ?? null });
        return;
      }
      if (path === "/api/health") {
        sendJson(res, 200, await getHealth(opts.daemon));
        return;
      }
      if (path === "/api/accuracy-summary") {
        const records = scanMemories(opts.memoryDir);
        sendJson(res, 200, { markdown: accuracySummary(records, readRatings(opts.ratingsPath)) });
        return;
      }
      if (path === "/api/rate" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)) || "{}");
        if (!body.memoryId || !VERDICTS.includes(body.verdict)) { sendJson(res, 400, { error: "bad request" }); return; }
        const rec = scanMemories(opts.memoryDir).find((r) => r.id === body.memoryId);
        const rating: RatingRecord = {
          memoryId: body.memoryId, verdict: body.verdict, note: String(body.note || ""),
          ts: new Date().toISOString(), category: rec?.category ?? "", namespace: rec?.namespace ?? "",
        };
        appendRating(opts.ratingsPath, rating);
        sendJson(res, 200, { ok: true, rating });
        return;
      }
      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      sendJson(res, 500, { error: String((err as Error).message || err) });
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}/?key=${opts.key}`,
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test extensions/remnic-mem-stats/server.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add extensions/remnic-mem-stats/server.ts extensions/remnic-mem-stats/server.test.ts
git commit -m "feat(mem-stats): loopback key-gated HTTP server + JSON API"
```

---

### Task 7: Frontend SPA (overview strip + two-pane browse)

**Files:**
- Create: `extensions/remnic-mem-stats/public/index.html`
- Create: `extensions/remnic-mem-stats/public/styles.css`
- Create: `extensions/remnic-mem-stats/public/app.js`

**Interfaces:**
- Consumes (HTTP, same-origin, cookie-authed): `/api/stats`, `/api/memories`, `/api/memory?id=`, `/api/health`, `POST /api/rate`, `/api/accuracy-summary`.
- Produces: no code interface (browser UI). Manual verification only.

- [ ] **Step 1: Create `public/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Remnic · /mem-stats</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <header id="overview">
    <div class="kpis" id="kpis"></div>
    <div class="spark" id="spark" title="captures per day (last 14d)"></div>
  </header>
  <main>
    <section id="list-pane">
      <div class="controls">
        <input id="search" type="search" placeholder="search preview + content…" />
        <div id="chips" class="chips"></div>
      </div>
      <ul id="list"></ul>
      <button id="summary-btn" title="copy accuracy summary markdown">⧉ accuracy summary</button>
    </section>
    <section id="detail-pane"><p class="empty">Select a memory to view + rate.</p></section>
  </main>
  <script src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `public/styles.css`**

```css
:root { --bg:#161616; --bg2:#1e1e1e; --fg:#e6e6e6; --muted:#8a8a8a; --border:#333; --good:#5ac47d; --junk:#e06666; --miscat:#e0c256; --accent:#5a9cc4; }
* { box-sizing:border-box; }
body { margin:0; font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; background:var(--bg); color:var(--fg); }
header#overview { padding:12px 16px; border-bottom:1px solid var(--border); background:var(--bg2); }
.kpis { display:flex; gap:10px; flex-wrap:wrap; }
.kpi { flex:1; min-width:96px; border:1px solid var(--border); border-radius:8px; padding:8px; text-align:center; }
.kpi b { display:block; font-size:18px; }
.kpi small { color:var(--muted); }
.kpi.bad b { color:var(--junk); } .kpi.ok b { color:var(--good); }
.spark { display:flex; gap:2px; align-items:flex-end; height:36px; margin-top:10px; }
.spark i { flex:1; background:var(--accent); opacity:.7; min-height:2px; border-radius:2px 2px 0 0; }
main { display:flex; height:calc(100vh - 118px); }
#list-pane { width:44%; border-right:1px solid var(--border); display:flex; flex-direction:column; }
.controls { padding:8px; border-bottom:1px solid var(--border); }
#search { width:100%; padding:6px; background:var(--bg); color:var(--fg); border:1px solid var(--border); border-radius:6px; }
.chips { margin-top:6px; display:flex; flex-wrap:wrap; gap:4px; }
.chip { border:1px solid var(--border); border-radius:12px; padding:1px 9px; color:var(--muted); cursor:pointer; user-select:none; }
.chip.active { color:var(--fg); border-color:var(--accent); background:rgba(90,156,196,.15); }
#list { list-style:none; margin:0; padding:0; overflow:auto; flex:1; }
#list li { padding:7px 10px; border-bottom:1px solid var(--border); cursor:pointer; }
#list li:hover { background:var(--bg2); }
#list li.sel { background:rgba(90,156,196,.12); }
#list .meta { color:var(--muted); font-size:11px; display:flex; gap:6px; }
.badge { font-size:10px; padding:0 5px; border-radius:8px; }
.badge.good{color:var(--good);border:1px solid var(--good);} .badge.junk{color:var(--junk);border:1px solid var(--junk);} .badge.miscategorized{color:var(--miscat);border:1px solid var(--miscat);}
#detail-pane { flex:1; padding:16px; overflow:auto; }
#detail-pane .empty { color:var(--muted); }
#detail-pane pre { white-space:pre-wrap; background:var(--bg2); padding:10px; border-radius:6px; border:1px solid var(--border); }
.fm { color:var(--muted); font-size:11px; margin:8px 0; }
.rate { display:flex; gap:8px; margin:12px 0; }
.rate button { padding:6px 12px; border-radius:6px; border:1px solid var(--border); background:var(--bg2); color:var(--fg); cursor:pointer; }
.rate button.good.on{border-color:var(--good);color:var(--good);} .rate button.junk.on{border-color:var(--junk);color:var(--junk);} .rate button.miscategorized.on{border-color:var(--miscat);color:var(--miscat);}
#note { width:100%; padding:6px; background:var(--bg); color:var(--fg); border:1px solid var(--border); border-radius:6px; }
#summary-btn { margin:8px; padding:6px; cursor:pointer; background:var(--bg2); color:var(--fg); border:1px solid var(--border); border-radius:6px; }
```

- [ ] **Step 3: Create `public/app.js`**

```js
const ICON = { decision:"🧭", fact:"📌", question:"❓", entity:"🔗", correction:"✏️", preference:"⭐", principle:"⚖️", rule:"📏", commitment:"🤝", artifact:"📎", procedure:"🔧" };
let state = { memories: [], filterCat: null, filterVerdict: null, q: "", selectedId: null };

async function api(path, opts) { const r = await fetch(path, opts); if (!r.ok) throw new Error(path + " " + r.status); return r.json(); }

function renderOverview(stats, health) {
  const q = health.reachable
    ? (health.qmdDegraded ? `<div class="kpi bad"><b>degraded</b><small>qmd</small></div>` : `<div class="kpi ok"><b>✓</b><small>qmd ${health.searchBackend||""}</small></div>`)
    : `<div class="kpi bad"><b>?</b><small>daemon down</small></div>`;
  document.getElementById("kpis").innerHTML =
    `<div class="kpi"><b>${stats.total}</b><small>memories</small></div>` +
    `<div class="kpi"><b>${stats.last24h}</b><small>last 24h</small></div>` +
    `<div class="kpi"><b>${stats.categories}</b><small>categories</small></div>` +
    `<div class="kpi"><b>${stats.namespaces}</b><small>namespaces</small></div>` +
    `<div class="kpi"><b>${stats.lastCaptureAt ? timeAgo(stats.lastCaptureAt) : "—"}</b><small>last capture</small></div>` +
    `<div class="kpi"><b>${fmtBytes(stats.sizeBytes || 0)}</b><small>on disk</small></div>` + q;
  const days = stats.byDay.slice(-14); const max = Math.max(1, ...days.map(d => d.count));
  document.getElementById("spark").innerHTML = days.map(d => `<i style="height:${Math.round((d.count/max)*100)}%" title="${d.day}: ${d.count}"></i>`).join("");
}

function timeAgo(iso) { const s = (Date.now() - Date.parse(iso)) / 1000; if (s < 3600) return Math.round(s/60)+"m"; if (s < 86400) return Math.round(s/3600)+"h"; return Math.round(s/86400)+"d"; }
function fmtBytes(n) { if (n < 1024) return n+"B"; if (n < 1048576) return (n/1024).toFixed(0)+"K"; return (n/1048576).toFixed(1)+"M"; }

function renderChips() {
  const cats = [...new Set(state.memories.map(m => m.category))].sort();
  const mk = (label, active, on) => `<span class="chip ${active?"active":""}" data-on="${on}">${label}</span>`;
  const chips = [mk("all", !state.filterCat && !state.filterVerdict, "all")]
    .concat(cats.map(c => mk((ICON[c]||"•")+" "+c, state.filterCat===c, "cat:"+c)))
    .concat(["good","junk","miscategorized","unrated"].map(v => mk(v, state.filterVerdict===v, "verdict:"+v)));
  const el = document.getElementById("chips"); el.innerHTML = chips.join("");
  el.querySelectorAll(".chip").forEach(ch => ch.onclick = () => {
    const on = ch.dataset.on;
    if (on === "all") { state.filterCat = null; state.filterVerdict = null; }
    else if (on.startsWith("cat:")) { state.filterCat = state.filterCat === on.slice(4) ? null : on.slice(4); }
    else if (on.startsWith("verdict:")) { state.filterVerdict = state.filterVerdict === on.slice(8) ? null : on.slice(8); }
    renderChips(); renderList();
  });
}

function filtered() {
  const q = state.q.toLowerCase();
  return state.memories.filter(m => {
    if (state.filterCat && m.category !== state.filterCat) return false;
    if (state.filterVerdict === "unrated" && m.verdict) return false;
    if (state.filterVerdict && state.filterVerdict !== "unrated" && m.verdict !== state.filterVerdict) return false;
    if (q && !(m.preview || "").toLowerCase().includes(q)) return false;
    return true;
  });
}

function renderList() {
  const ul = document.getElementById("list");
  ul.innerHTML = filtered().map(m => `<li data-id="${m.id}" class="${m.id===state.selectedId?"sel":""}">
    <div>${ICON[m.category]||"•"} ${escapeHtml(m.preview || "(no preview)")}</div>
    <div class="meta"><span>${m.category}</span>${m.namespace!=="default"?`<span>· ${m.namespace}</span>`:""}<span>· ${m.created.slice(0,10)}</span>${m.verdict?`<span class="badge ${m.verdict}">${m.verdict}</span>`:""}</div>
  </li>`).join("");
  ul.querySelectorAll("li").forEach(li => li.onclick = () => selectMemory(li.dataset.id));
}

async function selectMemory(id) {
  state.selectedId = id; renderList();
  const m = await api(`/api/memory?id=${encodeURIComponent(id)}`);
  const btn = (v) => `<button class="${v} ${m.verdict===v?"on":""}" data-v="${v}">${v==="good"?"👍 good":v==="junk"?"👎 junk":"⚠ miscategorized"}</button>`;
  document.getElementById("detail-pane").innerHTML = `
    <h3>${ICON[m.category]||"•"} ${m.category} <span class="fm">${m.namespace}</span></h3>
    <pre>${escapeHtml(m.body || m.preview)}</pre>
    <div class="fm">id: ${m.id} · created: ${m.created} · conf: ${m.confidence ?? "—"} · status: ${m.status ?? "—"} · tags: ${(m.tags||[]).join(", ")||"—"}</div>
    <div class="fm">${escapeHtml(m.path)}</div>
    <div class="rate">${btn("good")}${btn("junk")}${btn("miscategorized")}</div>
    <input id="note" placeholder="optional note…" value="${escapeAttr((m.note)||"")}" />`;
  document.querySelectorAll(".rate button").forEach(b => b.onclick = () => rate(id, b.dataset.v));
}

async function rate(id, verdict) {
  const note = (document.getElementById("note")||{}).value || "";
  await api(`/api/rate`, { method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({ memoryId:id, verdict, note }) });
  const m = state.memories.find(x => x.id === id); if (m) m.verdict = verdict;
  renderList(); selectMemory(id);
}

function escapeHtml(s){ return String(s).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }
function escapeAttr(s){ return escapeHtml(s).replace(/"/g,"&quot;"); }

async function refresh() {
  const [stats, memories, health] = await Promise.all([api("/api/stats"), api("/api/memories"), api("/api/health")]);
  state.memories = memories; renderOverview(stats, health); renderChips(); renderList();
}

document.getElementById("search").oninput = (e) => { state.q = e.target.value; renderList(); };
document.getElementById("summary-btn").onclick = async () => {
  const { markdown } = await api("/api/accuracy-summary");
  await navigator.clipboard.writeText(markdown).catch(()=>{});
  document.getElementById("summary-btn").textContent = "✓ copied"; setTimeout(()=>document.getElementById("summary-btn").textContent="⧉ accuracy summary", 1500);
};
refresh(); setInterval(refresh, 4000);
```

- [ ] **Step 4: Manual smoke (deferred to Task 8 wiring)**

The frontend can only be exercised once the extension serves it (Task 8). No automated test here — verified in Task 8's manual smoke.

- [ ] **Step 5: Commit**

```bash
git add extensions/remnic-mem-stats/public/
git commit -m "feat(mem-stats): frontend SPA (overview + two-pane browse + rating)"
```

---

### Task 8: Extension entrypoint (`/mem-stats` command + lifecycle)

**Files:**
- Create: `extensions/remnic-mem-stats/index.ts`

**Interfaces:**
- Consumes: `startServer` (server.ts); `resolveMemoryDir`, `resolveDaemon`, `resolveRatingsPath` (config.ts).
- Produces: default-exported pi extension registering command `mem-stats`; owns a single server per session, closed on `session_shutdown`.

- [ ] **Step 1: Write the implementation**

```ts
// extensions/remnic-mem-stats/index.ts
// remnic-mem-stats — /mem-stats local dashboard for the Remnic memory trial.
// Rating-only: reads the memory store + daemon health, never mutates the store.
// Boots a loopback-only, key-gated HTTP server and opens it in the browser.
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveMemoryDir, resolveDaemon, resolveRatingsPath } from "./config.ts";
import { startServer } from "./server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try { spawn(cmd, args, { detached: true, stdio: "ignore" }).unref(); } catch { /* ignore */ }
}

export default function (pi: any): void {
  let server: { url: string; port: number; close: () => Promise<void> } | null = null;

  async function ensureServer(): Promise<string> {
    if (server) return server.url;
    server = await startServer({
      memoryDir: resolveMemoryDir(),
      ratingsPath: resolveRatingsPath(),
      daemon: resolveDaemon(),
      publicDir: join(HERE, "public"),
      key: randomBytes(24).toString("hex"),
    });
    return server.url;
  }

  pi.registerCommand({
    name: "mem-stats",
    description: "Open the local Remnic memory dashboard (browse + rate captured memories)",
    handler: async (_args: string, ctx: any) => {
      try {
        const url = await ensureServer();
        openBrowser(url);
        if (ctx?.hasUI) {
          ctx.ui.notify(`🧠 /mem-stats → ${url}`, "info");
          ctx.ui.setStatus("mem-stats", `🧠 mem-stats: ${server?.port}`);
        }
      } catch (err) {
        ctx?.ui?.notify?.(`mem-stats failed: ${(err as Error).message}`, "error");
      }
    },
  });

  pi.on("session_shutdown", async () => {
    if (server) { await server.close().catch(() => {}); server = null; }
  });
}
```

- [ ] **Step 2: Verify the full automated suite passes**

Run: `node --test extensions/remnic-mem-stats/*.test.ts`
Expected: PASS — all suites from Tasks 1–6 green (config, data, stats, ratings, health, server).

- [ ] **Step 3: Confirm command registration API**

Read `docs/extensions.md` for the exact `pi.registerCommand` signature (name/description/handler) and `ctx.ui` methods.
Run: `grep -nA6 "registerCommand" /opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md | head -40`
Expected: signature matches `{ name, description, handler(args, ctx) }`. If it differs (e.g. positional `registerCommand(name, handler)`), adjust the call in `index.ts` to match, then re-run Step 2's suite (unaffected) and proceed.

- [ ] **Step 4: Manual smoke in a live pi session**

1. In a pi session: `/reload` (loads the new extension).
2. Run `/mem-stats`. Expected: browser opens to the dashboard; a toast shows the URL.
3. Verify overview `memories` count matches:
   Run: `find ~/.remnic/memory -name '*.md' | grep -Ev '/state/|profile.md' | wc -l`
   Expected: within category-filter of the dashboard total (dashboard counts only CATEGORY_DIRS).
4. Click a memory → detail renders with body + frontmatter. Click 👍 good → badge appears; confirm persisted:
   Run: `tail -1 ~/.remnic/mem-stats/ratings.jsonl`
   Expected: a JSON line with that `memoryId` + `"verdict":"good"`.
5. Trigger a new capture in another session (or wait) → within ~4s the overview `last 24h` / list updates live.
6. Click "accuracy summary" → clipboard holds markdown with totals.

- [ ] **Step 5: Commit**

```bash
git add extensions/remnic-mem-stats/index.ts
git commit -m "feat(mem-stats): /mem-stats command + server lifecycle"
```

---

### Task 9: README + close-out

**Files:**
- Create: `extensions/remnic-mem-stats/README.md`

**Interfaces:**
- Consumes: nothing. Produces: docs only.

- [ ] **Step 1: Write `README.md`**

```markdown
# remnic-mem-stats

Local, browser-based dashboard for the Remnic memory trial. Launch from pi with
`/mem-stats`. Rating-only — it reads the memory store + daemon health and **never
mutates memories**; its only write is `~/.remnic/mem-stats/ratings.jsonl`.

## What it shows
- Overview strip: totals, last-24h, categories, namespaces, last-capture, qmd health, 14-day capture sparkline.
- Two-pane browse: filter/search the store on the left; read a memory + rate it (👍 good / 👎 junk / ⚠ miscategorized) on the right.
- Live auto-refresh (~4s). "Accuracy summary" button copies a markdown rollup for the Phase-1 task note.

## Safety
- Server binds `127.0.0.1` only, key-gated URL, session-scoped (closed on pi shutdown).
- Daemon token read at runtime from `~/.config/remnic/config.json`; never embedded.
- No runtime dependencies (Node built-ins only).

## Config (env overrides)
| Env | Default |
| --- | --- |
| `REMNIC_MEMORY_DIR` | from daemon config, else `~/.remnic/memory` |
| `REMNIC_MEMSTATS_RATINGS` | `~/.remnic/mem-stats/ratings.jsonl` |
| `REMNIC_DAEMON_URL` / `REMNIC_PI_AUTH_TOKEN` | from `~/.config/remnic/config.json` |

## Tests
`node --test extensions/remnic-mem-stats/*.test.ts`

## Activate
Auto-discovered at `~/.pi/agent/extensions/remnic-mem-stats/index.ts`. Run `/reload` or start a new pi session.
```

- [ ] **Step 2: Full suite green + commit**

Run: `node --test extensions/remnic-mem-stats/*.test.ts`
Expected: PASS (all suites).

```bash
git add extensions/remnic-mem-stats/README.md
git commit -m "docs(mem-stats): extension README"
```

- [ ] **Step 3: Push**

```bash
cd ~/Documents/Personal/pi-config && git push
```

---

## Notes for the implementer

- **Run tests from the repo root** (`~/Documents/Personal/pi-config`) so relative `./x.ts` imports resolve.
- **Node type-stripping:** requires Node ≥ 22.6 (repo uses v25). If `node --test *.ts` errors on types, add `--experimental-strip-types` (unnecessary on v25).
- **Do not** add the ratings file or `.superpowers/` to git (already gitignored / lives under `~/.remnic`).
- The pre-existing `settings.json` change and the separate `remnic/` + `remnic-capture-hud/` extension dirs are **out of scope** for this plan — leave them untouched.
