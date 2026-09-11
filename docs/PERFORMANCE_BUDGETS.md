# Performance budgets

These budgets cover the task and list paths used by the web app and incremental
sync clients. They are release gates, not production promises: measure before
deployment and investigate any regression before raising a budget.

**Every row below names the thing that produces its number.** A budget whose
source is "none" is not a target, it is decoration — this document carried a
Core Web Vitals row for eleven days after the only tool that could measure it
was removed. Rows without a source are now marked as such, with the work to
give them one filed, rather than stated as if they were being checked.

| Metric | Critical read budget | Source | Last measured |
|---|---:|---|---|
| Server latency | p50 <= 250 ms; p95 <= 750 ms | `scripts/measure-api-latency.ts` | 2026-09-11 |
| Full task response | <= 500 KiB **on the wire** | `scripts/measure-api-latency.ts` | 2026-09-11 |
| Full list response | <= 250 KiB **on the wire** | `scripts/measure-api-latency.ts` | 2026-09-11 |
| Prisma work | <= 4 queries; p95 aggregate query time <= 300 ms | contract tests pin the query shape and count | pinned continuously |
| Incremental sync response | <= 100 KiB and <= 1 MiB across all pages | `scripts/measure-api-latency.ts` (route not yet added) | never |
| Server error rate | < 1% | `vercel logs` status codes — sample too small to assert, see below | 2026-09-11, indicative only |
| Redis cache hit rate | >= 80% after warm-up | **no source in production** — see below | never |
| Initial JavaScript | <= 250 KiB compressed | shared baseline only — see below | 2026-09-11 |
| Core Web Vitals | *removed* — see below | **no source** | never |

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

**Core Web Vitals — removed from the table.** PostHog went on 2026-09-06
(`a0373f86`) and nothing replaced it. There is no `web-vitals` dependency and
no `useReportWebVitals` call anywhere in `app/`, `lib/` or `components/`.
Restoring the row needs more than a client hook: `AnalyticsEvent.userId` is
non-nullable with an FK to `User`, so the existing first-party analytics table
cannot store a vital for a logged-out visitor, which is exactly where LCP
matters most. Filed as e586eff1 rather than left as a promised number.
Note for whoever takes it: CWV is defined at **p75**, not the p50/p95 the rest
of this document uses.

**Redis cache hit rate — emitted, but not observable in production.** PR #260
added structured outcome events (`Cache lookup` / `Cache load` in
`lib/redis.ts`), and they are correct. They are logged at `debug`.
`lib/logger.ts` defaults production to `info`, and no `LOG_LEVEL` is set on the
Vercel project, so these events are discarded before they reach a log. The
counters behind `RedisCache.getMetrics()` are also process-local, so they
describe one lambda instance rather than the fleet. Sampling the hit rate needs
either `LOG_LEVEL=debug` in production (loud, and the reason the events were
moved to debug in the first place) or a deliberate metrics surface. Filed as
2b89739c.

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
