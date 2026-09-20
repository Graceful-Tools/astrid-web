# Performance budgets

These budgets cover the task and list paths used by the web app and incremental
sync clients. They are release gates, not production promises: measure before
deployment and investigate any regression before raising a budget.

**Every row below names the thing that produces its number.** A budget whose
source is "none" is not a target, it is decoration. Rows without a source are
marked as such, with the work to give them one filed, rather than stated as if
they were being checked.

The converse matters too, and this document got it wrong once: a row marked
"no source" when a source exists sends the next reader off to build one. The
Core Web Vitals row said exactly that for five days while Vercel Speed
Insights was collecting the numbers — see below.

| Metric | Critical read budget | Source | Last measured |
|---|---:|---|---|
| Server latency | p50 <= 250 ms; p95 <= 750 ms | `scripts/measure-api-latency.ts` | 2026-09-11 |
| Full task response | <= 500 KiB **on the wire** | `scripts/measure-api-latency.ts` | 2026-09-11 |
| Full list response | <= 250 KiB **on the wire** | `scripts/measure-api-latency.ts` | 2026-09-11 |
| Prisma work | <= 4 queries; p95 aggregate query time <= 300 ms | contract tests pin the query shape and count | pinned continuously |
| Incremental sync response | <= 100 KiB and <= 1 MiB across all pages | `scripts/measure-api-latency.ts` (route not yet added) | never |
| Server error rate | < 1% | `vercel logs` status codes — sample too small to assert, see below | 2026-09-11, indicative only |
| Redis cache hit rate | >= 80% after warm-up | `scripts/measure-cache-hit-rate.ts` (needs the deploy carrying it) | **not yet sampled** |
| Initial JavaScript | <= 250 KiB compressed | shared baseline only — see below | 2026-09-11 |
| Core Web Vitals (p75) | LCP <= 2.5 s; INP <= 200 ms; CLS <= 0.1 | Vercel Speed Insights — dashboard only, see below | **not yet transcribed** |

## Compressed or decoded: say which, or the budget means nothing

The response-size rows are **on-the-wire (gzipped)** bytes. This is not a
detail. Measured 2026-09-11, `GET /api/v1/tasks?limit=1000&leanListMembers=1`
was:

- **439.5 KiB gzipped** — 88% of the 500 KiB budget, inside it
- **2,301.6 KiB decoded** — 4.6x over the same budget

Same response, same budget, opposite verdicts. The wire figure is the one the
budget is written against, because that is what `%{size_download}` reports in
the curl recipe below and what a client waits for on a slow connection. The
decoded figure is reported alongside it because that is what parses and stays
resident on a phone, and 2.3 MiB of it is worth knowing about.

## Reproducible measurement

```bash
npx tsx scripts/measure-api-latency.ts --samples 30      # latency + sizes
npx tsx scripts/index-drop-evidence.ts --prod            # index plans (AWTD-855)
npx tsx scripts/measure-cache-hit-rate.ts --hours 24     # Redis hit rate (2b89739c)
```

`measure-api-latency.ts` times the critical reads against production over
HTTPS with an OAuth token, discarding warm-ups, and judges p50/p95 and wire
size against the table above. It measures **wall clock from the machine
running it**, so it includes DNS, TLS and network: that is an *upper bound* on
server latency. A p95 inside budget proves the server is inside budget; a p95
over budget needs a second look before it is called a server regression.

For a controlled comparison, use a preview populated with production-shaped
synthetic data and record at least 30 warm and 30 cold requests for:

- `GET /api/v1/tasks?limit=1000&leanListMembers=1`
- `GET /api/v1/tasks?updatedSince=<cursor>&leanListMembers=1`
- `GET /api/v1/lists`
- `GET /api/v1/lists?updatedSince=<cursor>`

with `curl --compressed --output <body> --write-out '%{time_total}
%{size_download}\n'`. Never point local scripts at the production *database*
for a write; read-only production queries are fine and are what
`index-drop-evidence.ts` does.

## 2026-09-11 production measurement

30 warm samples per route against `https://astrid.cc`, from a local client.

| Route | p50 | p95 | min / max | Wire | Decoded | Verdict |
|---|---:|---:|---:|---:|---:|---|
| `GET /api/v1/tasks?limit=1000&leanListMembers=1` | 419 ms | 1059 ms | 361 / 1632 ms | 439.5 KiB | 2301.6 KiB | **latency over budget** |
| `GET /api/v1/lists` | 169 ms | 232 ms | 121 / 325 ms | 31.1 KiB | 75.2 KiB | within budget |

**The full task read is over both latency budgets** (p50 419 vs 250, p95 1059
vs 750). Two runs twenty minutes apart gave p50 362/419 ms and p95 690/1059 ms,
so the variance is large and network-inclusive — this is a flag to investigate,
not yet a proven server regression. It returns exactly 1000 tasks, the `limit`
cap, so the payload is at its maximum shape. `GET /api/v1/lists` has margin
everywhere.

## Rows without a source, stated plainly

**Core Web Vitals — collected, but the number has to be read by hand.**

This section previously said CWV lost its source when PostHog was removed on
2026-09-06 (`a0373f86`), and that nothing replaced it. **That was wrong**, and
it is corrected here rather than quietly edited because the error nearly cost
a duplicate collection pipeline: task e586eff1 was filed to build one.

`app/[locale]/layout.tsx` mounts `<SpeedInsights />` from
`@vercel/speed-insights` in the root locale layout, so Vercel's Core Web
Vitals product samples **every** route, marketing and authenticated alike. The
Vercel project API confirms it is live and has been throughout:

```json
"speedInsights": { "hasData": true, "enabledAt": 1755093272781 }
```

`enabledAt` is 2025-08-13 — thirteen months before PostHog was removed. LCP,
INP and CLS were being collected before PostHog, during it, and after it. The
absence of a `web-vitals` dependency or a `useReportWebVitals` call in this
repo is real and is not evidence of anything: the Vercel component does not
use either.

**The real limitation is that Speed Insights has no public API.** The data is
visible in the Vercel dashboard and nowhere a script can reach. Probed
2026-09-11 with a `VERCEL_TOKEN` that authenticates fine against
`/v9/projects`; every plausible endpoint 404s, including
`/v1/speed-insights/vitals`, `/v1/speed-insights/<speedInsightsId>/vitals`,
`/v1/projects/<projectId>/speed-insights/vitals` and `/v2/speed-insights/vitals`.

So this row's procedure is manual, like the `vercel logs` rows above it:

> Open the project's Speed Insights tab in the Vercel dashboard, read the
> **p75** for LCP, INP and CLS over the last 28 days, and record them here
> with the date.

**Use p75.** CWV thresholds are defined at the 75th percentile; the rest of
this document uses p50/p95, and copying that convention here would produce
numbers that do not mean what the thresholds mean. The budgets in the row
above are Google's "good" thresholds.

The cells are marked *not yet transcribed* rather than filled with a guess.
Whether the eventual source stays the dashboard or becomes a first-party
pipeline (a client reporter, an unauthenticated ingest endpoint, and a
`WebVitalSample` table, since `AnalyticsEvent.userId` is non-nullable and
cannot hold a sample from a logged-out visitor) is the open question on
e586eff1 — it buys scriptability, at the price of a second pipeline beside a
working one and a new production table.

**Redis cache hit rate — a surface now exists; the sample waits on a deploy.**

The problem was never that the outcomes were not recorded. PR #260's
structured `Cache lookup` / `Cache load` events in `lib/redis.ts` are correct
and are still there, still at `debug` — deliberately, because they are
per-lookup and promoting them to `info` would trade a logging-cost regression
for a metric. Production defaults to `info` and no `LOG_LEVEL` is set on the
Vercel project, so those events never reach a log, and that stays true.

`RedisCache` now also emits **one `info` event per process per 60s window**,
`Cache metrics window`, carrying that window's counts. Three properties make
it usable, and each is there to avoid a specific wrong number:

- **It fires on elapsed time, not on lookup count**, so its volume is bounded
  however hot the path gets. That is what lets it sit at `info` when the
  per-lookup events cannot.
- **It reports deltas, not lifetime totals.** `RedisCache`'s counters are
  process statics, cumulative for the life of the instance; logging those
  repeatedly makes them unsummable, because the same hits reappear in every
  event. Deltas sum by construction.
- **It is emitted from the request path**, not from a cron. A cron invocation
  is its own process whose cache counters describe the cron, not the lambdas
  serving `GET /api/v1/tasks` — the same reason reading `getMetrics()` from a
  single request is not the fleet's hit rate.

```bash
npx tsx scripts/measure-cache-hit-rate.ts --hours 24
```

sums those windows and divides **once** at the end. The fleet rate is not the
mean of the per-window rates: an instance that served three lookups and one
that served thirty thousand each contribute one `hitRate` field, and averaging
them weights them equally.

**Not yet sampled, and the row says so.** The event only exists in code;
production deploys are manual, so nothing has emitted one yet. Tracked on
2b89739c, which is parked on that deploy.

One thing for whoever takes the sample: the ~50-unique-row ceiling described
under *Server error rate* applies here too. One event per instance per minute
is far thinner than per-request rows and should fit, but the script refuses to
report a rate from fewer than 20 windows rather than printing a confident
percentage over four — which is how the error-rate row became unprovable.

**Server error rate — sample too small to assert.** The Vercel CLI returns only
~50 unique log rows per query and pads beyond that, so walking windows across
7 days yielded 30 serverless request rows: 28x 200, 1x 201, 1x 0. That is
consistent with the <1% budget and is nowhere near enough to demonstrate it.

**Initial JavaScript — the stated source no longer exists.** This row used to
say "from the `next build` route output". Under Next 16.3.1 with Turbopack the
route table has no First Load JS column at all; the sizes are simply not
emitted. What is still measurable from `.next/build-manifest.json` is the
shared bundle every app route loads: **166.5 KiB gzipped** (540.4 KiB raw) on
2026-09-11, against the 250 KiB budget. That is a *lower bound* — the
route-specific increment for the task-list route is not included, and is
currently unmeasured.

**Why `vercel logs` cannot supply latency.** Recorded because two prior reviews
of the budgets task asserted that it could. The runtime-log JSON the CLI emits
carries exactly: `id`, `timestamp`, `deploymentId`, `projectId`, `level`,
`message`, `source`, `domain`, `requestMethod`, `requestPath`,
`responseStatusCode`, `environment`, `branch`, `cache`, `traceId`. There is no
duration field to filter for. Application logs do carry `durationMs`, but only
where the code logs it itself, which today is the cron jobs and not the request
path.

## 2026-08-31 structural baseline

Established by contract tests rather than observation, which is what makes a
regression fail the gate instead of showing up in a graph later.

| Path | Before | After |
|---|---:|---:|
| `POST /api/v1/tasks` list validation | Every scalar on `TaskList` and `ListMember`, plus four user and four owner fields | 10 contract-required scalar fields; no user or owner relation |
| Three concurrent cold cache reads | 1 loader call, 3 misses, no coalescing metric | 1 loader call, 3 misses, 2 coalesced loads |
| Cache hit/miss logging | One info event per lookup | Debug-level structured outcome events |
| `GET /api/v1/lists` task counts | Correlated `_count.tasks` per list plus the contract count query | Contract count query only |
| `POST /api/v1/lists` task counts | Correlated `_count.tasks` plus a follow-up query | No count query; a new list returns the same `taskCount: 0` |

## Index work

Index decisions live in AWTD-855 and are settled with production query plans,
not with this document. `scripts/index-drop-evidence.ts --prod` produces them
read-only. The 2026-09-11 run found 9 of 14 prefix-redundant indexes actively
chosen by the planner — see `tests/rules/schema-redundant-indexes.test.ts`,
which records the evidence for each one that was kept.
