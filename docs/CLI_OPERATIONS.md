# Local CLI Operations — Astrid Web

*Single source of truth for the **local CLI** workflow (deploy, ship it, fix stuff,
quality gates, OAuth). Written tool-neutral — it applies to any local coding CLI
(Claude Code, Codex, etc.). The per-tool adapters ([CLAUDE.md](../CLAUDE.md),
[AGENTS.md](../AGENTS.md)) point here; **do not duplicate this content into them.***

For project architecture, code patterns, and the per-task coding workflow, see
[ASTRID.md](../ASTRID.md) — that is the source of truth for all AI agents (cloud and local).

---

## 0. Deployment: the one rule that matters

> ### ⚠️ Production deploys are MANUAL — by construction, not by accident.
> `.github/workflows/production-deployment.yml` has **`workflow_dispatch` only**.
> Nothing reaches `astrid.cc` until someone deploys: the Actions tab, or
> `./scripts/deploy-preview.sh --production`. A push to `main` is a push, not a
> release.
>
> **This became true on 2026-08-18 (#204), by changing the workflow.** Before that
> the same workflow ran on `push: branches: [main]` with no path filter *and* on
> `pull_request: types: [closed]` — so every merge shipped and applied migrations
> about ten minutes later, and closing a PR **unmerged** also deployed production
> (no job checked `github.event.pull_request.merged`, despite a comment claiming it
> did). Do not restore either trigger without deciding that merging should ship.
>
> Prisma migrations run inside that deploy — its own job and again via
> `npm run build` → `scripts/build-with-migrations.js` — with production env
> (`DATABASE_URL_DIRECT` is Production-scoped). **Pending migrations apply when you
> deploy.** Verify migration impact against production data before deploying.
>
> Two failure modes, both of which have burned an agent here:
> - **Do not report work as shipped because you pushed.** Merged code sits on `main`,
>   seen by nobody, until someone deploys it.
> - **Do not tell the user a merge is safe because it will not deploy** without
>   checking the workflow *as of that commit*. That claim was true, then false, then
>   true again — all in one day.

**Who may dispatch it: an agent may, once the gates are green (Jon, 2026-10-13).**

> *"Don't move to done until deployed to prod. You can deploy to prod if all tests are
> green."* — and, asked whether that covered the unattended runner too: *"Interactive
> sessions and automatic can deploy with clean tests and monitor to make sure it works.
> Don't block on me."*

MANUAL above describes the **trigger**, not the hand on it. Nothing auto-deploys; a human
or an agent dispatches it deliberately. What changed is that an agent no longer waits to be
told, provided it can show the gates were green *on the commit it is shipping*:

```bash
npm run predeploy                                    # 17/17 on the MERGED main, not just the branch
gh workflow run production-deployment.yml --ref main \
  -f skip_tests=false -f allow_destructive_migrations=false
gh run watch <run-id> --exit-status                  # to completion — not an early green step
scripts/verify-deployed-sha.sh "$(git rev-parse origin/main)"
```

Gate it on the **merged** `main`. Branch-green is weaker evidence: on 2026-10-13 all seven
of a run's PRs were green individually and the gate on the merge still went red.

**Monitoring is the other half of the permission, and the CLI's own success is not it.**
On 2026-09-18 the job reported FAILED about a deploy that had gone out; another time this
rule was rewritten from a check made 2m40s into a ~10-minute pipeline. Ask production what
it is serving (`commitSha`, below) and watch the run to completion.

**Two things an agent still does not decide:**
- **A pending migration.** It applies during the deploy, before the new code is live
  (§ *A destructive migration takes TWO deploys*). Check first —
  `git diff origin/prod origin/main -- prisma/migrations/`. Code-only is the safe case and
  needs no one; anything pending gets Jon, and `allow_destructive_migrations` stays
  `false` so the workflow refuses rather than guesses.
- **A red gate.** "All tests green" is the whole of the permission. A red gate that you
  believe is a false alarm is still red until you have shown why, on the record.

**The authoritative check is the workflow, never the deployment list:**
```bash
gh run list --workflow=production-deployment.yml --limit 5   # what actually ran
sed -n '1,25p' .github/workflows/production-deployment.yml    # what can trigger it
```
The Vercel deployment list shows what deployed, **never what caused it** — and
GitHub Actions deploys through the Vercel CLI, so an Actions build appears as
`source=cli`, indistinguishable from a hand-run one. `source=cli` reads as "a human
did this" and means nothing of the sort. That single misreading produced three of
the four wrong answers below.

To find what production is serving (a different question from what triggers a deploy),
just ask it — one curl, no token:
```bash
curl -s https://astrid.cc/api/health | grep -o '"commitSha":"[^"]*"'
```
`/api/health` reports `VERCEL_GIT_COMMIT_SHA` as `commitSha` (`app/api/health/route.ts`).
The Vercel API answers the same question if you need it from outside the app:
`GET https://api.vercel.com/v9/projects/<projectId>?teamId=<team>` →
`targets.production.meta.githubCommitSha`.

Once a deploy's health check passes, the workflow moves the **`prod` branch** to that commit
and tags it `prod-<YYYYMMDD-HHMMSS>-<sha7>` (`scripts/advance-prod-branch.sh`). Only the deploy
moves it. So what is waiting to ship is a git question:
```bash
git fetch origin && git log --oneline origin/prod..origin/main    # the next deploy's commits
git diff origin/prod origin/main -- prisma/migrations/            # and its migrations
```
**`prod` only moves forward, and a ruleset enforces it** (`protect_prod`, AWTD-1221: no deletion,
no non-fast-forward push). That is safe because the workflow can no longer deploy anything but
`main`. The `production` environment admits only `main`, so dispatching from an older tag or
another branch never reaches the deploy job. **Rolling back means one of two things:** a revert
commit on `main` that is then deployed (a fast-forward, so `prod` follows), or Vercel's instant
rollback for an emergency, which leaves `prod` ahead of production until the next deploy. GitHub
refuses the Actions integration as a bypass actor on a repo ruleset, so if a non-fast-forward
advance is ever genuinely needed, an admin disables `protect_prod` for that run.

`/api/health` is still the ground truth; `prod` lags it only if a deploy bypassed the workflow
(`./scripts/deploy-preview.sh --production` does not move it).

> **This section has been wrong three times — each one merged, and each one acted
> on. The pattern matters more than any of the answers:**
> 1. *"Auto-deploy is OFF."* An agent used it to call a merge safe; five migrations
>    shipped, including one that rewrote task/list membership rows.
> 2. *"Auto-deploy is ON — verified 2026-08-01."* Right conclusion, wrong evidence:
>    production builds in the deployment list, cause unexamined.
> 3. *"Deploys are MANUAL — 2026-08-18."* Written from a push that appeared not to
>    deploy. The check was **2m40s** after the push, against a ~10-minute pipeline,
>    and the hand-run deploy that "proved" it simply won the race. This told agents
>    merging was safe — the premise behind failure 1.
>
> **All three came from inferring the *trigger* from the *deployment list*.**
> Read the workflow file. Run `gh run list`. Never restate this section from memory.
>
> A fourth version — *"pushing to `main` ships"* — was correct when written and
> withdrawn unmerged within the hour, once #204 changed the workflow instead of the
> prose. Not a failure; the process working. It is worth knowing only for this: a
> rule about deploy behaviour can go stale the moment someone edits a trigger, so
> the freshness of your check matters as much as its correctness.

**Related, and still true:** `.github/workflows/monitor-deployments.yml` triggers on
push to `main` and hourly, and runs `scripts/monitor-vercel-logs.ts`, which reports
"✅ No failed deployments found!" when its own fetch fails and whose auto-resolve
substring-matches `build`/`vercel` against task titles. It writes comments to the
Astrid board. Do not trust or run it.

To check what is actually live, compare the latest production deployment's commit SHA
against `main`.

**Deploy to production — once the gates are green on the merged commit (§0; a pending
migration or a red gate still waits for Jon). This is the step that
ships — without it, merged code sits on `main` and no user ever sees it:**
```bash
./scripts/deploy-preview.sh --production      # → astrid.cc
```
It deploys the **working directory**, not a commit, so check out the commit you mean
to ship and confirm `git status` is clean before running it.
Alternatives: Vercel dashboard → Deployments → **Promote to Production**; or the Vercel
API `POST /v13/deployments` with `target:"production"`.

**Deploy a preview:**
```bash
./scripts/deploy-preview.sh                    # current branch → <branch>.astrid.cc
./scripts/deploy-preview.sh feature-dark-mode  # → dark-mode.astrid.cc
```
Multiple previews coexist via the `*.astrid.cc` wildcard on the single Vercel project.

### A destructive migration takes TWO deploys (AWTD-959)

**`database-migration` runs BEFORE `deploy-production` and does not depend on it.**
So a `DROP` lands whether or not the code that stops reading the dropped thing ever
goes live. On **2026-09-18** that took production down: four `TaskList` columns
dropped, the deploy job then hung and was cancelled, and the old build kept serving
against the new schema — `get_lists` returned `Internal server error` and every list
read 500'd. It recovered only because the code eventually landed. A `DROP` is
irreversible, so "roll back the deploy" would not have fixed it.

`npx tsx scripts/check-destructive-migrations.ts` now runs in that job before
`prisma migrate deploy` and **refuses** a pending `DROP TABLE` / `DROP COLUMN` /
`RENAME` / `SET NOT NULL`. When you hit it, the protocol is:

1. **Deploy the code that stops depending on the old shape.** No migration in it.
2. **Verify it is live** — not that a page returns 200, which it did throughout the
   outage:
   ```bash
   bash scripts/verify-deployed-sha.sh "$(git rev-parse HEAD)"
   ```
3. **Deploy again with the migration**, dispatching with
   `allow_destructive_migrations: true` to say on the record that step 1 is live.

AWTD-853 did exactly this for its first two steps; only step 3 skipped it, and step 3
is the one that caused the outage. Additive migrations are unaffected — the gate flags
8 of 86 migrations in this repo's history, all of them real.

`ALTER INDEX`/`ALTER SEQUENCE` renames, `DROP INDEX` and `DROP CONSTRAINT` are
deliberately **not** flagged: none can make the old code's queries fail.

### Production database secrets live in the `production` environment (2026-10-24)

`DATABASE_URL` and `DATABASE_URL_DIRECT` for production are **environment secrets** on
the GitHub `production` environment, which admits only `main`. Only the jobs that
declare `environment: production` in `production-deployment.yml` receive them
(`database-migration`; `deploy-production` declares it for the branch policy). Every
other workflow, the agent workflows included, cannot read them, and builds get a
placeholder URL because `next build` never connects.

**Do not add them back as repo secrets.** A repo secret is readable by any workflow
in the repo, including ones running code an agent just wrote.
`tests/rules/production-secrets-are-environment-scoped.test.ts` enforces this. To
rotate a credential, run `gh secret set DATABASE_URL --env production`.
Previews and `fixstuff` deploy with `VERCEL_TOKEN_PREVIEW`, scoped to the
`astrid-web-preview` project (AWTD-1373). The repo-level `VERCEL_TOKEN` is still
used by the monitor and production jobs, and scoping it is next (AWTD-1372).

### Vercel env vars: Config is readable, Secret is not (2026-10-24)

Scoping the GitHub secrets is only half of it. Vercel stores each project env var
as **Config** (`type: encrypted` or `plain` — readable back through the API,
`vercel env pull` and the dashboard) or **Secret** (`type: sensitive` —
write-only, decryptable only during a deployment). `production-deployment.yml`
demonstrates the read: `vercel pull --yes --environment=production`. So any
workflow holding `VERCEL_TOKEN` can read every **Config** production value,
`DATABASE_URL` included — which is exactly what moving the GitHub secrets to the
`production` environment was for. **Credentials belong in Secret.**

Three things that are not free:

- **A Secret breaks the build unless the build stops reading it.** `vercel pull`
  cannot read a Secret, so it writes the literal string `[SENSITIVE]` — and
  `vercel build` loads that file, so the build gets `"[SENSITIVE]"` as the value
  rather than nothing. Being non-empty, it is truthy: presence guards pass and
  whatever validates the value then throws. This failed two production deploys on
  2026-10-25 — `P1013` from `prisma migrate deploy`, and "Vapid private key must
  be a URL safe Base 64" thrown at **module scope** by
  [lib/push-notification-service.ts](../lib/push-notification-service.ts) while
  `next build` collected route config, killing the whole build over a key only
  push notifications need. [scripts/sanitize-pulled-env.ts](../scripts/sanitize-pulled-env.ts)
  now drops those lines after the pull; Prisma's two datasource vars instead get
  an unreachable localhost placeholder, because `prisma generate` hard-fails
  (P1012) on one that is merely undefined. **Before flipping a var, check whether
  anything reads it at module scope or during the build** — and read the deploy's
  build log the first time, not just its exit status.
- **Identifiers and build-time values stay Config.** `NEXT_PUBLIC_*` is inlined
  into the client bundle at build time, so a Secret would bake in `undefined`.
  Client IDs, URLs and `VAPID_PUBLIC_KEY` are public by design; write-only buys
  nothing and costs you the ability to read them back.
- **`BLOB_READ_WRITE_TOKEN` is gone from production (2026-10-31, [AWTD-1413](https://astrid.cc/t/AWTD-1413)).**
  Blob writes there authenticate with OIDC + `BLOB_STORE_ID`; the token survives only in
  `.env.local`, where there is no OIDC token. History: it could not be flipped from the env list. It is owned by
  the Blob store connection and targets development, and Vercel refuses Secret
  for integration connections that include Development. The answer there is
  Blob's OIDC upgrade (no long-lived token at all), not the
  disconnect/rotate/reconnect dance — see the OIDC task before touching it.
  Since [AWTD-1368](https://astrid.cc/t/AWTD-1368) the server is ready for the
  upgrade: the `BLOB_WEBHOOK_PUBLIC_KEY` it provisions switches direct uploads to
  presigned URLs, and callbacks verify with Ed25519, with no code change at the
  click. **The click is still a decision**: it removes the token, and iOS/Mac
  builds older than 1253 (the first with AITD-558) can only upload with a client
  token derived from it.

Flipping a var re-enters the same value; it does not rotate it. Vercel cannot
convert a Secret back to Config in place.

### NEVER pull from Vercel — it destroys `.env.local`
`vercel pull`, `vercel link`, and `vercel env pull` overwrite your local secrets.
**Do not run them.** Only ever *push* deployments.

If `.vercel/project.json` is missing, create it manually (do NOT run `vercel link`):
```json
{"projectId":"prj_MUWxfWJ9lIZOi2clHPZhlHsYqSiy","orgId":"team_gFxp7fWaX7e8tUPt8Vt3YXl0","projectName":"astrid-web"}
```
Production: `astrid.cc` / `www.astrid.cc`. Token lives in `.env.local` as `VERCEL_TOKEN`.

---

## 1. Approvals

**Push when the work is done — and deploy it when the gates are green (Jon, 2026-10-13).**
Pushing `main` ships nothing (§0: production deploys are `workflow_dispatch` only), so it is
how finished work becomes reviewable. A production deploy reaches real users, which used to
mean it waited for an explicit "ship it"; it no longer does, because work nobody deploys is
work nobody can use. The condition replaced the approval: green gates on the merged commit,
then verify what production serves. **A pending migration is the exception that still asks**
(§0).

Jon, 2026-09-06: *"I want to look at work when you are done. I don't want to tell you to
push it so I can look at it and then wait."* Asking to push made him wait twice — once for
the ask to be answered, once for the pipeline. So finishing ends with the push, and the
report says what landed rather than offering to land it.

| Action | Approval |
|--------|----------|
| Code analysis, local edits, local commits, posting task comments, docs | Autonomous |
| `git push` to main (ships nothing — see §0) | Autonomous, when the work is done |
| `git merge` (merging a PR) | Autonomous, when the gates are green |
| Production deploy, code-only (`gh workflow run production-deployment.yml`) | Autonomous, when the gates are green on the merged commit — then verify `commitSha` |
| Production deploy carrying a **pending migration** | **Ask first** — it applies before the new code is live, and a `DROP` cannot be undone by redeploying |
| `allow_destructive_migrations=true` | **Ask first, always** — only ever true when the code that stopped using the dropped thing is already live |
| DB destructive ops, file deletions outside the project | **Ask first** |

**Push once, when the run is done — not per task.** A batched push keeps CI and preview
builds proportionate to the work, and it is the rule the iOS repo learned the hard way
(a push per fix exhausted its Xcode Cloud allotment on 2026-08-18).

**Default branch policy:** commit directly to `main` for fixes/tests; create a branch
only when the user asks.

---

## 2. "Ship it"

"Ship it" means **deploy** — the push has already happened (§1). Since 2026-10-13 a green run
does not wait to be told (§0); "ship it" is now mostly how a *person* asks for it out of turn,
or how a deploy that was gated on a migration gets its answer.

```bash
git checkout main && git pull origin main
git merge <feature-branch>            # only if on a branch
git push origin main
npm run predeploy                     # the gate that licenses the deploy — on the MERGED main
gh workflow run production-deployment.yml --ref main \
  -f skip_tests=false -f allow_destructive_migrations=false
gh run watch "$(gh run list --workflow=production-deployment.yml --limit 1 \
  --json databaseId --jq '.[0].databaseId')" --exit-status
scripts/verify-deployed-sha.sh "$(git rev-parse HEAD)"   # what production is actually serving
# If working a task: mark it complete — AFTER the line above passes
npx tsx scripts/complete-task-with-workflow.ts <taskId>
```

Dispatching the workflow is preferred over `./scripts/deploy-preview.sh --production`: the
workflow runs the migration gate and the health check, and only it advances the `prod` branch
and tag. The script deploys the **working directory** and moves neither.

When "ship it" arrives as a task comment, first fetch the task + its PR:
```bash
npx tsx scripts/get-astrid-tasks.ts
gh pr merge <PR-number> --merge
```

---

## 3. "Let's fix stuff" (or `/fixstuff`)

```bash
npm run validate:settings:fix   # Claude Code only — validates .claude/settings.local.json
npm run monitor:vercel          # optional; OK if it fails when Vercel isn't configured
npx tsx scripts/get-astrid-tasks.ts   # pull tasks (arg: web | ios | all; default all)
```
**Take the working-tree lock first, in any interactive session that edits this checkout**
— `/fixstuff`, `/fixall`, or plain work:

```bash
npx tsx scripts/fixall-session.ts acquire --pid $PPID --harness claude-code   # exit 2: use a worktree
```

That acquire now also **pauses both scheduled loops**, on every Astrid repo on this Mac,
for as long as your session lives (AWTD-1212). There is nothing to undo: the pause is
keyed on your process, so it clears when the session exits, and `release` clears it
immediately. The loops take the same lock with `--scheduled`, which registers them
without pausing anything — otherwise each loop would stand down for the other forever.

The scheduled `/fixall` loop (`scripts/fixall-loop.sh`) runs in this checkout every half
hour, and the lock is the only thing that tells it someone is here. On 2026-10-05 a tick
started while an unlocked session was between commits on `main`, then saved that
session's edits as its own WIP and checked out `main` (AWTD-1095). The loop is more
careful now: it skips when `main` has unpushed commits, and it never moves a dirty `main`.
But a lock-free session stays invisible to it whenever its tree happens to be clean.

### Why a tick does not run (AWTD-1207)

A skip exits 0 and reads as healthy, so an idle loop and a muted one look identical
in the log. Count the outcomes before concluding anything:

```bash
grep -c "fixall loop (web)" ~/Library/Logs/astrid-fixall-web.log   # ticks that fired
grep "RESULT:" ~/Library/Logs/astrid-fixall-web.log | sort | uniq -c | sort -rn
```

48 ticks a day is the full count (`:20` and `:50`). Three guards can refuse one, and all
three now report through the same tracker: after `FIXALL_STUCK_ALERT_MINUTES` (default
120) of unbroken skips the loop posts to the board chat once, and the marker clears as
soon as a tick reaches the queue.

| Guard | Skips when | Knob |
|-------|------------|------|
| 1 — one session per tree | another **live** session holds the lock | take the lock, and release it when you stop |
| 1b — someone is working | any live interactive lock **on this Mac**, or an explicit pause | `npm run fixall:pause` / `npm run fixall:resume` |
| 2 — never clobber work | tree dirty, off `main`, or `main` ahead of origin | `FIXALL_FORCE=1` (testing only) |
| 2b — machine buried | 5-minute load average over cores × 4 | `FIXALL_MAX_LOAD`, `FIXALL_MAX_LOAD_PER_CPU` |

### Pausing the loops while you work

A Claude session that takes the lock needs nothing else — that is guard 1b. For work the
loops cannot see (plain Xcode, a manual build, a profiling run):

```bash
npm run fixall:pause                        # 2 hours, the default
npm run fixall:pause -- 45m "xcode profiling"
npm run fixall:pause -- status              # who is working, what is paused, how long is left
npm run fixall:resume
```

**An explicit pause is always bounded** — capped at 8 hours and always expiring on its
own. Nothing dies to clear it, unlike a session's registration, and an unbounded silent
mute is exactly the 2026-10-09 outage: the web loop worked one task in 48 ticks for 15½
hours without saying so. A pause that outlasts `FIXALL_STUCK_ALERT_MINUTES` posts to
board chat like any other long skip.

Both forms are honoured by the web loop and by astrid-ios's loop, which reads this
repo's `scripts/fixall-pause.ts`. A paused tick is **skipped, not deferred** — the loops
lose those ticks rather than queueing them, which is the price of not having a run and
your work fight over the same Mac.

Guard 2b exists because a run needs a green `npm run predeploy` to finish a task, and on
2026-10-10 two runs could not get one: predeploy went red twice on test timeouts in
unrelated files with the load average over 120, and each red run auto-filed a failure
task for nothing. The iOS loop's simulator suite and two self-hosted Actions runners
share this Mac.

**An age cap on the lock is not the fix for guard 1.** `scripts/lib/fixall-session-lock.ts`
decides staleness by liveness on purpose — a lock that expires under a session that is
genuinely working is worse than no lock. The 2026-10-09 holder was live for all 15½ hours
it held the tree. The alert is the fix; releasing the lock when you stop working is the
other half.

### Sleep is the other half, and it is a machine setting

A run that has started holds `caffeinate -i -m -w <pid>` for exactly as long as it lives,
so idle sleep cannot kill it mid-task. Nothing in the repo can wake a Mac for a tick that
has **not** started: on 2026-10-07 only 30 of 48 ticks fired and on 2026-10-08 only 38,
whole hours missing while the machine slept. launchd does not backfill a missed
`StartCalendarInterval`; it fires once on wake and carries on.

Two machine-level steps close that gap — both are Jon's call, neither belongs in a script:

```bash
sudo pmset repeat wakeorpoweron MTWRFSU 07:15:00   # one daily wake before the morning ticks
pmset -g sched                                     # confirm it
```

`pmset repeat` holds exactly one repeating event, so this recovers the morning window
rather than all 48 ticks. For full coverage the Mac must not idle-sleep at all: on AC,
System Settings → Battery → Options → "Prevent automatic sleeping on power adapter when
the display is off". With the lid closed on battery, nothing — `caffeinate` included —
keeps it awake.

Present tasks, ask which to work on, then implement. Run `npm run predeploy` **after**
implementation, not before. Follow the per-task coding workflow in
[ASTRID.md](../ASTRID.md) (strategy comment → RED-GREEN TDD → verify → fix-summary comment).

**Task scripts:** `get-astrid-tasks.ts` (pull), `analyze-task.ts <id>` (analyze),
`add-task-comment.ts <id> "..."` (comment), `complete-task-with-workflow.ts <id>` (complete).

For autonomous `/fixall`, use the single portable definition in
[`.claude/commands/fixall.md`](../.claude/commands/fixall.md). Every queue read is:

```bash
npx tsx scripts/ready-tasks.ts [web|ios] --harness <selector>
```

`ASTRID_FIXALL_HARNESS` is the environment fallback; CLI wins. Valid selectors are
`claude-code`, `github-copilot`, `codex`, and `astrid-server`. They map respectively
to the brand-derived `claude@`, `copilot@`, `codex@`, and `astrid@` identities.
Missing or unknown selectors fail closed. Codex is deliberately distinct from the
cloud `openai@` agent.

---

## 4. Quality gates

| Command | What it runs |
|---------|--------------|
| `npm run predeploy:quick` | `check:model-sync` + `check:api-breaking` + `tsc --noEmit` + lint |
| `npm run predeploy` | Self-healing loop (model-sync + api-breaking + Vitest + tsc + lint, auto-fix + retry) |
| `npm run predeploy:simple` | Same checks, **no** auto-fix |
| `npm run predeploy:full` | `predeploy` checks + Playwright E2E |
| `npm run predeploy:dry` | Analyze only, apply no fixes |
| `npm run predeploy:ci` | CI mode: create tasks on failure, exit 1 |
| `npm run test:run` | Vitest once |
| `npm run test:e2e` | Playwright E2E (signed-in specs need a minted session: docs/testing/PLAYWRIGHT_AUTH_GUIDE.md) |
| `npm run deploy:canary` | Post-deploy production health check |
| `npm run dev` | Dev server |

Use the smallest targeted test while iterating. Before completion, run
`npm run predeploy`; use `npm run predeploy:full` when the change affects a
browser flow that requires Playwright/E2E coverage or when the task or workflow
explicitly requires it. Do not stack every gate by default, and do not report a
targeted pass as the final gate.

The manually dispatched `predeploy.yml` workflow defaults to `predeploy:full` and runs
on GitHub-hosted `ubuntu-24.04` (the Mac's `astrid-web` runner was retired, AWTD-1363).

**Test locations:** Vitest unit → `tests/`; Playwright E2E → `e2e/*.spec.ts`.
iOS tests live in the separate [astrid-ios](https://github.com/Graceful-Tools/astrid-ios) repo.

---

## 5. OAuth (task-management integration)

Required in `.env.local`:
```bash
ASTRID_OAUTH_CLIENT_ID=your_client_id
ASTRID_OAUTH_CLIENT_SECRET=your_secret
ASTRID_OAUTH_LIST_ID=your-web-list-uuid       # web To-do list
ASTRID_IOS_LIST_ID=aa41c1a3-bd63-4c6d-9b87-42c6e0aafa36   # iOS To-do list (for `get-astrid-tasks.ts ios`)
```
OAuth client: grant type `client_credentials`; scopes `tasks:read tasks:write lists:read
comments:read comments:write`. **Use the `X-OAuth-Token` header** (not `Authorization: Bearer`).

When filing/updating tasks, use the **`listIds`** array field (not `listId`), and confirm
**list ID vs task ID** before closing — the wrong field orphans tasks and 400s comment posts.

---

## 6. Pre-approved commands (configured in `.claude/settings.local.json`)

Run without asking: `git add|commit|checkout|log|status`, `npm run *`, `npx tsx *`,
`npx tsc`, `npx prisma *`, `npx next lint`.
Still require approval: `git push`, `git merge`, `vercel --prod`, DB destructive ops,
deletions outside the project. (See §1.)

---

## 7. Multi-agent execution (Astrid SDK) — reference

Cloud/remote agent execution is handled by the **Astrid SDK**
(`npm i -g @gracefultools/astrid-sdk`), which routes tasks by assignee email. Registered
agents: `claude@astrid.cc`, `openai@astrid.cc`, `gemini@astrid.cc`, `openclaw@astrid.cc`
(and `{name}.oc@astrid.cc` for named OpenClaw agents). For current default models and
routing, see [ASTRID.md](../ASTRID.md) → "AI Agent System" and `lib/ai/agent-config.ts`;
for SDK modes (API / terminal / webhook) see `packages/astrid-sdk/README.md`.

---

*Local-CLI operations live here. Architecture and the per-task coding workflow live in
[ASTRID.md](../ASTRID.md). Keep the two separate and un-duplicated.*
