# Astrid Channel Plugin for OpenClaw

**Author:** Astrid Claw  
**Date:** 2026-02-16  
**Status:** Proposal  

## Summary

Build Astrid.cc as a first-class OpenClaw channel — like Discord, Telegram, or Signal. Users install the plugin, configure their Astrid credentials, and tasks assigned to `openclaw@astrid.cc` flow into their agent automatically. No tunnels, no port forwarding, no public URLs required.

## Problem

Today, connecting Astrid to OpenClaw requires either:
- **Polling** — agent checks for tasks on a timer (30+ min delay)
- **Push via hooks** — Astrid POSTs to the gateway (requires public URL, tunnels, or Tailscale)

Neither matches the seamless experience of Discord/Telegram, where OpenClaw connects outbound and receives messages in real-time.

## Solution

An OpenClaw channel plugin that connects **outbound** to Astrid's APIs, just like the Discord bot connects outbound to Discord. No inbound connections needed.

```
┌─────────────────────────────────┐
│  User's Machine (behind NAT)    │
│                                 │
│  OpenClaw Gateway               │
│  ├── Discord plugin ──────────► Discord API
│  ├── Telegram plugin ─────────► Telegram API
│  └── Astrid plugin ───────────► Astrid.cc API  ◄── NEW
│       ├── SSE (real-time events)│
│       ├── REST (task CRUD)      │
│       └── OAuth (auth)          │
└─────────────────────────────────┘
```

## Architecture

### Connection Model

```
OpenClaw                              Astrid.cc
────────                              ─────────
1. OAuth token request ──────────────► /api/v1/oauth/token
   ◄──────────────────────────────── access_token

2. SSE connection (persistent) ──────► /api/sse?since={timestamp}
   ◄──────────────────────────────── task_assigned events
   ◄──────────────────────────────── task_updated events
   ◄──────────────────────────────── comment events

3. REST calls (as needed) ──────────► /api/v1/tasks/{id}/comments
                                     /api/v1/tasks/{id} (complete)
                                     /api/v1/tasks (list)
```

### Event Flow: Task Assignment

```
1. User assigns task to openclaw@astrid.cc in Astrid
2. Astrid broadcasts SSE event: { type: "task_assigned", data: { taskId, title, ... } }
3. OpenClaw Astrid plugin receives event
4. Plugin creates a new session (or resumes existing one for that task)
5. Agent works on the task
6. Agent posts progress/results as comments via REST API
7. Agent marks task complete via REST API
8. All list members see updates in real-time via Astrid's SSE
```

### Event Flow: User Comments (Conversation)

```
1. User comments on an openclaw-assigned task
2. Astrid broadcasts SSE event: { type: "comment_added", data: { taskId, content, ... } }
3. Plugin receives event, routes to existing session for that task
4. Agent processes the comment (continues conversation)
5. Agent replies via REST API comment
```

### Session Mapping

| Astrid Concept | OpenClaw Concept |
|---|---|
| Task | Session (keyed by `astrid:task:{taskId}`) |
| Task title + description | Initial user message |
| Comment from human | Follow-up user message |
| Comment from agent | Agent response |
| Task completion | Session end |
| List | Group/channel context |
| Task priority | Message metadata |

## Configuration

### OpenClaw Config (`~/.openclaw/openclaw.json`)

```json5
{
  channels: {
    astrid: {
      enabled: true,
      // OAuth credentials (from astrid.cc/settings/api-access)
      clientId: "astrid_client_...",
      clientSecret: "...",

      // Which lists to monitor (optional, default: all accessible)
      lists: ["b39a13f0-..."],

      // Agent identity on Astrid
      agentEmail: "openclaw@astrid.cc",

      // Polling fallback interval if SSE disconnects (ms)
      pollIntervalMs: 30000,

      // Session behavior
      session: {
        // How long to keep task sessions alive after last activity
        idleTimeoutMinutes: 1440,  // 24 hours
        // Whether to auto-complete tasks when agent says it's done
        autoComplete: false,
      },

      // What triggers a new agent turn
      triggers: {
        taskAssigned: true,      // new task assigned to agent
        commentAdded: true,      // human comments on agent's task
        taskUpdated: false,      // task metadata changed (title, priority, etc.)
      },
    },
  },
}
```

### Minimal Config (just works)

```json5
{
  channels: {
    astrid: {
      enabled: true,
      clientId: "astrid_client_...",
      clientSecret: "...",
    },
  },
}
```

## Astrid-Side Requirements

### 1. OAuth SSE Support

**Current state:** SSE endpoint (`/api/sse`) requires a browser session cookie.  
**Needed:** Support OAuth Bearer token authentication for SSE connections.

```typescript
// Current (browser only):
const session = await getServerSession(authConfig)

// Needed (also support OAuth):
const auth = await authenticateAPI(req)  // supports OAuth + session
```

This allows OpenClaw (and any OAuth client) to connect to SSE without a browser.

### 2. SSE Event Enrichment

Ensure SSE events for task assignments include enough context for the agent to start working without additional API calls:

```json
{
  "type": "task_assigned",
  "timestamp": "2026-02-16T...",
  "data": {
    "taskId": "abc-123",
    "title": "Research competitor pricing",
    "description": "Look into...",
    "priority": 2,
    "dueDateTime": null,
    "listId": "list-456",
    "listName": "Marketing",
    "assignerName": "Jon Paris",
    "assignerId": "user-789",
    "comments": []
  }
}
```

### 3. Comment Events for Agent Tasks

When a human comments on a task assigned to an AI agent, broadcast an SSE event:

```json
{
  "type": "agent_task_comment",
  "timestamp": "2026-02-16T...",
  "data": {
    "taskId": "abc-123",
    "commentId": "comment-111",
    "content": "Can you also check their enterprise pricing?",
    "authorName": "Jon Paris",
    "authorId": "user-789"
  }
}
```

### 4. Agent Comment Attribution

Comments posted via OAuth by the agent's OAuth client should be attributed to the agent user (`openclaw@astrid.cc`), not the OAuth client owner. This may require:

- Mapping OAuth client → agent email
- Or allowing the `authorId` to be specified when the OAuth client has agent scopes

## OpenClaw-Side: Plugin Implementation

### Plugin Structure

```
plugins/astrid/
├── index.ts          — Plugin entry, registers channel
├── channel.ts        — Channel implementation (connect, disconnect, send, receive)
├── sse-client.ts     — SSE connection manager (reconnect, heartbeat, event parsing)
├── oauth.ts          — OAuth token management (fetch, cache, refresh)
├── task-mapper.ts    — Maps Astrid tasks ↔ OpenClaw sessions
└── types.ts          — TypeScript types
```

### Channel Interface

The plugin implements OpenClaw's channel interface:

```typescript
interface AstridChannel {
  // Lifecycle
  connect(): Promise<void>
  disconnect(): Promise<void>
  isConnected(): boolean

  // Receiving (Astrid → OpenClaw)
  onTaskAssigned(handler: (task: AstridTask) => void): void
  onCommentAdded(handler: (taskId: string, comment: AstridComment) => void): void

  // Sending (OpenClaw → Astrid)
  sendComment(taskId: string, content: string): Promise<void>
  completeTask(taskId: string): Promise<void>
  updateTask(taskId: string, updates: Partial<AstridTask>): Promise<void>

  // Polling fallback
  pollTasks(): Promise<AstridTask[]>
}
```

### SSE Client

Robust SSE connection with:
- Auto-reconnect with exponential backoff
- `since` parameter for missed event recovery
- Heartbeat monitoring (detect dead connections)
- Token refresh on 401

```typescript
class AstridSSEClient {
  private eventSource: EventSource | null = null
  private reconnectAttempts = 0
  private lastEventTimestamp: number = Date.now()

  async connect(token: string): Promise<void> {
    const url = `https://www.astrid.cc/api/sse?since=${this.lastEventTimestamp}`
    // Connect with OAuth token
    // Handle events, reconnection, etc.
  }
}
```

### Message Formatting

Inbound task → agent message:
```
# Task: Research competitor pricing

Look into competitor pricing models for our enterprise tier.

**Priority:** High
**List:** Marketing
**Assigned by:** Jon Paris
**Due:** 2026-02-20

---
*Reply to this message to add a comment. Say "done" to mark the task complete.*
```

Agent response → Astrid comment:
- Markdown content posted as-is
- File attachments via Astrid's upload API
- "Task complete" detection → auto-mark done (if configured)

## Rollout Plan

### Phase 1: OAuth SSE + Polling Plugin (MVP)
**Astrid changes:**
- Add OAuth auth to SSE endpoint
- Enrich task_assigned SSE events with full context
- Add agent_task_comment SSE events

**OpenClaw changes:**
- Build Astrid channel plugin with SSE + polling fallback
- Session-per-task mapping
- Comment send/receive

**Result:** Real-time task flow, no tunnels needed. Works for any OpenClaw user.

### Phase 2: Enhanced UX
- Task priority → message urgency mapping
- Due date → reminder scheduling
- List-based routing (different lists → different agents)
- GitHub repo context (if list has linked repo)
- File attachment support in both directions

### Phase 3: Multi-Agent + Team
- Multiple agents per list (route by task type)
- Agent handoff (reassign between agents)
- Team dashboards showing agent activity
- Usage/cost tracking per task

### Phase 4: ClaHub Publication
- Package as installable OpenClaw skill/plugin
- Publish to ClaHub (clawhub.com)
- Setup wizard (guided OAuth + list selection)
- Documentation + getting started guide

## Effort Estimate

| Phase | Astrid | OpenClaw Plugin | Total |
|---|---|---|---|
| Phase 1 (MVP) | 2-3 days | 3-4 days | ~1 week |
| Phase 2 | 2 days | 2 days | ~4 days |
| Phase 3 | 3 days | 2 days | ~5 days |
| Phase 4 | 1 day | 2 days | ~3 days |

**MVP to production: ~1 week**

## Open Questions

1. **Agent identity:** Each OpenClaw instance gets a unique email: `{name}.oc@astrid.cc` (e.g., `astrid.oc@astrid.cc`, `jeff.oc@astrid.cc`). The `.oc` suffix identifies all OpenClaw agents. Pattern match `*.oc@astrid.cc` for routing. ✅ DECIDED

2. **Rate limiting:** How many SSE connections can Astrid handle? Need connection pooling if many users connect.

3. **Offline handling:** When OpenClaw is offline, tasks queue up. Should Astrid show "agent offline" status? Retry delivery on reconnect?

4. **Conflict resolution:** If a task is assigned to `openclaw@astrid.cc` but the user doesn't have an OpenClaw instance, should Astrid fall back to its built-in AI (Claude/OpenAI)?

5. **Plugin distribution:** Should this be a built-in OpenClaw channel (like Discord) or an installable plugin from ClaHub? Built-in gets more adoption, ClaHub is more flexible.

---

*This spec was created by Astrid Claw based on analysis of both Astrid.cc and OpenClaw codebases.*
