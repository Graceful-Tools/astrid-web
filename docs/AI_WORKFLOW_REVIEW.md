# AI workflow review

**Status:** Recommended direction

**Reviewed:** 2026-09-04
**Scope:** Astrid server-run agents, MCP, agent polling, GitHub workflows, repository
instructions, the Astrid SDK, and OpenClaw/Custom Agents

## Executive summary

Astrid already has the right core abstraction: a task is assigned to an agent identity,
the task becomes Ready, and the agent reads its queue through
`get_agent_queue`. MCP and REST supply task tools, while comments provide a durable
conversation that works across the web app, iOS, and every agent runtime.

The main problem is not missing infrastructure. It is that this paved path is difficult to
discover and stops at configuration snippets instead of installing a reusable workflow.
Astrid currently presents six overlapping integration stories:

1. Astrid runs a provider with the user's API key.
2. A native coding harness polls the agent queue.
3. An external webhook runtime receives pushed work.
4. An OpenClaw agent connects over OAuth, SSE, and REST.
5. An MCP client manipulates tasks directly.
6. The Astrid SDK runs or connects custom agents.

These should become three clear product choices:

| User intent | Paved path | Runtime |
|---|---|---|
| "Answer even when none of my computers are running" | **Astrid runs it** | Server provider call |
| "Use my Claude Code, Copilot, or Codex subscription and repository" | **Connect my coding agent** | MCP + agent queue |
| "Connect an agent service I operate" | **Custom Agent** | OAuth + SSE/webhook + REST |

MCP and REST are shared tool layers, not additional user choices. Polling, SSE, and
webhooks are transport details under the two external-runtime paths. A webhook runtime is
user-operated but Astrid-initiated: Astrid pushes an event to the endpoint instead of waiting
for the runtime to poll.

The highest-value work is:

1. Make **Connect my coding agent** the first integration users see.
2. Ship an installable, cross-harness Astrid workflow instead of only prose and cron lines.
3. Move Ready/Waiting lifecycle maintenance into the product.
4. Rebrand the useful OpenClaw protocol as generic **Custom Agents**, then remove the
   gateway-specific remnants.

## Current workflow inventory

### Product/runtime paths

| Path | Identity | Trigger | Execution location | Return channel | Recommendation |
|---|---|---|---|---|---|
| Server API agent | `astrid@`, `claude@`, `openai@`, `gemini@`, `copilot@` | Assignment/comment | Astrid/Vercel provider call | Task comments | Keep |
| Native harness queue | `claude@`, `codex@`, `copilot@`, `gemini@` | Scheduled/manual poll | Claude Code, Codex, Copilot, Gemini | MCP/REST comments and task updates | Make primary coding path |
| Webhook runtime | Provider mailbox | Assignment/comment push | User-operated server | Webhook/REST | Keep as advanced transport |
| OpenClaw channel | `{name}.oc@` | SSE event | User-operated OpenClaw | REST | Rebrand as Custom Agents |
| MCP direct use | Authenticated user | Interactive tool call | Any MCP client | MCP response | Keep as common tool layer |
| GitHub Actions loops | `copilot@` | Cron/manual dispatch | GitHub runner | REST/task comments | Keep, simplify setup |

### Main implementation surfaces

- `components/agent-hub.tsx` asks the useful first question per provider: who runs it.
- `components/agent-runtime-settings.tsx` owns all harness recipes and is reused by
  settings, list administration, and `/docs/loops`.
- `app/api/v1/agent-queue/route.ts` and the MCP `get_agent_queue` tool expose assigned,
  Ready, due work.
- `lib/ai/agent-execution-mode.ts` resolves `api`, `polling`, `webhook`, and `off`.
- `lib/integration-registry.ts` drives both `/docs/integrate` and `/llms.txt`.
- `lib/ai/providers/` retains provider-specific server execution for Claude, OpenAI,
  Gemini, and Copilot.
- `app/api/v1/agent/events` plus the agent task/comment routes form a generic external
  agent protocol.
- `packages/astrid-sdk` is the client library for that protocol.
- `packages/openclaw-astrid-channel` adapts the protocol to OpenClaw.
- `.claude/commands/fixall.md` and `docs/FIXALL_WORKFLOW.md` contain the most complete
  autonomous queue workflow, but only this repository receives it.

## What is already working well

### One queue contract

`get_agent_queue` has the correct safety properties:

- The caller must name its agent mailbox; Astrid does not guess.
- Assignment is the handshake.
- Only Ready tasks are returned.
- Future work is held until due.
- Visibility is evaluated as the authenticated caller.
- `empty: true` makes a quiet scheduled invocation cheap.

This is the stable contract all native harnesses should share.

### One recipe component

`AgentLoopRecipes` is rendered in multiple product surfaces. That prevents setup
instructions in settings and public documentation from drifting apart. It should remain the
single UI owner for native-harness connection instructions.

### Server execution remains useful

Server-run API mode is not legacy. It is the correct option when a user wants an agent to
respond from a phone without maintaining a local or hosted runtime. The simplification must
not force every user to operate a harness.

### Transport implementations share domain behavior

MCP and REST overlap intentionally: they are different transports over the same task, list,
and comment domain. They should share service-layer behavior rather than be collapsed into
one protocol.

## Findings

### 1. The best path is missing from the integration index

`lib/integration-registry.ts` lists REST, MCP, OpenClaw, ChatGPT Actions, and the SDK.
It does not list the native coding-agent queue. As a result:

- `/docs/integrate` does not answer the most common coding-agent question.
- `/llms.txt` cannot direct an agent to the queue workflow.
- The SDK is presented as a coding-agent runtime even though native harnesses are now the
  preferred coding runtime.

The registry should lead with **Connect my coding agent** and absorb the current generic MCP
entry rather than adding a second overlapping card. MCP remains documented as the connection
and tool technology inside the coding-agent and Custom Agent paths.

### 2. The downloadable workflow is stale and manually duplicated

`ASTRID_WORKFLOW.md` and `public/ASTRID_WORKFLOW.md` tell users to run
`scripts/get-project-tasks-oauth.ts`, a repository script that their own project does not
contain unless they download it separately. They teach environment-variable OAuth rather
than the current MCP queue path and require changes to be mirrored by hand.

This is the exact documentation-drift pattern that the canonical
`docs/FIXALL_WORKFLOW.md` eliminated inside Astrid's own repositories.

### 3. Astrid ships instructions, not a native harness artifact

The repository has good Claude commands and a comprehensive autonomous workflow, but a user
connecting another repository gets only configuration snippets. The native harnesses now
support installable or repository-scoped customization:

- Claude Code: skills/plugins and repository instructions.
- GitHub Copilot CLI, the Copilot app, GitHub.com, and VS Code: custom agents, agent skills,
  repository instructions, and MCP configuration.
- Codex: `AGENTS.md`, agent skills, and MCP configuration.

Astrid should publish one canonical queue skill and generate thin adapters for each harness.
Exact install commands must be tested against the current stable harness releases during
implementation; recipes should retain a manual config fallback when native remote-MCP OAuth
support differs.

### 4. Connection recipes create avoidable friction

Current recipes require users to hand-edit configuration even where a native `mcp add`
flow may be available. The GitHub Actions recipe refers to `ASTRID_TOKEN` without taking
the user to token creation. The Copilot recipe combines CLI and VS Code but does not
explicitly cover the Copilot app or repository custom-agent format.

Each recipe should follow one shape:

1. Connect and authorize Astrid.
2. Install the Astrid queue skill/custom agent.
3. Choose manual, session-loop, or scheduled execution.
4. Run a connection test that reports the selected mailbox and board.

### 5. Ready-lane maintenance is available only to Astrid's own repositories

`scripts/ready-tasks.ts` maintains the meaning of Ready, Doing, and Waiting for the web and
iOS boards. It moves scheduled Ready work to Waiting and returns work whose date or named
condition is satisfied. External users only receive `held.scheduled` from the queue.

Lifecycle maintenance belongs in a shared server service, but **not as a side effect of the
queue's GET request**. It should run when relevant task fields change and from a scheduled,
idempotent maintenance job, only for boards that explicitly enable agent lifecycle
automation. The scheduled job remains necessary for time passing and for conditions changed
by another task. The queue remains a read-only view over the resulting state.

### 6. OpenClaw is now a brand-specific shell around a generic protocol

The `openclaw_workers` table was added and removed in consecutive migrations. The current
working architecture is generic and valuable:

- OAuth client credentials
- A per-user agent identity
- Server-sent task events
- REST task and comment operations

The gateway-specific remnants are not part of that path:

- `lib/ai/openclaw-signing.ts` has no production caller outside its tests and describes a
  public-key endpoint that is not present.
- `packages/openclaw-astrid-channel` is a runtime-specific adapter.
- `/docs/openclaw`, the integration registry, API route names, UI components, identity
  suffixes, and archived specifications expose OpenClaw as the product abstraction.

Keep the protocol and rebrand it to **Custom Agents**. Preserve old routes and continue
issuing/routing `.oc@` identities internally during the first migration; the suffix is a
load-bearing routing key in several modules. Consider a new suffix only in a separate,
telemetry-backed migration that makes every matcher accept both forms before issuing the
new one.

### 7. The mode model leaks transport details into the first decision

`api`, `polling`, `webhook`, and `off` are useful internal states, but four equal choices
make the user understand Astrid's transport architecture.

The UI should group them as:

- **Astrid runs it**: provider API or Copilot OAuth.
- **I run it**: native harness polling, webhook delivery, or Custom Agent event stream.
- **Off**.

Do not erase polling and webhook from storage: pull and push have different operational and
failure behavior. Simplify the presentation while retaining explicit transport state.

### 8. Repository adapters still duplicate policy

`CLAUDE.md`, `AGENTS.md`, `CODEX.md`, `GEMINI.md`, and
`.github/copilot-instructions.md` are thin adapters over `ASTRID.md` and
`docs/CLI_OPERATIONS.md`, but they continue to repeat critical rules. The existing files
already document a prior broken mechanical copy.

Keep one canonical repository policy and generate the minimum harness-specific adapters.
Do not assume one filename is consumed by every harness; generated stubs should point to the
canonical owner in the format each harness actually reads.

### 9. Legacy documentation still teaches superseded architecture

`docs/ai-agents/README.md` instructs a new user to create a GitHub App, handle a private key,
run a database script, and rely on an older plan/approve/merge workflow. The integration
registry still describes the SDK as a multi-provider executor. These conflict with the
current queue and external-runtime direction.

## Target architecture

```text
                         Astrid
             tasks · lists · comments · identity
                    /                 \
          Astrid runs it             I run it
         provider API/OAuth      native or custom runtime
                                      |
                     +----------------+----------------+
                     |                |                |
                 queue poll       SSE events       webhook push
                     \                |                /
                        MCP and REST task actions
```

The user chooses ownership of execution. Transport is configured only after that choice.

## Recommendations

### A. Make the native queue the primary coding-agent path

Replace the generic top-level MCP integration card with a coding-agent integration in
`lib/integration-registry.ts`, place it first on `/docs/integrate`, include it in
`/llms.txt`, and cross-link it from the MCP and API docs. Keep `/docs/mcp` as the detailed
protocol/tool reference. Name the action **Connect my coding agent**, not "polling mode."

### B. Publish an Astrid queue skill with generated adapters

Create one canonical, repository-agnostic skill containing:

- explicit mailbox and board selection;
- assignment and Ready-state rules;
- due-date behavior;
- progress/comment expectations;
- completion criteria;
- `empty: true` termination behavior;
- error behavior that fails visibly rather than retrying indefinitely.

Generate or package:

- a Claude Code skill/plugin adapter;
- a Copilot custom agent and agent skill for CLI, app, GitHub.com, and VS Code;
- a Codex agent skill plus a minimal `AGENTS.md` reference;
- a plain `AGENTS.md` fragment for compatible harnesses;
- MCP config and a tested manual fallback.

Start with versioned templates in this repository. Add an initializer package only after the
generated files and upgrade semantics are stable; an `npx` installer should not become a new
source of truth.

### C. Add a guided connection check

After setup, let the user verify:

- authenticated Astrid account;
- selected board;
- selected agent identity/mailbox;
- queue visibility;
- comment and update permissions;
- scheduling method.

This removes the current failure mode where a valid MCP connection silently reads the wrong
identity or an unscoped board.

### D. Productize Ready/Waiting lifecycle maintenance

Extract the predicates and transitions from `scripts/ready-tasks.ts` into a shared service.
Invoke it from task mutations and an idempotent scheduled job for boards that explicitly opt
into agent lifecycle automation. Preserve these guardrails:

- never move Doing tasks;
- never move a human assignee's tasks on behalf of an agent;
- make transitions auditable through comments/activity;
- revalidate the condition immediately before writing;
- make concurrent and repeated reconciliation produce one transition and one audit event;
- keep the queue GET side-effect free.

### E. Rebrand OpenClaw to Custom Agents

Introduce generic Custom Agent names first, then deprecate OpenClaw names:

- generic registration and management routes;
- `/docs/custom-agents`;
- `CustomAgentManager`;
- generic capability and registry entry;
- the existing `.oc@` identity convention behind generic UI copy during the compatibility
  phase.

Keep old OpenClaw routes and `.oc@` identities as aliases until usage telemetry shows they
can be removed. If a generic suffix is still desirable later, first enumerate and update
every suffix matcher in agent config, webhook routing, search, assignment, and brand helpers
to accept both forms. Remove the orphaned signing module and public-key documentation
separately, because they have no current production caller. Move the OpenClaw channel package
to an optional adapter repository or archive it after publishing migration guidance.

### F. Simplify the agent hub without flattening transport semantics

Show **Astrid runs it**, **I run it**, and **Off** first. "I run it" means the runtime is
user-operated, not necessarily that it initiates delivery: webhook mode remains an
Astrid-initiated push to that runtime. Under **I run it**, offer:

- Native coding harness (queue polling)
- Custom Agent (SSE)
- Webhook server

Continue storing an explicit transport mode so dispatch behavior remains deterministic.

### G. Consolidate documentation and generated repository files

Replace the hand-mirrored `ASTRID_WORKFLOW.md` pair with generated downloads from the
canonical queue skill. Retire the old AI-agent setup walkthrough and update the SDK
description to "client library for custom agents." Generate harness adapter files from one
small data source or test them for semantic parity.

## Deprecation recommendations

| Surface | Action | Replacement / condition |
|---|---|---|
| `lib/ai/openclaw-signing.ts` and its tests | Remove | No production caller; no public-key route exists |
| OpenClaw public-key/gateway docs | Archive/remove | OAuth agent protocol |
| `packages/openclaw-astrid-channel` | Deprecate, then archive or split out | Generic SDK + optional adapter |
| `/docs/openclaw` and OpenClaw UI labels | Rename with redirects | `/docs/custom-agents` |
| `/api/v1/openclaw/*` | Add generic aliases, then sunset | `/api/v1/custom-agents/*` |
| `.oc@` for newly created identities | Stop issuing after migration | New generic identity; keep old aliases |
| SDK "multi-provider executor" positioning | Remove | Thin Custom Agent client |
| `ASTRID_WORKFLOW.md` hand-maintained copies | Replace | Generated queue skill/adapters |
| `docs/ai-agents/README.md` legacy setup | Archive after links migrate | `/docs/loops` and Custom Agents docs |
| Legacy `/api/user/ai-*` routes | Retire on the existing API sunset plan | `/api/v1/users/me/*` |
| Repeated policy in harness adapter files | Generate/minimize | `ASTRID.md` + `docs/CLI_OPERATIONS.md` |

## Keep

- MCP and its task tools
- `get_agent_queue` and `/api/v1/agent-queue`
- `AgentLoopRecipes` as the shared UI owner
- server-run provider mode
- `/api/v1/agent/events`
- OAuth and REST agent task/comment APIs
- the generic parts of `astrid-sdk`
- explicit agent identities and assignment as the work handshake
- `ASTRID.md`, `docs/CLI_OPERATIONS.md`, and `docs/FIXALL_WORKFLOW.md` as canonical
  internal documentation

## Delivery phases

### Phase 1 — Make the paved path discoverable

Replace the generic MCP card with **Connect my coding agent** in the integration registry,
`/docs/integrate`, and `/llms.txt`; keep `/docs/mcp` as the linked protocol reference and
cross-link `/docs/loops` and the settings agent hub.

**Success:** a new user or an LLM entering through any integration index reaches the queue
workflow without knowing the terms MCP or polling.

### Phase 2 — One guided connection flow

Refine `AgentLoopRecipes` around connect, install, schedule, and test. Use native MCP-add or
install flows only where verified against stable harness releases, retain manual fallbacks,
add Copilot custom-agent/app guidance, and make token creation explicit for Actions.

**Success:** Claude Code, Copilot CLI/app/VS Code, and Codex each have one tested path from
zero configuration to a correctly scoped queue read.

### Phase 3 — Ship the cross-harness Astrid queue skill

Create the canonical skill and generated Claude, Copilot, Codex, and generic adapters.
Version templates before considering an initializer CLI. Replace the downloadable workflow
only after migration and update behavior are defined.

**Depends on:** Phases 1 and 2.

**Success:** in a fresh repository, one documented install flow gives each supported harness
the canonical queue behavior, reads the selected board and mailbox, and terminates on
`empty: true`; adapter parity tests cover every generated target.

### Phase 4 — Productize Ready/Waiting lifecycle maintenance

Extract the lane-transition service and run it, for opted-in boards, on relevant mutations
plus a scheduled, idempotent reconciliation job. Keep queue reads side-effect free.

**Success:** external users receive the same honest Ready/Waiting behavior as Astrid's own
web and iOS boards; concurrent and repeated runs create no duplicate transition or audit
comment, and boards without lifecycle automation remain unchanged.

### Phase 5 — Introduce Custom Agents and remove dead gateway code

Add generic names/routes/UI/docs and compatibility aliases while retaining `.oc@` as the
internal identity/routing suffix. Remove orphaned signing code independently. Publish
migration guidance before deprecating the OpenClaw channel adapter. Treat any suffix change
as a later migration with dual matcher support, not part of the initial rebrand.

**Success:** a custom runtime can connect without learning OpenClaw terminology, while every
existing `.oc@` agent continues to work.

### Phase 6 — Simplify runtime ownership in the agent hub

Group the UI into Astrid-run, user-run, and off. Keep polling, webhook, and SSE as explicit
transport configurations underneath user-run.

**Depends on:** Phase 5.

**Success:** a user answers one ownership question before seeing transport configuration.

### Phase 7 — Consolidate docs and repository adapters

Archive the legacy setup walkthrough, replace stale SDK wording, migrate links away from the
downloadable workflow copies, and minimize or generate the five harness adapters.

**Depends on:** Phases 3 and 5.

**Success:** every mutable workflow rule has one authoritative owner and automated checks
prevent adapter drift.

## Sequence and risk

Phases 1 and 2 are low-risk presentation work and should land first. Phase 3 proves the
cross-harness artifact before old downloads are retired. Phase 4 is independent but needs
careful audit and concurrency tests. Phase 5 is an additive compatibility migration before
any deletion. Phases 6 and 7 consume the stable results of the earlier work.

The project should not remove API mode, MCP, or explicit transport states. It should remove
duplicate explanations, obsolete gateway artifacts, and the need for users to assemble the
same workflow by hand in every harness.
