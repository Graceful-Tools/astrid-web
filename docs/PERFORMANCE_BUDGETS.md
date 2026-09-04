# Performance budgets

These budgets cover the task and list paths used by the web app and incremental
sync clients. They are release gates, not production promises: measure on a
production-shaped preview before deployment and investigate any regression
before raising a budget.

| Metric | Critical read budget |
|---|---:|
| Server latency | p50 <= 250 ms; p95 <= 750 ms |
| Prisma work | <= 4 queries; p95 aggregate query time <= 300 ms |
| Full task response | <= 500 KiB |
| Full list response | <= 250 KiB |
| Incremental sync response | <= 100 KiB and <= 1 MiB across all pages |
| Redis cache hit rate | >= 80% after warm-up |
| Server error rate | < 1% |
| Core Web Vitals | LCP <= 2.5 s; INP <= 200 ms; CLS <= 0.1 |
| Initial JavaScript | <= 250 KiB compressed for the task-list route |

## Reproducible measurement

Use a preview populated with production-shaped synthetic data. Never point local
scripts at the production database. Record at least 30 warm requests and 30 cold
requests for:

- `GET /api/v1/tasks?limit=1000&leanListMembers=1`
- `GET /api/v1/tasks?updatedSince=<cursor>&leanListMembers=1`
- `GET /api/v1/lists`
- `GET /api/v1/lists?updatedSince=<cursor>`

Capture response bytes and latency with `curl --output <body> --write-out
'%{time_total} %{size_download}\n'`. Capture Prisma query count and duration
from a preview run with Prisma query events enabled, Redis outcomes from the
structured `Cache lookup` / `Cache load` events, Web Vitals from Speed Insights,
and compressed route JavaScript from the Next build output. Store the dated
results with the pull request; do not commit credentials or user data.

## 2026-08-31 structural baseline

The isolated worktree has no database or Redis configured, so it cannot safely
claim production latency, query-plan, or cache-hit numbers. The reproducible
contract tests establish these before/after measurements:

| Path | Before | After |
|---|---:|---:|
| `POST /api/v1/tasks` list validation | Every scalar on `TaskList` and `ListMember`, plus four user and four owner fields | 10 contract-required scalar fields; no user or owner relation |
| Three concurrent cold cache reads | 1 loader call, 3 misses, no coalescing metric | 1 loader call, 3 misses, 2 coalesced loads |
| Cache hit/miss logging | One info event per lookup | Debug-level structured outcome events |
| `GET /api/v1/lists` task counts | Correlated `_count.tasks` per list plus the contract count query | Contract count query only |
| `POST /api/v1/lists` task counts | Correlated `_count.tasks` plus a follow-up query | No count query; a new list returns the same `taskCount: 0` |

No index migration is included. Index work requires sanitized production query
plans and cardinality evidence, followed by post-deployment verification.
