import {
  cacheRequestRate,
  cacheTokenShare,
  type DayBucket,
  type KeyBucket,
  type Report,
  type Totals,
} from "./aggregate.ts";

const LOCAL_PROVIDERS = new Set(["lmstudio", "ollama", "llamacpp", "llama-cpp", "local"]);

const PALETTE = [
  "#7aa2f7",
  "#f7768e",
  "#e0af68",
  "#bb9af7",
  "#2ac3de",
  "#ff9e64",
  "#9ece6a",
  "#c0caf5",
  "#b4f9f8",
  "#db4b4b",
];
const LOCAL_COLORS = ["#9ece6a", "#73daca", "#41a6b5"];

const CACHE_TARGET = 0.9;

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

function fmtCost(n: number): string {
  return n >= 100 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`;
}

function fmtCostTick(n: number): string {
  if (n === 0) return "$0";
  if (n >= 10) return `$${Math.round(n)}`;
  if (n >= 1) return `$${n.toFixed(1)}`;
  return `$${n.toFixed(2)}`;
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function isLocal(provider: string): boolean {
  return LOCAL_PROVIDERS.has(provider);
}

function providerColors(providers: string[]): Map<string, string> {
  const colors = new Map<string, string>();
  let hosted = 0;
  let local = 0;
  for (const p of providers) {
    if (isLocal(p)) colors.set(p, LOCAL_COLORS[local++ % LOCAL_COLORS.length]);
    else colors.set(p, PALETTE[hosted++ % PALETTE.length]);
  }
  return colors;
}

function shortDay(day: string): string {
  return day.slice(5);
}

function xAxisLabels(days: DayBucket[], xCenter: (i: number) => number, y: number): string {
  const every = Math.ceil(days.length / 24);
  return days
    .map((d, i) =>
      i % every === 0 || i === days.length - 1
        ? `<text class="axis" x="${xCenter(i).toFixed(1)}" y="${y}" text-anchor="middle">${shortDay(d.day)}</text>`
        : "",
    )
    .join("");
}

function tokensChart(days: DayBucket[], providers: string[], colors: Map<string, string>): string {
  const w = 1040;
  const h = 340;
  const padL = 64;
  const padR = 64;
  const padT = 16;
  const padB = 40;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const maxTokens = Math.max(1, ...days.map((d) => d.totalTokens));
  const maxCost = Math.max(0.01, ...days.map((d) => d.cost));
  const slot = plotW / Math.max(1, days.length);
  const barW = Math.max(2, Math.min(28, slot * 0.7));

  const yTokens = (v: number) => padT + plotH - (v / maxTokens) * plotH;
  const xCenter = (i: number) => padL + slot * i + slot / 2;

  const gridlines: string[] = [];
  for (let i = 0; i <= 4; i++) {
    const value = (maxTokens / 4) * i;
    const y = yTokens(value);
    gridlines.push(`<line class="grid" x1="${padL}" y1="${y.toFixed(1)}" x2="${padL + plotW}" y2="${y.toFixed(1)}"/>`);
    gridlines.push(
      `<text class="axis" x="${padL - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end">${fmtTokens(value)}</text>`,
    );
    const costLabel = fmtCostTick((maxCost / 4) * i);
    gridlines.push(`<text class="axis cost" x="${padL + plotW + 8}" y="${(y + 4).toFixed(1)}">${costLabel}</text>`);
  }

  const bars: string[] = [];
  days.forEach((d, i) => {
    let cursor = padT + plotH;
    const x = xCenter(i) - barW / 2;
    for (const p of providers) {
      const tokens = d.byProvider.get(p) ?? 0;
      if (tokens <= 0) continue;
      const segH = (tokens / maxTokens) * plotH;
      cursor -= segH;
      const share = d.totalTokens > 0 ? tokens / d.totalTokens : 0;
      bars.push(
        `<rect x="${x.toFixed(1)}" y="${cursor.toFixed(1)}" width="${barW.toFixed(1)}" height="${segH.toFixed(1)}" fill="${colors.get(p)}"><title>${esc(d.day)} · ${esc(p)}\n${fmtTokens(tokens)} tokens (${fmtPct(share)} of day)</title></rect>`,
      );
    }
    bars.push(
      `<rect class="hit" x="${(xCenter(i) - slot / 2).toFixed(1)}" y="${padT}" width="${slot.toFixed(1)}" height="${plotH}"><title>${esc(d.day)}\n${fmtTokens(d.totalTokens)} tokens · ${fmtCost(d.cost)} · ${d.requests} requests</title></rect>`,
    );
  });

  const costPoints = days
    .map((d, i) => `${xCenter(i).toFixed(1)},${(padT + plotH - (d.cost / maxCost) * plotH).toFixed(1)}`)
    .join(" ");

  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Tokens per day by provider">
  ${gridlines.join("")}
  ${bars.join("")}
  <polyline class="costline" points="${costPoints}"/>
  ${days.map((d, i) => `<circle class="costdot" cx="${xCenter(i).toFixed(1)}" cy="${(padT + plotH - (d.cost / maxCost) * plotH).toFixed(1)}" r="2.5"><title>${esc(d.day)} · ${fmtCost(d.cost)}</title></circle>`).join("")}
  ${xAxisLabels(days, xCenter, h - 14)}
</svg>`;
}

function cacheChart(days: DayBucket[]): string {
  const w = 1040;
  const h = 300;
  const padL = 64;
  const padR = 64;
  const padT = 16;
  const padB = 40;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const slot = plotW / Math.max(1, days.length);
  const xCenter = (i: number) => padL + slot * i + slot / 2;
  const yRate = (v: number) => padT + plotH - v * plotH;

  const gridlines: string[] = [];
  for (let i = 0; i <= 5; i++) {
    const value = i / 5;
    const y = yRate(value);
    gridlines.push(`<line class="grid" x1="${padL}" y1="${y.toFixed(1)}" x2="${padL + plotW}" y2="${y.toFixed(1)}"/>`);
    gridlines.push(
      `<text class="axis" x="${padL - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end">${(value * 100).toFixed(0)}%</text>`,
    );
  }

  const targetY = yRate(CACHE_TARGET);
  const target = `<line class="target" x1="${padL}" y1="${targetY.toFixed(1)}" x2="${padL + plotW}" y2="${targetY.toFixed(1)}"/><text class="targetlabel" x="${padL + 6}" y="${(targetY - 6).toFixed(1)}">90% target</text>`;

  const sharePoints = days.map((d, i) => `${xCenter(i).toFixed(1)},${yRate(cacheTokenShare(d)).toFixed(1)}`).join(" ");
  const ratePoints = days.map((d, i) => `${xCenter(i).toFixed(1)},${yRate(cacheRequestRate(d)).toFixed(1)}`).join(" ");

  const dots = days
    .map((d, i) => {
      const share = cacheTokenShare(d);
      const rate = cacheRequestRate(d);
      return `<circle class="dot share" cx="${xCenter(i).toFixed(1)}" cy="${yRate(share).toFixed(1)}" r="3"><title>${esc(d.day)}\ntoken share ${fmtPct(share)}</title></circle><circle class="dot rate" cx="${xCenter(i).toFixed(1)}" cy="${yRate(rate).toFixed(1)}" r="3"><title>${esc(d.day)}\nrequest hit rate ${fmtPct(rate)} (${d.hitRequests}/${d.requests})</title></circle>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Cache hit rate over time">
  ${gridlines.join("")}
  ${target}
  <polyline class="line share" points="${sharePoints}"/>
  <polyline class="line rate" points="${ratePoints}"/>
  ${dots}
  ${xAxisLabels(days, xCenter, h - 14)}
</svg>`;
}

function statRow(bucket: KeyBucket, grandTotal: number, colorDot?: string): string {
  const share = grandTotal > 0 ? bucket.totalTokens / grandTotal : 0;
  const dot = colorDot ? `<span class="dot-swatch" style="background:${colorDot}"></span>` : "";
  const label = colorDot && isLocal(bucket.key) ? `${esc(bucket.key)} <span class="tag">local</span>` : esc(bucket.key);
  return `<tr>
  <td class="name">${dot}${label}</td>
  <td data-v="${bucket.totalTokens}">${fmtTokens(bucket.totalTokens)}</td>
  <td data-v="${share}">${fmtPct(share)}</td>
  <td data-v="${bucket.cost}">${fmtCost(bucket.cost)}</td>
  <td data-v="${bucket.requests}">${bucket.requests}</td>
  <td data-v="${cacheTokenShare(bucket)}">${fmtPct(cacheTokenShare(bucket))}</td>
  <td data-v="${cacheRequestRate(bucket)}">${fmtPct(cacheRequestRate(bucket))}</td>
  <td data-v="${bucket.input}">${fmtTokens(bucket.input)}</td>
  <td data-v="${bucket.output}">${fmtTokens(bucket.output)}</td>
</tr>`;
}

function table(id: string, firstHeader: string, rows: string): string {
  return `<table id="${id}" class="stats">
  <thead><tr>
    <th data-sort="text">${firstHeader}</th>
    <th data-sort="num">Tokens</th>
    <th data-sort="num">Share</th>
    <th data-sort="num">Cost</th>
    <th data-sort="num">Requests</th>
    <th data-sort="num">Cache token share</th>
    <th data-sort="num">Request hit rate</th>
    <th data-sort="num">Uncached input</th>
    <th data-sort="num">Output</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

function dayTable(days: DayBucket[]): string {
  const rows = days
    .slice()
    .reverse()
    .map((d) => {
      const flag = cacheTokenShare(d) < CACHE_TARGET ? ' class="below"' : "";
      return `<tr${flag}>
  <td class="name">${d.day}</td>
  <td data-v="${d.totalTokens}">${fmtTokens(d.totalTokens)}</td>
  <td data-v="${d.cost}">${fmtCost(d.cost)}</td>
  <td data-v="${d.requests}">${d.requests}</td>
  <td data-v="${cacheTokenShare(d)}">${fmtPct(cacheTokenShare(d))}</td>
  <td data-v="${cacheRequestRate(d)}">${fmtPct(cacheRequestRate(d))}</td>
  <td data-v="${d.cacheRead}">${fmtTokens(d.cacheRead)}</td>
  <td data-v="${d.cacheWrite}">${fmtTokens(d.cacheWrite)}</td>
  <td data-v="${d.input}">${fmtTokens(d.input)}</td>
  <td data-v="${d.output}">${fmtTokens(d.output)}</td>
</tr>`;
    })
    .join("");
  return `<table id="days" class="stats">
  <thead><tr>
    <th data-sort="text">Day</th>
    <th data-sort="num">Tokens</th>
    <th data-sort="num">Cost</th>
    <th data-sort="num">Requests</th>
    <th data-sort="num">Cache token share</th>
    <th data-sort="num">Request hit rate</th>
    <th data-sort="num">Cache read</th>
    <th data-sort="num">Cache write</th>
    <th data-sort="num">Uncached input</th>
    <th data-sort="num">Output</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

function summaryCards(r: Report, localTokens: number): string {
  const t: Totals = r.totals;
  const days = Math.max(1, r.days.length);
  const localShare = t.totalTokens > 0 ? localTokens / t.totalTokens : 0;
  const cards = [
    ["Tokens", fmtTokens(t.totalTokens), `${fmtTokens(Math.round(t.totalTokens / days))} per active day`],
    ["Cost", fmtCost(t.cost), `${fmtCost(t.cost / days)} per active day`],
    [
      "Cache token share",
      fmtPct(cacheTokenShare(t)),
      cacheTokenShare(t) >= CACHE_TARGET ? "at or above 90% target" : "below 90% target",
    ],
    ["Request hit rate", fmtPct(cacheRequestRate(t)), `${t.hitRequests} of ${t.requests} requests`],
    ["Local models", fmtPct(localShare), `${fmtTokens(localTokens)} tokens on local providers`],
  ];
  return cards
    .map(
      ([label, value, sub]) =>
        `<div class="card"><div class="card-label">${label}</div><div class="card-value">${value}</div><div class="card-sub">${sub}</div></div>`,
    )
    .join("");
}

export function renderReport(r: Report): string {
  const providers = r.providers.map((p) => p.key);
  const colors = providerColors(providers);
  const localTokens = r.providers.filter((p) => isLocal(p.key)).reduce((sum, p) => sum + p.totalTokens, 0);
  const windowLabel = r.windowDays === "all" ? "all history" : `last ${r.windowDays} days`;
  const generated = new Date().toLocaleString();

  const legend = providers
    .map(
      (p) =>
        `<span class="legend-item"><span class="dot-swatch" style="background:${colors.get(p)}"></span>${esc(p)}${isLocal(p) ? ' <span class="tag">local</span>' : ""}</span>`,
    )
    .join("");

  const empty = r.days.length === 0;
  const body = empty
    ? `<p class="empty">No usage found in ${windowLabel}.</p>`
    : `<section class="cards">${summaryCards(r, localTokens)}</section>

<section>
  <h2>Tokens per day</h2>
  <p class="hint">Bars stack tokens by provider. The orange line is cost on the right axis. Hover any bar for detail.</p>
  <div class="legend">${legend}<span class="legend-item"><span class="dot-swatch costswatch"></span>cost</span></div>
  ${tokensChart(r.days, providers, colors)}
</section>

<section>
  <h2>Cache hit rate over time</h2>
  <p class="hint">Token share is cache reads divided by all prompt tokens. Request hit rate is the share of requests that read any cache. The dashed line is the 90% target.</p>
  <div class="legend">
    <span class="legend-item"><span class="dot-swatch" style="background:#7aa2f7"></span>cache token share</span>
    <span class="legend-item"><span class="dot-swatch" style="background:#e0af68"></span>request hit rate</span>
  </div>
  ${cacheChart(r.days)}
</section>

<section>
  <h2>By model</h2>
  <p class="hint">Click a column header to sort.</p>
  ${table(
    "models",
    "Provider / model",
    r.models.map((m) => statRow(m, r.totals.totalTokens, colors.get(m.key.split("/")[0]))).join(""),
  )}
</section>

<section>
  <h2>By provider</h2>
  ${table("providers", "Provider", r.providers.map((p) => statRow(p, r.totals.totalTokens, colors.get(p.key))).join(""))}
</section>

<section>
  <h2>By day</h2>
  ${dayTable(r.days)}
</section>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>pi usage · ${windowLabel}</title>
<style>
:root {
  --bg: #16161e; --panel: #1a1b26; --line: #2f3549; --fg: #c0caf5; --muted: #7f8bb0;
  --accent: #7aa2f7; --cost: #ff9e64; --warn: #f7768e;
}
* { box-sizing: border-box; }
body { margin: 0; padding: 32px 40px 64px; background: var(--bg); color: var(--fg);
  font: 14px/1.5 ui-sans-serif, -apple-system, "Segoe UI", sans-serif; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 16px; margin: 0 0 4px; font-weight: 600; }
.sub { color: var(--muted); margin: 0 0 28px; font-size: 13px; }
.hint { color: var(--muted); font-size: 12px; margin: 0 0 12px; max-width: 900px; }
section { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 20px; margin-bottom: 20px; }
section.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 16px; }
.card-label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
.card-value { font-size: 26px; font-weight: 600; margin: 2px 0; font-variant-numeric: tabular-nums; }
.card-sub { color: var(--muted); font-size: 12px; }
svg { width: 100%; height: auto; display: block; }
.grid { stroke: var(--line); stroke-width: 1; }
.axis { fill: var(--muted); font-size: 11px; font-family: ui-monospace, monospace; }
.axis.cost { fill: var(--cost); }
.costline { fill: none; stroke: var(--cost); stroke-width: 1.6; }
.costdot { fill: var(--cost); }
.hit { fill: transparent; }
.hit:hover { fill: rgba(192,202,245,.06); }
.line { fill: none; stroke-width: 2; }
.line.share { stroke: var(--accent); }
.line.rate { stroke: #e0af68; }
.dot.share { fill: var(--accent); }
.dot.rate { fill: #e0af68; }
.target { stroke: var(--warn); stroke-width: 1.2; stroke-dasharray: 5 4; }
.targetlabel { fill: var(--warn); font-size: 11px; font-family: ui-monospace, monospace; }
.legend { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 10px; font-size: 12px; color: var(--muted); }
.legend-item { display: flex; align-items: center; gap: 6px; }
.dot-swatch { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
.costswatch { background: var(--cost); }
.tag { color: #9ece6a; border: 1px solid #9ece6a55; border-radius: 3px; padding: 0 4px; font-size: 10px; }
table.stats { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
table.stats th, table.stats td { text-align: right; padding: 6px 10px; border-bottom: 1px solid var(--line); white-space: nowrap; }
table.stats th { color: var(--muted); font-weight: 500; font-size: 12px; cursor: pointer; user-select: none; }
table.stats th:hover { color: var(--fg); }
table.stats th:first-child, table.stats td.name { text-align: left; }
table.stats td.name { display: flex; align-items: center; gap: 8px; }
tr.below td { color: var(--warn); }
.empty { color: var(--muted); }
footer { color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
<h1>pi usage · ${windowLabel}</h1>
<p class="sub">${empty ? "no data" : `${esc(r.firstDay)} to ${esc(r.lastDay)} · ${r.days.length} active days`} · generated ${esc(generated)}</p>
${body}
<footer>
  ${r.filesScanned} session files · ${r.entriesCounted} usage entries · ${r.duplicatesSkipped} fork/clone duplicates skipped · ${r.malformedLines} unreadable lines · scanned in ${r.scanMs} ms
</footer>
<script>
for (const table of document.querySelectorAll("table.stats")) {
  table.querySelectorAll("th").forEach((th, index) => {
    th.addEventListener("click", () => {
      const numeric = th.dataset.sort === "num";
      const body = table.tBodies[0];
      const rows = [...body.rows];
      const asc = th.dataset.dir !== "asc";
      table.querySelectorAll("th").forEach((h) => delete h.dataset.dir);
      th.dataset.dir = asc ? "asc" : "desc";
      rows.sort((a, b) => {
        const ca = a.cells[index];
        const cb = b.cells[index];
        if (numeric) {
          const va = Number(ca.dataset.v ?? 0);
          const vb = Number(cb.dataset.v ?? 0);
          return asc ? va - vb : vb - va;
        }
        return asc ? ca.textContent.localeCompare(cb.textContent) : cb.textContent.localeCompare(ca.textContent);
      });
      rows.forEach((row) => body.appendChild(row));
    });
  });
}
</script>
</body>
</html>`;
}
