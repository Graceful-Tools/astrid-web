# Platform assessment — November 2026

*astrid-web and astrid-core: performance, maintainability, scale, and what a white-label partner needs to run this in their own Azure tenancy.*

**Written for:** Jon, and the engineers and agents who pick up the tasks it files.
**Frame:** design for tens of thousands of users across many partner tenants; the partner **self-hosts** (we ship artifacts and docs, their IT runs it).
**Method:** three read-only audits (core, web backend, white-label/hosting) on 2026-11-01, with the headline findings re-verified by hand against the code. Every `file:line` below was checked on `main` at `3b5bef19` (web) and astrid-core at `2e0ebed` (branch `fix/awtd-1318-viewer-membership`, 18 commits behind its `origin/main`). Production row counts were **not measured** — the read-only query was refused by the agent sandbox; the script is kept at the end so it can be run by hand.

The tasks filed from this document are listed in [§7](#7-tasks-filed).

---

## 1. Headline

The architecture is the right shape and does not need re-architecting.

- **astrid-core** is well split: a pure `astrid-rules` crate (no clock, disk, network or entropy; builds for wasm32) under an I/O `astrid-core` crate; one JSON door (`App::run_json`); an idempotent, dependency-ordered Outbox; and fixture-locked contracts generated from astrid-web. 69,746 LOC, roughly half of it tests, zero `unsafe`, zero `TODO`.
- **astrid-web** already has a Docker self-host path (`Dockerfile`, `deploy/self-host/`, `scripts/cron-runner.mjs`) that is smoke-tested in CI (`.github/workflows/self-host.yml`) and removes most of the Vercel coupling. No API route runs on the edge runtime. Postgres is plain Postgres.
- **White-label** is one brand per build (`--build-arg BRAND`), one deployment and one database per partner, a generic OIDC `sso` provider — which is exactly the shape a self-hosting partner on Entra ID needs.

What stands between today and the target scale is a short list of implementation-level problems concentrated in four places: the main task read, the realtime layer, request-path side effects, and core's SQLite/sync loop. The work that fixes realtime and background jobs for scale is the **same** work that makes a partner deployment possible, so it is done once (§5).

---

## 2. astrid-web — scale blockers, ordered by impact

| # | Finding | Evidence | Why it matters at 10k+ users |
|---|---|---|---|
| **W1** | **The home read fans in every PUBLIC list in the database.** `GET /api/v1/tasks` without `listId` ORs `lists.some.privacy='PUBLIC'` into the caller's visibility clause, then runs `count()` over the same clause on every page. | `app/api/v1/tasks/route.ts:114-128,158-171`; legacy `app/api/tasks/route.ts:52` | Cost grows with *all public data in the deployment*, not with the caller's own data. The route is already over budget: p50 **497 ms** against 250 (`docs/PERFORMANCE_BUDGETS.md`, 2026-10-22). |
| **W2** | **Realtime is not pub/sub.** `broadcastToUsers` writes each event to a per-user Redis sorted set with three awaited Upstash REST calls per recipient; every open SSE connection then **polls** that set on its 15 s heartbeat. A local broadcast sets `connection.lastEventCheck = Date.now()`, so an event another instance wrote just before that instant falls below the next poll's lower bound and is never delivered. Cross-replica delivery is Upstash-REST-only. | `lib/sse-utils.ts:256,361-387,449-487`; `app/api/sse/route.ts:194-216`; `docs/deployment/SELF_HOSTING.md:172-178` | 10k open connections ≈ 40k Redis REST calls per minute doing nothing. Up to 15 s cross-instance latency. Dropped events under load. A partner's Azure has no Upstash. Vercel functions (300 s `maxDuration`, per-connection concurrency) are the wrong host for long-lived SSE at this scale. |
| **W3** | **Per-instance mutable state that breaks at more than one instance:** the MCP SSE session map (a POST to `/mcp/messages` that lands on another instance cannot find its session); the in-memory `WorkflowQueue`, which `lib/background.ts` names as the durable option; AI key-cache invalidation. | `lib/server/mcp-session-store.ts:13`; `lib/workflow-queue.ts:59,569-571`; `lib/api-key-cache.ts:15-16` | Any horizontally scaled deployment — Vercel under load, Azure Container Apps with two replicas — misroutes MCP messages and loses workflow state. |
| **W4** | **Write side effects run inside the request, sequentially, with no wrapping transaction.** `updateTaskWithSideEffects` is ~580 lines of awaits: rollover, state comment, workflow cancel, reminder reschedule, agent dispatch, dependency re-eval, manual order, `TaskEvent`, notifications, stats and Redis invalidation, a v1 reload for SSE, analytics. Two LLM calls are fire-and-forget promises outside `after()`, which `lib/background.ts:2-11` itself says is unsafe on Vercel. | `services/task.service.ts:863-1440`; `lib/astrid-handoff.ts:154`; `lib/comments/post-comment-side-effects.ts:154` | Every edit pays the whole chain in latency and exposes a partial-failure surface; the fire-and-forget work is killed when the function freezes. |
| **W5** | **Cron shape, and two digest bugs.** The reminder cron runs every minute inside a 30 s function and `include`-loads full `User` rows per reminder. Digests scan the **whole `User` table every hour** (`findMany` with no `where`, no `take`). They are called only when `getMinutes() === 0`, but a user matches only within ±5 minutes of their chosen time — a user who picked 08:30 never receives one. "Today" is computed in server UTC, not the user's zone. AWTD-783 was closed against the scan but no commit on `main` references it; the scan is still there. | `lib/reminder-service.ts:60-99,441-446,474-476,550-554`; `app/api/cron/reminders/route.ts:51` | Linear in users per hour; silently wrong today. See also open [AWTD-1448](https://astrid.cc/t/AWTD-1448). |
| **W6** | **Search is `ILIKE '%term%'`** over title, description and comment content, with no trigram or tsvector index — the file says so itself. | `app/api/v1/search/route.ts:18-19,95-103` | Sequential scans that grow with the corpus. |
| **W7** | **Append-only tables with no retention:** `TaskEvent` (every mutation), `AnalyticsEvent` (every action), `Notification`. (`WebVitalSample` got retention in AWTD-990; `DeletionLog` in AWTD-993.) | `prisma/schema.prisma:529,1350` | Unbounded growth; backup, restore and vacuum cost. |
| **W8** | **Offset pagination at `limit=1000`** on the main read and on delta sync; a full page is 553 KiB on the wire against a 500 KiB cap. Core's sync inherits the row-shift problem (C3). | `app/api/v1/tasks/route.ts:64-65,168` | Deep pages re-scan; rows can move between pages mid-sync. |
| **W9** | At least one DB read per API request for auth (OAuth token lookup or session → `user.findUnique`) before the route's own queries. | `lib/api-auth-middleware.ts` (~251-289) | Fine today. When QPS grows, cache `tokenHash → principal` in Redis with a short TTL. |

**Tenancy.** There is no Organization model. The tenant boundary is *one deployment plus one database per brand* (`scripts/provision-brand-database.ts`; `brands/*.brand.json`). For a partner who self-hosts this is the **right** model: physical isolation, no row-level-security surface, a simple compliance story. **Recommendation: do not build row-level multi-tenancy now.** Revisit only if Astrid itself ends up hosting many brands on shared infrastructure.

### 2.1 Maintainability

- `lib/` is 442 files / 78k LOC. `lib/ai/**` is still 7.8k LOC after `docs/AGENT_ARCHITECTURE_SIMPLIFICATION.md` ("Phase 1 complete") planned to remove ~8.3k; `lib/ai-orchestrator.ts` (1,547 LOC) and `lib/workflow-queue.ts` (673) remain. Its Phase 3 is not done.
- **Unused dependencies** (no import anywhere in app/lib/services/mcp/pages/scripts/tools): `@neondatabase/serverless`, `openai`, `@anthropic-ai/claude-agent-sdk`, `@anthropic-ai/claude-code`, `crypto-js`, `body-parser`, `eventsource`, `lru-cache`, `@opentelemetry/api`.
- `docs/ARCHITECTURE.md` was wrong in seven places (edge runtime, five vs six crons, "Redis pub/sub", "middleware validates sessions", pooling "via Prisma", a copied sw version, a wrong path in `OFFLINE_MODE.md`). Corrected in the PR that adds this document.
- `public/sw.js` re-declares the Dexie schema (a second copy of `lib/offline-db/database.ts` to keep in step) and its background sync still calls the legacy `/api/tasks` and `/api/lists`.
- `check:reuse` is not part of `predeploy`; in CI it runs as `npm run check:reuse || echo …` in `fixstuff.yml:114` and cannot fail a build.
- `/api/health` is unauthenticated and returns the first 30 characters of `CLAUDE_REMOTE_WEBHOOK_URL` (`app/api/health/route.ts:60`).
- Observability: OpenTelemetry is registered (`instrumentation.ts:64`) but there are **no custom spans**, and request latency is not logged — only crons log `durationMs`.

---

## 3. astrid-core — performance

| # | Finding | Evidence |
|---|---|---|
| **C1** | **One SQLite connection behind a `std::sync::Mutex`; every store method is synchronous; there are zero `spawn_blocking` calls in the workspace.** All store work runs directly on tokio worker threads. Sync's per-phase write transaction — which spans applying every fetched page — blocks every read until it commits. WAL buys nothing with a single connection. `lock().expect("cache lock")` turns a poisoned lock into a panic inside the FFI call. | `crates/astrid-core/src/store/mod.rs:15-17,72,113-123`; `sync/mod.rs:311,361-415` |
| **C2** | **`store.tasks()` decodes the whole `tasks` table from JSON in 16 non-test call sites**, including the **reminder loop every 30 s** (`app/background.rs:197` — the comment at :183 says "tasks already in memory", which is not the case), the Google external loop **per linked account every 300 s** (`services/external.rs:1049,1196,1572`), the palette, mention suggestions, board, search, nesting, and the sync absence check. The column-backed `TaskSummary` / `summaries_in_list()` exist but are **used only in tests**; the list view decodes JSON per row and slices to the visible window last (`app/row_json.rs:79-83,150-152`). `store/schema.rs:12-13` and `app/mod.rs:22-23` document the opposite. | as cited |
| **C3** | **The sync cursor is the client's clock** (`updatedSince = stamp − 5 min`); paging is by offset, which the code itself notes can shift rows between pages; projects are a full refetch on every pass; there is no `ETag`/`If-None-Match` anywhere; and the 60 s tick fetches lists, tasks, projects, features and the notifications inbox even while SSE is live. A full pass adds up to 100 sequential confirmation GETs. | `sync/mod.rs:37-58,254-300,359,446-481,556-568`; `api/pagination.rs:29-50`; `app/background.rs:37-89` |
| **C4** | **The Outbox "concurrent batch" is sequential** (`CONCURRENCY_LIMIT = 4`, then `for entry in batch { run_one(..).await }`). Each drain pass reads the journal twice; backoff has no jitter; `has_pending` opens a transaction for one `SELECT EXISTS` after **every** command. | `outbox/runner.rs:35,221-234`; `outbox/scheduler.rs:39-43`; `outbox/journal.rs:329-338` |
| **C5** | `secure_store.get(SESSION_COOKIE_KEY).await` on **every HTTP request** — a foreign Keychain/Keystore callback per call on Apple and Android. `send_as` decodes bytes → `Value` → `T`; `unwrap_envelope` and `send_collection` clone the entire rows `Value`. | `api/client.rs:240,262,317+`; `sync/mod.rs:588` |
| **C6** | Index gaps: `metadata_with_prefix` uses `substr()` and cannot use an index, and runs on every reminder tick; no index on `tasks.completed` or `outbox.next_attempt_at`; no `busy_timeout`. | `store/mod.rs:563`; `store/schema.rs` |

`tests/performance.rs` (10k tasks, 500 ms budgets) runs on `:memory:` with a stub transport, so it cannot observe C1 or C3.

### 3.1 Maintainability

- `Command` has **199 variants**; `dispatch::run` is a **1,360-line `match`**; `command_kinds()` discovers command names by **parsing `command.rs`'s own source through `include_str!`** (it depends on four-space indentation and the enum closing with a bare `}`); `services/external.rs` is 4,024 LOC; `app/dispatch/tests.rs` is 7,031 LOC in one file.
- **The three native clients pin three different core revisions:** Windows `0be2e3a` (96 commits behind), Android `2cf2b5f`, iOS `cd47d05`. No CI job checks that each pinned revision still builds or that its fixture set matches.
- MSRV is declared as 1.82 but `rust-toolchain.toml` floats on `stable`; the README calls it "pinned"; there is no MSRV CI job.
- 23 references to `docs/ASTRID.md`, `docs/M0_NOTES.md` and `PRODUCT_CONTRACT.md` point at files that live in astrid-windows, not in this repo; `lib.rs:11` names `TaskService::complete_task` (the method is `complete`).
- The `Reachability` trait (`platform/mod.rs:223`) is defined and used by nothing.
- Duplicated helpers: `is_newer` ×2, `unwrap_envelope` ×2 (plus `send_collection`), and two different functions named `ids_named`.
- Coverage is strong by count (790 + 470 unit tests, 48 contract tests) but there is **no test against a real HTTP server or an on-disk database**.

---

## 4. Azure white-label — partner self-hosts in their own tenancy

### 4.1 What already works off Vercel (env swap)

Plain Postgres via `DATABASE_URL` / `DATABASE_URL_DIRECT` (Azure Database for PostgreSQL Flexible Server with its PgBouncer for the pooled URL); the six crons via `scripts/cron-runner.mjs`, which reads `vercel.json`; cache and rate-limit Redis via `REDIS_URL` (Azure Cache for Redis); `STORAGE_DRIVER=s3|local`; the OpenTelemetry exporter pointed at Azure Monitor; no edge routes, and `middleware.ts` runs under `next start`; `sharp` image optimisation; the `TRUSTED_PROXY_DEPTH` knob for Front Door or Application Gateway; the brand baked in with `--build-arg BRAND`; TLS and custom domains handled by the platform; and the single-issuer OIDC `sso` provider, which means **Entra ID works today** for one tenant per deployment — which is exactly the partner-self-hosts model.

### 4.2 Hard couplings — the work

| # | Gap | Where the seam is | Recommendation |
|---|---|---|---|
| **A1** | **No container image is published.** `self-host.yml` builds and smoke-tests the image but pushes nothing; production deploys are "main at a sha" through the Vercel CLI. | `.github/workflows/self-host.yml` | Publish the multi-stage image (app + `migrator` target) to GHCR on semver tags; the tag plus `CHANGELOG.md` becomes the partner release channel. Document upgrade = pull tag → run the migrator job → roll the app. |
| **A2** | **Realtime across replicas requires Upstash REST.** | `lib/sse-utils.ts:1,43` | The same fix as W2: a `RealtimeBus` interface with a node-redis pub/sub implementation. One change serves scale and Azure. |
| **A3** | **No Azure Blob storage driver.** Azure Blob does not speak S3. | `lib/storage/object-store.ts:27-48`; `lib/storage/s3-object-store.ts` is the pattern | Add `lib/storage/azure-blob-object-store.ts` (`@azure/storage-blob`; SAS for signed reads; Managed Identity or connection string). Interim: `STORAGE_DRIVER=local` on Azure Files, documented. |
| **A4** | **Email is Resend-only.** | `lib/email-transport.ts:16,32` | Add a generic **SMTP** transport (nodemailer) rather than an ACS SDK — it works with ACS SMTP, SendGrid, and Exchange Online alike. |
| **A5** | **AI provider hosts are hardcoded.** | `lib/ai/clients/openai.ts:118`; `claude.ts:146,380`; `gemini.ts:86` | Make base URLs configurable (`OPENAI_BASE_URL` plus `api-version` for Azure OpenAI; `ANTHROPIC_BASE_URL` for a Foundry endpoint). Keep the bring-your-own-key model. |
| **A6** | **No Azure deployment definition.** `deploy/self-host/docker-compose.yml` is the only infrastructure artifact. | `deploy/` | Add `deploy/azure/` as Bicep: Container Apps (app, min 1 replica), Container Apps Jobs (migrator, cron-runner), Postgres Flexible Server, Azure Cache for Redis, Blob, Key Vault references for secrets, Log Analytics. Plus `docs/deployment/AZURE.md`: Entra issuer `https://login.microsoftonline.com/{tenant}/v2.0`, `TRUSTED_PROXY_DEPTH` behind Front Door, custom-domain TLS, `GIT_COMMIT_SHA` build arg, per-tenant `ENCRYPTION_KEY` and VAPID keys. |
| **A7** | Google sign-in on previews bounces through astrid.cc. | `lib/auth-host.ts:1-25` | Verify it is preview-only and pin that with a test, so a partner domain can never bounce. |
| **A8** | The MCP "list deployments" operation calls the Vercel API. | `lib/vercel-client.ts:51-52` | Gate it behind a capability; it already returns empty without a token. Document as Vercel-only. |
| **A9** | Per-organisation SSO, SAML and SCIM are specified only. | `docs/WHITELABELING.md:266-348` | **Defer.** Single-issuer Entra per deployment satisfies the partner-self-hosts model; SCIM only when a partner asks. |
| **A10** | Native release builds are tied to one server domain. | `docs/deployment/SELF_HOSTING.md:183-187` | Already handled by brand variants in astrid-ios and astrid-android; the partner needs their own app builds and store listings. A deliverable, not a code change. |

---

## 5. Does this help astrid.cc, and how do the Vercel and Azure paths stay one codebase?

**astrid.cc gets most of the benefit.** Phases A, B and D below are production hot paths today: W1 (the home read, already over budget), W2 (polling realtime and the dropped-event race), W4 (the sequential write path), W5 (the digest bugs), W6 (search), and every core finding C1–C6 runs against astrid.cc from each native client. Only Phase C is Azure-specific, and it changes nothing astrid.cc executes.

**One code path, backend chosen by env — never a Vercel branch and an Azure branch.** The repo already works this way for storage (`STORAGE_DRIVER=vercel-blob|s3|local`) and cron (`cron-runner.mjs` replays `vercel.json`). Every new seam follows the same shape:

| Seam | astrid.cc (Vercel) | Partner (Azure) | Shared |
|---|---|---|---|
| `RealtimeBus` (`lib/realtime/`) | Upstash implementation — keeps the sorted set, **fixes the `lastEventCheck` race**, one Redis call per poll | node-redis pub/sub implementation | `broadcastToUsers`, the SSE route, the connection registry, the event types |
| `EMAIL_TRANSPORT` | `resend` | `smtp` (nodemailer) | templates, `lib/email.ts`, reminder and digest services |
| `Job` table + `drainJobs()` | drained by the minute cron and `after()` (as `GitHubSyncJob` is today) | drained by a worker container running the same image | job handlers, retry and dead-letter policy, the side effects moved out of `updateTaskWithSideEffects` |
| MCP session store | Redis | Redis | one store; the in-memory `Map` goes |
| AI base URLs | defaults are the public hosts | `OPENAI_BASE_URL` / `ANTHROPIC_BASE_URL` set | the clients are otherwise unchanged |
| Object store | `vercel-blob` | `azure-blob` | `lib/secure-storage.ts` and every caller |

**Tests keep both paths honest on every change:**

- A **conformance test per seam** that runs the same assertions against every implementation: object store against `local`, S3 (SeaweedFS) and Azure (Azurite); realtime bus against an Upstash mock and a real Redis; email against a Resend mock and a local SMTP sink. They live in `tests/integration/` under `vitest.postgres.config.ts` where a container is needed.
- `self-host.yml` already smoke-tests the Docker path. Add `paths:` triggers so it runs on any PR touching `lib/storage/**`, `lib/realtime/**`, `lib/email-transport.ts`, `lib/jobs/**`, `Dockerfile` or `deploy/**`.
- An ESLint `no-restricted-imports` rule (the same mechanism `check:reuse` relies on) confining `@upstash/redis`, `@vercel/blob`, `resend` and `@azure/*` to their driver files, so vendor code cannot leak back into shared paths.

**Decision deliberately left open:** hosting astrid.cc's own SSE in the same container image (for example `realtime.astrid.cc` on Container Apps) would make its realtime path byte-identical to a partner's and remove the 300 s function ceiling. Decide after Phase B lands, not before.

---

## 6. Recommended sequence

Each phase is independently shippable; the realtime and jobs work is done **once** for both scale and Azure.

- **Phase A — cheap, do now (web):** W1, W6, the W5 bugs, W7 retention, the health leak, unused dependencies, `check:reuse` as a real gate.
- **Phase B — realtime and jobs (web; serves Azure too):** `RealtimeBus` with both implementations and a conformance test; the durable `Job` table and `drainJobs()`; the Redis MCP session store (or dropping the legacy MCP SSE transport); the transactional task write with job-emitted side effects; vendor-import confinement and the `self-host.yml` path triggers.
- **Phase C — Azure packaging (web):** image publishing and semver; the Azure Blob driver; the SMTP transport; configurable AI base URLs; `deploy/azure/` Bicep and `docs/deployment/AZURE.md`; the auth-host test. Done when the self-host smoke passes on a real Azure subscription using the partner brand.
- **Phase D — astrid-core:** C1 (blocking work off tokio; a read-only second connection; `busy_timeout`); C2 (column-backed rows; a due-range reminder query; no `store.tasks()` in loops); C3 (a server-issued cursor — the web returns server time and a keyset `nextCursor`; ETags on lists, projects and features; suppress the 60 s poll while SSE is healthy); C4 (real concurrency with jitter; one journal read per pass); C5 (cache the session cookie in memory, invalidated on sign-out); governance (align the three client pins; an MSRV CI job; the 23 stale doc references; split `dispatch::run` by domain; derive `command_kinds()` from the enum with a macro).
- **Deferred by decision:** row-level multi-tenancy and an Organization model; SAML and SCIM; per-organisation SSO.

---

## 7. Tasks filed

Web and Azure work is on the Web board (AWTD-*); astrid-core work is on the Windows board (AWTD2-*), which is where core tasks live. Priority 3 is the highest.

**Phase A — cheap, do now**

| Task | Finding | Summary | P |
|---|---|---|:-:|
| [AWTD-1451](https://astrid.cc/t/AWTD-1451) | W1 | Home read fans in every PUBLIC list — drop public from the no-listId read, make count opt-in | 3 |
| [AWTD-1453](https://astrid.cc/t/AWTD-1453) | W5 | Digests only run at minute 0 but match ±5 min; 'today' is server UTC | 3 |
| [AWTD-1452](https://astrid.cc/t/AWTD-1452) | W6 | Search ILIKE with no index — pg_trgm GIN | 2 |
| [AWTD-1454](https://astrid.cc/t/AWTD-1454) | W5 | Digest pass scans the whole User table hourly — per-user nextDigestAt | 2 |
| [AWTD-1455](https://astrid.cc/t/AWTD-1455) | W7 | Retention for TaskEvent, AnalyticsEvent, Notification | 2 |
| [AWTD-1456](https://astrid.cc/t/AWTD-1456) | §2.1 | /api/health leaks a prefix of CLAUDE_REMOTE_WEBHOOK_URL | 2 |
| [AWTD-1458](https://astrid.cc/t/AWTD-1458) | §2.1 | check:reuse as a real predeploy gate | 2 |
| [AWTD-1457](https://astrid.cc/t/AWTD-1457) | §2.1 | Remove nine unused dependencies | 1 |

**Phase B — realtime and jobs (serves Azure too)**

| Task | Finding | Summary | P |
|---|---|---|:-:|
| [AWTD-1459](https://astrid.cc/t/AWTD-1459) | W2 / A2 | RealtimeBus: Upstash impl with the race fixed + Redis pub/sub impl, conformance-tested | 3 |
| [AWTD-1460](https://astrid.cc/t/AWTD-1460) | W3 / W4 | Durable Job table + drainJobs(); retire WorkflowQueue; host the fire-and-forget LLM calls | 3 |
| [AWTD-1462](https://astrid.cc/t/AWTD-1462) | W4 | updateTaskWithSideEffects → transactional write + job-emitted side effects (waits on AWTD-1460) | 3 |
| [AWTD-1461](https://astrid.cc/t/AWTD-1461) | W3 | MCP SSE session map is per-instance — drop the legacy transport or back it with Redis | 2 |
| [AWTD-1463](https://astrid.cc/t/AWTD-1463) | §5 | Confine vendor imports (ESLint); self-host.yml path triggers; conformance harness | 2 |

**Phase C — Azure packaging**

| Task | Finding | Summary | P |
|---|---|---|:-:|
| [AWTD-1464](https://astrid.cc/t/AWTD-1464) | A1 | Publish the image to GHCR on semver tags; partner upgrade runbook | 2 |
| [AWTD-1465](https://astrid.cc/t/AWTD-1465) | A3 | Azure Blob object-store driver | 2 |
| [AWTD-1466](https://astrid.cc/t/AWTD-1466) | A4 | SMTP email transport beside Resend | 2 |
| [AWTD-1468](https://astrid.cc/t/AWTD-1468) | A6 | deploy/azure Bicep + docs/deployment/AZURE.md (waits on AWTD-1464, AWTD-1459) | 2 |
| [AWTD-1470](https://astrid.cc/t/AWTD-1470) | W8 / C3 | Server-issued sync cursor: serverTime + keyset nextCursor (web half) | 2 |
| [AWTD-1467](https://astrid.cc/t/AWTD-1467) | A5 | Configurable AI provider base URLs | 1 |
| [AWTD-1469](https://astrid.cc/t/AWTD-1469) | A7 | Pin that the astrid.cc sign-in bounce is preview-only | 1 |

**Phase D — astrid-core (Windows board)**

| Task | Finding | Summary | P |
|---|---|---|:-:|
| [AWTD2-132](https://astrid.cc/t/AWTD2-132) | C1 | SQLite off the tokio workers; read-only second connection; busy_timeout | 3 |
| [AWTD2-133](https://astrid.cc/t/AWTD2-133) | C2 | store.tasks() whole-table decodes; column-backed rows; due-range reminder query | 3 |
| [AWTD2-134](https://astrid.cc/t/AWTD2-134) | C3 | Adopt the server-issued sync cursor (waits on AWTD-1470) | 2 |
| [AWTD2-135](https://astrid.cc/t/AWTD2-135) | C3 | ETags; suppress the 60 s poll while SSE is healthy | 2 |
| [AWTD2-136](https://astrid.cc/t/AWTD2-136) | C4 | Outbox: real concurrency, one journal read, jitter, cheap has_pending | 2 |
| [AWTD2-138](https://astrid.cc/t/AWTD2-138) | §3.1 | Governance: client pins, MSRV job, stale doc refs, Reachability | 2 |
| [AWTD2-137](https://astrid.cc/t/AWTD2-137) | C5 | Cache the session cookie instead of a SecureStore call per request | 1 |
| [AWTD2-139](https://astrid.cc/t/AWTD2-139) | §3.1 | Split dispatch::run by domain; derive command_kinds() from the enum | 1 |

---

## Appendix — measuring the unmeasured

The structural claims in W1 and W7 would be sharper with production counts. This read-only script was refused by the agent sandbox and is left for a human to run (it needs `DATABASE_URL_PROD` or `DATABASE_URL_DIRECT_PROD` in `.env.local`; it only selects):

```sql
select count(*) from "User";
select count(*), count(*) filter (where completed) from "Task";
select count(*), count(*) filter (where privacy='PUBLIC') from "TaskList";
select count(distinct j."A") from "_TaskToTaskList" j join "TaskList" l on l.id=j."B" where l.privacy='PUBLIC';
select count(*) from "TaskEvent"; select count(*) from "AnalyticsEvent"; select count(*) from "Notification";
select relname, pg_size_pretty(pg_total_relation_size(oid)) from pg_class
  where relkind='r' and relnamespace='public'::regnamespace order by pg_total_relation_size(oid) desc limit 8;
```

Paste the numbers into W1 and W7 above when they are known.
