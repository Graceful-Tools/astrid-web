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
| Server latency | p50 <= 250 ms; p95 <= 750 ms | `scripts/measure-api-latency.ts` | 2026-10-22 — p50 **497**, p95 648: **p50 OVER** (also over on 2026-09-11 and 2026-10-12, below) |
| Task payload **regression** | <= 135 bytes/task on the wire, measured with `?omit=description` | `scripts/measure-api-latency.ts` | 2026-10-12 — **112.0**, within |
| Full task **page** (1,000 tasks) | <= 500 KiB **on the wire** — a client-experience cap, not a regression gate | `scripts/measure-api-latency.ts` | 2026-10-12 — **553.5 KiB, OVER** |
| Full list response | <= 250 KiB **on the wire** | `scripts/measure-api-latency.ts` | 2026-10-12 — 37.3 KiB |
| Prisma work | <= 4 queries; p95 aggregate query time <= 300 ms | contract tests pin the query shape and count | pinned continuously |
| Incremental sync response | <= 100 KiB and <= 1 MiB across all pages | `scripts/measure-api-latency.ts` (route not yet added) | never |
| Server error rate | < 1% | `vercel logs` status codes — sample too small to assert, see below | 2026-09-11, indicative only |
| Redis cache hit rate | >= 60% after warm-up (re-based 2026-10-16, AWTD-1201 — was >= 80%) | `/admin/analytics` → **Redis Cache**, per day, from the `CacheMetricBucket` table | 2026-10-16: **66.3% over the last 7 days — within budget**; 70.6% since recording began 2026-09-25. See below |
| Initial JavaScript | <= 250 KiB compressed | shared baseline only — see below | 2026-09-11 |
| Core Web Vitals (p75) | LCP <= 2.5 s; INP <= 200 ms; CLS <= 0.1 | Vercel Speed Insights (history, dashboard only) + `scripts/measure-web-vitals.ts` (scriptable, no history yet) — see below | **not yet transcribed** |
| GitHub Projects webhook ack | p95 <= 300 ms (delivery check, one indexed read, one insert; work runs after the response) | `vercel logs --query projects_v2_item` route timings; shape pinned by `tests/api/github-projects-webhook.test.ts` (AWTD-1152) | 2026-10-21 (AWTD-1159): the lanes-test brand has it on and its App is delivering. GitHub's own delivery log reports **p50 360 ms, p95 1040 ms** over 58 `projects_v2_item` deliveries, all HTTP 200. **Not comparable to this budget**: GitHub's `duration` is its whole round trip — DNS, TLS, network and any cold start — while the budget is route time. Route time still unmeasured; see below |
| GitHub Projects edit → replica | p95 <= 10 s from a github.com edit to the Astrid row | `npm run test:live:github-projects` (AWTD-1154) measures edit → hydrate job → replica; the webhook leg needs a deployed GitHub-Projects brand | 2026-10-21 (AWTD-1159), on the deployed lanes-test brand: webhook received → replica written is **p50 616 ms, p95 840 ms, max 1.34 s** over 67 first-attempt hydrate jobs. With the ack above that is **~1.9 s at p95**, against a 10 s budget. The one leg still unmeasured is github.com edit → GitHub delivering; see below. (2026-10-10: ~1.0–1.2 s for edit → hydrate → replica locally, webhook leg excluded, one run) |
| GitHub Projects apply | <= 4 queries per item event; no N+1 | `tests/services/github-projects-apply-query-budget.test.ts` pins the statement count through the real field and iteration passes (AWTD-1297); `tests/services/github-projects-service.test.ts` pins the reads (AWTD-1151); `npm run test:live:github-projects` counts real queries (AWTD-1154) | 2026-10-10: **3** for one changed item; an import page is **25 fixed + 0 per item**, so 0.25 per item at 100-item pages. 2026-10-21: P6a/P6c had pushed one changed item to **10** (live); AWTD-1297 brings it back to **3** (≤ 4 when the task holds field values) in the contract test, live re-run pending. A task holding mirrored labels, milestones or iterations still costs more (AWTD-1315) |
| GitHub Projects initial import | 2,000-item project <= 5 min | `npm run test:live:github-projects` (AWTD-1154) | 2026-10-10: 3 items in ~0.6 s. **2,000 not yet measured**: GitHub's content-creation caps make seeding 2,000 items a multi-hour job |
| GitHub reconcile share | <= 30% of an installation's hourly GraphQL budget | `admit()` in `lib/github/rate-limiter.ts`, table-tested (AWTD-1150) | pinned continuously |

## One number cannot be both a regression gate and a size cap (AWTD-1238)

The task response used to have a single budget: 500 KiB on the wire, measured
against **the live account's own data**, which grows every time anyone — human
or agent — files a well-described task. So the number moved for two completely
different reasons and could not tell them apart:

- **the code changed** — a field was added, a relation got fatter, something
  serialized worse. That is what a budget is for.
- **the content grew** — people wrote more. On 2026-10-12 that was the entire
  story: the response was 10% over and `description` was 80% of it, while every
  schema addition of the previous month totalled under 2 KiB.

A breach therefore said nothing on its own, and the reflex it invited — raise
the number — is how a budget stops meaning anything.

So there are two rows now, with two jobs.

**The regression gate is per-task bytes on the LEAN read.** Both halves matter:

- *per task*, so a thousand more tasks leave it flat. A total cannot be compared
  across months when the denominator is whatever the account happens to hold.
- *lean* (`?omit=description`, AWTD-1236), so a thousand **longer** tasks leave
  it flat too. Per-task bytes alone would still drift upward as people wrote
  more — the same problem, one division later.

What remains moves only when the code moves. 112.0 bytes/task measured
2026-10-12 against a budget of 135, about 20% headroom: `assigneeIds`
(AWTD-1190) cost 1.2 bytes/task, so this absorbs many honest field additions
and still fails on anything structural.

**The page cap stays, as what it always really was** — a limit on what a
cacheless client downloads in one request. It is breached at 553.5 KiB and is
left breached rather than raised, because the answer is for callers to send
`?omit=description` or ask for a smaller page, not for the number to grow to
meet the corpus.

It will be breached again, by writing rather than by code. That is no longer a
flaw, now that it only claims to be a cap: **when it breaches, read the per-task
row before reaching for the number.**

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
npx tsx scripts/measure-cache-hit-rate.ts --hours 24     # Redis hit rate from LOGS — capped, see below
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

## 2026-10-12 — over budget, `description` is 80% of it, and project fields cannot ride it

Two measurements taken the same day, by AWTD-1231 and AWTD-1208. They share a
baseline, so they share a section.

Measured with `npx tsx scripts/measure-api-latency.ts`, same recipe as above.

| Route | p50 | p95 | Wire | Decoded | Verdict |
|---|---:|---:|---:|---:|---|
| `GET /api/v1/tasks?limit=1000&leanListMembers=1` | 831 ms | 1126 ms | **551.8 KiB** | 2875 KiB | **over the 500 KiB wire budget, and over both latency budgets** |
| `GET /api/v1/lists` | 187 ms | 188 ms | 37.3 KiB | 81.9 KiB | within budget |

The size budget is breached, not merely approached: 439.5 KiB on 2026-09-11,
551.8 KiB now — 112 KiB of growth in a month, 10% over. The decoded figure grew
with it, 2,301.6 → 2,875 KiB.

(Latency: p50 831 ms against 250 ms, but only three samples from a laptop at
night, network-inclusive. The 2026-09-11 run was also over at 419 ms. Treat this
as consistent with a known-over budget, not as a new regression.)

### What grew

Measured by dropping each top-level key from all 1,000 tasks and re-gzipping, so
each figure is that key's **marginal** wire cost rather than its share of the
decoded bytes:

| Key | Marginal wire cost |
|---|---:|
| `description` | **443.3 KiB** |
| `id` | 30.1 KiB |
| `title` | 24.6 KiB |
| `createdAt` | 10.3 KiB |
| `updatedAt` | 8.4 KiB |
| everything else (29 keys) | ~35 KiB combined |

`description` is **80% of the entire response**. The fields added since the last
measurement are nowhere near it — `assigneeIds` (AWTD-1190) costs 1.2 KiB,
`previousOccurrenceId` and the `remote`/`syncState` keys less. **No schema
addition caused this**, which is where the search would naturally have started.

The descriptions: 1,534 KiB decoded across 1,000 tasks, median 995 characters,
p90 3,771, max 20,727. A quarter of tasks have none; **325 tasks with
descriptions over 2,000 characters hold 1,161 KiB of the 1,534.**

And they are recent. Description bytes by the month the task was created:

| Month | KiB |
|---|---:|
| through 2026-06 | ~71 combined |
| 2026-07 | 96 |
| 2026-08 | 435 |
| 2026-09 | 705 |
| 2026-10 (partial) | 226 |

That is exactly the period in which agents began filing tasks with full
reproduction steps, evidence and contracts — the practice
`docs/FIXALL_WORKFLOW.md` asks for, working as intended. **The payload grew
because the content grew, not because the code regressed.**

### The project-fields gate (AWTD-1208, spec §9.4.3)

The spec required a 1,000-task x 8-field fixture before `fields` could ride task
payloads. There is no GitHub-backed board in production with a thousand tasks,
and `measure-api-latency.ts` is a read-only client that seeds nothing — so the
fixture is grafted onto the **real** thousand-task response and re-compressed,
which measures the marginal wire cost against that payload's own
compressibility.

| | Wire (gzipped) |
|---|---:|
| Baseline, 1,000 tasks | 551.8 KiB |
| With 8 project fields on every task | 594.0 KiB |
| **Marginal cost of `fields`** | **+42.2 KiB** |

**Compression is the whole story.** Uncompressed, eight entries per task is
roughly 440 KB over a thousand tasks — more than the entire budget. Gzipped it
costs 42.2 KiB, because the eight field ids repeat on every task and only the
two free-text fields carry per-task content. A guess in either direction would
have been wrong by an order of magnitude.

**Verdict: over budget, so values do not ride list responses.** 594.0 KiB
against 500 KiB. Note that the +42.2 KiB would have fitted the 60.5 KiB of
headroom the 2026-09-11 figure left; the headroom is what is gone. Either way
the spec's rule settles it — *"the budget wins over convenience"* — so
`GET /api/v1/tasks` carries `fields` only on `?include=fields`, and the detail
route carries them always, where one task's handful of entries is a few hundred
bytes.

### Two things that follow, and neither is "optimise a field"

- **The budget is measured against a moving fixture.** It is the live account's
  own data, which grows every time anyone — human or agent — files a
  well-described task. A fixed byte budget against a growing corpus will be
  breached again whatever is done to the code, so the number alone cannot tell
  anyone whether something is wrong.
- **The route is doing two jobs.** `GET /api/v1/tasks?limit=1000` is both the
  list view's read and the clients' full sync. A list view needs titles; a sync
  needs descriptions. Charging the list view for the sync's payload is the real
  design question, and `?updatedSince=` already exists for the sync half.
### What was decided

`description` became opt-out on the list route — `GET /api/v1/tasks?omit=description`
(AWTD-1233 → AWTD-1236). Measured against the same 1,000-task response: **554.4
→ 109.4 KiB on the wire**, 22% of budget instead of 111%. It is opt-in to use,
so no client's payload changed on the day it shipped, and the moving-fixture
problem above is untouched by it and filed separately.

## 2026-10-21 — the GitHub Projects webhook leg, measured on a deployed brand (AWTD-1159)

Two rows above said the webhook leg could not be measured because no brand had
GitHub Projects turned on. **That stopped being true.** `lanes-test.astrid.cc`
serves the GitHub Projects brand — `/api/v1/capabilities` answers
`product.githubProjects: true` — with its own Neon database and its own
registered GitHub App. Its App has delivered 58 `projects_v2_item` webhooks, and
its database holds 2 bound projects, 19 project items and 68 completed hydrate
jobs.

Everything below is a **read-only** measurement of that live deployment: its
database and GitHub's own delivery log. Nothing was written to either.

### Webhook received → replica written

67 hydrate jobs that succeeded on their first attempt, `createdAt` (the webhook
handler enqueued it) to `doneAt` (the replica is written):

```
p50 616 ms    p95 840 ms    max 1,343 ms
```

First attempts only, on purpose. The 68th job took 33.9 s across two attempts —
that is a retry's backoff, not the write taking 34 seconds, and averaging it in
would describe neither.

### The ack, as GitHub measures it

GitHub records a `duration` per delivery. Over the 58 `projects_v2_item`
deliveries: **p50 360 ms, p95 1,040 ms**, every one HTTP 200.

**This is not the 300 ms ack budget, and must not be read as a breach of it.**
That budget is route time — a delivery check, one indexed read, one insert.
GitHub's number is its whole round trip: DNS, TLS, the network to Vercel, any
cold start, and the response. Route time still needs
`vercel logs --query projects_v2_item` on the lanes-test deployment, which is
the remaining work on that row.

### What is still not measured, and why

**github.com edit → GitHub delivering the webhook.** The obvious source is the
delivery payload's own `updated_at`, but GitHub redacts payloads on historical
deliveries — `GET /app/hook/deliveries/{id}` answers an empty `request.payload`
for all of these. Measuring it means making an edit on the lanes-test project
and timing it live, which is a **write to a real GitHub org** and so is a
deliberate act, not something to do while passing.

Composing what we do have puts edit → replica at roughly **1.9 s at p95**
against a 10 s budget, with only that first leg unaccounted for. GitHub
typically delivers in well under a second, so the row is very likely comfortably
inside budget — but "very likely" is not a measurement, which is why the row
says what it says.

**A 2,000-item import.** Unchanged and still genuinely blocked: GitHub's
content-creation caps make seeding 2,000 items a multi-hour job. Per-page cost
is measured and flat (25 queries fixed, 0 per item), so the arithmetic is known;
the wall-clock number is not.

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

So this row had a manual procedure, like the `vercel logs` rows above it:

> Open the project's Speed Insights tab in the Vercel dashboard, read the
> **p75** for LCP, INP and CLS over the last 28 days, and record them here
> with the date.

**Use p75.** CWV thresholds are defined at the 75th percentile; the rest of
this document uses p50/p95, and copying that convention here would produce
numbers that do not mean what the thresholds mean. The budgets in the row
above are Google's "good" thresholds.

### There is now a scriptable second source (AWTD-904)

Speed Insights stays mounted and remains the source with **history** — it has
been collecting since 2025-08-13 and nothing here replaces it. What it cannot
do is answer a script, which is why the row above still says "not yet
transcribed" rather than carrying a number.

A first-party pipeline now collects the same three metrics into a table this
repo can query:

| piece | where |
|---|---|
| client reporter | `components/web-vitals-reporter.tsx`, mounted in `components/providers.tsx` |
| ingest beacon | `POST /api/internal/web-vitals` — unauthenticated, rate-limited per IP |
| storage | `WebVitalSample` — no `userId`, only an `anonymous` / `signed-in` flag |
| rules and p75 | `lib/web-vitals.ts` |
| report | `npx tsx scripts/measure-web-vitals.ts --prod` |
| retention | 35 days, pruned nightly by `/api/cron/analytics` (AWTD-990) |

The reporter samples every page view, so the table only stays bounded because
something deletes from it. `WEB_VITALS_RETENTION_DAYS` is deliberately a week
longer than `WEB_VITALS_WINDOW_DAYS` — retention shorter than the report window
would quietly truncate the oldest days of the p75 rather than raise anything,
so the two constants live together in `lib/web-vitals.ts` with a test asserting
the ordering. Asking for `--days` beyond 35 will read a window the data no
longer covers.

```bash
npx tsx scripts/measure-web-vitals.ts --prod          # 28-day p75, read-only
npx tsx scripts/measure-web-vitals.ts --prod --days 7
```

It reports p75 overall and split by auth state, because the logged-out case is
both the worst for LCP and the one Speed Insights will not break out.

**Its history starts on the day it is deployed, so it has none yet.** Until
samples accumulate the script prints *"No samples recorded in this window"* and
says in as many words that this means NOT MEASURED rather than fast. Do not
copy a zero out of it. That is the same failure this whole section exists to
correct, and `summarizeWebVitals` returns `p75: null` — never `0` — so an empty
window cannot be mistaken for a passing score anywhere downstream.

**Why both collectors, rather than removing one.** Speed Insights has thirteen
months of real-visitor data and no API; this has an API and no history. Neither
is redundant today. Revisit once the first-party table has a few months behind
it — and if Speed Insights is ever unmounted, the rules test that guards this
section retires with it.

**Why no `web-vitals` dependency.** The reporter uses Next's own
`useReportWebVitals`, which already wraps that library. Adding it directly
would ship the measurement code twice.

The cells are marked *not yet transcribed* rather than filled with a guess.
Whether the eventual source stays the dashboard or becomes a first-party
pipeline (a client reporter, an unauthenticated ingest endpoint, and a
`WebVitalSample` table, since `AnalyticsEvent.userId` is non-nullable and
cannot hold a sample from a logged-out visitor) is the open question on
e586eff1 — it buys scriptability, at the price of a second pipeline beside a
working one and a new production table.

**Redis cache hit rate — re-based 2026-10-16 to >= 60%, and now within budget.**

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

**The log was the wrong sink, and the row ceiling is why.** `scripts/measure-cache-hit-rate.ts`
sums those windows out of `vercel logs` and divides once at the end, and it works — against a
source that returns **exactly 100 rows whether `--since` is 2h, 24h or 72h**. Measured 2026-09-19:
the 20-window floor the script needs is unreachable at any `--hours`, so widening the query (the
remedy this section used to recommend) cannot help. The ~50-unique-row ceiling under *Server error
rate* is a hard cap, not a tendency. The script stays for a spot check on a single deploy; it is no
longer the source of the number.

**The source is the app's own database, read on the analytics page** (AWTD-905, Jon: *"Add this to
the analytics page so we can see latency per period"*). Each flush now also increments a
`CacheMetricBucket` row — one per hour per process — and `/admin/analytics` → **Redis Cache**
summarizes them over the range its selector already offers. No row cap, no CLI, and the numbers
accumulate whether or not anyone is looking.

Three things about what that page shows:

- **The rate divides once, at the end**, out of summed hits and summed lookups. The fleet rate is
  not the mean of the per-bucket rates: a bucket that served three lookups and one that served
  thirty thousand would otherwise weigh the same.
- **Both latencies are MEANS, and are labelled as such** — mean Redis round trip per lookup, and
  mean loader time per load, the pair that says what a hit costs against what a miss costs. The
  stored columns are summed durations, and no percentile is recoverable from a sum. The other
  latency rows in this document are percentiles; do not read the two as comparable.
- **`instances` is on the page** because a hit rate aggregated from one lambda and one aggregated
  from the fleet look identical otherwise.

Buckets are kept 97 days — wider than the 90-day range the page can ask for, so the oldest end of
a chart is never quietly truncated — and the nightly analytics cron prunes them.

**The sample, 2026-10-16** — every production `CacheMetricBucket` row, summed with
`summarizeCacheMetrics` (the function the page uses), read-only:

| Range | Hit rate | Lookups | Instances | Mean lookup | Mean loader |
|---|---:|---:|---:|---:|---:|
| Last 24 h | 67.3% | 954 | 86 | 18.2 ms | 61.7 ms |
| Last 7 days | 66.3% | 5,985 | 731 | 15.5 ms | 40.7 ms |
| Since the migration settled (2026-10-07) | 63.7% | 6,899 | 916 | 15.6 ms | 39.9 ms |
| Since the first bucket (2026-09-25 14:00 UTC) | 70.6% | 16,571 | 1,768 | 18.5 ms | 37.9 ms |

2,696 buckets, 11,498 flushed windows, 0 cache errors.

**Why the budget moved from 80% to 60%, rather than the rate being "restored"** (AWTD-1201).
The 80% figure was set against a workload that no longer exists, and should not be recreated:

- **The cause is established.** Until 2026-09-30 16:00 UTC the cache served a near-constant
  ~50 hits and ~10 misses *every hour, around the clock including 03:00* — the signature of a
  poller, not of people. At 16:00 it stopped: 59 hits in the 15:00 hour, 11 at 16:00, then 0–1
  an hour. The day's rate fell to 4.3%.
- **It was not a deploy.** The only production deploy in the window, `92da8a1d`, landed at
  04:56 UTC — eleven hours earlier — and changes nothing under `lib/redis.ts` or any
  `getOrSet` call site.
- **Hits collapsed while misses did not.** 2026-10-01 was 6 hits against 135 misses, with
  misses inside their normal band throughout. A degrading cache raises misses; this was the
  hit-producing traffic leaving.
- **What left was legacy full-sync polling.** Every `getOrSet` site caches only the full-sync
  path — `app/api/tasks/route.ts:67`, `app/api/lists/route.ts:59` and
  `app/api/v1/lists/route.ts:84` all skip the cache when the request carries `updatedSince`,
  because a delta must be fresh. Clients have since moved to v1 and to delta sync: over two
  days of production logs `/api/tasks` and `/api/lists` drew **zero** requests, while
  `/api/v1/lists` and the uncached `/api/v1/tasks` both saturated the log query's 50-row cap.
  That migration is intentional — see AWTD-1246 and AWTD-839.

So the cacheable share of the workload shrank **because the application improved**: repeated
identical full syncs were replaced by deltas. Meeting 80% again would mean reinstating that
polling, or caching `GET /api/v1/tasks`, whose delta path has to stay uncached for
correctness. The rate has recovered on its own as v1 full-sync traffic grew — 4.3% on 10-01 to
66.3% over the last seven days — and 60% is set as a floor under that regime with room for the
daily swing (63.7–72.6% since 10-07).

**A hit is worth keeping.** A lookup averages 15.5 ms against a loader at 40.7 ms, so a hit
saves roughly 25 ms. An earlier reading of this row put the gap at ~15 ms and suggested the
cache might not earn its keep; on the current workload it does. These are means and are not
comparable to the percentile rows above.

**Whether `GET /api/v1/tasks` should be cached is deliberately still open** — it now carries
the task traffic and has no cache at all, but its delta path cannot take one, so it needs its
own measurement rather than being folded into this row.

Re-sample from `/admin/analytics` → **Redis Cache**; nothing needs a script any more.

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

## Table retention

Every append-only table and the window it is kept for. All are pruned nightly by
`/api/cron/analytics`, after the daily aggregation. A window is set by its
widest reader and pinned in a test against it. If retention is shorter than a
window someone reads, nothing errors: the oldest days just come back empty.

| Table | Kept for | Source |
|---|---|---|
| `WebVitalSample` | 35 days | `WEB_VITALS_RETENTION_DAYS`, `lib/web-vitals.ts` (AWTD-990) |
| `DeletionLog` | 30 days | `DELETION_LOG_RETENTION_DAYS`, `lib/deletion-log.ts` (AWTD-993) |
| `CacheMetricBucket` | 97 days | `CACHE_METRICS_RETENTION_DAYS`, `lib/cache-metrics.ts` (AWTD-905) |
| `TaskEvent` | 365 days; lane-history kinds (`status_changed`, `unblocked`, `completed`, `closed`, `reopened`) **never** | `TASK_EVENT_RETENTION_DAYS` / `TASK_EVENT_KEPT_KINDS`, `lib/history-retention.ts` (AWTD-1455) |
| `AnalyticsEvent` | 120 days (`/admin/analytics`' 90-day max + 30) | `ANALYTICS_EVENT_RETENTION_DAYS`, `lib/history-retention.ts` (AWTD-1455) |
| `Notification` | 90 days after it is read; 180 days after it is created, read or not | `NOTIFICATION_READ_RETENTION_DAYS` / `NOTIFICATION_RETENTION_DAYS`, `lib/history-retention.ts` (AWTD-1455) |

**The AWTD-1455 rows are DRY-RUN until switched on.** Unless the production env var
`HISTORY_RETENTION_PRUNE=delete` is set, the cron only counts what each window
would remove. It logs the counts (`History retention DRY RUN`) and returns them
as `taskEventsPruned` / `analyticsEventsPruned` / `notificationsPruned` with
`historyRetentionMode: "dry-run"`. Read a night's counts first, then flip the
switch. Deletes run in batches of 5,000 ids, at most 20 batches per table per
night, so a backlog drains over several nights.

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
