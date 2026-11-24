# Taskmarket, live

A public, live dashboard of [Taskmarket](https://taskmarket.dev)'s market data — headline numbers, trends, tasks by mode and status, posters per week, an activity heatmap and a live feed, for both Tempo and Base.

Built for the paid Taskmarket bounty **"Build and host Taskmarket's live market visualizer (50 OUSD)"** (task `TSK-BRK611AN`). This is not an official Taskmarket product.

## Live

The dashboard is hosted at the URL in `notes.txt`. It loads in under 3 seconds on a phone, needs no login and no wallet, and stays up for at least 30 days after payout.

## How it works

Taskmarket's public API does not accept browser requests from other sites, so the data is fetched on the server and cached:

- `api/data.js` — one Node serverless function. It fetches Taskmarket's public endpoints in parallel (market stats, breakdowns, time series, heatmaps, activity feed, task lists for both chains), computes the derived views (distinct posters per week, concentration, open rewards per chain), and returns one JSON document with a visible `asOf` timestamp.
- The page (`index.html` + `app.js` + `styles.css`) renders that JSON. No build step, no dependencies, no analytics, no tracking, no wallet connection.
- Cache: the function caches in memory for 10 minutes and sets `s-maxage=3600`, so the page is refreshed at least hourly and cached for at least 60 seconds.

Every number can be reproduced from the public API at `https://api.taskmarket.dev`. No names or identities are attached to wallet addresses. No number is invented.

## Endpoints used

- `/api/market/stats` — headline numbers
- `/api/stats/breakdowns` — tasks by status, mode, actor type
- `/api/stats/platform-time-series?range=7d|30d|90d|all&bucket=day|week`
- `/api/stats/activity-heatmap?range=30d&dimension=hourOfWeek|mode`
- `/api/stats/activity-feed?limit=50`
- `/api/tasks?chainId=4217|8453&status=open&sort=newest&limit=100`

One honest wrinkle, verified live on 2026-11-24: the headline stats, time series, heatmaps and activity feed are platform-wide — the API returns the same values for `chainId=4217` and `chainId=8453` on those endpoints. Task lists, open rewards and posters-per-week are computed per chain from `/api/tasks`, and the page says so in its methods note.

## Brand

Follows the [Taskmarket brand kit](https://gist.github.com/ponderingdemocritus/05b7371bb286ab09c9f3f26bc2af9636/af55554d77b0627ff96b52a82a2f3b94b9cab387): ground `#12100E`, panel `#221E1A`, magenta `#E74079` as the single accent, Instrument Serif headlines, Inter Tight body, Departure Mono for addresses and commands. The Taskmarket lockup is hotlinked from the official brand kit.

## Deploy

One command, from this repo:

```sh
vercel --prod
```

No environment variables, no secrets, no build step. Or link the repo in the Vercel dashboard and every push to `main` deploys automatically.

## Local dev

```sh
npx vercel dev
```

Then open http://localhost:3000. The `/api/data` function runs locally the same way it runs in production.

## Licence

MIT — see `LICENSE`. Paid entries also grant the bounty requester a perpetual, worldwide, royalty-free licence to use, host, adapt and promote the dashboard and its screenshots, per the bounty terms.
