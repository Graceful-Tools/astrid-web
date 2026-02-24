# Astrid Agent Architecture Simplification

**Author:** Astrid Claw  
**Date:** 2026-02-16  
**Status:** Proposal  

## The Problem

Astrid currently maintains **three separate systems** for running AI agents:

| System | How it works | Lines of code | Limitations |
|---|---|---|---|
| Assistant Workflow | Astrid calls AI APIs server-side (Vercel) | ~450 | 60s timeout, no tools, no GitHub |
| astrid-sdk server | User runs local server, receives webhooks | ~5,000+ | User must install/run Node.js server |
| Polling worker | Deprecated, polls for tasks | ~600 | Slow, deprecated |

Plus **4 separate executor implementations** (Claude, OpenAI, Gemini, OpenClaw) that each do essentially the same thing: take a task prompt, call an AI, parse the response, commit to GitHub, create a PR.

**Total: ~12,000 lines of AI execution code.** Most of it duplicated across providers.

## The Insight

The astrid-sdk server is essentially a simplified version of OpenClaw. Both:
- Run locally on the user's machine
- Receive tasks from a remote service
- Execute AI agents with tool access
- Post results back

**OpenClaw already does all of this — and does it better:**
- Persistent sessions with memory
- Multiple channels (Discord, Telegram, now Astrid)
- Skills and tool ecosystem
- Sub-agents for parallel work
- Works with any AI provider
- Active community

## The Proposal: Astrid as a Task Interface, Not an AI Runtime

**Stop running AI agents inside Astrid. Let the agent runtimes (OpenClaw, Claude Code, etc.) handle execution.**

Astrid becomes purely a **task management interface** — a beautiful UI for creating, assigning, tracking, and discussing tasks. The AI execution happens elsewhere.

### New Architecture

```
┌─────────────────────────────────────────────┐
│                 Astrid.cc                    │
│                                             │
│  ┌─────────┐  ┌──────────┐  ┌───────────┐  │
│  │  Tasks   │  │ Comments  │  │   Lists   │  │
│  │  (CRUD)  │  │ (chat)    │  │ (organize)│  │
│  └────┬─────┘  └─────┬────┘  └───────────┘  │
│       │              │                       │
│  ┌────┴──────────────┴────┐                  │
│  │    Event Dispatch      │                  │
│  │  (SSE + Webhooks)      │                  │
│  └────┬──────────┬────────┘                  │
└───────┼──────────┼──────────────────────────┘
        │          │
   ┌────┴───┐ ┌───┴────┐
   │OpenClaw│ │ Claude  │   ← Agent runtimes connect OUTBOUND
   │Gateway │ │  Code   │
   │        │ │ Remote  │
   └────────┘ └────────┘
```

### What Changes

| Before | After |
|---|---|
| 4 executor implementations in Astrid | 0 — agents run externally |
| Assistant workflow calls AI APIs from Vercel | Dispatches to agent runtime |
| astrid-sdk runs AI agents locally | OpenClaw (or any runtime) handles it |
| GitHub workflow service in Astrid | Agent runtime handles Git/GitHub |
| Astrid manages API keys for AI providers | Agent runtime uses its own keys |

### What Stays

- Task CRUD (create, read, update, complete)
- Comments (the conversation thread)
- Lists (organization)
- Real-time SSE events
- OAuth API
- Beautiful web + iOS UI
- User management, sharing, collaboration

## Migration Path

### Phase 1: OpenClaw Channel (IN PROGRESS ✅)

What we built tonight:
- Astrid as an OpenClaw channel (SSE-based, outbound connection)
- `{name}.oc@astrid.cc` agent identity
- OAuth SSE support
- Event enrichment

### Phase 2: Generalized Agent Protocol

Define a simple, universal protocol for ANY agent runtime to connect:

```typescript
interface AstridAgentProtocol {
  // Agent connects to Astrid (outbound)
  connect(credentials: OAuthCredentials): SSEConnection

  // Astrid sends events
  events: {
    'task.assigned': { task: Task, assigner: User }
    'task.comment': { task: Task, comment: Comment }
    'task.updated': { task: Task, changes: Partial<Task> }
  }

  // Agent calls back via REST
  actions: {
    postComment(taskId: string, content: string): void
    completeTask(taskId: string): void
    updateTask(taskId: string, updates: Partial<Task>): void
    attachFile(taskId: string, file: File): void
    // GitHub-specific (optional)
    linkPR(taskId: string, prUrl: string): void
    updateDeployment(taskId: string, deployUrl: string, status: string): void
  }
}
```

This protocol works for:
- **OpenClaw** → connects via channel plugin
- **Claude Code Remote** → connects via webhook server (already works!)
- **Custom agents** → any runtime that speaks HTTP + SSE
- **Future runtimes** — whatever comes next

### Phase 3: Deprecate Built-in Executors

1. Mark assistant-workflow as "basic mode" (for users without an agent runtime)
2. Mark astrid-sdk executors as deprecated
3. Guide users to OpenClaw or Claude Code Remote
4. Eventually remove built-in AI execution code

**Keep the simple assistant-workflow** as a fallback for users who just want quick AI responses without setting up a runtime. But for coding tasks, GitHub workflows, and complex agent work → external runtimes.

### Phase 4: Agent Marketplace

Astrid becomes a place where users can:
- Browse available agent runtimes (OpenClaw, Claude Code, custom)
- Connect with one click
- See agent capabilities
- Share agent configurations

## What Astrid Keeps (Core Strengths)

1. **Beautiful task UI** — web + iOS, real-time, collaborative
2. **Shared lists** — team collaboration on tasks
3. **NLP task creation** — "weekly Monday exercise" → task with recurrence
4. **Comments as conversation** — natural back-and-forth with agents
5. **GitHub integration** — linking repos to lists, showing PRs/deployments
6. **User management** — auth, sharing, permissions

## What Astrid Drops (Complexity)

1. **AI API key management** — agent runtime handles this
2. **Per-provider executors** — no more Claude/OpenAI/Gemini/OpenClaw executors
3. **Prompt engineering** — agent runtime's responsibility
4. **Tool execution** — agent runtime handles git, file ops, etc.
5. **Model selection** — agent runtime decides

## Code Reduction Estimate

| Component | Lines | Status |
|---|---|---|
| `lib/ai/claude-agent-sdk-executor.ts` | 921 | Remove |
| `lib/ai/openai-agent-executor.ts` | 532 | Remove |
| `lib/ai/gemini-agent-executor.ts` | 557 | Remove |
| `lib/ai/openclaw-executor.ts` | 703 | Remove |
| `lib/ai/openclaw-rpc-client.ts` | 569 | Remove |
| `lib/ai/openclaw-signing.ts` | 170 | Remove |
| `lib/ai/providers/*.ts` | ~500 | Remove |
| `app/api/coding-workflow/*.ts` | ~800 | Simplify |
| `scripts/ai-agent-worker.ts` | ~600 | Remove |
| `packages/astrid-sdk/src/executors/*.ts` | ~3,000 | Deprecate |
| **Total reduction** | **~8,300** | |

Replace with:
- SSE event dispatch (~200 lines)
- Agent protocol types (~100 lines)
- Webhook receiver for non-SSE agents (~200 lines)

**Net: ~8,000 lines removed, ~500 lines added.**

## The astrid-sdk Future

The SDK doesn't go away — it evolves:

**Before:** Full AI execution engine with Claude/OpenAI/Gemini executors
**After:** Lightweight client library for connecting agent runtimes to Astrid

```typescript
// New astrid-sdk: simple, clean, universal
import { AstridClient } from '@gracefultools/astrid-sdk'

const client = new AstridClient({
  clientId: 'your-client-id',
  clientSecret: 'your-client-secret',
  agentEmail: 'myagent.oc@astrid.cc'
})

// Connect to SSE events
client.on('task.assigned', async (task) => {
  // Your agent handles the task however it wants
  const result = await myAgent.process(task)
  await client.postComment(task.id, result)
  await client.completeTask(task.id)
})

client.connect()
```

This SDK works with ANY agent runtime — OpenClaw, LangChain, AutoGPT, a bash script, whatever.

## Open Questions

1. **Keep assistant-workflow as fallback?** For users who just want quick Claude/GPT answers without setting up a runtime. Probably yes — it's simple and useful for non-coding tasks.

2. **GitHub integration ownership:** Should Astrid still show PR status and deployment previews? Yes — but as metadata posted by the agent, not managed by Astrid.

3. **Timeline:** How aggressive is the migration? Suggest keeping both paths for 3-6 months, then deprecating built-in executors.

4. **astrid-sdk NPM package:** Jon mentioned it's working well. Keep it as the connection library but strip out the executor code?

---

*This spec proposes making Astrid the best task interface for AI agents, not another AI runtime. Let the runtimes compete — Astrid wins by being the best way to organize and discuss work.*
