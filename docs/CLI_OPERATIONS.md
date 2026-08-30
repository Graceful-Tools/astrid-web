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

To find what production is serving (a different question from what triggers a deploy):
`GET https://api.vercel.com/v9/projects/<projectId>?teamId=<team>` →
`targets.production.meta.githubCommitSha`.

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

**Deploy to production (only after the user says "ship it"). This is the step that
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

**Always ASK before deploying** ("Ready to ship it?") and WAIT for explicit approval
("ship it" / "yes" / "deploy"). Never combine commit + push + deploy without it.

| Action | Approval |
|--------|----------|
| Code analysis, local edits, local commits, posting task comments, docs | Autonomous |
| `git push` to main | Ask first (part of "ship it") |
| `git merge` (merging a PR) | Ask first (part of "ship it") |
| `vercel --prod` / `deploy-preview.sh --production` | Ask first |
| DB destructive ops, file deletions outside the project | Ask first |

**Default branch policy:** commit directly to `main` for fixes/tests; create a branch
only when the user asks.

---

## 2. "Ship it"

When the user says **"ship it"** (in-session or as a comment on an Astrid task):

```bash
git checkout main && git pull origin main
git merge <feature-branch>            # only if on a branch
git push origin main
./scripts/deploy-preview.sh --production
npm run deploy:canary                 # verify production health
# If working a task: mark it complete
npx tsx scripts/complete-task-with-workflow.ts <taskId>
```

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
| `npm run test:e2e` | Playwright E2E (auth specs skip without `PLAYWRIGHT_TEST_EMAIL`) |
| `npm run deploy:canary` | Post-deploy production health check |
| `npm run dev` | Dev server |

The manually dispatched `predeploy.yml` workflow defaults to `predeploy:full` and runs
on the web-only `[self-hosted, astrid-web]` runner label.

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
