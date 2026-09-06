# Weekly deep review — Astrid, both repos

You are running **unattended**. Nobody will answer a question, so never stop to ask one:
make the call, state the assumption in your summary, and keep going.

This review spans **both** repos in one run: `astrid-ios` (Swift, iOS + Mac) and
`astrid-web` (Next.js/TypeScript), checked out as siblings. It is driven by a repeating
Astrid task; see `astrid-web/docs/WEEKLY_DEEP_REVIEW.md` for how it is triggered.

Read `CLAUDE.md` and `ASTRID.md` in whichever repo you start from before anything else.
`ASTRID.md` is the architecture source of truth and supplies two of the lenses below.

---

## Hard rules

**Read-only on code.** Do not edit, commit, push, merge, or deploy anything, in either repo.
Your only writes are Astrid tasks, Astrid comments, and the summary you print.

Never run any of these:

| Command | Why |
|---|---|
| `npm run weekly-review` | **It does not fail — it lies.** `scripts/weekly-review.ts:22` builds a bare `new PrismaClient()`, which reads `DATABASE_URL`; `.env.local` sets that to `localhost:5432/astrid_dev` and `scripts/lib/load-env.ts` loads it with `override: true`. It prints **local dev** counts under headings that say "Server Health" and "real users". |
| `npm run monitor:vercel*` | It writes comments to real Astrid tasks. Even `:no-fix` posts "Deployment Issues Resolved" onto live tasks, and its auto-resolve substring-matches `build`/`vercel` against task titles. On 2026-08-18 it wrote three misleading comments before it could be stopped, the earliest four days earlier. |
| `vercel pull`, `vercel link`, `vercel env pull` | Destroys `.env.local`. |
| `npm run predeploy` | Files its own Astrid tasks and would pollute the board. |
| any `deploy:*`, any writing `db:*` | Deploys and mutations. |
| `git push` (astrid-ios) | A push starts four Xcode Cloud runs and has exhausted the monthly compute allotment before. |
| `xcodebuild`, `npm test`, `npm run test:mac`, `monkey:*` | A review has no budget for a 15-minute simulator run. **Static analysis only.** |

If a permitted check fails, note it and continue — a broken check is itself a finding worth
reporting.

---

## THE ANTI-FABRICATION RULE

Read this twice. Lenses 4 and 5 are exactly where a model invents numbers.

> Every number you report is either **(a)** the literal output of a command you ran this
> session, printed with that command beside it, or **(b)** absent. There is no third option.
>
> You may not estimate a cache hit rate, a p50, a p95, a DAU, an error rate, or a bundle
> size. If a command failed, write ``could not measure: `<command>` failed with `<error>` ``.
> That sentence is worth more than a plausible number, because a plausible number gets acted
> on.
>
> Specifically: **you have no production latency, no production error rate, and no production
> cache hit rate** unless a command in this run produced one. Do not infer them from
> `/api/health` response time (that is one request from one machine), from local timings, or
> from what `docs/PERFORMANCE_BUDGETS.md` says the budget is. **A budget is a target, not a
> measurement.**

---

## Step 0 — Take the lock

Before any analysis, on the driver task:

```bash
cd ../astrid-web && npx tsx scripts/set-task-status.ts <this task id> Doing
```

A task in `Doing` is not in `get_agent_queue`, so this — not the comment — is the real lock.
Then post a claim comment so a human can see who is running:
`add_comment { taskId, content: "DEEP-REVIEW-CLAIM <ISO timestamp> <session url>", type: "MARKDOWN" }`.

## Step 1 — Load both boards first (dedupe)

```
get_tasks { listIds: ["a623f322-4c3c-49b5-8a94-d2d9f00c82ba"] }   # Astrid Web To-do
get_tasks { listIds: ["aa41c1a3-bd63-4c6d-9b87-42c6e0aafa36"] }   # Astrid iOS To-do
```

Hold on to every open task title, **from both boards**. Nothing you file may restate an open
task. Duplicate tasks are worse than missed ones — they make the board untrustworthy. A
`[web]` task and an `[ios]` task describing two halves of one contract are **one** finding.

Also read the last four weeks of **completed** `[deep-review]` titles and the previous run's
summary comment on the driver task. A finding that was filed and closed as wontfix must not
come back. Last week's numbers are how you compute this week's deltas.

## Step 2 — Gather evidence

**astrid-web** (baseline `origin/main`):

```bash
git log --oneline --since='8 days ago' origin/main
git diff --stat "@{8 days ago}"...origin/main
npm run check:reuse:warn
npm run lint 2>&1 | tail -60
npm run typecheck 2>&1 | tail -40
npm run check:model-sync
npm run check:api-breaking
npm run check:api-boundaries
npm run check:unimported
npm run check:docs
npm run check:i18n
npm run check:env
npm audit --omit=dev 2>&1 | tail -40
curl -s -o /dev/null -w 'health %{http_code} %{time_total}s\n' https://astrid.cc/api/health
curl -s -o /dev/null -w 'home   %{http_code} %{time_total}s\n' https://astrid.cc/
curl -s https://astrid.cc/api/health
```

**astrid-ios** (baseline `origin/iosdev` — that is the branch iOS ships from, not `main`):

```bash
git log --oneline --since='8 days ago' origin/iosdev
git diff --stat "@{8 days ago}"...origin/iosdev
# Architecture invariants from ASTRID.md §0. Baselines measured 2026-09-06 — these are
# counts that must not GROW. Scope them to source: the test targets contain the dead paths
# on purpose (V1APIContractIntegrationTests lists them to assert their absence), so an
# unscoped grep reports five false positives.
grep -rn "AstridAPIClient.shared" "Astrid App/Views" "Astrid Mac" --include="*.swift" | wc -l
#   rule 1 — baseline 1. That one hit is real: Astrid Mac/App/MacRootView.swift:1196 calls
#   AstridAPIClient.shared.getPublicLists directly from a view. File it if it is still there
#   and not already on the board; the fix is a ListService method.

grep -rn "updateTask(completed: true)" --include="*.swift" . | wc -l        # rule 2 — baseline 0

grep -rn 'path: "/api/' --include="*.swift" "Astrid App" "Astrid Mac" "Astrid" \
  | grep -v "/api/v1/" | grep -v "/api/mcp/" | wc -l                        # rule 6 — baseline 0
#   /api/mcp/* is excluded deliberately: the MCP server genuinely lives outside /api/v1.
#   The dead paths rule 6 is about are /api/user/* and /api/chat/*.

grep -rln "APIEndpoint" "Astrid App" --include="*.swift" | wc -l            # rule 9 — baseline 3, cap 5 (task 2023c90f)
npm run check:localizations
npm run check:brands
npm run audit:dependencies
```

**Production traffic** — read-only SELECTs against `DATABASE_URL_PROD` (the Neon URL; **not**
`DATABASE_URL`, which is localhost). SELECT only, and print the exact SQL you ran:

- `AnalyticsDailyStats` over 14 days → week-over-week DAU/WAU/MAU, per-platform including
  `dauMacApp`, and the per-event daily counters.
- `LegacyApiDailyUsage` over 28 days grouped by route and method → which legacy routes still
  carry production traffic, and from which platform.

**Production SHA** (read-only, and remember `main` ahead of production is *expected*):

```bash
curl -s "https://api.vercel.com/v9/projects/prj_MUWxfWJ9lIZOi2clHPZhlHsYqSiy?teamId=team_gFxp7fWaX7e8tUPt8Vt3YXl0" \
  -H "Authorization: Bearer $VERCEL_TOKEN" | jq '.targets.production.meta.githubCommitSha'
```

**Production deploys are manual, and that is enforced rather than assumed.**
`.github/workflows/production-deployment.yml` triggers on `workflow_dispatch` only. Pushing
or merging to `main` does **not** deploy and does not run migrations. So **`main` running
ahead of what production serves is the expected state, not a finding** — do not file it.

Be careful here, because this repo has been wrong about it three times, in both directions,
and an agent acted on each. If you report anything about deploy behaviour, the authoritative
check is the **workflow file plus `gh run list --workflow=production-deployment.yml`**. Never
infer a trigger from the Vercel deployment list: it shows what deployed, never what caused
it, and `source=cli` reads as "a human ran this" when it is in fact Actions. That one
misreading is the root of all three wrong versions.

Weight the review toward **the week's diff** — that is where fresh regressions live — but do
not ignore standing problems the tools surface.

## Step 3 — Fan out across the lenses

Spawn one subagent per lens, in parallel, each returning findings with `file:line` evidence.
Spend real effort. **Reprinting tool output is not a review**; the value is in what a careful
reader notices that no linter flags.

1. **Security** — *every week, never cut.* Web: authorization gaps on API routes (especially
   ones added this week), missing OAuth scope checks, secrets in code, unvalidated input
   reaching Prisma, over-permissive CORS, vulnerable deps. iOS: Keychain vs UserDefaults for
   tokens, ATS exceptions, secrets in `Info.plist`/`.xcconfig`, OAuth `state` validation, deep
   link parsing, share-extension entitlements, the sync deletion ledgers in UserDefaults.
2. **Architecture** — `ASTRID.md` §0's nine rules as a checkable list, using the Step 2
   counts: `AstridAPIClient` called from a View/timer/notification handler (rule 1);
   `updateTask(completed:)` outside `TaskService` (rule 2); inline next-occurrence math
   outside `RepeatingTaskCalculator` (rule 4); writes bypassing the Outbox (rule 5);
   non-`/api/v1` paths (rule 6); new endpoints added to legacy `APIClient`/`APIEndpoint`
   (rule 9). Web: `check:api-boundaries`, permission checks inlined instead of
   `lib/list-permissions.ts`. Report god-file line counts **as a delta against last week**;
   growing is a finding, standing large is not.
3. **Cross-platform contract drift** — walk all six rows of `ASTRID.md` §8, reading the web
   canonical and the iOS mirror in the same pass. This is the entire reason the run spans both
   repos. For each row say whether they still agree and whether the named test exists and
   references both sides. Row 3 (list role/permissions, `lib/list-permissions.ts` ↔
   `TaskList.role(for:)`) has **no test** — that is known, do not re-file it, but *do* check
   whether iOS has started branching on the legacy `admins[]`/`members[]` arrays again, which
   is the regression that row exists to catch.
4. **Caching and cache hit rate** — see "The cache hit rate" below.
5. **Production traffic** — the measured numbers from Step 2 against
   `docs/PERFORMANCE_BUDGETS.md`. Which legacy routes still carry traffic. Week-over-week
   movement in DAU and error-event counters. Numbers only, per the anti-fabrication rule.
6. **Performance (static)** — Web: N+1 Prisma queries, missing indexes, unbounded `findMany`,
   oversized client bundles. iOS: main-thread work in `TaskService`/`SyncManager`, `@Published`
   fan-out on the 1600-line views, filtering in `TaskListView.applyDateFilter`, Core Data
   fetches without batch limits.
7. **Hygiene** — dead code and unreferenced scripts, stale feature flags, TODO rot, files that
   outgrew their home, drift between `CLAUDE.md` / `AGENTS.md` / `ASTRID.md`. Duplication: the
   same logic in two places, permission checks inlined, user-facing copy hardcoded instead of
   i18n keys or `Localizable.strings`. iOS adds the Mac `project.pbxproj` exclusion list.
8. **Documentation** — docs that contradict the code, undocumented new env vars / scripts /
   API routes, stale runbooks, `ASTRID.md` §8 rows naming tests that no longer exist, and
   `PERFORMANCE_BUDGETS.md` claims versus what is actually measurable. Treat this as
   load-bearing: the deploy section has been confidently wrong in **both** directions and an
   agent acted on each. Never restate deploy behaviour from memory — say what you verified
   rather than what a doc claims.

**Depth budget.** Every lens runs every week. On top of that, one area gets extra depth,
chosen deterministically so runs are replayable and the same area is not mined forever:

```bash
SLOT=$(( $(date +%V | sed 's/^0//') % 6 ))   # ISO week, six-week cycle
```

| Slot | Extra-depth area |
|---|---|
| 0 | Caching and invalidation — every `RedisCache.getOrSet` key and TTL vs its `delPattern`; the twelve iOS caches in `docs/LOCAL_FIRST_PATTERN.md` |
| 1 | Data and query paths — Prisma N+1 and indexes; Core Data batch limits, `SyncManager` full-pull cost |
| 2 | Auth, permissions and API surface — `lib/list-permissions.ts` bypasses, route authz, `TaskList.role(for:)` call sites |
| 3 | The god files — a named extraction with a test, not "split this file" |
| 4 | Sync, Outbox and offline — the 8 Outbox kinds; Lists/ListMembers/chat-deletes that sit *outside* it; `GoogleTasksSyncService` coverage |
| 5 | Docs, scripts and dead weight — `check:unimported`, `check:docs`, stale flags, dead `.claude/commands` |

Print the slot and ISO week in your summary. Jon can override for one week with a
`DEEP-REVIEW-SLOT: <n>` comment on the driver task. **If the run is going long, cut the
extra-depth area — never the security lens or the §8 contract walk** — and say which you cut.
A serious finding outside the slot is still filed; rotation controls where effort goes, not
what may be reported.

## Step 4 — Verify before filing

Every candidate finding gets an adversarial check: re-read the `file:line` and confirm it
still says what the finding claims, and confirm it is not a deliberate past decision.

**Standing non-findings — do not file these:**

- `lib/cache-manager.ts` is intentionally not split. It is also a *browser* three-tier cache
  (Memory → IndexedDB → Network), not a Redis cache — do not group it with the server caches.
- `/api/v1/*` and `/api/*` are **not** duplicates — iOS uses both.
- `main` ahead of production is expected.
- The six iOS 1000+ line god files are known. File only on **growth**.
- The five legacy `APIClient` call sites are task `2023c90f`. File only if the count **goes up**.
- `ASTRID.md` §8 row 3 having no test is known.
- `ImageCache.clearMemoryCache()` being dead code and the missing task-side `SyncOrphanPrune`
  are documented in `docs/LOCAL_FIRST_PATTERN.md`. File the *fix*, once, or not at all.

Findings you could not verify go in the summary, not on the board.

## Step 5 — File tasks

- **Cap: 8 tasks total across both boards** — not 8 each. Rank by (real user or security
  impact × your confidence) and file only the top ones. **Filing zero tasks is a valid,
  respectable outcome** — say so plainly rather than padding the board.
- Every task must be independently actionable: the **title states the fix**, the description
  gives `file:line` evidence, why it matters, and the concrete change. No "audit X",
  "investigate Y", or "consider Z" tasks.
- Prefix every title with `[deep-review]`, plus `[web]` or `[ios]` as a second token only for
  cross-repo pairs.
- Cross-repo tasks additionally carry the four `FIXALL_WORKFLOW.md` fields: the exact contract,
  evidence with a re-runnable command, what this side does once the other lands, and whether
  the halves can ship independently.

Web / server findings:

```bash
cd ../astrid-web && npx tsx scripts/create-task.ts "[deep-review] <title>" "<description>" -p <1|2|3>
```

Swift findings — never commit to `astrid-ios`, file a task. **Use the OAuth script, not MCP
`create_task`:**

```bash
cd ../astrid-web && npx tsx scripts/file-ios-task.ts "[deep-review] <title>" "<description>" -p 2
```

**Do not file with MCP `create_task`.** Its schema exposes `listId` (singular), the API wants
`listIds` (an array), and the mismatch is silent: the task is created successfully, returns a
task id, and is attached to **no list at all** — an orphan, invisible on every board.
Verified 2026-09-06; task `22c86a5c-44ce-4b0e-b4fa-8edc7fb3d815` is one such orphan. A
`create_task` response with `"lists": []` means the task did not land. `file-ios-task.ts` goes
through the OAuth API, resolves the board by name, refuses duplicate open titles, and supports
`--dry-run`.

Priority scale is `0=none, 1=low, 2=medium, 3=high`. Use `3` only for a security hole or
active production breakage, `2` for a real defect worth scheduling, `1` for nice-to-have.

## Step 6 — Summary, then complete the task

Print, in this order:

1. **Numbers** — a table of every measured value with the command that produced it beside it.
   This is what makes next week's deltas possible.
2. What you checked, and anything that failed to run.
3. What you filed, **by title** — Jon does not read task ids.
4. What you found and deliberately did not file, with the reason.
5. Coverage you skipped, and the rotation slot used this week.

Post that whole summary as a comment on the driver task — that comment *is* the persistence
mechanism, and next week's run reads it. Then `update_task { taskId, completed: true }`,
which rolls the repeat forward.

End with exactly one line:

```
RESULT: OK — <n> filed, <m> deliberately not filed, rotation slot <X>
```

or `RESULT: FAILED — <why>`.

---

## The cache hit rate

Jon asks for this specifically, so be precise about why you probably cannot report one.

**The number is not being produced at all** — this is not an access problem. The
`Cache lookup` / `Cache load` events at `lib/redis.ts:404,408,416` are `log.debug`, and
`getLogLevel()` in `lib/logger.ts` returns `info` when `NODE_ENV === "production"` unless
`LOG_LEVEL` is set. They are filtered at the logger before Vercel ever sees them. Meanwhile
`RedisCache.getMetrics()` (`lib/redis.ts:261`) already computes `hitRate` and has **zero
callers**. So `docs/PERFORMANCE_BUDGETS.md`'s ">= 80% after warm-up" has never been measurable
in production.

What you **can** do without telemetry:

- **Audit the cache surface statically.** Every `RedisCache.getOrSet` call site with its TTL,
  cross-referenced against every `delPattern`/invalidation site. A cached key with no
  invalidation path is a staleness bug you can find by reading. On iOS, walk the twelve caches
  in `docs/LOCAL_FIRST_PATTERN.md` and ask, for each: is the "cleared by" column still true in
  the code?
- **Measure warm-vs-cold latency** on the four endpoints `docs/PERFORMANCE_BUDGETS.md` names,
  with `curl --write-out '%{time_total} %{size_download}'`. A flat warm-vs-cold delta is
  evidence a cache is not working, and is reportable. A latency figure is not a hit rate.

**Week one's honest answer to "what is our cache hit rate?" is: unknown — and here are the
commits that would make it knowable.** That is the correct outcome, not a failed run.
