# Local CLI Operations — Astrid Web

*Single source of truth for the **local CLI** workflow (deploy, ship it, fix stuff,
quality gates, OAuth). Written tool-neutral — it applies to any local coding CLI
(Claude Code, Codex, etc.). The per-tool adapters ([CLAUDE.md](../CLAUDE.md),
[AGENTS.md](../AGENTS.md)) point here; **do not duplicate this content into them.***

For project architecture, code patterns, and the per-task coding workflow, see
[ASTRID.md](../ASTRID.md) — that is the source of truth for all AI agents (cloud and local).

---

## 0. Deployment: the one rule that matters

> ### ⚠️ Production deploys are MANUAL. Pushing to `main` does not ship.
> **Stated by Jon 2026-08-18: "For web / vercel we don't push from main to vercel.
> We push manually."** Nothing reaches `astrid.cc` until someone runs the deploy
> command below. A push to `main` is a push, not a release.
>
> This cuts both ways, and both ways have burned an agent here:
> - **Do not tell the user a merge is safe because it will not deploy.** It is safe
>   from a *deploy*, but say what you actually verified, not what a doc claims.
> - **Do not report work as shipped because you pushed.** It is not live until a
>   production deployment for that commit is `READY` and serving.
>
> Prisma migrations run during the deploy build with production env
> (`DATABASE_URL_DIRECT` is Production-scoped), so **pending migrations apply when
> you deploy — not when you push.** Verify migration impact against production data
> before running the deploy command.

**Observed 2026-08-18.** `main` moved `4d4a801 → 8f6bede` at 07:48 local. Thirteen
minutes later the production deployment list still showed `4d4a801`, and the feature
branch push produced no preview either — the GitHub integration created nothing.
`./scripts/deploy-preview.sh --production` at 07:50 built `8f6bede` and put it live.

> **This section has now been wrong in both directions.** It said auto-deploy was OFF;
> an agent used that to call a merge safe, and five migrations shipped. It was then
> rewritten to say auto-deploy was ON, dated *verified 2026-08-01* — and that reading
> was wrong too. The "verification" mistook production builds that a person or a
> script had triggered manually for builds the push caused; every commit in the list
> carries two or three production builds, which is the fingerprint of a manual
> trigger racing an integration, not of one automatic deploy per push.
>
> **The lesson is not the current answer, it is the method.** Never infer deploy
> behaviour from the deployment list alone, and never restate this section from
> memory. Ask production what it is serving:
> `GET /v6/deployments?projectId=…&target=production` and compare the newest
> `READY` deployment's `meta.githubCommitSha` against `main`.

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
