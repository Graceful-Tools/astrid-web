# Astrid API Contract

This document defines the stable API contract between the Astrid web backend and mobile clients (iOS, Android). Changes to these endpoints follow strict versioning and deprecation policies.

## API Versioning

### Current Version: v1

The API version is communicated via the `X-API-Version` header:

```http
X-API-Version: 1
```

### Version Policy

- **Current version**: 1
- **Minimum supported version**: 1
- **Breaking change policy**: 6-month deprecation notice before removal

### What Constitutes a Breaking Change

**Breaking (requires version bump):**
- Removing a field from response
- Changing a field's type
- Renaming a field
- Making an optional field required
- Changing enum values

**Non-breaking (can add anytime):**
- Adding new optional fields
- Adding new endpoints
- Deprecating (but not removing) fields

### Route Structure

The API has two route layers:

- **`/api/v1/*`** — Versioned endpoints for external clients (mobile, SDK, OAuth). These are the stable contract.
- **`/api/*`** — Internal/legacy endpoints used by the web app directly (auth, SSE, cron jobs, health checks).

When building mobile or external integrations, always use `/api/v1/` routes. The non-versioned routes may change without notice.

---

## Authentication Endpoints

### POST `/api/auth/apple`
Sign in with Apple.

**Request:**
```json
{
  "identityToken": "string",
  "authorizationCode": "string",
  "user": "string",
  "email": "string",       // optional
  "fullName": "string"     // optional
}
```

### POST `/api/auth/google`
Sign in with Google.

**Request:**
```json
{
  "idToken": "string"
}
```

### GET `/api/auth/mobile-session`
Get current session information.

**Response:**
```json
{
  "user": {
    "id": "string",
    "email": "string",
    "name": "string",
    "image": "string"
  }
}
```

### DELETE `/api/auth/signout`
Sign out the current user.

### POST `/api/auth/mobile-mcp-token`
Get MCP (Model Context Protocol) token for AI integrations.

---

## Task Endpoints

### GET `/api/tasks`
Fetch all tasks accessible to the current user.

**Response:**
```json
{
  "tasks": [
    {
      "id": "string",
      "title": "string",
      "description": "string",
      "completed": false,
      "isPrivate": false,
      "repeating": "never",
      "repeatFrom": "DUE_DATE",
      "occurrenceCount": 0,
      "priority": 0,
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z",
      "creatorId": "string",
      "assigneeId": "string",
      "dueDateTime": "2024-01-01T00:00:00Z",
      "isAllDay": true,
      "lists": [{ "id": "string", "name": "string" }],
      "creator": { "id": "string", "name": "string", "email": "string" },
      "assignee": { "id": "string", "name": "string", "email": "string" }
    }
  ]
}
```

### GET `/api/tasks/{id}`
Get a specific task by ID.

### POST `/api/tasks`
Create a new task.

**Request:**
```json
{
  "title": "string",
  "description": "string",
  "priority": 0,
  "repeating": "never",
  "isPrivate": false,
  "dueDateTime": "2024-01-01T00:00:00Z",
  "isAllDay": true,
  "listIds": ["string"],
  "assigneeId": "string"
}
```

### PUT `/api/tasks/{id}`
Update an existing task.

**Request:** Partial task object with fields to update.

### DELETE `/api/tasks/{id}`
Delete a task.

### PUT `/api/tasks/{id}` (completion)
Mark task as complete/incomplete.

**Request:**
```json
{
  "completed": true
}
```

### POST `/api/tasks/{id}/copy`
Copy a single task.

### POST `/api/tasks/copy`
Batch copy multiple tasks.

**Request:**
```json
{
  "taskIds": ["string"]
}
```

---

## List Endpoints

### GET `/api/lists`
Fetch all lists accessible to the current user.

**Response:**
```json
{
  "lists": [
    {
      "id": "string",
      "name": "string",
      "privacy": "PRIVATE",
      "ownerId": "string",
      "color": "string",
      "imageUrl": "string",
      "description": "string",
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### GET `/api/lists/{id}`
Get a specific list by ID.

### POST `/api/lists`
Create a new list.

**Request:**
```json
{
  "name": "string",
  "description": "string",
  "color": "string",
  "privacy": "PRIVATE"
}
```

### PUT `/api/lists/{id}`
Update an existing list.

### DELETE `/api/lists/{id}`
Delete a list.

### PUT `/api/lists/{id}/invite`
Invite users to a list.

**Request:**
```json
{
  "emails": ["user@example.com"]
}
```

### DELETE `/api/lists/{id}/leave`
Leave a shared list.

### PUT `/api/lists/{id}/favorite`
Toggle list as favorite.

**Request:**
```json
{
  "favorite": true
}
```

---

## Comment Endpoints

### GET `/api/tasks/{taskId}/comments`
Get comments for a task.

**Response:**
```json
{
  "comments": [
    {
      "id": "string",
      "content": "string",
      "type": "TEXT",
      "taskId": "string",
      "authorId": "string",
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z",
      "author": { "id": "string", "name": "string", "email": "string" }
    }
  ]
}
```

### POST `/api/tasks/{taskId}/comments`
Create a comment on a task. Supports file attachments via `fileId`.

**Request:**
```json
{
  "content": "string",
  "type": "TEXT | IMAGE | FILE | CODE | AUDIO | VIDEO",
  "fileId": "string (optional - SecureFile ID to attach)",
  "parentCommentId": "string (optional - for threaded replies)"
}
```

**Notes:**
- `content` is required unless `fileId` is provided
- `fileId` links an existing SecureFile to the comment
- Files can be from the user's uploads or from chat channels the user has access to

### PUT `/api/comments/{id}`
Update a comment.

**Request:**
```json
{
  "content": "string"
}
```

### DELETE `/api/comments/{id}`
Delete a comment.

---

## Reminder Endpoints

### GET `/api/reminders/status`
Get pending reminders for the current user.

### PUT `/api/reminders/{id}/dismiss`
Dismiss a reminder.

### PUT `/api/reminders/{id}/snooze`
Snooze a reminder.

**Request:**
```json
{
  "minutes": 15
}
```

---

## User Endpoints

### GET `/api/users/search?q={query}`
Search for users by name or email.

**Query Parameters:**
- `q` (required): Search query (min 2 characters)
- `includeAIAgents` (optional): Include AI agent users
- `taskId` (optional): Filter by task context
- `listIds` (optional): Comma-separated list IDs

**Response:**
```json
{
  "users": [
    {
      "id": "string",
      "name": "string",
      "email": "string",
      "image": "string"
    }
  ]
}
```

### GET `/api/users/{userId}/profile`
Get a user's public profile.

---

## Account Endpoints

### GET `/api/account`
Get current user's account details.

### PUT `/api/account`
Update account settings.

**Request:**
```json
{
  "name": "string",
  "image": "string",
  "defaultDueTime": "09:00"
}
```

### POST `/api/account/verify-email?action={action}`
Manage email verification.

**Actions:** `send`, `resend`, `cancel`

### POST `/api/account/delete`
Delete the user's account.

**Request:**
```json
{
  "confirmationText": "delete my account"
}
```

### GET `/api/account/export?format={format}`
Export account data.

**Formats:** `json`, `csv`

---

## File Upload

### POST `/api/upload`
Upload a file (multipart/form-data).

**Request:** Multipart form with `file` field.

**Response:**
```json
{
  "url": "string",
  "filename": "string"
}
```

---

## Chat Endpoints

See [iOS Chat API Spec](ios/IOS_CHAT_API_SPEC.md) for full details.

### POST `/api/chat/channels`
Get or create a chat channel for a list or virtual key (My Tasks).

### GET `/api/chat/channels/{channelId}/messages`
Paginated messages. Query: `limit`, `before` (cursor).

### POST `/api/chat/channels/{channelId}/messages`
Send a message. Body: `{ content, type?, fileId?, replyToId?, clientRequestId? }`

---

## Real-Time Updates

### GET `/api/sse`
Server-Sent Events endpoint for real-time updates.

**Events:**
- `task:created` - New task created
- `task:updated` - Task modified
- `task:deleted` - Task removed
- `list:created` - New list created
- `list:updated` - List modified
- `list:deleted` - List removed
- `comment:created` - New comment added
- `chat_message_created` - New chat message
- `chat_message_updated` - Chat message edited
- `chat_message_deleted` - Chat message removed
- `agent_typing_start` - AI agent began processing (show typing indicator)
- `agent_typing_stop` - AI agent finished processing (hide typing indicator)

---

## Data Types

### Task Fields (V1)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| id | string | yes | UUID |
| title | string | yes | |
| description | string | yes | Can be empty |
| completed | boolean | yes | |
| isPrivate | boolean | yes | |
| repeating | enum | yes | `never`, `daily`, `weekly`, `monthly`, `yearly`, `custom` |
| repeatFrom | enum | yes | `DUE_DATE`, `COMPLETION_DATE` |
| occurrenceCount | number | yes | |
| priority | enum | yes | 0, 1, 2, 3 |
| createdAt | date | yes | ISO 8601 |
| updatedAt | date | yes | ISO 8601 |
| creatorId | string | yes | |
| assigneeId | string | no | |
| dueDateTime | date | no | ISO 8601 |
| isAllDay | boolean | no | |
| lists | array | no | List references |

### TaskList Fields (V1)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| id | string | yes | UUID |
| name | string | yes | |
| privacy | enum | yes | `PRIVATE`, `SHARED`, `PUBLIC` |
| ownerId | string | yes | |
| createdAt | date | yes | ISO 8601 |
| updatedAt | date | yes | ISO 8601 |
| color | string | no | Hex color code |
| imageUrl | string | no | |
| description | string | no | |

### User Fields (V1)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| id | string | yes | UUID |
| email | string | yes | |
| name | string | no | |
| image | string | no | Avatar URL |

### Comment Fields (V1)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| id | string | yes | UUID |
| content | string | yes | |
| type | enum | yes | `TEXT`, `MARKDOWN`, `ATTACHMENT` |
| taskId | string | yes | |
| authorId | string | no | |
| createdAt | date | yes | ISO 8601 |
| updatedAt | date | yes | ISO 8601 |

---

## Error Responses

All errors follow this format:

```json
{
  "error": "Error message description"
}
```

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| 400 | Bad Request - Invalid input |
| 401 | Unauthorized - Not authenticated |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found - Resource doesn't exist |
| 409 | Conflict - Resource already exists |
| 429 | Too Many Requests - Rate limited |
| 500 | Internal Server Error |

---

## Rate Limiting

- Standard endpoints: 100 requests/minute
- Search endpoints: 30 requests/minute
- File upload: 10 requests/minute

Rate limit headers:
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1640000000
```

---

## Changelog

### v1 (Current)
- Initial stable API release
- All endpoints documented above
