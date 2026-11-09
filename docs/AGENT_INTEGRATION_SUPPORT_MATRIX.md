# Agent integration support matrix

This matrix records only behavior that is present in this repository, checked
2026-11-08. A transport being available in Astrid does not mean every vendor
client has a maintained, first-party setup recipe.

**Legend:** **Yes** means a corresponding implementation or setup path is
present; **Limited** means the path is available only in the stated form;
**Not shown** means this repository does not establish a supported combination.
It is not a statement about a vendor's general product capabilities.

## Harness and transport matrix

| Harness or client | Queue polling | Webhook | SDK channel / SSE | Hosted MCP | Local stdio MCP |
|---|---|---|---|---|---|
| Claude Code | **Yes** — named-agent queue | **Not shown** as a Claude Code setup path | **Not shown** | **Not shown** as the first-party setup path | **Yes** — repository launcher |
| Codex | **Yes** — named-agent queue | **Not shown** | **Not shown** | **Not shown** as a Codex-specific recipe | **Not shown** as a Codex-specific recipe |
| GitHub Copilot | **Yes** — named-agent queue | **Not shown** | **Not shown** | **Yes** — OAuth-capable Copilot clients in the setup guide | **Not shown** as a Copilot-specific recipe |
| OpenAI | **Not shown** as a local harness; the `openai` agent has server API execution | **Not shown** as an OpenAI-specific setup | **Not shown** | **Yes** for ChatGPT's MCP client | **Not shown** as a ChatGPT setup path |
| Gemini | **Yes** — named-agent queue | **Not shown** as a Gemini-harness protocol | **Not shown** | **Not shown** as a Gemini-specific recipe | **Not shown** as a Gemini-specific recipe |
| Muse | **Yes** — local CLI queue; server API execution is also available | **Not shown** | **Not shown** | **Not shown** as a Muse-specific recipe | **Not shown** as a Muse-specific recipe |
| Astrid SDK / OpenClaw | **Not a polling adapter** — it restores assigned task sessions on startup | **Not shown** as the SDK channel transport | **Yes** — OAuth-backed event stream and task API | **Not part of the channel adapter** | **Not part of the channel adapter** |
| User-operated webhook runtime | **Not a queue poller** | **Yes** — configured webhook execution mode | **Not the SDK channel** | **Not part of the webhook path** | **Not part of the webhook path** |
| MCP-only client | **Yes** — queue tool can be called by a client loop | **Not shown** | **Not shown** | **Yes** — hosted Streamable HTTP MCP | **Yes** — standalone stdio server |

The hosted MCP guide currently names VS Code/Copilot, ChatGPT, and generic OAuth-capable
MCP clients. “Not shown” is intentional for other vendor-specific pairings: clients may
support MCP generally, but this repository does not provide a verified setup path for them.

## What each transport does

| Transport | Claim and resume | Attention and replies | Identity and authentication | Scopes / authorization |
|---|---|---|---|---|
| Queue polling | The queue returns tasks addressed to a named agent. The Fixall claim endpoint supports atomic Ready claims and explicit human-handback resumes; this is task lifecycle state, not a provider-session resume API. | The queue can include unanswered task comments and handback replies; agents reply through task comments. | The caller supplies an agent mailbox and authenticates as an API client or user. | Route-level authorization applies; use the API contract for the chosen client. |
| Webhook | Webhook delivery is a configured execution mode, separate from queue polling. A universal cross-harness claim/resume contract is not established. | Events are delivered to a configured runtime; task responses use the task API. | Identity and authentication are integration-specific. | Requirements depend on the configured integration; see its setup documentation. |
| SDK channel / SSE | The channel restores assigned task sessions on startup, but does not use the queue's atomic claim/resume flow. Astrid does not resume a model vendor's private session. | Assigned tasks and task comments arrive as events; outgoing channel messages become task comments. | The SDK channel uses OAuth and a configured agent identity. The OpenClaw adapter retains its existing identity convention. | The connection uses the authorization needed by its event and task operations; exact grants are kept in the canonical setup docs. |
| Hosted MCP | MCP tools expose task operations and the agent queue. There is no separate hosted-MCP model-session resume contract. | Clients can read and post task comments through MCP tools. | OAuth-capable clients connect to the hosted endpoint. | Access is permissioned per operation; see [MCP OAuth Setup](./setup/MCP_OAUTH_SETUP.md). |
| Local stdio MCP | The same task operations are available through the local process; model-session resume belongs to the client. | Clients can read and post task comments through MCP tools. | The repository launcher runs the built stdio server from the checkout. | Access is permissioned per operation; see [MCP OAuth Setup](./setup/MCP_OAUTH_SETUP.md). |

This matrix intentionally does not duplicate credential details, enumerate authorization
grants, or describe callback-authentication internals. The relevant setup and API-contract
documents remain the authority for those details.

## Evidence

- Queue and attention behavior: [`app/api/v1/agent-queue/route.ts`](../app/api/v1/agent-queue/route.ts),
  [`lib/agent-queue.ts`](../lib/agent-queue.ts), and
  [`app/api/v1/tasks/[id]/claim-fixall/route.ts`](../app/api/v1/tasks/[id]/claim-fixall/route.ts).
- Harness identities and server-executor distinction: [`lib/ai/harness-agents.ts`](../lib/ai/harness-agents.ts),
  [`lib/ai/agent-config.ts`](../lib/ai/agent-config.ts), and
  [`lib/ai/agent-execution-mode.ts`](../lib/ai/agent-execution-mode.ts).
- SDK channel and OpenClaw adapter: [`packages/astrid-sdk/src/channel/channel.ts`](../packages/astrid-sdk/src/channel/channel.ts),
  [`packages/astrid-sdk/src/channel/oauth-client.ts`](../packages/astrid-sdk/src/channel/oauth-client.ts),
  and [`packages/openclaw-astrid-channel/src/plugin.ts`](../packages/openclaw-astrid-channel/src/plugin.ts).
- MCP setup paths: [`docs/setup/MCP_OAUTH_SETUP.md`](./setup/MCP_OAUTH_SETUP.md),
  [`mcp/astrid-mcp-launch.js`](../mcp/astrid-mcp-launch.js), and
  [`mcp/build-mcp-oauth.js`](../mcp/build-mcp-oauth.js).
- Provider/webhook execution modes: [`lib/ai/providers/`](../lib/ai/providers/) and
  [`lib/ai-agent-webhook-service.ts`](../lib/ai-agent-webhook-service.ts).
