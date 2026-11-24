// Taskmarket live visualizer — client rendering. All numbers come from
// /api/data (server-side fetch of Taskmarket's public API). Nothing here
// is mocked, guessed or invented.

const state = { range: "30d", chain: "all", metric: "activeAgents", heatDim: "hourOfWeek" };
let data = null;

const $ = (s) => document.querySelector(s);
const nf = new Intl.NumberFormat("en-US");
const money = (n) =>
  "$" + new Intl.NumberFormat("en-US", { maximumFractionDigits: n < 100 ? 2 : 0 }).format(n);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const shortAddr = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "—");
const ago = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return Math.floor(s) + "s ago";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
};
const fmtTime = (iso) =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

async function load() {
  const err = $("#err");
  try {
    const r = await fetch(`/api/data?range=${state.range}&chain=${state.chain}`);
    if (!r.ok) throw new Error("API " + r.status);
    data = await r.json();
    err.hidden = true;
    render();
  } catch (e) {
    err.hidden = false;
    err.textContent = "Could not load fresh market data (" + e.message + "). Showing the last good load, if any. Retrying automatically.";
    setTimeout(load, 60000);
  }
}

function render() {
  if (!data) return;
  $("#asOf").textContent = fmtTime(data.asOf) + (data.cached ? " (cached)" : "");
  $("#endpointList").textContent = data.endpoints.join("  ·  ");
  renderHeadlines();
  renderFlow();
  renderTrends();
  renderBreakdowns();
  renderPosters();
  renderHeat();
  renderFeed();
  renderTasks();
}

function renderHeadlines() {
  const m = data.market || {};
  const t = data.totals || {};
  const cards = [
    ["Registered workers", nf.format(m.registeredWorkers || 0), "agents and people"],
    ["Active agents · 7d", nf.format(m.activeAgents7d || 0), "worked in the last week"],
    ["Open tasks", nf.format(m.openTasks || 0), data.openByChain.map((c) => `${c.openTasks} on ${c.name}`).join(" · ")],
    ["Rewards put up · " + state.range, money(t.rewardVolume || 0), "escrowed across tasks"],
    ["Rewards paid · " + state.range, money(t.paidVolume || 0), `${nf.format(t.settlements || 0)} settlements`],
    ["Paid workers", nf.format(m.paidWorkers || 0), `${nf.format(m.activeWallets || 0)} active wallets`],
  ];
  $("#headlineCards").innerHTML = cards
    .map(([k, v, s]) => `<div class="card"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="s">${esc(s)}</div></div>`)
    .join("");
}

function renderFlow() {
  const t = data.totals || {};
  const put = t.rewardVolume || 0;
  const paid = t.paidVolume || 0;
  const pct = put > 0 ? Math.round((paid / put) * 100) : 0;
  $("#flowBox").innerHTML = `
    <div class="node"><div class="v">${money(put)}</div><div class="k">Rewards put up</div><div class="sub">by requesters, ${esc(state.range)}</div></div>
    <div class="arrow">→</div>
    <div class="node hot"><div class="v">${money(paid)}</div><div class="k">Rewards paid</div><div class="sub">${pct}% of what was put up reached winners</div></div>
    <div class="arrow">→</div>
    <div class="node"><div class="v">${nf.format(t.completedTasks || 0)}</div><div class="k">Tasks completed</div><div class="sub">${nf.format(t.settlements || 0)} settlements · ${nf.format(t.newAgents || 0)} new agents</div></div>`;
}

function lineChart(series, key, isMoney) {
  const W = 980, H = 260, P = 34;
  const vals = series.map((d) => (key === "rewardVolume" || key === "paidVolume" ? Number(d[key] || 0) / 1e6 : d[key] || 0));
  const max = Math.max(...vals, 1);
  const min = 0;
  const x = (i) => P + (i * (W - 2 * P)) / Math.max(series.length - 1, 1);
  const y = (v) => H - P - ((v - min) / (max - min)) * (H - 2 * P);
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${P},${H - P} ` + pts + ` ${x(vals.length - 1).toFixed(1)},${H - P}`;
  const fmt = (v) => (isMoney ? money(v) : nf.format(Math.round(v)));
  const labels = [0, 1, 2, 3, 4].map((i) => {
    const v = min + ((max - min) * i) / 4;
    return `<text x="8" y="${y(v) + 4}" fill="#B0A79D" font-size="11">${fmt(v)}</text>`;
  }).join("");
  const first = series[0]?.bucket || "", last = series[series.length - 1]?.bucket || "";
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Trend chart">
    ${labels}
    <polygon points="${area}" fill="#E74079" opacity="0.14"/>
    <polyline points="${pts}" fill="none" stroke="#E74079" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${vals.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="2.6" fill="#12100E" stroke="#E74079" stroke-width="1.5"><title>${esc(series[i].bucket)}: ${fmt(v)}</title></circle>`).join("")}
    <text x="${P}" y="${H - 8}" fill="#B0A79D" font-size="11">${esc(first)}</text>
    <text x="${W - P}" y="${H - 8}" fill="#B0A79D" font-size="11" text-anchor="end">${esc(last)}</text>
  </svg>`;
}

function renderTrends() {
  const isMoney = state.metric === "rewardVolume" || state.metric === "paidVolume";
  $("#trendChart").innerHTML = data.series.length
    ? lineChart(data.series, state.metric, isMoney)
    : "<p class='note'>No time-series data returned for this range.</p>";
  const t = data.totals || {};
  $("#rangeTotals").innerHTML = `
    <div>Tasks posted <b>${nf.format(t.tasksCreated || 0)}</b></div>
    <div>Rewards put up <b>${money(t.rewardVolume || 0)}</b></div>
    <div>Rewards paid <b>${money(t.paidVolume || 0)}</b></div>
    <div>New agents <b>${nf.format(t.newAgents || 0)}</b></div>
    <div>Range <b>${esc(state.range)}</b></div>`;
}

function bars(rows, maxVal) {
  return rows
    .map(([label, value, moneyFmt]) => {
      const pct = maxVal > 0 ? Math.round((value / maxVal) * 100) : 0;
      const disp = moneyFmt ? money(value) : nf.format(value);
      return `<div class="bar-row"><span class="lbl">${esc(label)}</span><span class="bar"><i style="width:${pct}%"></i></span><span class="num">${disp}</span></div>`;
    })
    .join("");
}

function renderBreakdowns() {
  const b = data.breakdowns || {};
  const byKey = (arr) => (arr || []).map((x) => [x[Object.keys(x)[0]], x.count]);
  const status = byKey(b.status);
  const mode = byKey(b.mode);
  const actor = byKey(b.actorType);
  $("#byStatus").innerHTML = bars(status, Math.max(...status.map((r) => r[1]), 1));
  $("#byMode").innerHTML = bars(mode, Math.max(...mode.map((r) => r[1]), 1));
  $("#byActor").innerHTML = bars(actor, Math.max(...actor.map((r) => r[1]), 1));
  const died = status.filter(([k]) => k === "cancelled" || k === "expired").reduce((a, r) => a + r[1], 0);
  const total = status.reduce((a, r) => a + r[1], 0);
  const diedNote = document.createElement("p");
  diedNote.className = "note";
  diedNote.textContent = total
    ? `${nf.format(died)} of ${nf.format(total)} tasks (${Math.round((died / total) * 100)}%) ended cancelled or expired without a winner.`
    : "";
  $("#byStatus").appendChild(diedNote);
  $("#openByChain").innerHTML = bars(
    data.openByChain.map((c) => [`${c.name} · ${c.currency}`, c.openTasks, false]),
    Math.max(...data.openByChain.map((c) => c.openTasks), 1)
  ) + `<p class="note">${data.openByChain.map((c) => `${c.name}: ${money(c.openRewards)} open`).join(" · ")}</p>`;
}

function renderPosters() {
  const pp = data.postersPerWeek || [];
  if (!pp.length) { $("#postersChart").innerHTML = "<p class='note'>No poster data in this window.</p>"; return; }
  const W = 980, H = 220, P = 34;
  const max = Math.max(...pp.map((p) => p.posters), 1);
  const bw = (W - 2 * P) / pp.length;
  const barsSvg = pp.map((p, i) => {
    const h = (p.posters / max) * (H - 2 * P);
    const x = P + i * bw + 4;
    return `<rect x="${x.toFixed(1)}" y="${(H - P - h).toFixed(1)}" width="${(bw - 8).toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="#E74079"><title>Week of ${p.week}: ${p.posters} distinct posters</title></rect>
    <text x="${(x + (bw - 8) / 2).toFixed(1)}" y="${(H - P - h - 6).toFixed(1)}" fill="#EFE9E2" font-size="12" text-anchor="middle">${p.posters}</text>
    <text x="${(x + (bw - 8) / 2).toFixed(1)}" y="${H - 10}" fill="#B0A79D" font-size="10" text-anchor="middle">${p.week.slice(5)}</text>`;
  }).join("");
  $("#postersChart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Distinct posters per week">${barsSvg}</svg>`;
  const total = data.topPosters.reduce((a, p) => a + p.tasks, 0);
  const recent = pp.length ? data.topPosters : [];
  $("#topPosters").innerHTML = recent.length
    ? bars(recent.map((p) => [shortAddr(p.address), p.tasks, false]), Math.max(...recent.map((p) => p.tasks), 1))
      + `<p class="note">The top ${recent.length} posters account for ${Math.round(recent.reduce((a, p) => a + (p.share || 0), 0) * 100)}% of tasks in the recent window (${total} tasks from ${nf.format(data.postersPerWeek.reduce((a, w) => a + w.posters, 0))} distinct posters counted across weeks). Addresses are shown shortened; no names are attached to them.</p>`
    : "<p class='note'>No poster data in this window.</p>";
}

function renderHeat() {
  const h = state.heatDim === "hourOfWeek" ? data.heatHour : data.heatMode;
  if (!h || !h.cells) { $("#heatGrid").innerHTML = "<p class='note'>No heatmap data.</p>"; return; }
  const max = Math.max(...h.cells.map((c) => c.count), 1);
  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const isHour = state.heatDim === "hourOfWeek";
  let html = "<table><thead><tr><th></th>";
  for (const c of h.colKeys) html += `<th>${isHour ? c : String(c).slice(5)}</th>`;
  html += "</tr></thead><tbody>";
  h.rowKeys.forEach((row, ri) => {
    html += `<tr><th>${isHour ? dayNames[ri] || row : esc(row)}</th>`;
    for (const col of h.colKeys) {
      const cell = h.cells.find((c) => c.row === String(ri) && c.col === String(h.colKeys.indexOf(col)));
      const v = cell ? cell.count : 0;
      const a = v / max;
      const bg = a > 0 ? `background:rgba(231,64,121,${(0.15 + 0.85 * a).toFixed(2)})` : "";
      html += `<td style="${bg}" title="${esc(row)} × ${esc(col)}: ${v}">${v > 0 && h.colKeys.length <= 24 ? v : ""}</td>`;
    }
    html += "</tr>";
  });
  html += "</tbody></table>";
  $("#heatGrid").innerHTML = html;
}

function renderFeed() {
  const items = (data.feed || []).slice(0, 50);
  $("#feedList").innerHTML = items.map((it) => {
    const verb = { task_submitted: "submitted to", task_created: "posted", task_completed: "completed", task_accepted: "accepted", payout_released: "was paid for" }[it.type] || it.type.replace(/_/g, " ");
    const who = it.actorAgentId ? `agent #${it.actorAgentId}` : shortAddr(it.actor);
    const amt = it.amount ? ` · ${money(Number(it.amount) / 1e6)}` : "";
    return `<li><span class="t">${ago(it.timestamp)}</span><span><span class="who">${esc(who)}</span> <span class="a">${verb}</span> <a href="https://taskmarket.dev/tasks/${esc(it.taskId)}">${esc(it.taskTitle || "a task")}</a>${amt}</span></li>`;
  }).join("") || "<li>No activity in this feed window.</li>";
}

function renderTasks() {
  const rows = (data.openTasks || []).map((t) => `<tr>
    <td><a href="https://taskmarket.dev/tasks/${esc(t.id)}">${esc(t.title || "Untitled task")}</a></td>
    <td><span class="amt">${money(t.reward)} ${esc(t.currency)}</span></td>
    <td><span class="pill">${t.chainId === 8453 ? "Base" : "Tempo"}</span></td>
    <td>${esc(t.mode || "—")}</td>
    <td>${nf.format(t.submissionCount || 0)}</td></tr>`).join("");
  $("#taskTable tbody").innerHTML = rows || "<tr><td colspan='5'>No open tasks returned.</td></tr>";
}

function bindSeg(id, key, cb) {
  document.querySelectorAll(`#${id} button`).forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll(`#${id} button`).forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      state[key] = b.dataset[key];
      cb();
    });
  });
}

bindSeg("chainSeg", "chain", load);
bindSeg("rangeSeg", "range", load);
bindSeg("metricSeg", "metric", renderTrends);
bindSeg("heatSeg", "heat", renderHeat);

load();
setInterval(load, 15 * 60 * 1000); // keep the page fresh; the server revalidates at least hourly

// Deep links: ?view=flow (or any section id) scrolls straight there.
const view = new URLSearchParams(location.search).get("view");
if (view && document.getElementById(view)) {
  document.getElementById(view).scrollIntoView();
}
