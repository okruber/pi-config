# `/mem-stats` — Remnic Memory Dashboard (design)

- **Date:** 2026-07-09
- **Status:** Approved (design); ready for implementation planning
- **Owner:** Olle (driving); built as a pi-config companion extension
- **Context:** Phase-1 remnic memory trial (vault handoff `2026-07-07-remnic-memory-trial.md`).
  A bounded, reversible local trial is underway. This dashboard is a **trial
  instrument** to gather evidence for the adopt/drop decision, and a way to
  **explore the memories being captured**.

## 1. Purpose & goals

A local, browser-based dashboard, launched from pi via `/mem-stats`, that lets Olle:

1. **Judge capture accuracy** (trial success criterion #1) by browsing captured
   memories and rating each **good / junk / miscategorized**.
2. **Explore the store** — filter, search, and read individual memories with their
   frontmatter and provenance.
3. **Monitor the memory system** during the trial — totals, growth over time, and
   health (daemon + qmd + embedding freshness → footprint criterion #4).

**Non-goal (hard constraint):** the dashboard is **rating-only**. It MUST NOT
mutate the memory store (no correct/forget/edit) during the trial. Its only write
is to its own ratings file. This keeps the store neutral for evaluation and keeps
`.pi/memory.md`-style purity.

## 2. Scope

**In scope (v1):**
- Single-screen dashboard: overview strip on top + two-pane browse below (Layout A).
- Read-only browse of the memory store (list, filter, search, read detail).
- Per-memory rating (good / junk / miscategorized) + optional one-line note,
  persisted locally.
- Live auto-refresh of overview + list.
- An accuracy-summary export (markdown) for the Phase-1 task note.

**Out of scope (deferred, leave architectural room):**
- Interactive **X-ray recall query box** (trial criterion #2 — "why did a memory
  surface"). Planned as a future third view/tab.
- qmd SQLite index stats (chunk/vector counts from `~/.cache/qmd/index.sqlite`).
  Deferred to keep the v1 data layer file-only; may be added to the overview later.
- Any memory mutation (correct/forget/promote/dedup).

## 3. Delivery & lifecycle

- Implemented as a **companion pi extension** `extensions/remnic-mem-stats/`
  (separate from vendored `extensions/remnic/`, which `remnic connectors install
  pi` regenerates — keeping this upgrade-safe). Git-tracked in pi-config.
- Registers a `/mem-stats` command. On invoke:
  1. If a server for this session is already running, reuse it; else boot one.
  2. Open the URL in the default browser (`open` on macOS).
- **Server:** binds `127.0.0.1` only, on an ephemeral port, **key-gated** (a random
  key in the URL query string, validated on every HTTP request — same pattern as
  the brainstorming visual companion). No external network calls.
- **Session-scoped:** the server is torn down on `session_shutdown` (and process
  exit). Re-invoking `/mem-stats` in a later session boots a fresh one.
- **No secrets in the repo:** the daemon auth token is read at runtime from
  `~/.config/remnic/config.json` (or the remnic connector config), never embedded.

## 4. Data sources

All reads are **non-mutating**.

1. **Markdown frontmatter — source of truth for browse & stats.**
   Walk `~/.remnic/memory/**/*.md` (memory dir resolved from
   `~/.config/remnic/config.json → remnic.memoryDir`, env override
   `REMNIC_MEMORY_DIR`, default `~/.remnic/memory`). Namespace-aware:
   - `‹cat›/‹date›/‹id›.md` → namespace `default`
   - `namespaces/‹ns›/‹cat›/‹date›/‹id›.md` → namespace `‹ns›`
   - Skip `state/`, `.registry/`, and `profile.md` (not discrete captures).
   Parse frontmatter (`id`, `category`, `created`, `updated`, `tags`, `confidence`,
   `status`, lifecycle state, `namespace`) + body preview.
2. **Daemon REST — runtime health.** `GET /engram/v1/health` (qmd active/degraded,
   embedding freshness, searchBackend, memoryDir), and optionally
   `/engram/v1/dreams/status` + `/engram/v1/procedural/stats`. Loopback, bearer
   token from config. If the daemon is unreachable, the dashboard still works from
   files; health panel shows "daemon unreachable".
3. **Ratings file** (see §6).

## 5. Screen layout (Layout A)

One page, no navigation:

**Overview strip (full-width, top):**
- KPIs: total memories · captured last-24h · # categories · # namespaces ·
  last-capture time · **qmd health** (active / degraded + embedding freshness) ·
  store size on disk.
- **Captures-over-time** sparkline (by day; window e.g. last 14 days).

**Browse (below), two panes:**
- **Left — list.** Filter chips (category, namespace, verdict: unrated/good/junk/
  miscat), a substring search box (over preview + content), sort (newest first
  default). Rows: category icon · category · one-line preview · date · namespace
  tag (if non-default) · current-verdict badge.
- **Right — detail (docked).** Full memory content; frontmatter block (id, category,
  created/updated, tags, confidence, lifecycle/status, namespace, file path);
  provenance flags (safe/stale/corrected where available). **Rating controls:**
  👍 good / 👎 junk / ⚠ miscategorized + optional one-line note. Selecting a verdict
  POSTs immediately and updates the list badge.

**Live refresh:** throttled poll (~3–5s) of overview + list. The currently-open
detail pane does not jump/reload while being read; new/changed items reconcile in
the list. Cost is a few local file stats + one health ping — near-zero.

## 6. Ratings persistence

- **File:** `~/.remnic/mem-stats/ratings.jsonl` — **local, untracked** (stays with
  the store it describes; keeps the config repo clean). Created on first rating.
- **Format:** append-only JSONL, one record per rating action:
  ```json
  {"memoryId":"decision-…","verdict":"good","note":"","ts":"2026-07-09T…Z","category":"decision","namespace":"default"}
  ```
  **Latest-verdict-wins** per `memoryId` when read back (append-only history is
  preserved for audit; the UI reflects the most recent).
- **Accuracy summary export:** a button renders markdown — totals, % good/junk/
  miscat, breakdown by category, count rated vs. unrated — for pasting into the
  Phase-1 task note. At decision time this rollup can also be written into the
  task note (fulfilling the trial return protocol). The raw JSONL is never
  committed to git.

## 7. Component boundaries

Designed as small, independently testable units:

1. **Data layer** (`data.ts` or similar) — pure functions:
   - `scanMemories(memoryDir) → MemoryRecord[]` (parse frontmatter + classify ns/category)
   - `aggregateStats(records) → Stats` (totals, by-category, by-namespace, by-day, last-capture)
   - `readRatings(path) → Map<memoryId, Verdict>` (latest-wins) and `appendRating(path, record)`
   - `accuracySummary(records, ratings) → markdown`
   No network, no server — unit-testable against a temp dir with fixture files.
2. **Health client** — thin wrapper over the daemon REST (`getHealth()`), tolerant
   of an unreachable daemon.
3. **HTTP server** — static asset serving + JSON API; loopback + key gate:
   - `GET /api/stats` → overview KPIs + timeline
   - `GET /api/memories?category=&namespace=&verdict=&q=` → list rows (+ current verdict)
   - `GET /api/memory/:id` → full content + frontmatter + provenance
   - `GET /api/health` → daemon/qmd health
   - `POST /api/rate` `{memoryId, verdict, note}` → append to ratings file
   - `GET /api/accuracy-summary` → markdown rollup
4. **Extension entrypoint** (`index.ts`) — registers `/mem-stats`, owns server
   lifecycle (start/reuse/teardown on `session_shutdown`), opens the browser.
5. **Frontend SPA** — single static HTML/CSS/JS bundle: overview strip + two-pane
   browse + live poll + rating actions. No build step (vanilla or minimal) to keep
   it inspectable and dependency-light, consistent with the local-first ethos.

## 8. Security & safety

- Loopback bind only; key-gated URL; no CORS to other origins; no external calls.
- Read-only against the memory store; the sole write target is
  `~/.remnic/mem-stats/ratings.jsonl`.
- Daemon token read at runtime; never written to the repo or logs.
- Fully reversible: delete the extension dir + `~/.remnic/mem-stats/`.

## 9. Testing strategy

- **Data layer:** unit tests over a temp memory dir with fixture markdown covering
  default + namespaced files, each category, malformed frontmatter, and empty
  store. Assert stats aggregation, namespace/category classification, ratings
  latest-wins, and accuracy-summary output.
- **Server API:** integration tests via `fetch` against a booted server on an
  ephemeral port — each endpoint's shape, key-gate rejection, and `POST /api/rate`
  round-trip (write then read-back reflects latest verdict).
- **Frontend:** manual smoke via `/mem-stats` (`/reload` then invoke); verify
  overview numbers match `find … | wc -l`, live refresh reflects a new capture,
  rating persists across reload.

## 10. Open items / follow-ups (not blockers)

- Fold the qmd degradation fix, the `remnic-capture-hud` extension, and this design
  into the pi-config commit; record the qmd-degraded finding + fix in the Phase-1
  task note (per the trial return protocol).
- Future: add the X-ray recall view (criterion #2) and optional qmd index stats.
