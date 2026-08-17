# usage-dashboard

Adds `/usage` to pi. The command scans all session files, writes a
self-contained HTML report to the temp directory, and opens it in the browser.

## Use

```
/usage          # last 30 days
/usage 7        # last 7 days
/usage 90
/usage all      # all history
```

The report has five sections: summary cards, tokens per day stacked by provider
with cost as a line, cache rate over time against a 90% target, a per-model
table, a per-provider table, and a per-day table. Click any table header to
sort. Local providers carry a `local` tag, so local and hosted models compare
directly.

## Files

| File | Purpose |
|---|---|
| `aggregate.ts` | Scans session JSONL and returns typed buckets. No UI code. |
| `render.ts` | Turns buckets into HTML with inline SVG charts. No network calls. |
| `index.ts` | Registers the command, writes the file, opens the browser. |

## Cache metrics

The report shows two rates, because they answer different questions.

- **Cache token share** is `cacheRead / (cacheRead + cacheWrite + input)`. It
  measures the share of prompt tokens served from cache, weighted by volume.
- **Request hit rate** is the share of requests that read any cache. It matches
  the metric in `pi-cache-optimizer-stats.json`. It is coarse, because one
  cached token marks a request as a hit.

## Data notes

- The scan reads `~/.pi/agent/sessions` recursively. A custom `--session-dir`
  root is scanned as well.
- Usage comes from assistant messages, tool results with nested usage, and
  compaction and branch-summary entries.
- `/fork` and `/clone` copy entries between files. Entries are deduplicated on
  id plus timestamp to prevent double counting.
- Compaction entries and tool usage carry no model. They inherit the model in
  effect at that point in the session file.
- Malformed lines from sessions in progress are skipped. The footer reports the
  count.
- Days use local time. Only days with usage appear.
