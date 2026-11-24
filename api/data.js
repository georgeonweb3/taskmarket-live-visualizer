// Taskmarket live market visualizer — server-side data aggregator.
// Fetches Taskmarket's public APIs server-side (the API blocks browser/CORS
// requests), aggregates them, and caches the result. No keys, no wallet,
// no personal data. Every number returned can be reproduced from
// https://api.taskmarket.dev (see the `endpoints` array in the response).

const BASE = "https://api.taskmarket.dev";
const OUSD = 1e6; // base units per stablecoin unit (OUSD on Tempo, USDC on Base)

// In-memory cache: 10 minutes. The CDN layer adds s-maxage=3600 so the
// page is refreshed at least hourly and cached for at least 60 seconds.
const cache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

async function getJSON(url, timeoutMs = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": "taskmarket-live-visualizer/1.0 (+https://taskmarket.dev)" },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

function isoWeekStart(d) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (x.getUTCDay() + 6) % 7; // Monday = 0
  x.setUTCDate(x.getUTCDate() - day);
  return x.toISOString().slice(0, 10);
}

async function fetchTaskPages(chainId, { status, pages = 3, since } = {}) {
  const out = [];
  let cursor = null;
  for (let p = 0; p < pages; p++) {
    const q = new URLSearchParams({ chainId: String(chainId), sort: "newest", limit: "100" });
    if (status) q.set("status", status);
    if (cursor) q.set("cursor", cursor);
    const d = await getJSON(`${BASE}/api/tasks?${q}`);
    const tasks = d.tasks || [];
    out.push(...tasks);
    if (since && tasks.length) {
      const oldest = tasks[tasks.length - 1].createdAt;
      if (oldest && new Date(oldest) < since) break;
    }
    if (!d.hasMore || !d.nextCursor) break;
    cursor = d.nextCursor;
  }
  return out;
}

export default async function handler(req, res) {
  const url = new URL(req.url, "http://localhost");
  const range = ["7d", "30d", "90d", "all"].includes(url.searchParams.get("range"))
    ? url.searchParams.get("range")
    : "30d";
  const chain = ["4217", "8453", "all"].includes(url.searchParams.get("chain"))
    ? url.searchParams.get("chain")
    : "all";
  const cacheKey = `${range}:${chain}`;
  const now = Date.now();

  const hit = cache.get(cacheKey);
  if (hit && now - hit.at < CACHE_TTL_MS) {
    res.setHeader("cache-control", "public, s-maxage=3600, stale-while-revalidate=86400");
    res.setHeader("content-type", "application/json");
    return res.status(200).json({ ...hit.data, cached: true });
  }

  const bucket = range === "all" ? "week" : "day";
  const since = new Date(now - 56 * 24 * 3600 * 1000); // 8 weeks back for posters/week

  const endpoints = [
    "/api/market/stats",
    "/api/stats/breakdowns",
    `/api/stats/platform-time-series?range=${range}&bucket=${bucket}`,
    "/api/stats/activity-heatmap?range=30d&dimension=hourOfWeek",
    "/api/stats/activity-heatmap?range=30d&dimension=mode",
    "/api/stats/activity-feed?limit=50",
    "/api/tasks?chainId=4217&status=open&limit=100",
    "/api/tasks?chainId=8453&status=open&limit=100",
  ];

  const settled = await Promise.allSettled([
    getJSON(`${BASE}/api/market/stats`),
    getJSON(`${BASE}/api/stats/breakdowns`),
    getJSON(`${BASE}/api/stats/platform-time-series?range=${range}&bucket=${bucket}`),
    getJSON(`${BASE}/api/stats/activity-heatmap?range=30d&dimension=hourOfWeek`),
    getJSON(`${BASE}/api/stats/activity-heatmap?range=30d&dimension=mode`),
    getJSON(`${BASE}/api/stats/activity-feed?limit=50`),
    fetchTaskPages(4217, { status: "open" }),
    fetchTaskPages(8453, { status: "open" }),
    fetchTaskPages(4217, { pages: 3, since }),
    fetchTaskPages(8453, { pages: 3, since }),
  ]);

  const val = (i, fallback) => (settled[i].status === "fulfilled" ? settled[i].value : fallback);
  const market = val(0, null);
  const breakdowns = val(1, null);
  const series = val(2, []);
  const heatHour = val(3, null);
  const heatMode = val(4, null);
  const feed = val(5, { items: [] });
  const openTempo = val(6, []);
  const openBase = val(7, []);
  const recentTempo = val(8, []);
  const recentBase = val(9, []);

  const chainOpen = chain === "4217" ? openTempo : chain === "8453" ? openBase : [...openTempo, ...openBase];
  const recent = chain === "4217" ? recentTempo : chain === "8453" ? recentBase : [...recentTempo, ...recentBase];

  // Range totals from the time series (platform-wide: the API returns the
  // same series for either chainId, verified 2026-11-24).
  const totals = series.reduce(
    (a, b) => ({
      tasksCreated: a.tasksCreated + (b.tasksCreated || 0),
      rewardVolume: a.rewardVolume + Number(b.rewardVolume || 0),
      completedTasks: a.completedTasks + (b.completedTasks || 0),
      newAgents: a.newAgents + (b.newAgents || 0),
      activeAgents: a.activeAgents + (b.activeAgents || 0),
      paidVolume: a.paidVolume + Number(b.paidVolume || 0),
      settlements: a.settlements + (b.settlements || 0),
    }),
    { tasksCreated: 0, rewardVolume: 0, completedTasks: 0, newAgents: 0, activeAgents: 0, paidVolume: 0, settlements: 0 }
  );

  // Distinct task posters per week, computed from the task list.
  const byWeek = new Map();
  for (const t of recent) {
    if (!t.createdAt || !t.requester) continue;
    const w = isoWeekStart(new Date(t.createdAt));
    if (!byWeek.has(w)) byWeek.set(w, new Set());
    byWeek.get(w).add(t.requester.toLowerCase());
  }
  const postersPerWeek = [...byWeek.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-8)
    .map(([week, set]) => ({ week, posters: set.size }));

  // Concentration: share of recent tasks from the top posters.
  const posterCounts = new Map();
  for (const t of recent) {
    if (!t.requester) continue;
    const k = t.requester.toLowerCase();
    posterCounts.set(k, (posterCounts.get(k) || 0) + 1);
  }
  const topPosters = [...posterCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([address, tasks]) => ({ address, tasks, share: recent.length ? tasks / recent.length : 0 }));

  const sumReward = (list) => list.reduce((a, t) => a + Number(t.reward || 0), 0);
  const openByChain = [
    { chainId: 4217, name: "Tempo", currency: "OUSD", openTasks: openTempo.length, openRewards: sumReward(openTempo) / OUSD },
    { chainId: 8453, name: "Base", currency: "USDC", openTasks: openBase.length, openRewards: sumReward(openBase) / OUSD },
  ];
  const openTasks = [...openTempo, ...openBase]
    .sort((a, b) => Number(b.reward || 0) - Number(a.reward || 0))
    .slice(0, 15)
    .map((t) => ({
      id: t.id,
      title: (t.description || "").split("\n")[0].slice(0, 120),
      reward: Number(t.reward || 0) / OUSD,
      currency: t.chainId === 8453 ? "USDC" : "OUSD",
      chainId: t.chainId,
      status: t.status,
      mode: t.mode,
      createdAt: t.createdAt,
      expiryTime: t.expiryTime,
      submissionCount: t.submissionCount || 0,
    }));

  // Total upstream failure: say so (502) instead of serving a page of zeros.
  if (!market && !series.length && !(feed.items || []).length) {
    res.setHeader("content-type", "application/json");
    return res.status(502).json({ error: "TaskMarket API unreachable from the server", asOf: new Date(now).toISOString() });
  }

  const data = {
    asOf: new Date(now).toISOString(),
    range,
    chain,
    market,
    breakdowns,
    series,
    heatHour,
    heatMode,
    feed: feed.items || [],
    postersPerWeek,
    topPosters,
    openByChain,
    openTasks,
    totals: {
      ...totals,
      rewardVolume: totals.rewardVolume / OUSD,
      paidVolume: totals.paidVolume / OUSD,
    },
    chainNote:
      "Headline stats, time series, heatmaps and the activity feed are platform-wide: the TaskMarket API returns the same values for chainId=4217 and chainId=8453 on those endpoints (verified 2026-11-24). Task lists, open rewards and posters-per-week are computed per chain from /api/tasks.",
    endpoints,
    cached: false,
  };

  cache.set(cacheKey, { at: now, data });
  res.setHeader("cache-control", "public, s-maxage=3600, stale-while-revalidate=86400");
  res.setHeader("content-type", "application/json");
  return res.status(200).json(data);
}
