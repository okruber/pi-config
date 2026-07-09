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
