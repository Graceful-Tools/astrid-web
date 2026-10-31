# The agent fleet: machines, harnesses, secrets

*Updated 2026-10-25 by Jon. Preserve existing Claude Code workers; add Copilot
cloud participation rather than replacing the web server. The activation steps
below distinguish repository support from a running fleet.*

## Why

Until now one MacBook Air (M2, 8 cores) ran everything: the iOS, Android and web
`/fixall` loops, the Copilot app's web queue, two self-hosted Actions runners, the
weekly monkey run, and interactive sessions. Load sat around 10–20 and reached 120
on 2026-10-10. Predeploy took 776–1200s instead of ~135s and filed false red tasks
(see `predeploy-needs-the-machine-alone`). The locks are per repo, but the
contention is per machine.

## One platform per machine

| Where | Owns |
|---|---|
| **Cloud (`agent-run.yml`)** | The Claude Code web worker. A run that finishes a task starts the next one (up to `ASTRID_AGENT_MAX_CHAIN`, default 8), and the :05/:35 schedule restarts an ended chain; it shares the Web board's atomic claims with other web harnesses. The Mac's web loop, the Copilot app's web-queue cron and the `astrid-web` self-hosted runner were retired 2026-10-28 (AWTD-1363) |
| **GitHub's built-in Copilot coding agent** | Additional web changes and independent reviews of Claude changes, scoped to the Web board and `copilot` mailbox. `native-copilot-bridge.yml` bridges Astrid to GitHub's issue-assigned agent; `copilot-setup-steps.yml` prepares its worker. This is not Copilot CLI in Actions |
| **Dedicated Apple device** | Keep the existing Claude Code iOS/Mac loop, Xcode and TestFlight work in astrid-ios |
| **Windows device** | Keep its existing Claude Code worker and `fixall-loop.ps1`; `windows-latest` continues builds/unit tests |
| **Android host/VM** | Android's own worker and toolchain; the coordinating Mac is an available host. Do not silently move or install it as part of a web PR |

Hardware is the scarce resource, so a device only runs work that needs that device.

## The boards are how machines talk

No machine calls another. Every device and every cloud run reads and writes the same
Astrid boards, and **task assignment is the message**:

| To get work done by… | Do this |
|---|---|
| **Any agent on that platform** | Put the task on that platform's board (Web, iOS, Windows, Android), **unassigned**, in Ready. Whichever loop claims it first owns it (`claim-fixall-task.ts`). |
| **A specific agent** | Assign it to that agent's mailbox (`claude`, `copilot`, `codex`). Only that harness's queue returns it. |
| **A human, to review or decide** | Assign it to **Jon (the default human)** with the question written on the task, and park it in `Waiting` (FIXALL_WORKFLOW.md → *Waiting carries its condition*). Agents never wait silently on a person. |

Questions also carry the agent-authored `AGENT-HANDBACK: <mailbox>` line. The
human answers in Astrid; the scoped attention inbox and atomic resume claim route
the reply back without requiring a reassignment. See
[the shared reply contract](./FIXALL_WORKFLOW.md#a-human-reply-resumes-an-explicit-handback).

Cross-platform work is split the same way. A web run that needs an iOS change files
the iOS half on the **iOS board** (unassigned, or for the Mac's agent) and links it with a
blocker row (`POST /api/v1/tasks/<id>/blockers`). The Mac's loop picks it up, and the web
task waits on it in `Waiting`. Shared-rules changes for astrid-core go on the Windows board,
as before.

List membership decides who can see a task. Every agent identity that works a board must be
a member of that list, and Jon is a member of every board, so each device sees exactly what
it may act on and Jon sees all of it.

## Many harnesses, one contract

The web server work is not tied to one tool. Claude Code, the GitHub Copilot coding
agent and Codex all use the same board/claim contract. Claude/Codex use their own
CLI logins; GitHub starts its built-in Copilot worker through native assignment.

| Part of the contract | Where it lives |
|---|---|
| Instructions | `ASTRID.md`, `docs/FIXALL_WORKFLOW.md`, `docs/FIXALL_WEB.md`; per-harness adapters stay thin (`CLAUDE.md` + `.claude/commands/fixall.md`, `AGENTS.md`, `.github/copilot-instructions.md`) |
| Environment | `.github/actions/agent-setup`: called by `copilot-setup-steps.yml` (Copilot) and `agent-run.yml` (Claude Code, Codex) |
| Queue and claim | `scripts/ready-tasks.ts --harness <h> --list <board-id>` and `scripts/claim-fixall-task.ts --agent <mailbox> --list <board-id>`; the native bridge uses the same atomic API |
| Output | One PR linked from Astrid; CLI workers use `agent/<harness>/<task-key>`, native Copilot controls its own branch names |
| Gate | `npm run predeploy`, the same for every harness |

`tests/rules/fixall-harness-parity.test.ts` holds the adapters to this.

An `agent-run.yml` run fails unless the agent's last line is `RESULT: OK` or `RESULT: SKIPPED` (see `.github/agent-run-prompt.md`).

## Secrets: agents never hold production keys

| Tier | Holds | Can |
|---|---|---|
| **Agent runs** (`agent` and `copilot` environments) | Astrid OAuth for the agent identity, the harness's own login, a throwaway Postgres | Write code, run gates, open PRs |
| **Native bridge** (`copilot-bridge` environment) | Astrid OAuth and `COPILOT_DISPATCH_TOKEN`, a separately provisioned GitHub user-to-server token | Deterministic issue assignment and comment relay, not code execution, merges or deployments |
| **Deploy** (`production` environment, admits only `main`) | Production `DATABASE_URL`, `DATABASE_URL_DIRECT` | Migrate and deploy. Agents see only logs and pass/fail |
| **This Mac** (`.env.local`) | `*_PROD` URLs, `VERCEL_TOKEN` | Ad-hoc read-only production queries and runtime logs |

An agent that needs a production fact writes the question on the task and hands it
back. A Mac session answers it. `tests/rules/production-secrets-are-environment-scoped.test.ts`
keeps the database secrets out of every other job.

Previews and `fixstuff` deploy to their own Vercel project, `astrid-web-preview`,
with `VERCEL_TOKEN_PREVIEW`, a token scoped to that project (AWTD-1373). Vercel's
narrowest token scope is a whole *project*, so this is what keeps a preview token
from deploying production. The preview runtime has its own database
(`astrid_preview` on the staging server) and none of
production's keys. The database URL is a Vercel Secret on that project, which
`vercel pull` redacts, so previews build on Vercel and migrate there, only when the
PR changes no migrations and only a database named `astrid_preview`
(`scripts/lib/build-migration-policy.js`). Still open: the repo-level `VERCEL_TOKEN`, which only the
monitor and production jobs now use ([AWTD-1372](https://astrid.cc/t/AWTD-1372)). Credentials are being moved to Vercel **Secret** in the
meantime, which is what stops a leaked token reading them
(docs/CLI_OPERATIONS.md §0).

## Shipping

Agents stop at the PR. A deterministic ship workflow, not an agent, does the rest:
- merge a PR when `predeploy` is green on the merged commit;
- dispatch `production-deployment.yml`;
- check `commitSha` on `/api/health`.

A pending migration still goes to Jon (CLAUDE.md rule 3). `agent-ship.yml` is
that wrapper, live since `ASTRID_SHIP_ENABLED=true` (2026-10-31). It runs when an
agent PR's CI finishes (`workflow_run`, always from main's copy of the file) and
on its :17/:47 schedule. With the variable unset, an agent-run task stays
incomplete after its PR and an authorized release operator lands it. No production deployment
or device activation is implied by these repository changes.

## Cloud activation checklist

1. The cloud schedule replaced the Mac's web loop on 2026-10-28 (AWTD-1363). Keep the
   Apple/Windows workers running, and do not unload another host from a web change.
2. Set the specific worker mailbox to **polling** in Astrid's AI Agents settings.
   `api`, `webhook` and `off` are refused by cloud preflight before claims or lane
   mutations. Confirm membership on the exact platform list. The Android board
   ID used by the current adapters is `85eef4ce-3d4d-4072-9ca7-bd631ca815b1`;
   duplicate same-name lists must be resolved explicitly, never first-match.
3. For optional Claude/Codex dispatches, the `agent` environment holds Astrid
   OAuth and `AGENT_GH_TOKEN` (repo-only Contents + Pull requests write,
   **no Actions write**). Subscription login configuration is unchanged.
   `agent-run.yml` runs on a schedule (:05/:35, claude-code) since 2026-10-28, chains itself through a `repository_dispatch` that this same token sends, and can still be dispatched; it does not run Copilot CLI.
4. For the selected **GitHub issue-assigned coding agent**, provision
   `COPILOT_DISPATCH_TOKEN` only in `copilot-bridge`. GitHub requires a real
   user-to-server token; its fine-grained permission requirements include
   Metadata read and Actions/Contents/Issues/Pull requests read/write
   ([official API contract](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-via-the-api)).
   An installation token or Actions `GITHUB_TOKEN` is not a substitute. Do not
   collect credentials in task comments or give this dispatcher token to coding
   workers. The bridge checks native Copilot's assignability before mutation.
   The `copilot` worker environment needs Astrid OAuth; repository coding-agent
   MCP settings must register `node mcp/astrid-mcp-launch.js` with those credentials.
   Setup alone does not register MCP. Validate real task reads and signed writes.
   Hosted MCP now resolves declared write identities through the authenticated
   queue even on a fresh request, not merely a previous process-local poll.
   Pull-request setup CI builds the test environment and MCP transport without
   checking the live account's activation state. Actual Copilot startup and
   manual setup dispatches retain the fail-closed polling-mode check; passing
   PR CI does not mean the worker has been activated.
5. Run `native-copilot-bridge.yml` with its default `dry_run=true`. Confirm its
   version-1 artifact, exact board, no claims/comments/assignment, and explicit
   unread-channel warnings. Then smoke one **Copilot-assigned Ready** task and
   one human handback/reply before enabling `ASTRID_NATIVE_COPILOT_ENABLED=true`.
   The bridge intentionally leaves unassigned Ready work to the existing Claude
   worker. Existing grants may lack `chat:read`; task replies work without it,
   list chat does not. `comments:read/write` and `tasks:read/write` are required.
6. For independent Copilot review, create a Web **Ready** task assigned to
   `copilot` with the Claude PR URL and exact head SHA, requesting a review report
   on that task. Keep it separate from the implementation task. This uses the
   same claim and attention path; it does not let a review task merge/deploy.
   Automatic creation or mandatory approval enforcement of review tasks is not
   enabled by this PR.
7. Provision a separate `release` environment with Astrid OAuth (no DB or harness
   credentials), and smoke `agent-ship.yml` with its default `dry_run=true`.
   Validate an eligible cloud handoff and a deliberately held PR before setting
   `ASTRID_SHIP_ENABLED=true`. The ship job's built-in token has Contents/PR/Actions
   write; only `production-deployment.yml` obtains production environment secrets.
   A pending migration remains a human decision and is never approved by a
   conversational handback reply.
8. Reconcile the live Web list description before activating autonomous merges
   or previews: it still requests human approval and contains an old absolute
   checkout path. Repository support is not permission to ignore that board
   policy. Do not silently change the list or weaken account protections.

### Native dispatch and return-path boundaries

`scripts/native-copilot-bridge.ts` defaults to read-only; `--execute` is explicit.
An inert GitHub issue mirror is created before the exclusive exact-board claim,
then the documented REST assignment starts **GitHub's built-in agent**. At most
one new session starts per tick. Issue mapping, attempt records and reply
deduplication live in Astrid/GitHub, not an ephemeral runner file. A lost
claim is distinguished from a lost claim response by an agent-authored
board/task/repository/issue binding committed transactionally with the claim.
An inert mirror never permits adopting another Copilot session's Doing task.
A lost
assignment response is reconciled from the existing assignment before retrying;
three unconfirmed attempts stop and atomically park a still-owned, version-matched
Doing task in Waiting. An agent-signed Astrid notice exposes that blocker.
Exhausted tasks remain held without blocking other candidates or replies; the
tick reports their failures after processing the remaining candidates.
An assigned issue with no linked open PR and no issue activity for three hours
is likewise parked with an Astrid notice. This watchdog never cancels or starts
another native execution; it does not mistake assignment acceptance for progress.

The bridge mirrors native agent comments and PR descriptions/heads into the
source task. New human task replies are batched into one `@copilot` comment on
the proven native PR, with exact task/PR/head metadata and idempotency markers.
Replies before a linked PR exists remain pending, not falsely acknowledged.
Human-assigned Waiting tasks require the shared atomic resume claim first.
Malformed/duplicate/unowned mappings, changed heads and truncated history fail
closed. No task text is evaluated as a shell command or release authorization.

**Not yet activated or supplied:** a live authorized-token smoke test, repository
MCP configuration, automatic creation/mandatory enforcement of independent
review tasks, and automatic ship qualification of GitHub-controlled `copilot/`
PR branches. The generic ship registrar currently accepts only its verified
`agent/<harness>/AWTD-...` handoffs. Closed native issues/PRs are not automatically
reassigned to start another agent. Native CI may also need GitHub's workflow
approval setting; this change does not bypass it. An authorized operator must
handle those boundaries until separately reconciled and smoke-proven.

CLI cloud wake state is keyed by harness and branch, serialized by workflow
concurrency, and saved after success **or failure**. Actions cache is backed by
30-day run artifacts; corrupt retained state fails loudly rather than resetting
retry limits. After all retained history expires, the first new run explicitly
starts fresh wake memory. Worker and ship outputs remain available as artifacts
on failures. The unfinished-work finalizer preserves clean-but-unpushed commits
as well as dirty WIP, moving main/detached work to a recovery branch rather than
pushing main. It writes `.agent-output/recovery.bundle` and `recovery-head.txt`
before attempting the push, so a rejected push still leaves the local commits
in the retained run artifact. The bundle is incremental against origin's fetched
history; restore it in a checkout containing that history.
A runner lost before finalizers is recovered by a later stale-Doing
sweep; unpushed work on a destroyed host cannot be recovered.

## Migration steps

1. ✅ Production DB secrets moved to the `production` environment; previews no longer fall back to them (#515).
2. ✅ Shared setup action, `copilot-setup-steps.yml`, and `agent-run.yml` (#516). The first
   real run, AWTD-1364, opened PR #518 in about a minute.
3. ✅ Harness-neutral `/fixall` (`docs/FIXALL_WEB.md`), with adapters pointing to it (#516).
4. ☐ Smoke/activate `agent-ship.yml` and the shared reply/resume API after deployment.
5. ☐ Smoke/activate additional Copilot web work and reviews alongside the cloud
   Claude worker.
6. ☐ Verify Android's launcher on its chosen host/VM with the explicit board ID.
7. ☐ Update and verify the existing Apple/Windows launchers on their actual devices.

## Setup a person has to do

The cloud agent's credentials live in **`.env.cloud`** in your checkout. It is never
committed, and neither is any template of it (`.gitignore`: `.env.cloud*`). The keys are
listed at the top of `scripts/push-agent-env.sh`. Fill it in, then upload it:

```bash
claude setup-token                    # Max-plan token → CLAUDE_CODE_OAUTH_TOKEN in .env.cloud
scripts/push-agent-env.sh             # → GitHub `agent` environment (secrets + variables)
```

The script refuses a file that names a production key or value, or a key it doesn't know.

- `AGENT_GH_TOKEN` (in `.env.cloud`): a fine-grained token for Graceful-Tools/astrid-web
  only, with **Contents** and **Pull requests** read/write and **no Actions** access. Without
  it the agent's PRs get no CI, because GitHub doesn't run workflows on events made with the
  built-in token. PRs and pushes then show the token owner as the author. A GitHub App
  token can replace it later for a separate bot identity.
- `agent` environment: created 2026-10-24 with the Astrid OAuth client and
  `ASTRID_FIXALL_MAX_TASKS`. It still needs `CLAUDE_CODE_OAUTH_TOKEN`; Codex also needs
  `CODEX_AUTH_JSON` and `CODEX_VERSION`.
- `copilot` environment: nothing from production, ever.
- Check each harness's plan limits before putting it on a schedule. Claude runs draw on
  the Max plan that interactive sessions also use.
