# OpenClaw Channel Plugin for Astrid.cc — Engineering Specification

**Version:** 1.0  
**Date:** 2026-02-16  
**Status:** Draft  
**Prerequisite:** [ASTRID_OPENCLAW_CHANNEL_SPEC.md](./ASTRID_OPENCLAW_CHANNEL_SPEC.md) (overview)

---

## Table of Contents

- [A. Agent Registration Flow](#a-agent-registration-flow)
- [B. OpenClaw Plugin Architecture](#b-openclaw-plugin-architecture)
- [C. SSE Protocol](#c-sse-protocol)
- [D. OAuth Scopes](#d-oauth-scopes)
- [E. Astrid-Side API Changes](#e-astrid-side-api-changes)
- [F. OpenClaw-Side Plugin Implementation](#f-openclaw-side-plugin-implementation)
- [G. Configuration Examples](#g-configuration-examples)
- [H. Message Format Spec](#h-message-format-spec)
- [I. Error Handling](#i-error-handling)
- [J. Security](#j-security)
- [K. Testing Plan](#k-testing-plan)
- [L. Migration Path](#l-migration-path)

---

## A. Agent Registration Flow

### Overview

Each OpenClaw instance connected to Astrid gets a unique agent identity: `{name}.oc@astrid.cc`. The `.oc` suffix is reserved for OpenClaw agents and triggers pattern-based routing throughout the Astrid codebase.

### Registration Methods

#### Method 1: Settings UI (Recommended)

1. User navigates to **Settings → AI Agents → OpenClaw** in Astrid web UI
2. User enters a desired agent name (e.g., `astrid`, `jeff`, `helper`)
3. Astrid validates the name:
   - Must match `/^[a-z0-9][a-z0-9._-]{0,30}[a-z0-9]$/` (2-32 chars, lowercase alphanumeric + dots/hyphens/underscores)
   - Must not collide with existing `*.oc@astrid.cc` users
   - Reserved names: `admin`, `system`, `test`, `api`, `support`
4. Astrid creates the agent user record and OAuth client
5. UI displays `clientId` and `clientSecret` (shown once, user copies to OpenClaw config)
6. UI also displays the agent email: `{name}.oc@astrid.cc`

#### Method 2: Registration API

```
POST /api/v1/openclaw/register
Authorization: Bearer <user_session_or_oauth_token>
Content-Type: application/json

{
  "agentName": "astrid",
  "listIds": ["b39a13f0-..."]  // optional: lists the agent should access
}
```

Response (201):
```json
{
  "agent": {
    "id": "user_abc123",
    "email": "astrid.oc@astrid.cc",
    "name": "Astrid (OpenClaw)",
    "aiAgentType": "openclaw_worker"
  },
  "oauth": {
    "clientId": "astrid_oc_abc123",
    "clientSecret": "sk_oc_...",
    "scopes": ["tasks:read", "tasks:write", "comments:read", "comments:write", "sse:connect"]
  },
  "config": {
    "sseEndpoint": "https://www.astrid.cc/api/sse",
    "apiBase": "https://www.astrid.cc/api/v1",
    "tokenEndpoint": "https://www.astrid.cc/api/v1/oauth/token"
  }
}
```

### Database Schema for `.oc` Agent Users

```sql
-- User record for the agent
INSERT INTO "User" (
  id, email, name, image,
  "isAIAgent", "aiAgentType", "aiAgentConfig",
  "isActive", "createdAt", "updatedAt"
) VALUES (
  'generated-uuid',
  'astrid.oc@astrid.cc',
  'Astrid (OpenClaw)',
  '/avatars/openclaw-agent.png',
  true,
  'openclaw_worker',
  '{"registeredBy": "user_xyz", "agentName": "astrid", "version": "1.0"}',
  true,
  NOW(),
  NOW()
);
```

Key fields:
- `isAIAgent = true` — marks this as a non-human user
- `aiAgentType = 'openclaw_worker'` — identifies this as an OpenClaw-managed agent
- `email` — pattern `{name}.oc@astrid.cc` enables pattern-based routing
- `aiAgentConfig` — JSON blob storing registration metadata

### Pattern Matching in Code

The `.oc@astrid.cc` pattern is matched with: `/^[a-z0-9._-]+\.oc@astrid\.cc$/i`

This pattern is used in:
- `lib/ai-agent-webhook-service.ts` → `getAgentType()` — returns `'openclaw'`
- `app/api/assistant-workflow/route.ts` → `getServiceFromEmail()` — returns `'openclaw'`
- `lib/ai/agent-config.ts` → `getAgentConfig()` — returns OpenClaw config
- `lib/ai-agent-comment-service.ts` → agent resolution fallback
- `app/api/users/search/route.ts` → includes `.oc` agents in search results

---

## B. OpenClaw Plugin Architecture

### File Structure (OpenClaw Codebase)

```
src/channels/astrid/
├── index.ts              — Channel registration, exports
├── astrid-channel.ts     — Main channel class (implements ChannelProvider)
├── sse-client.ts         — SSE connection via fetch + ReadableStream
├── oauth-client.ts       — OAuth2 client credentials flow + token caching
├── task-session-mapper.ts — Maps Astrid tasks ↔ OpenClaw sessions
├── message-formatter.ts  — Bidirectional message formatting
├── rest-client.ts        — Astrid REST API wrapper
├── types.ts              — TypeScript interfaces & event schemas
├── polling-fallback.ts   — Poll-based fallback when SSE unavailable
└── __tests__/
    ├── sse-client.test.ts
    ├── message-formatter.test.ts
    ├── task-session-mapper.test.ts
    └── oauth-client.test.ts
```

### Channel Interface Implementation

```typescript
// astrid-channel.ts
import type { ChannelProvider, InboundMessage, OutboundMessage } from '@openclaw/core'

export class AstridChannel implements ChannelProvider {
  readonly id = 'astrid'
  readonly displayName = 'Astrid.cc'

  private sseClient: AstridSSEClient
  private oauthClient: AstridOAuthClient
  private restClient: AstridRestClient
  private sessionMapper: TaskSessionMapper
  private formatter: MessageFormatter
  private pollingFallback: PollingFallback | null = null
  private config: AstridChannelConfig

  constructor(config: AstridChannelConfig) {
    this.config = config
    this.oauthClient = new AstridOAuthClient(config)
    this.restClient = new AstridRestClient(config.apiBase, this.oauthClient)
    this.sseClient = new AstridSSEClient(config, this.oauthClient)
    this.sessionMapper = new TaskSessionMapper(config.session)
    this.formatter = new MessageFormatter(config)
  }

  // === Lifecycle ===

  async init(): Promise<void> {
    // Validate config
    if (!this.config.clientId || !this.config.clientSecret) {
      throw new Error('Astrid channel: clientId and clientSecret are required')
    }

    // Pre-authenticate
    await this.oauthClient.ensureToken()

    // Fetch initial task list for session recovery
    if (this.config.session?.resumeOnRestart) {
      await this.recoverSessions()
    }
  }

  async connect(onMessage: (msg: InboundMessage) => void): Promise<void> {
    this.sseClient.on('task_assigned', (event) => {
      const msg = this.formatter.taskToMessage(event.data)
      const sessionKey = this.sessionMapper.getOrCreate(event.data.taskId)
      onMessage({ ...msg, sessionKey })
    })

    this.sseClient.on('comment_added', (event) => {
      const sessionKey = this.sessionMapper.get(event.data.taskId)
      if (!sessionKey) return // Unknown task, ignore
      const msg = this.formatter.commentToMessage(event.data)
      onMessage({ ...msg, sessionKey })
    })

    this.sseClient.on('task_completed', (event) => {
      this.sessionMapper.end(event.data.taskId)
    })

    this.sseClient.on('task_deleted', (event) => {
      this.sessionMapper.end(event.data.taskId)
    })

    try {
      await this.sseClient.connect()
    } catch (err) {
      // Fall back to polling if SSE fails
      if (this.config.pollIntervalMs) {
        this.pollingFallback = new PollingFallback(
          this.restClient,
          this.config.pollIntervalMs,
          (tasks) => {
            for (const task of tasks) {
              const msg = this.formatter.taskToMessage(task)
              const sessionKey = this.sessionMapper.getOrCreate(task.taskId)
              onMessage({ ...msg, sessionKey })
            }
          }
        )
        await this.pollingFallback.start()
      } else {
        throw err
      }
    }
  }

  async disconnect(): Promise<void> {
    this.sseClient.disconnect()
    this.pollingFallback?.stop()
  }

  async send(msg: OutboundMessage): Promise<void> {
    const taskId = this.sessionMapper.getTaskId(msg.sessionKey)
    if (!taskId) {
      throw new Error(`No Astrid task mapped to session ${msg.sessionKey}`)
    }

    // Post as comment
    const content = this.formatter.responseToComment(msg)
    await this.restClient.addComment(taskId, content)

    // Auto-complete detection
    if (this.config.session?.autoComplete && this.formatter.isCompletionSignal(msg)) {
      await this.restClient.completeTask(taskId)
      this.sessionMapper.end(taskId)
    }
  }

  isConnected(): boolean {
    return this.sseClient.isConnected() || (this.pollingFallback?.isRunning() ?? false)
  }

  getHealth(): ChannelHealth {
    return {
      connected: this.isConnected(),
      mode: this.sseClient.isConnected() ? 'sse' : this.pollingFallback?.isRunning() ? 'polling' : 'disconnected',
      lastEvent: this.sseClient.lastEventTime,
      activeSessions: this.sessionMapper.activeCount(),
      reconnectAttempts: this.sseClient.reconnectAttempts,
    }
  }

  private async recoverSessions(): Promise<void> {
    const tasks = await this.restClient.getAssignedTasks()
    for (const task of tasks) {
      if (!task.completed) {
        this.sessionMapper.getOrCreate(task.id)
      }
    }
  }
}
```

### Configuration Schema

```typescript
// types.ts
export interface AstridChannelConfig {
  enabled: boolean

  // OAuth credentials
  clientId: string
  clientSecret: string

  // API endpoints (defaults to production)
  apiBase?: string         // default: 'https://www.astrid.cc/api/v1'
  sseEndpoint?: string     // default: 'https://www.astrid.cc/api/sse'
  tokenEndpoint?: string   // default: 'https://www.astrid.cc/api/v1/oauth/token'

  // Agent identity
  agentEmail?: string      // auto-detected from OAuth client if not set

  // List filtering
  lists?: string[]         // list IDs to monitor (default: all accessible)

  // SSE/polling
  pollIntervalMs?: number  // fallback poll interval (default: 30000)

  // Session behavior
  session?: {
    idleTimeoutMinutes?: number  // default: 1440 (24h)
    autoComplete?: boolean       // default: false
    resumeOnRestart?: boolean    // default: true
  }

  // Triggers
  triggers?: {
    taskAssigned?: boolean   // default: true
    commentAdded?: boolean   // default: true
    taskUpdated?: boolean    // default: false
  }

  // Message formatting
  format?: {
    showPriority?: boolean   // default: true
    showDueDate?: boolean    // default: true
    showListName?: boolean   // default: true
    showAssigner?: boolean   // default: true
    completionKeywords?: string[]  // default: ['done', 'complete', 'finished', 'completed']
  }
}
```

### Connection Lifecycle

```
┌──────────┐
│   INIT   │ validate config, pre-auth OAuth
└────┬─────┘
     │
┌────▼──────────┐
│  AUTHENTICATE │ client_credentials grant → access_token
└────┬──────────┘
     │
┌────▼──────────┐     ┌──────────────┐
│  CONNECT SSE  │────►│  POLLING     │  (fallback on SSE failure)
└────┬──────────┘     │  FALLBACK    │
     │                └──────┬───────┘
┌────▼──────────┐            │
│ PROCESS EVENTS│◄───────────┘
│  (steady state)│
└────┬──────────┘
     │ (disconnect/error)
┌────▼──────────┐
│  RECONNECT    │ exponential backoff with jitter
│  (with since) │
└───────────────┘
```

### Session Management

| Astrid Concept | OpenClaw Concept | Mapping Key |
|---|---|---|
| Task | Session | `astrid:task:{taskId}` |
| Task title + description | Initial user message | — |
| Comment from human | Follow-up user message | — |
| Comment from agent | Agent response | — |
| Task completed/deleted | Session end | — |
| List | Group/channel context | `astrid:list:{listId}` |

```typescript
// task-session-mapper.ts
export class TaskSessionMapper {
  private taskToSession = new Map<string, string>()  // taskId → sessionKey
  private sessionToTask = new Map<string, string>()  // sessionKey → taskId
  private lastActivity = new Map<string, number>()   // taskId → timestamp

  getOrCreate(taskId: string): string {
    let sessionKey = this.taskToSession.get(taskId)
    if (!sessionKey) {
      sessionKey = `astrid:task:${taskId}`
      this.taskToSession.set(taskId, sessionKey)
      this.sessionToTask.set(sessionKey, taskId)
    }
    this.lastActivity.set(taskId, Date.now())
    return sessionKey
  }

  get(taskId: string): string | undefined {
    return this.taskToSession.get(taskId)
  }

  getTaskId(sessionKey: string): string | undefined {
    return this.sessionToTask.get(sessionKey)
  }

  end(taskId: string): void {
    const sessionKey = this.taskToSession.get(taskId)
    if (sessionKey) {
      this.sessionToTask.delete(sessionKey)
    }
    this.taskToSession.delete(taskId)
    this.lastActivity.delete(taskId)
  }

  activeCount(): number {
    return this.taskToSession.size
  }

  // Called periodically to clean up idle sessions
  cleanupIdle(maxIdleMs: number): string[] {
    const now = Date.now()
    const expired: string[] = []
    for (const [taskId, lastTime] of this.lastActivity) {
      if (now - lastTime > maxIdleMs) {
        expired.push(taskId)
        this.end(taskId)
      }
    }
    return expired
  }
}
```

---

## C. SSE Protocol

### Connection

```
GET /api/sse?since={iso8601_timestamp}&agent=true
Authorization: Bearer {access_token}
Accept: text/event-stream
Cache-Control: no-cache
```

The `agent=true` parameter tells the SSE endpoint to include agent-specific events (task assignments, comments on agent tasks) rather than general user events.

**Why not `EventSource`:** The browser `EventSource` API does not support custom headers. The plugin uses `fetch()` with `ReadableStream` to set the `Authorization` header. See [F. SSE Client Implementation](#sse-client-implementation) for details.

### Event Schema

All events follow this envelope:

```typescript
interface SSEEvent<T = unknown> {
  id: string           // unique event ID (UUID or monotonic counter)
  type: string         // event type name
  timestamp: string    // ISO 8601
  data: T              // event-specific payload
}
```

#### `task_assigned`

Fired when a task is assigned to the agent user.

```json
{
  "id": "evt_abc123",
  "type": "task_assigned",
  "timestamp": "2026-02-16T10:30:00.000Z",
  "data": {
    "taskId": "task_xyz",
    "title": "Research competitor pricing",
    "description": "Look into competitor pricing models for our enterprise tier.",
    "priority": 2,
    "dueDateTime": "2026-02-20T00:00:00.000Z",
    "listId": "list_456",
    "listName": "Marketing",
    "assignerName": "Jon Paris",
    "assignerId": "user_789",
    "comments": [],
    "tags": ["research", "pricing"],
    "createdAt": "2026-02-16T10:29:55.000Z"
  }
}
```

#### `task_updated`

Task metadata changed (title, priority, due date, description).

```json
{
  "id": "evt_def456",
  "type": "task_updated",
  "timestamp": "2026-02-16T11:00:00.000Z",
  "data": {
    "taskId": "task_xyz",
    "changes": {
      "priority": { "from": 2, "to": 3 },
      "title": { "from": "Research competitor pricing", "to": "URGENT: Research competitor pricing" }
    },
    "updatedBy": "user_789"
  }
}
```

#### `task_completed`

Task marked as complete by a human (not by the agent itself).

```json
{
  "id": "evt_ghi789",
  "type": "task_completed",
  "timestamp": "2026-02-16T12:00:00.000Z",
  "data": {
    "taskId": "task_xyz",
    "completedBy": "user_789"
  }
}
```

#### `task_deleted`

Task removed.

```json
{
  "id": "evt_jkl012",
  "type": "task_deleted",
  "timestamp": "2026-02-16T12:05:00.000Z",
  "data": {
    "taskId": "task_xyz",
    "deletedBy": "user_789"
  }
}
```

#### `comment_added`

Human commented on a task assigned to the agent.

```json
{
  "id": "evt_mno345",
  "type": "comment_added",
  "timestamp": "2026-02-16T10:45:00.000Z",
  "data": {
    "taskId": "task_xyz",
    "commentId": "comment_111",
    "content": "Can you also check their enterprise pricing?",
    "authorName": "Jon Paris",
    "authorId": "user_789",
    "parentCommentId": null
  }
}
```

#### `comment_deleted`

Comment removed from an agent's task.

```json
{
  "id": "evt_pqr678",
  "type": "comment_deleted",
  "timestamp": "2026-02-16T10:50:00.000Z",
  "data": {
    "taskId": "task_xyz",
    "commentId": "comment_111",
    "deletedBy": "user_789"
  }
}
```

#### `list_updated`

List settings changed (name, description, members).

```json
{
  "id": "evt_stu901",
  "type": "list_updated",
  "timestamp": "2026-02-16T13:00:00.000Z",
  "data": {
    "listId": "list_456",
    "changes": {
      "name": { "from": "Marketing", "to": "Marketing & Sales" }
    }
  }
}
```

### Reconnection Protocol

1. Client stores `lastEventId` from each received event
2. On disconnect, client waits with exponential backoff (see [I. Error Handling](#i-error-handling))
3. Reconnects with `?since={lastEventTimestamp}` to receive missed events
4. Server replays events from `since` (up to a 24-hour buffer)
5. If gap exceeds buffer, server sends a `sync_required` event — client should poll full task list

### Heartbeat / Keepalive

- Server sends `:keepalive\n\n` (SSE comment) every 30 seconds
- If client receives no data for 90 seconds, assume dead connection → reconnect
- Client can send periodic `GET /api/sse/ping` with Bearer token to verify auth is still valid

---

## D. OAuth Scopes

### Scope Definitions

| Scope | Description | Used For |
|---|---|---|
| `tasks:read` | Read tasks assigned to agent | SSE events, polling |
| `tasks:write` | Update task status (complete) | Auto-completion |
| `comments:read` | Read comments on agent tasks | Context loading |
| `comments:write` | Post comments as agent | Agent responses |
| `sse:connect` | Connect to SSE endpoint | Real-time events |
| `lists:read` | Read list metadata | List context |
| `user:read` | Read agent's own profile | Identity verification |

### New Scope: `sse:connect`

Add to `lib/oauth/oauth-scopes.ts`:

```typescript
'sse:connect': 'Connect to server-sent events stream',
```

Add to `SCOPE_GROUPS.ai_agent`:
```typescript
ai_agent: [
  'tasks:read', 'tasks:write', 'lists:read',
  'comments:read', 'comments:write', 'user:read',
  'sse:connect',  // NEW
],
```

### Token Flow

```
1. Plugin starts
2. POST /api/v1/oauth/token
   grant_type=client_credentials
   client_id=...
   client_secret=...
   scope=tasks:read tasks:write comments:read comments:write sse:connect

3. Response: { access_token, token_type: "Bearer", expires_in: 3600 }

4. Plugin caches token, refreshes 5 minutes before expiry
5. On 401 from any endpoint → immediately refresh → retry once
```

---

## E. Astrid-Side API Changes Needed

### 1. SSE Endpoint OAuth Support

**File:** `app/api/sse/route.ts`

Currently authenticates only via browser session. Needs to also accept OAuth Bearer tokens:

```typescript
// Current:
const session = await getServerSession(authConfig)

// Updated:
const auth = await authenticateRequest(req)  // checks OAuth token first, then session

function authenticateRequest(req: NextRequest) {
  const authHeader = req.headers.get('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    return validateOAuthToken(token, ['sse:connect'])
  }
  return getServerSession(authConfig)
}
```

### 2. SSE Event Enrichment for Agent Tasks

When a task is assigned to a `*.oc@astrid.cc` user, the SSE event should include full context:
- Task title, description, priority, due date
- List name and ID
- Assigner name
- Existing comments (for resumption)
- Tags

This avoids the plugin needing a separate REST call after each event.

### 3. Agent-Specific SSE Events

New SSE events to broadcast:
- `comment_added` — when human comments on agent's task (currently only broadcast as generic `comment_created`)
- `comment_deleted` — when comment removed from agent's task
- `task_completed` — when human completes agent's task
- `task_deleted` — when agent's task is deleted

Filter: only broadcast these events to SSE connections authenticated as the assigned agent.

### 4. Agent Registration Endpoint

**File:** `app/api/v1/openclaw/register/route.ts` (new)

```typescript
export async function POST(req: NextRequest) {
  const auth = await authenticateRequest(req)
  if (!auth) return unauthorized()

  const { agentName, listIds } = await req.json()

  // Validate name
  if (!/^[a-z0-9][a-z0-9._-]{0,30}[a-z0-9]$/.test(agentName)) {
    return badRequest('Invalid agent name')
  }

  const email = `${agentName}.oc@astrid.cc`

  // Check uniqueness
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) return conflict('Agent name already taken')

  // Create agent user
  const agent = await prisma.user.create({
    data: {
      email,
      name: `${agentName} (OpenClaw)`,
      isAIAgent: true,
      aiAgentType: 'openclaw_worker',
      aiAgentConfig: JSON.stringify({
        registeredBy: auth.userId,
        agentName,
        version: '1.0'
      }),
      isActive: true,
    }
  })

  // Create OAuth client
  const oauthClient = await createOAuthClient({
    name: `OpenClaw Agent: ${agentName}`,
    userId: auth.userId,
    agentUserId: agent.id,
    scopes: ['tasks:read', 'tasks:write', 'comments:read', 'comments:write', 'sse:connect', 'lists:read', 'user:read'],
  })

  // Add agent to specified lists
  if (listIds?.length) {
    for (const listId of listIds) {
      await prisma.listMember.create({
        data: { listId, userId: agent.id, role: 'member' }
      })
    }
  }

  return NextResponse.json({
    agent: { id: agent.id, email, name: agent.name, aiAgentType: agent.aiAgentType },
    oauth: { clientId: oauthClient.clientId, clientSecret: oauthClient.clientSecret, scopes: oauthClient.scopes },
    config: {
      sseEndpoint: 'https://www.astrid.cc/api/sse',
      apiBase: 'https://www.astrid.cc/api/v1',
      tokenEndpoint: 'https://www.astrid.cc/api/v1/oauth/token',
    }
  }, { status: 201 })
}
```

### 5. `.oc@astrid.cc` Pattern Routing in Webhook Service

Update `getAgentType()` in `lib/ai-agent-webhook-service.ts` to recognize the pattern:

```typescript
function getAgentType(email?: string, name?: string): string | null {
  if (email?.match(/^[a-z0-9._-]+\.oc@astrid\.cc$/i)) {
    return 'openclaw'
  }
  // ... existing exact matches
}
```

### 6. Pattern-Based Config in `agent-config.ts`

Add `getAgentConfigByPattern()` to handle dynamic `.oc` emails:

```typescript
export function getAgentConfig(email: string): AIAgentConfig | null {
  // Exact match first
  if (AI_AGENT_CONFIG[email]) return AI_AGENT_CONFIG[email]

  // Pattern match for *.oc@astrid.cc
  if (/^[a-z0-9._-]+\.oc@astrid\.cc$/i.test(email)) {
    return AI_AGENT_CONFIG['openclaw@astrid.cc']
  }

  return null
}
```

---

## F. OpenClaw-Side Plugin Implementation

### SSE Client Implementation

Uses `fetch` + `ReadableStream` instead of `EventSource` for auth header support:

```typescript
// sse-client.ts
export class AstridSSEClient {
  private abortController: AbortController | null = null
  private connected = false
  private _lastEventTime: number = Date.now()
  private _reconnectAttempts = 0
  private handlers = new Map<string, ((event: SSEEvent) => void)[]>()
  private keepaliveTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private config: AstridChannelConfig,
    private oauth: AstridOAuthClient
  ) {}

  get lastEventTime(): number { return this._lastEventTime }
  get reconnectAttempts(): number { return this._reconnectAttempts }

  on(eventType: string, handler: (event: SSEEvent) => void): void {
    const existing = this.handlers.get(eventType) || []
    existing.push(handler)
    this.handlers.set(eventType, existing)
  }

  async connect(): Promise<void> {
    const token = await this.oauth.ensureToken()
    const since = new Date(this._lastEventTime).toISOString()
    const endpoint = this.config.sseEndpoint || 'https://www.astrid.cc/api/sse'
    const url = `${endpoint}?since=${encodeURIComponent(since)}&agent=true`

    this.abortController = new AbortController()

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
      signal: this.abortController.signal,
    })

    if (response.status === 401) {
      // Token expired, refresh and retry
      await this.oauth.refreshToken()
      return this.connect()
    }

    if (!response.ok) {
      throw new Error(`SSE connection failed: ${response.status} ${response.statusText}`)
    }

    if (!response.body) {
      throw new Error('SSE response has no body')
    }

    this.connected = true
    this._reconnectAttempts = 0
    this.startKeepaliveMonitor()

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const events = this.parseSSEBuffer(buffer)
        buffer = events.remaining

        for (const event of events.parsed) {
          this._lastEventTime = Date.now()
          this.resetKeepaliveMonitor()
          this.dispatch(event)
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return // Intentional disconnect
      throw err
    } finally {
      this.connected = false
      this.stopKeepaliveMonitor()
    }
  }

  disconnect(): void {
    this.abortController?.abort()
    this.connected = false
    this.stopKeepaliveMonitor()
  }

  isConnected(): boolean {
    return this.connected
  }

  async reconnect(): Promise<void> {
    this._reconnectAttempts++
    const delay = this.getBackoffDelay()
    await new Promise(resolve => setTimeout(resolve, delay))
    return this.connect()
  }

  private getBackoffDelay(): number {
    const base = 2000    // 2s initial
    const max = 120000   // 2min max
    const factor = 1.4
    const jitter = 0.2

    const delay = Math.min(base * Math.pow(factor, this._reconnectAttempts), max)
    const jitterMs = delay * jitter * (Math.random() * 2 - 1)
    return Math.round(delay + jitterMs)
  }

  private parseSSEBuffer(buffer: string): { parsed: SSEEvent[], remaining: string } {
    const parsed: SSEEvent[] = []
    const lines = buffer.split('\n')
    let currentEvent: Partial<SSEEvent> = {}
    let dataLines: string[] = []
    let remaining = ''

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      // Incomplete last line — save as remaining
      if (i === lines.length - 1 && !buffer.endsWith('\n')) {
        remaining = line
        break
      }

      // Empty line = end of event
      if (line === '') {
        if (dataLines.length > 0) {
          try {
            const data = JSON.parse(dataLines.join('\n'))
            parsed.push({
              id: currentEvent.id || '',
              type: currentEvent.type || 'message',
              timestamp: data.timestamp || new Date().toISOString(),
              data: data.data || data,
            })
          } catch { /* skip malformed */ }
        }
        currentEvent = {}
        dataLines = []
        continue
      }

      // SSE comment (keepalive)
      if (line.startsWith(':')) continue

      // Parse field
      const colonIndex = line.indexOf(':')
      if (colonIndex === -1) continue
      const field = line.slice(0, colonIndex)
      const value = line.slice(colonIndex + 1).trimStart()

      switch (field) {
        case 'id': currentEvent.id = value; break
        case 'event': currentEvent.type = value; break
        case 'data': dataLines.push(value); break
      }
    }

    return { parsed, remaining }
  }

  private dispatch(event: SSEEvent): void {
    const handlers = this.handlers.get(event.type) || []
    for (const handler of handlers) {
      try { handler(event) } catch (err) { console.error(`SSE handler error:`, err) }
    }
  }

  private startKeepaliveMonitor(): void {
    this.keepaliveTimer = setTimeout(() => {
      // No data for 90s — assume dead
      console.warn('Astrid SSE: keepalive timeout, reconnecting...')
      this.disconnect()
      this.reconnect().catch(console.error)
    }, 90_000)
  }

  private resetKeepaliveMonitor(): void {
    this.stopKeepaliveMonitor()
    this.startKeepaliveMonitor()
  }

  private stopKeepaliveMonitor(): void {
    if (this.keepaliveTimer) {
      clearTimeout(this.keepaliveTimer)
      this.keepaliveTimer = null
    }
  }
}
```

### OAuth Client

```typescript
// oauth-client.ts
export class AstridOAuthClient {
  private accessToken: string | null = null
  private expiresAt: number = 0

  constructor(private config: AstridChannelConfig) {}

  async ensureToken(): Promise<string> {
    // Refresh 5 minutes before expiry
    if (this.accessToken && Date.now() < this.expiresAt - 300_000) {
      return this.accessToken
    }
    return this.refreshToken()
  }

  async refreshToken(): Promise<string> {
    const endpoint = this.config.tokenEndpoint || 'https://www.astrid.cc/api/v1/oauth/token'

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        scope: 'tasks:read tasks:write comments:read comments:write sse:connect lists:read user:read',
      }),
    })

    if (!response.ok) {
      throw new Error(`OAuth token request failed: ${response.status}`)
    }

    const data = await response.json()
    this.accessToken = data.access_token
    this.expiresAt = Date.now() + (data.expires_in * 1000)
    return this.accessToken!
  }
}
```

### REST Client

```typescript
// rest-client.ts
export class AstridRestClient {
  constructor(
    private apiBase: string = 'https://www.astrid.cc/api/v1',
    private oauth: AstridOAuthClient
  ) {}

  private async request(path: string, options: RequestInit = {}): Promise<any> {
    const token = await this.oauth.ensureToken()
    const response = await fetch(`${this.apiBase}${path}`, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })

    if (response.status === 401) {
      // Retry once with fresh token
      const newToken = await this.oauth.refreshToken()
      const retryResponse = await fetch(`${this.apiBase}${path}`, {
        ...options,
        headers: {
          ...options.headers,
          'Authorization': `Bearer ${newToken}`,
          'Content-Type': 'application/json',
        },
      })
      if (!retryResponse.ok) throw new Error(`API error: ${retryResponse.status}`)
      return retryResponse.json()
    }

    if (!response.ok) throw new Error(`API error: ${response.status}`)
    return response.json()
  }

  async getAssignedTasks(): Promise<AstridTask[]> {
    return this.request('/tasks?assignedToMe=true&completed=false')
  }

  async getTask(taskId: string): Promise<AstridTask> {
    return this.request(`/tasks/${taskId}`)
  }

  async addComment(taskId: string, content: string): Promise<void> {
    await this.request(`/tasks/${taskId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content, type: 'MARKDOWN' }),
    })
  }

  async completeTask(taskId: string): Promise<void> {
    await this.request(`/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ completed: true }),
    })
  }
}
```

### Polling Fallback

```typescript
// polling-fallback.ts
export class PollingFallback {
  private interval: ReturnType<typeof setInterval> | null = null
  private running = false
  private knownTaskIds = new Set<string>()

  constructor(
    private restClient: AstridRestClient,
    private intervalMs: number,
    private onNewTasks: (tasks: AstridTask[]) => void
  ) {}

  async start(): Promise<void> {
    this.running = true
    // Initial poll
    await this.poll()
    // Schedule recurring
    this.interval = setInterval(() => this.poll(), this.intervalMs)
  }

  stop(): void {
    this.running = false
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
  }

  isRunning(): boolean {
    return this.running
  }

  private async poll(): Promise<void> {
    try {
      const tasks = await this.restClient.getAssignedTasks()
      const newTasks = tasks.filter(t => !this.knownTaskIds.has(t.id))
      for (const task of tasks) {
        this.knownTaskIds.add(task.id)
      }
      if (newTasks.length > 0) {
        this.onNewTasks(newTasks)
      }
    } catch (err) {
      console.error('Astrid polling error:', err)
    }
  }
}
```

---

## G. Configuration Examples

### Minimal Config

```json5
// ~/.openclaw/openclaw.json
{
  channels: {
    astrid: {
      enabled: true,
      clientId: "astrid_oc_abc123",
      clientSecret: "sk_oc_...",
    },
  },
}
```

### Full Config

```json5
{
  channels: {
    astrid: {
      enabled: true,
      clientId: "astrid_oc_abc123",
      clientSecret: "sk_oc_...",

      // Endpoints (defaults shown)
      apiBase: "https://www.astrid.cc/api/v1",
      sseEndpoint: "https://www.astrid.cc/api/sse",
      tokenEndpoint: "https://www.astrid.cc/api/v1/oauth/token",

      // Agent identity
      agentEmail: "mybot.oc@astrid.cc",

      // Only monitor specific lists
      lists: ["b39a13f0-483f-4df6-a14b-4ddb832fa07b"],

      // Polling fallback (30s)
      pollIntervalMs: 30000,

      // Session behavior
      session: {
        idleTimeoutMinutes: 1440,
        autoComplete: true,
        resumeOnRestart: true,
      },

      // What triggers agent turns
      triggers: {
        taskAssigned: true,
        commentAdded: true,
        taskUpdated: false,
      },

      // Message formatting
      format: {
        showPriority: true,
        showDueDate: true,
        showListName: true,
        showAssigner: true,
        completionKeywords: ["done", "complete", "finished", "task complete"],
      },
    },
  },
}
```

### Multi-List Config

```json5
{
  channels: {
    astrid: {
      enabled: true,
      clientId: "astrid_oc_abc123",
      clientSecret: "sk_oc_...",
      lists: [
        "b39a13f0-...",  // Marketing tasks
        "c48b24e1-...",  // Support tickets
        "d57c35f2-...",  // Dev backlog
      ],
      session: {
        autoComplete: true,  // Agent marks tasks done when finished
      },
    },
  },
}
```

### Custom Agent Name

```json5
{
  channels: {
    astrid: {
      enabled: true,
      clientId: "astrid_oc_abc123",
      clientSecret: "sk_oc_...",
      agentEmail: "jeff.oc@astrid.cc",  // Custom name
    },
  },
}
```

---

## H. Message Format Spec

### Task → OpenClaw Message (Inbound)

```typescript
// message-formatter.ts
export class MessageFormatter {
  taskToMessage(task: TaskAssignedEvent['data']): InboundMessage {
    const parts: string[] = []

    parts.push(`# Task: ${task.title}`)
    parts.push('')

    if (task.description) {
      parts.push(task.description)
      parts.push('')
    }

    // Metadata block
    const meta: string[] = []
    if (this.config.format?.showPriority && task.priority > 0) {
      const priorities = ['', '⬇️ Low', '➡️ Medium', '⬆️ High']
      meta.push(`**Priority:** ${priorities[task.priority]}`)
    }
    if (this.config.format?.showListName && task.listName) {
      meta.push(`**List:** ${task.listName}`)
    }
    if (this.config.format?.showAssigner && task.assignerName) {
      meta.push(`**Assigned by:** ${task.assignerName}`)
    }
    if (this.config.format?.showDueDate && task.dueDateTime) {
      const due = new Date(task.dueDateTime)
      meta.push(`**Due:** ${due.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}`)
    }

    if (meta.length > 0) {
      parts.push(meta.join('\n'))
      parts.push('')
    }

    // Existing comments (for context on reconnect)
    if (task.comments?.length > 0) {
      parts.push('---')
      parts.push('**Previous conversation:**')
      for (const comment of task.comments) {
        parts.push(`> **${comment.authorName}:** ${comment.content}`)
      }
      parts.push('')
    }

    parts.push('---')
    parts.push('*Reply to work on this task. Say "done" when complete.*')

    return {
      content: parts.join('\n'),
      metadata: {
        taskId: task.taskId,
        priority: task.priority,
        listId: task.listId,
        dueDateTime: task.dueDateTime,
      },
    }
  }

  commentToMessage(comment: CommentAddedEvent['data']): InboundMessage {
    return {
      content: `**${comment.authorName}:** ${comment.content}`,
      metadata: {
        taskId: comment.taskId,
        commentId: comment.commentId,
      },
    }
  }
}
```

### OpenClaw Response → Astrid Comment (Outbound)

```typescript
responseToComment(msg: OutboundMessage): string {
  let content = msg.content

  // Strip any system prefixes OpenClaw might add
  content = content.replace(/^(Assistant|AI|Agent):\s*/i, '')

  // Preserve markdown formatting (Astrid supports markdown comments)
  // Code blocks, links, lists all pass through as-is

  return content.trim()
}
```

### Rich Content Handling

| Content Type | Astrid → OpenClaw | OpenClaw → Astrid |
|---|---|---|
| Markdown | Pass through | Pass through |
| Code blocks | Pass through (fenced) | Pass through (fenced) |
| Links | Pass through | Pass through |
| Images | `![alt](url)` in description | URL in comment |
| File attachments | URL reference in metadata | Upload via `/api/v1/files` + link in comment |

### Completion Detection

```typescript
isCompletionSignal(msg: OutboundMessage): boolean {
  const keywords = this.config.format?.completionKeywords ||
    ['done', 'complete', 'finished', 'completed', 'task complete']

  const lower = msg.content.toLowerCase().trim()

  // Check if the last line contains a completion keyword
  const lastLine = lower.split('\n').pop()?.trim() || ''
  return keywords.some(kw => lastLine.includes(kw))
}
```

---

## I. Error Handling

### SSE Disconnection

```
Disconnect detected
  → Wait: min(2000 * 1.4^attempt, 120000) + jitter(±20%)
  → Reconnect with ?since={lastEventTimestamp}
  → Max attempts: unlimited (keeps retrying)
  → After 10 consecutive failures: switch to polling fallback
  → Log warning every 5th attempt
```

### OAuth Token Expired

```
401 received on any request
  → Refresh token via client_credentials grant
  → Retry original request once with new token
  → If refresh also fails (e.g., credentials revoked) → log error, stop channel
```

### Task Not Found

```
GET /tasks/{id} returns 404
  → Log warning: "Task {id} not found, may have been deleted"
  → Remove from session mapper
  → Skip processing
```

### Rate Limiting

```
429 received
  → Read Retry-After header (or default 60s)
  → Wait specified duration
  → Retry
  → If persistent (>5 in 10min): reduce request rate, log warning
```

### Network Errors

```
ECONNREFUSED / ETIMEDOUT / DNS failure
  → Same exponential backoff as SSE reconnection
  → Queue outbound messages in memory (max 100)
  → Flush queue on reconnection
  → Drop oldest messages if queue exceeds limit
```

### Astrid Downtime

```
5xx responses or complete unreachability
  → Outbound messages queued in memory
  → Retry queue every 30s
  → SSE will auto-reconnect with backoff
  → Log periodic status: "Astrid unreachable for {duration}"
```

---

## J. Security

### Principle of Least Privilege

- OAuth scopes are minimal: only what the plugin needs
- Agent user can only access tasks assigned to it (enforced server-side)
- Agent can only post comments on its own assigned tasks
- No access to other users' data, settings, or API keys

### Token Storage

- `clientSecret` stored in OpenClaw's encrypted credential store
- Access tokens cached in memory only (not persisted to disk)
- Tokens have 1-hour expiry with auto-refresh

### SSE Connection Security

- Each SSE connection validated with OAuth token
- Token scopes checked: must include `sse:connect`
- Events filtered server-side: agent only receives events for its own tasks
- Connection terminated on token revocation

### Agent Isolation

- Each `.oc@astrid.cc` agent is a separate database user
- Agent cannot impersonate other users
- Agent cannot modify tasks it's not assigned to
- Agent cannot access lists it's not a member of

### Input Validation

- All agent-posted comments sanitized server-side
- Maximum comment length enforced (10,000 chars)
- File uploads validated (type, size limits)
- Rate limiting per OAuth client

---

## K. Testing Plan

### Unit Tests

**Message Formatter:**
- `taskToMessage` produces correct markdown for various priority/due date combinations
- `commentToMessage` includes author attribution
- `responseToComment` strips system prefixes
- `isCompletionSignal` detects "done", "complete", etc. in last line
- Edge cases: empty description, no priority, no due date, very long content

**SSE Parser:**
- Parses single events correctly
- Handles multi-line data fields
- Handles keepalive comments (`:keepalive`)
- Handles partial buffers (split across chunks)
- Handles malformed events gracefully (skip, don't crash)

**Task Session Mapper:**
- `getOrCreate` creates new sessions
- `get` returns existing sessions
- `end` cleans up both maps
- `cleanupIdle` removes sessions past timeout

**OAuth Client:**
- Token caching (doesn't re-fetch when valid)
- Pre-emptive refresh (5 min before expiry)
- Handles refresh failure

### Integration Tests

**SSE Client:**
- Connects to mock SSE server
- Receives and dispatches events
- Reconnects on disconnect with `since` parameter
- Handles 401 → token refresh → reconnect
- Keepalive timeout triggers reconnect

**REST Client:**
- CRUD operations against mock Astrid API
- 401 retry with token refresh
- 429 rate limit handling

### End-to-End Tests

1. **Happy path:** Assign task → SSE event received → session created → agent processes → comment posted → task completed
2. **Comment conversation:** Task assigned → agent comments → human replies → agent receives comment → agent replies
3. **Disconnect/reconnect:** SSE disconnect → reconnect with `since` → missed events replayed
4. **Token refresh:** Token expires mid-session → auto-refresh → no interruption
5. **Polling fallback:** SSE endpoint unreachable → switch to polling → tasks still received

### Load Tests

- 100 concurrent tasks with active sessions
- SSE reconnection storm (server restart)
- Message queue drain after outage

---

## L. Migration Path

### From Current Polling Skill to Channel Plugin

**Current state:** OpenClaw uses `skills/astrid/check-tasks.sh` on a cron-like schedule to poll for new tasks.

**Migration steps:**

1. **Install channel config:** Add `channels.astrid` to `openclaw.json` with OAuth credentials
2. **Verify connection:** OpenClaw logs `✅ Astrid channel connected (SSE)` on startup
3. **Disable polling:** Remove or disable the cron task for `check-tasks.sh`
4. **Verify real-time:** Assign a task in Astrid, confirm agent picks it up within seconds
5. **Remove skill:** Once stable, remove `skills/astrid/` directory

### Backward Compatibility

- The polling skill continues to work alongside the channel plugin
- If both are active, the channel plugin takes priority (deduplicated by taskId)
- Existing `openclaw@astrid.cc` user continues to work — it's just a specific case of `*.oc@astrid.cc`

### Settings Migration

If user already has an `openclaw@astrid.cc` agent configured:
- The new channel plugin recognizes it
- No need to re-register; just add OAuth credentials to `openclaw.json`
- Existing task assignments carry over (session mapper recovers on startup)

### Timeline

| Phase | Duration | Description |
|---|---|---|
| 1. Pattern matching (this PR) | Now | Wire up `*.oc@astrid.cc` routing in astrid-web |
| 2. SSE OAuth support | 1-2 days | Add Bearer token auth to SSE endpoint |
| 3. Agent registration API | 1 day | `POST /api/v1/openclaw/register` |
| 4. OpenClaw plugin MVP | 3-4 days | SSE client + REST client + session mapper |
| 5. Polish & testing | 2 days | Error handling, reconnection, e2e tests |

---

*This spec was authored by Astrid Claw based on deep analysis of both the Astrid.cc and OpenClaw codebases.*
