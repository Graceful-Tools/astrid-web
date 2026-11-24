# GitHub Copilot SDK: where it fits, and the plan

**Status (2026-11-24):** not installed. Decision: **adopt it**, in the agent runner first (Phase 1) and, for server runs, behind a hosted gateway (Phase 2, decided 2026-11-24).
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

### Phase 2: the server path: a hosted Copilot gateway

**Decided (Jon, 2026-11-24, ADEV-238): host the runtime.** Server-run Copilot stays, but it stops
sending `vscode-chat` and goes through the SDK running in a small always-on container. The other
options were to withdraw server-run Copilot, or to leave it as it is.

**Why a gateway, not a remote runtime.** The SDK reaches a runtime it didn't start in only one way,
`RuntimeConnection.forTcp(host, port, { connectionToken })`, which is plaintext TCP with no TLS
option. (`cliUrl` and `forUri`, which an earlier version of this plan named, no longer exist in v2.)
Pointing a Vercel function at a public runtime port would send every user's GitHub token
unencrypted. So the SDK runs **inside** the container, next to its runtime, and the container
offers Astrid a small HTTPS API instead:

```
Vercel function ──HTTPS + shared secret──▶ copilot-gateway (container)
  (lib/ai/providers/copilot-provider.ts)      @microsoft/copilot-sdk, mode "empty"
                                              runtime over local stdio/in-process
                                                    │ user's GitHub token, per session
                                                    ▼
                                              GitHub Copilot
```

This also keeps the SDK out of the Vercel bundle entirely: the server only makes `fetch` calls.

**The gateway (`services/copilot-gateway/`, its own package and Dockerfile):**
- `POST /v1/turns`: a prompt, a model, the caller's GitHub token, and tool declarations. It
  creates a session with `mode: "empty"` and `github.tokenProvider` returning that user's token.
  Tools are declaration-only, so a tool call comes back to the server as a pending call. The server
  runs it with the existing `executeToolCallback` and posts the result to
  `POST /v1/turns/:id/tool-results`. The loop stays in one function invocation, as it does today.
- Auth: `Authorization: Bearer <COPILOT_GATEWAY_SECRET>`, compared in constant time. TLS is
  terminated by the host. Tokens never go into logs or onto disk (`sessionFs` in memory,
  `state.enableCrossSessionStore` off, and sessions deleted at the end of a turn).
- `GET /healthz` reports the SDK and runtime versions without a token.

**The server (`copilot-provider.ts`):** when `COPILOT_GATEWAY_URL` and `COPILOT_GATEWAY_SECRET` are
set, it calls the gateway. Otherwise it keeps the REST path, so nothing changes until the gateway is
live. Phase 3 deletes the REST path.

**Hosting** (Jon: an account, a monthly bill, and two secrets): one small always-on instance on
Azure Container Apps, Fly or similar, with HTTPS on the host's domain. Vercel gets
`COPILOT_GATEWAY_URL` and `COPILOT_GATEWAY_SECRET`. The secret is generated once and stored on both
sides.

**Rollback:** unset `COPILOT_GATEWAY_URL` in Vercel. The provider falls back to REST until Phase 3,
and after Phase 3 Copilot server runs fail with a clear "gateway unavailable" error.

### Phase 3: retire the REST provider

Once the gateway has served production for a week, delete `copilot-provider.ts`'s REST call, its model-list fetch, and
the tests that pin the REST contract (`tests/lib/copilot-integration.test.ts`).

## Verification before each phase ships

`npm run predeploy`, plus one real Copilot task worked end to end with an account that has an active
Copilot subscription: claimed, worked, reported and released by the runner (Phase 1), or answered by
the server agent (Phase 2).
