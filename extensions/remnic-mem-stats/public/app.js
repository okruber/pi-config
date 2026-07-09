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
