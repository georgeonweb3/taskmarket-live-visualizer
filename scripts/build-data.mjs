// Build-time data generator for static hosting (GitHub Pages).
// Calls the same server-side aggregator as the Vercel function
// (api/data.js) for every range x chain combination and writes one JSON
// snapshot per combination into data/. The page falls back to these files
// when /api/data is not available. Run: node scripts/build-data.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import handler from "../api/data.js";

const OUT = new URL("../data/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const ranges = ["7d", "30d", "90d", "all"];
const chains = ["all", "4217", "8453"];

for (const range of ranges) {
  for (const chain of chains) {
    const req = { url: `/api/data?range=${range}&chain=${chain}` };
    let body = null;
    let code = null;
    const res = {
      setHeader() {},
      status(c) { code = c; return this; },
      json(d) { body = d; },
    };
    await handler(req, res);
    if (code !== 200) {
      console.error(`FAILED ${range}/${chain}: HTTP ${code}`, JSON.stringify(body).slice(0, 300));
      process.exitCode = 1;
      continue;
    }
    writeFileSync(`${OUT}data-${range}-${chain}.json`, JSON.stringify(body));
    console.log(`ok data-${range}-${chain}.json asOf=${body.asOf} series=${body.series.length} feed=${body.feed.length}`);
  }
}
