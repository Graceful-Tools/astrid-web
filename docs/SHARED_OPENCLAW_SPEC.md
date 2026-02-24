# Shared OpenClaw Workers for Team Lists

> **Status:** Draft Spec  
> **Author:** Astrid Claw  
> **Date:** 2026-02-07  

## Overview

Enable multiple Astrid users to share access to a single OpenClaw instance through shared lists. When a team shares a list, they can also share an OpenClaw worker that any member can assign tasks to.

## Problem Statement

Currently:
- OpenClaw workers are registered per-user (`OpenClawWorker.userId`)
- Each user must set up their own Gateway connection
- Teams sharing a list can't share an AI worker

This creates friction for teams:
- Each team member needs their own OpenClaw setup
- No way to have a "team AI assistant" that sees all team tasks
- Billing/resource management is fragmented

## Proposed Solution

### 1. List-Level OpenClaw Workers

Add the ability to attach an OpenClaw worker to a **TaskList** rather than just a User.

```prisma
model TaskList {
  // ... existing fields ...
  
  // New: Optional list-level OpenClaw worker
  openclawWorkerId    String?
  openclawWorker      OpenClawWorker? @relation("ListOpenClawWorker", fields: [openclawWorkerId], references: [id])
}

model OpenClawWorker {
  // ... existing fields ...
  
  // New: Workers can be owned by a user OR shared with lists
  ownerType     String    @default("user")  // "user" | "list"
  
  // New: Lists using this worker (for shared workers)
  sharedWithLists  TaskList[] @relation("ListOpenClawWorker")
}
```

### 2. Permission Model

| Role | Can Use Worker | Can Configure Worker | Can Remove Worker |
|------|---------------|---------------------|-------------------|
| List Owner | ✅ | ✅ | ✅ |
| List Admin | ✅ | ✅ | ❌ |
| List Member | ✅ | ❌ | ❌ |
| List Viewer | ❌ | ❌ | ❌ |

### 3. Worker Assignment Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    Shared List: "Team Tasks"                 │
│  Members: Alice (owner), Bob (admin), Charlie (member)       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  OpenClaw Worker: "Team Gateway"                             │
│  URL: wss://team-gateway.example.com                         │
│  Auth: astrid-signed                                         │
│  Configured by: Alice                                        │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Any member can:                                             │
│  - Create a task                                             │
│  - Assign it to "OpenClaw" (the list's worker)              │
│  - Worker executes with full list context                    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 4. Task Routing

When a task is assigned to OpenClaw on a shared list:

1. **Check list-level worker first** - If `TaskList.openclawWorkerId` is set, use that
2. **Fall back to assignee's worker** - If task has a specific assignee with their own worker
3. **Fall back to creator's worker** - Use task creator's personal worker
4. **Error** - No available worker

```typescript
async function resolveOpenClawWorker(task: Task): Promise<OpenClawWorker | null> {
  // 1. List-level worker (shared)
  const list = await getTaskList(task.listId);
  if (list.openclawWorkerId) {
    return getWorker(list.openclawWorkerId);
  }
  
  // 2. Assignee's personal worker
  if (task.assigneeId) {
    const assigneeWorker = await getUserActiveWorker(task.assigneeId);
    if (assigneeWorker) return assigneeWorker;
  }
  
  // 3. Creator's personal worker
  const creatorWorker = await getUserActiveWorker(task.creatorId);
  if (creatorWorker) return creatorWorker;
  
  return null;
}
```

### 5. Authentication Context

When connecting to a shared worker, the `astrid-signed` payload includes team context:

```json
{
  "timestamp": "2026-02-07T17:00:00.000Z",
  "nonce": "abc123...",
  "gatewayUrl": "wss://team-gateway.example.com",
  "userId": "user_bob",
  "context": {
    "type": "shared-list",
    "listId": "list_xyz",
    "listName": "Team Tasks",
    "role": "member",
    "taskId": "task_123"
  }
}
```

The Gateway can use this to:
- Log which user initiated the task
- Apply per-user rate limits within the team
- Provide user-specific context to the agent

### 6. UI Changes

#### List Settings → AI Agents Tab

```
┌─────────────────────────────────────────────────────────────┐
│  AI Agents for "Team Tasks"                                  │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  🤖 OpenClaw Worker                    [Configure]  │    │
│  │                                                     │    │
│  │  Status: ● Online                                   │    │
│  │  URL: wss://team-gateway.example.com               │    │
│  │  Auth: astrid-signed                               │    │
│  │  Configured by: Alice                              │    │
│  │                                                     │    │
│  │  All list members can assign tasks to this worker  │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  ─────────────────── OR ───────────────────                  │
│                                                              │
│  [ ] Use each member's personal OpenClaw worker              │
│      (Members without a worker can't use AI features)        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### Task Assignment Dropdown

When assigning a task on a list with a shared worker:

```
Assign to:
├── 👤 Alice
├── 👤 Bob  
├── 👤 Charlie
├── ──────────────
├── 🤖 OpenClaw (Team Gateway)  ← New option
└── 🤖 Astrid Cloud
```

### 7. Gateway-Side Considerations

Shared workers should handle multi-tenant scenarios:

```typescript
// Gateway receives task with team context
interface TaskContext {
  userId: string;      // Who initiated this task
  listId: string;      // Which shared list
  listName: string;    // For agent context
  role: string;        // User's role in the list
  taskId: string;      // The specific task
}

// Agent system prompt can include:
`You are assisting the "${context.listName}" team.
This task was created by a team ${context.role}.
You have access to all tasks in this shared list.`
```

### 8. Security Considerations

1. **Worker Isolation** - Shared workers see all tasks in the list, which is intentional for team collaboration

2. **Credential Scope** - The Gateway's Astrid API credentials should be scoped to the list, not the configuring user's full account

3. **Audit Trail** - All task executions should log which user initiated them

4. **Worker Removal** - When a shared worker is removed, tasks in progress should gracefully terminate

5. **Member Removal** - When a user is removed from a list, their pending tasks to the shared worker should be reassigned or cancelled

### 9. Migration Path

1. **Phase 1:** Add `openclawWorkerId` to TaskList (nullable)
2. **Phase 2:** Add UI for list owners to configure shared workers
3. **Phase 3:** Update task routing to check list-level workers first
4. **Phase 4:** Add team context to `astrid-signed` payload

### 10. API Changes

#### New Endpoints

```
POST /api/lists/:listId/openclaw-worker
  - Attach a worker to a list (owner/admin only)
  - Body: { workerId: string } or { gatewayUrl, authMode, ... } to create new

DELETE /api/lists/:listId/openclaw-worker
  - Remove worker from list (owner only)

GET /api/lists/:listId/openclaw-worker
  - Get the list's worker config (any member)
```

#### Modified Endpoints

```
GET /api/openclaw/workers
  - Now includes workers shared with lists the user is a member of
  - Response includes `sharedWithLists: [{ id, name }]`

POST /api/tasks/:taskId/execute
  - Resolves worker using new priority order
  - Includes team context in execution
```

## Open Questions

1. **Billing:** How are API costs attributed for shared workers? Per-user? Per-list? 

2. **Rate Limits:** Should shared workers have team-level or per-user rate limits?

3. **Worker Visibility:** Can members see the Gateway URL, or just that a worker is configured?

4. **Multiple Workers:** Should lists support multiple workers (primary + fallback)?

5. **Cross-List Workers:** Can one worker be shared across multiple lists?

## Implementation Estimate

- **Database changes:** 1 day
- **API endpoints:** 2 days  
- **UI (list settings):** 2 days
- **Task routing logic:** 1 day
- **Testing:** 2 days
- **Documentation:** 1 day

**Total:** ~9 days

---

*This spec enables teams to share an AI assistant through Astrid's familiar list-sharing model, making OpenClaw accessible to teams without requiring each member to run their own infrastructure.*
