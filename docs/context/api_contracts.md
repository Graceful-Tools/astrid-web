# API Contracts

## Authentication
All API endpoints require authentication via NextAuth.js session cookies.

### Session Validation
```typescript
const session = await getServerSession(authConfig)
if (!session?.user?.id) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
}
```

## Core Endpoints

### Lists API (`/api/lists`)
- **GET**: Fetch user's accessible lists (owned, admin, member, public) (`app/api/lists/route.ts:10`)
- **POST**: Create new task list with `CreateListData` body (`app/api/lists/route.ts:50`)
- **Body**: `{ name: string, description?: string, color?: string, privacy?: "PRIVATE" | "SHARED" | "PUBLIC", adminIds?: string[], memberIds?: string[] }`

### Tasks API (`/api/tasks`)
- **GET**: Fetch user's tasks (assigned, created, or from accessible lists) (`app/api/tasks/route.ts:10`)
- **POST**: Create new task with `CreateTaskData` body (`app/api/tasks/route.ts:50`)
- **Body**: `{ title: string, description?: string, priority?: 0-3, repeating?: string, isPrivate?: boolean, when?: Date, listIds: string[], assigneeId?: string, assigneeEmail?: string }`

### Task Management (`/api/tasks/[id]`)
- **PUT**: Update task with permission check (`app/api/tasks/[id]/route.ts:10`)
- **DELETE**: Remove task (same permission logic)
- **Body**: Partial task data with validation

### Invitations API (`/api/invitations`)
- **POST**: Create invitation for task assignment or list sharing (`app/api/invitations/route.ts:20`)
- **Body**: `{ email: string, type: "TASK_ASSIGNMENT" | "LIST_SHARING" | "WORKSPACE_INVITE", taskId?: string, listId?: string, message?: string }`

## v1 API Endpoints (OAuth / iOS)

### List Members (`/api/v1/lists/:id/members`)
- **GET**: Get all members + pending invitations for a list (requires `lists:read`)
  - Returns `{ members: [{ id, name, email, image, role, isOwner, isAdmin, type }] }`
  - `type` is `"member"` for active members or `"invite"` for pending invitations
  - Invite entries have `id` prefixed with `invite_`, `name: null`, `image: null`
- **POST**: Add a member or send invitation (requires `lists:write`)
  - Body: `{ email: string, role?: "admin" | "member" }`

### Individual Member (`/api/v1/lists/:id/members/:userId`)
- **PUT**: Update member role (requires `lists:write`)
  - Body: `{ role: "admin" | "member" }`
- **DELETE**: Remove member from list (requires `lists:write`)

### List Invitations (`/api/v1/lists/:id/invitations`)
- **GET**: Get pending invitations for a list (requires `lists:read`)
  - Returns `{ invitations: [{ id, email, role, createdAt, createdBy: { id, name, email } | null }] }`
- **DELETE**: Cancel a pending invitation (requires `lists:write`)
  - Body: `{ email: string }`

### User Search (`/api/users/search`)
- **GET**: Search users by query parameter (`app/api/users/search/route.ts:15`)
- **Query**: `?q=<search_term>` (min 2 chars)
- **Response**: `{ users: Array<{ id, name, email, image }> }`

## Client SDK Hooks

### React Hooks
- **`useLists()`**: Fetch/create lists (`hooks/use-lists.ts:5`)
- **`useTasks()`**: CRUD operations for tasks (`hooks/use-tasks.ts:5`)
- **Both hooks**: Handle loading states, errors, and optimistic updates

## Request/Response Patterns

### Standard Response Format
```typescript
// Success
return NextResponse.json(data)

// Error
return NextResponse.json({ error: "Error message" }, { status: code })
```

### Error Status Codes
- `400`: Bad Request (validation errors)
- `401`: Unauthorized (missing/invalid session)
- `403`: Forbidden (insufficient permissions)
- `404`: Not Found (resource doesn't exist)
- `409`: Conflict (invitation already exists)
- `500`: Internal Server Error (server issues)

### TypeScript Types
- **`CreateListData`**: List creation payload (`types/index.ts:95`)
- **`CreateTaskData`**: Task creation payload (`types/index.ts:75`)
- **`TaskWithRelations`**: Full task with nested data (`types/index.ts:60`)