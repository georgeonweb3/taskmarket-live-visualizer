// Build-time data generator for static hosting (GitHub Pages).
// Calls the same server-side aggregator as the Vercel function
// (api/data.js) for every range x chain combination and writes one JSON
// snapshot per combination into data/. The page falls back to these files
// when /api/data is not available. Run: node scripts/build-data.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import handler from "../api/data.js";

// Memoize upstream fetches across the 12 combos: the payloads differ only
// in range (time series) and chain (task-list slice). Without this, each
// combo re-fetches ~16 upstream URLs — slow and flaky through a proxy.
// Only successful JSON is cached; failures retry once after 3s and are not
// cached. The handler's getJSON only needs { ok, json() } on the response.
const fetchCache = new Map();
const rawFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const key = String(url);
  if (fetchCache.has(key)) {
    const data = fetchCache.get(key);
    return { ok: true, status: 200, json: async () => data };
  }
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await rawFetch(url, opts);
      if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`);
      const data = await r.json();
      fetchCache.set(key, data);
      return { ok: true, status: 200, json: async () => data };
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw lastErr;
};

const OUT = new URL("../data/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const ranges = ["7d", "30d", "90d", "all"];
const chains = ["all", "4217", "8453"];

for (const range of ranges) {
  for (const chain of chains) {
    let done = false;
    for (let attempt = 1; attempt <= 3 && !done; attempt++) {
      const req = { url: `/api/data?range=${range}&chain=${chain}` };
      let body = null;
      let code = null;
      const res = {
        setHeader() {},
        status(c) { code = c; return this; },
        json(d) { body = d; },
      };
      await handler(req, res);
      if (code === 200) {
        writeFileSync(`${OUT}data-${range}-${chain}.json`, JSON.stringify(body));
        console.log(`ok data-${range}-${chain}.json asOf=${body.asOf} series=${body.series.length} feed=${body.feed.length}`);
        done = true;
      } else if (attempt < 3) {
        console.error(`RETRY ${range}/${chain} attempt ${attempt}: HTTP ${code}`);
        await new Promise((r) => setTimeout(r, 5000));
      } else {
        console.error(`FAILED ${range}/${chain}: HTTP ${code}`, JSON.stringify(body).slice(0, 300));
        process.exitCode = 1;
      }
    }
  }
}
