# GitHub Copilot SDK: where it fits, and the plan

**Status (2026-11-24):** not installed. Decision: **adopt it, in the agent runner first.**
This file used to say the SDK was "implemented in code". It was, for one day in July 2026, and
then removed. That history is the main constraint on the plan, so it comes first.

## What exists today

| Path | How it reaches Copilot | Code |
|---|---|---|
| Server-run Copilot agent (assistant workflow, agent runtime tool calls) | Direct REST to `api.githubcopilot.com` through `callOpenAI` with the user's GitHub token | `lib/ai/providers/copilot-provider.ts`, `lib/astrid-agent-runtime.ts` |
| Model list | `GET api.githubcopilot.com/models` | `lib/ai/fetch-provider-models.ts` |
| Local and cloud runner (`astrid-agent run --harness copilot`) | Spawns the Copilot CLI: `copilot -p <prompt>` | `packages/astrid-sdk/src/run.ts` |
| Copilot cloud agent on GitHub | GitHub's own coding agent, bridged to the board | `.github/workflows/native-copilot-bridge.yml` |

Users connect Copilot with GitHub OAuth (`CopilotCredential`, encrypted) or a pasted GitHub token.
Entitlement follows the user's Copilot subscription, not the app that minted the token.

## Why the SDK was removed (76fffa0a, 2026-07-26)

The Node SDK starts a bundled Copilot runtime. That binary was about 253 MB, which is more than
Vercel's 250 MB unzipped function limit, so the SDK-based provider could never have run in
production. It was replaced by the REST call above.

## Why adopt it now

1. **The REST path identifies itself as VS Code.** `COPILOT_HEADERS` sends
   `Copilot-Integration-Id: vscode-chat`. The July plan explicitly ruled out impersonating another
   editor's integration identifier, and GitHub can block or revoke that at any time. The SDK is the
   supported way for a third-party app to use Copilot.
2. **The runner only sees an exit code.** `copilot -p` gives back text and a status. The SDK gives
   sessions, streamed events, explicit tool registration (the Astrid MCP tools only) and a
   permission handler, so the runner can report progress, heartbeat on real activity, and refuse a
   tool call it should not make.
3. **It is generally available** (GA 2026-06-02) and maintained.

## Constraints

- **Package:** `@github/copilot-sdk` was deprecated on 2026-11-19 in favour of
  `@microsoft/copilot-sdk`, whose v2 has breaking changes
  ([v2 breaking changes](https://github.com/microsoft/copilot-sdk/blob/main/docs/v2-breaking-changes.md)).
  v2.0.1 was published 2026-11-24. Use `@microsoft/copilot-sdk`, pinned exactly, and not before it
  has been out for two weeks.
- **Size:** the package itself is about 4 MB, but it still brings the Copilot runtime. Never put it
  in a Vercel function bundle. On the server, connect to a separately run runtime instead
  (`RuntimeConnection.forUri` in v2; the older docs call it `cliUrl`).
- **Identity:** each session runs with that user's GitHub token. Never a shared token, and never
  across users in one session.
- **Node:** `^20.19.0 || >=22.12.0`.

## Plan

### Phase 1: the agent runner (no cost, no Vercel limit)

Add the SDK to `packages/astrid-sdk` as the engine behind `--harness copilot`, with the CLI spawn
kept as the fallback when the SDK cannot start.

- One session per claimed task, created with the task prompt the runner already builds.
- Register only Astrid's MCP server as tools, and handle permissions in code: allow the repo's
  tools, deny anything outside the worktree.
- Map SDK events to the claim lease: heartbeat on activity, and release with the SDK's error text
  rather than "exited with code 1".
- Tests: the session lifecycle with a fake transport, the tool allow-list, and the fallback.
- Docs: `packages/astrid-sdk/README.md`, `docs/AGENT_FLEET.md`.

### Phase 2: the server path (needs a decision on cost)

Stop sending `vscode-chat`. Two ways:

1. **A hosted Copilot runtime** that the server reaches with `RuntimeConnection.forUri`: a small
   always-on container (Azure Container Apps, Fly or similar), per-session user tokens. This is
   the supported route, and it costs money every month, so it is Jon's call.
2. **No server-run Copilot.** Copilot keeps working through the runner and the GitHub cloud agent,
   and the server-run Copilot option is withdrawn from the agent picker.

Until Phase 2 is decided, the REST provider stays as it is.

### Phase 3: retire the REST provider

Once Phase 2 ships either way, delete `copilot-provider.ts`'s REST call, its model-list fetch, and
the tests that pin the REST contract (`tests/lib/copilot-integration.test.ts`).

## Verification before each phase ships

`npm run predeploy`, plus one real Copilot task worked end to end with an account that has an active
Copilot subscription: claimed, worked, reported and released by the runner (Phase 1), or answered by
the server agent (Phase 2).
