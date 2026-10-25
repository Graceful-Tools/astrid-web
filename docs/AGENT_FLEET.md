# The agent fleet: machines, harnesses, secrets

*Decided 2026-10-24 by Jon. This is the target layout; the migration steps at the end
say how far along it is.*

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
| **GitHub Actions, ubuntu (cloud)** | **Claude Code owns web and server.** `/fixall` on the web board and on the Android board runs here, together with astrid-core CI and the Android emulator tests (KVM) |
| **This Mac** | The astrid-ios repo only: iOS **and** the native Mac app (one Xcode project, `Astrid App` + `Astrid Mac`). That covers the iOS loop, the `astrid-ios` runner, the monkey run, and interactive Apple work |
| **Windows device** | The astrid-windows repo only: its `fixall-loop.ps1` task and a self-hosted `astrid-windows` runner for UI tests. `windows-latest` keeps doing builds and unit tests |

Hardware is the scarce resource, so a device only runs work that needs that device.

## The boards are how machines talk

No machine calls another. Every device and every cloud run reads and writes the same
Astrid boards, and **task assignment is the message**:

| To get work done by… | Do this |
|---|---|
| **Any agent on that platform** | Put the task on that platform's board (Web, iOS, Windows, Android), **unassigned**, in Ready. Whichever loop claims it first owns it (`claim-fixall-task.ts`). |
| **A specific agent** | Assign it to that agent's mailbox (`claude`, `copilot`, `codex`). Only that harness's queue returns it. |
| **A human, to review or decide** | Assign it to **Jon (the default human)** with the question written on the task, and park it in `Waiting` (FIXALL_WORKFLOW.md → *Waiting carries its condition*). Agents never wait silently on a person. |

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
agent and Codex all work the same board in the same way. They differ only in which
CLI starts and which login it holds.

| Part of the contract | Where it lives |
|---|---|
| Instructions | `ASTRID.md`, `docs/FIXALL_WORKFLOW.md`, `docs/FIXALL_WEB.md`; per-harness adapters stay thin (`CLAUDE.md` + `.claude/commands/fixall.md`, `AGENTS.md`, `.github/copilot-instructions.md`) |
| Environment | `.github/actions/agent-setup`: called by `copilot-setup-steps.yml` (Copilot) and `agent-run.yml` (Claude Code, Codex) |
| Queue and claim | `scripts/ready-tasks.ts --harness <h>` and `scripts/claim-fixall-task.ts --agent <mailbox>`; whichever harness claims first owns the task |
| Output | Branch `agent/<harness>/<task-key>`, one PR, PR URL commented on the task |
| Gate | `npm run predeploy`, the same for every harness |

`tests/rules/fixall-harness-parity.test.ts` holds the adapters to this.

## Secrets: agents never hold production keys

| Tier | Holds | Can |
|---|---|---|
| **Agent runs** (`agent` and `copilot` environments) | Astrid OAuth for the agent identity, the harness's own login, a throwaway Postgres | Write code, run gates, open PRs |
| **Deploy** (`production` environment, admits only `main`) | Production `DATABASE_URL`, `DATABASE_URL_DIRECT` | Migrate and deploy. Agents see only logs and pass/fail |
| **This Mac** (`.env.local`) | `*_PROD` URLs, `VERCEL_TOKEN` | Ad-hoc read-only production queries and runtime logs |

An agent that needs a production fact writes the question on the task and hands it
back. A Mac session answers it. `tests/rules/production-secrets-are-environment-scoped.test.ts`
keeps the database secrets out of every other job.

Still open: `VERCEL_TOKEN` is a repo secret, because previews, `fixstuff` and the
monitor job use it, and a Vercel token cannot be made preview-only.

## Shipping

Agents stop at the PR. A deterministic ship workflow, not an agent, does the rest:
- merge a PR when `predeploy` is green on the merged commit;
- dispatch `production-deployment.yml`;
- check `commitSha` on `/api/health`.

A pending migration still goes to Jon (CLAUDE.md rule 3). Until that workflow exists,
an agent-run task stays incomplete after its PR, and a Mac session or Jon lands it.

## Migration steps

1. ✅ Production DB secrets moved to the `production` environment; previews no longer fall back to them (#515).
2. ✅ Shared setup action, `copilot-setup-steps.yml`, and `agent-run.yml` (#516). The first
   real run, AWTD-1364, opened PR #518 in about a minute.
3. ✅ Harness-neutral `/fixall` (`docs/FIXALL_WEB.md`), with adapters pointing to it (#516).
4. ☐ Ship workflow.
5. ☐ Unload `cc.astrid.fixall-web` and the `astrid-web` self-hosted runner; point
   `predeploy.yml` / `fixstuff.yml` / `fixall.yml` at ubuntu; retire the Copilot
   app's web-queue cron (Claude owns web, decided 2026-10-24).
6. ☐ Android off the Mac: `/fixall` for the Android board from the cloud (an `agent-run.yml` in
   astrid-android), instrumented tests on ubuntu + KVM, then unload `cc.astrid.fixall-android`.
7. ☐ Windows device: fixall task and an `astrid-windows` runner.

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
