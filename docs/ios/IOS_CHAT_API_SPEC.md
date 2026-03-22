# iOS Chat API Integration Spec

**Date**: 2026-03-31
**Status**: Ready for Implementation
**Scope**: Chat messaging, file attachments, agent typing indicators

This spec covers the chat messaging API that iOS needs to integrate. The web app already has a working implementation. iOS should use the same endpoints and SSE events.

---

## Overview

The chat system provides per-list and per-user messaging channels. Users can send text messages with file attachments, @mention AI agents, and receive real-time typing indicators when agents are processing.

**Key concepts:**
- **List channels** — one channel per TaskList, shared by list members
- **Virtual channels** — per-user channels for "My Tasks" (no list association)
- **Secure files** — file attachments uploaded via the secure upload system
- **Agent typing** — SSE-based indicators when AI agents are processing

---

## Authentication

All endpoints use the standard authentication:
- **Session cookie** (web): `next-auth.session-token` or `__Secure-next-auth.session-token`
- **OAuth token** (iOS): `Authorization: Bearer {token}` with appropriate scopes

Required OAuth scopes for chat: `tasks:read`, `tasks:write` (chat access inherits from list access).

---

## Endpoints

### POST `/api/chat/channels`

Get or create a chat channel. Call this before loading messages.

**Request:**
```json
// For a list channel:
{ "listId": "list-uuid" }

// For a virtual channel (My Tasks):
{ "virtualKey": "virtual-chat:{userId}:my-tasks" }
```

**Response:**
```json
{
  "channel": {
    "id": "channel-uuid",
    "listId": "list-uuid | null",
    "virtualKey": "virtual-chat:user123:my-tasks | null",
    "name": "List Name | My Tasks",
    "createdAt": "2026-03-31T00:00:00.000Z"
  }
}
```

**Notes:**
- Virtual key format: `virtual-chat:{userId}:{type}` — the userId segment must match the authenticated user
- This is an upsert — safe to call multiple times, returns the same channel

---

### GET `/api/chat/channels/{channelId}/messages`

Paginated messages for a channel, newest first (reversed to chronological in response).

**Query params:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | 50 | Max 100 |
| `before` | ISO date | — | Cursor for pagination (load older messages) |

**Response:**
```json
{
  "messages": [
    {
      "id": "msg-uuid",
      "channelId": "channel-uuid",
      "authorId": "user-id",
      "author": {
        "id": "user-id",
        "name": "Jon Paris",
        "email": "jon@example.com",
        "image": "https://...",
        "isAIAgent": false,
        "aiAgentType": null
      },
      "content": "Hello!",
      "type": "TEXT",
      "attachmentUrl": null,
      "attachmentName": null,
      "attachmentType": null,
      "attachmentSize": null,
      "replyToId": null,
      "clientRequestId": "msg_123_abc",
      "secureFiles": [
        {
          "id": "file-uuid",
          "originalName": "photo.jpg",
          "mimeType": "image/jpeg",
          "fileSize": 102400,
          "createdAt": "2026-03-31T00:00:00.000Z"
        }
      ],
      "createdAt": "2026-03-31T00:00:00.000Z"
    }
  ],
  "hasMore": true,
  "nextCursor": "2026-03-30T23:50:00.000Z"
}
```

**Pagination:**
1. Initial load: `GET /messages?limit=50`
2. Load older: `GET /messages?limit=50&before={nextCursor}`
3. Stop when `hasMore` is false

---

### POST `/api/chat/channels/{channelId}/messages`

Send a message. Supports text, attachments, and idempotency.

**Request:**
```json
{
  "content": "Hello!",
  "type": "TEXT",
  "fileId": "secure-file-uuid",
  "replyToId": "msg-uuid",
  "clientRequestId": "msg_1711843200000_a1b2c3"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `content` | string | yes* | Message text (*not required if `fileId` provided) |
| `type` | enum | no | `TEXT` (default), `MARKDOWN`, `ATTACHMENT` |
| `fileId` | string | no | SecureFile ID to attach. Upload file first via `/api/secure-upload/request-upload` |
| `replyToId` | string | no | ID of message being replied to |
| `clientRequestId` | string | no | Client-generated unique ID for idempotency and optimistic updates |

**Response (201):**
```json
{
  "message": {
    "id": "msg-uuid",
    "channelId": "channel-uuid",
    "authorId": "user-id",
    "author": { "id": "...", "name": "...", "email": "...", "image": "...", "isAIAgent": false, "aiAgentType": null },
    "content": "Hello!",
    "type": "TEXT",
    "secureFiles": [],
    "clientRequestId": "msg_1711843200000_a1b2c3",
    "createdAt": "2026-03-31T00:00:00.000Z",
    "updatedAt": "2026-03-31T00:00:00.000Z"
  }
}
```

**Idempotency:**
- Generate `clientRequestId` as `msg_{timestamp}_{random}` on the client
- If the same `clientRequestId` is sent twice, the server returns the existing message (no duplicate)
- Use this for optimistic updates: display the message immediately, then reconcile with the server response

**File attachments:**
1. Upload the file: `POST /api/secure-upload/request-upload` with FormData (`file` + `context: {"channelId":"..."}`)
2. Get back `fileId` from the upload response
3. Send message with `fileId` and `type: "ATTACHMENT"`
4. Do NOT also send `attachmentUrl`/`attachmentName` — use `fileId` only to avoid duplicates

---

## SSE Events

Subscribe to the existing SSE endpoint (`GET /api/sse`). The following events are relevant to chat:

### `chat_message_created`

A new message was posted in a channel (by another user or agent).

```json
{
  "type": "chat_message_created",
  "timestamp": "2026-03-31T00:00:00.000Z",
  "data": {
    "channelId": "channel-uuid",
    "message": {
      "id": "msg-uuid",
      "channelId": "channel-uuid",
      "authorId": "user-id",
      "author": { ... },
      "content": "Response from Astrid",
      "type": "MARKDOWN",
      "secureFiles": [],
      "createdAt": "2026-03-31T00:00:00.000Z",
      "updatedAt": "2026-03-31T00:00:00.000Z"
    }
  }
}
```

**Handling:**
- Filter by `channelId` matching the currently visible channel
- Append to message list if not a duplicate (check `message.id`)
- If message has a `clientRequestId` matching an optimistic message, replace the optimistic message with the server version

### `chat_message_updated`

A message was edited.

```json
{
  "type": "chat_message_updated",
  "data": {
    "channelId": "channel-uuid",
    "message": { ... }
  }
}
```

### `chat_message_deleted`

A message was deleted.

```json
{
  "type": "chat_message_deleted",
  "data": {
    "channelId": "channel-uuid",
    "messageId": "msg-uuid"
  }
}
```

### `agent_typing_start`

An AI agent has begun processing a response. Show a typing indicator.

```json
{
  "type": "agent_typing_start",
  "timestamp": "2026-03-31T00:00:00.000Z",
  "data": {
    "channelId": "channel-uuid",
    "agentId": "agent-user-id",
    "agentName": "Astrid"
  }
}
```

### `agent_typing_stop`

The AI agent has finished processing. Hide the typing indicator.

```json
{
  "type": "agent_typing_stop",
  "timestamp": "2026-03-31T00:00:00.000Z",
  "data": {
    "channelId": "channel-uuid",
    "agentId": "agent-user-id"
  }
}
```

**Typing indicator implementation:**

```
                         ┌─────────────────────────┐
  agent_typing_start ──> │  Show "Astrid is         │
                         │  thinking..." indicator   │
                         └──────────┬───────────────┘
                                    │
               ┌────────────────────┼────────────────────┐
               │                    │                     │
       agent_typing_stop   chat_message_created    45s timeout
       (explicit stop)     (from same agent)       (safety net)
               │                    │                     │
               └────────────────────┼─────────────────────┘
                                    │
                         ┌──────────▼───────────────┐
                         │  Hide indicator           │
                         └──────────────────────────┘
```

**Rules:**
1. On `agent_typing_start`: show indicator, start a 45-second timeout
2. On `agent_typing_stop`: hide indicator, cancel timeout
3. On `chat_message_created` where `author.isAIAgent == true`: also hide indicator (belt-and-suspenders)
4. On timeout (45s): auto-hide indicator (handles server crashes)
5. These events are **ephemeral** — do NOT persist or replay on reconnection. If the app reconnects and the agent is still thinking, the `agent_typing_stop` or the actual message will arrive shortly.

---

## Optimistic Updates Pattern

For the best user experience, iOS should implement optimistic message sending:

1. **On send**: immediately insert a local message with `id = "optimistic_{clientRequestId}"` and display it
2. **On server response (201)**: replace the optimistic message with the real one (match by `clientRequestId`)
3. **On server error**: remove the optimistic message and show an error

This matches the web implementation exactly.

---

## Secure File Upload for Chat

**Upload flow:**

```
iOS App                          Server
  │                                │
  │  POST /api/secure-upload/      │
  │  request-upload                │
  │  FormData:                     │
  │    file: <binary>              │
  │    context: {"channelId":"x"}  │
  │ ─────────────────────────────> │
  │                                │ Upload to Vercel Blob
  │                                │ Create SecureFile record
  │  { fileId, fileName,           │
  │    fileSize, mimeType }        │
  │ <───────────────────────────── │
  │                                │
  │  POST /api/chat/channels/      │
  │  {channelId}/messages          │
  │  { content, type: "ATTACHMENT",│
  │    fileId: "..." }             │
  │ ─────────────────────────────> │
  │                                │ Link SecureFile to message
  │  { message: { secureFiles } }  │
  │ <───────────────────────────── │
```

**Viewing attachments:**
- Each message's `secureFiles` array contains file metadata
- To get a download URL: `GET /api/secure-files/{fileId}?info=true`
  ```json
  { "url": "https://signed-blob-url...", "fileName": "photo.jpg", "mimeType": "image/jpeg", "fileSize": 102400, "expiresIn": 300 }
  ```
- Or redirect directly: `GET /api/secure-files/{fileId}` (302 redirect to signed URL)
- Signed URLs expire in 5 minutes — fetch a new one if needed

**Upload context:**
- For list channels: use `{"listId": "..."}` or `{"channelId": "..."}`
- For virtual channels (My Tasks): use `{"channelId": "..."}`
- The `channelId` context is required when no `listId` is available

---

## Data Types

### ChatMessage

| Field | Type | Notes |
|-------|------|-------|
| id | string | UUID |
| channelId | string | UUID |
| authorId | string | User ID |
| author | ChatMessageAuthor | Nested object |
| content | string | Message text (may be markdown) |
| type | enum | `TEXT`, `MARKDOWN`, `ATTACHMENT` |
| attachmentUrl | string? | Legacy — prefer `secureFiles` |
| attachmentName | string? | Legacy |
| attachmentType | string? | Legacy |
| attachmentSize | number? | Legacy |
| replyToId | string? | For threaded replies |
| clientRequestId | string? | Client-generated idempotency key |
| secureFiles | SecureFile[] | Attached files (new system) |
| createdAt | string | ISO 8601 |

### ChatMessageAuthor

| Field | Type | Notes |
|-------|------|-------|
| id | string | User ID |
| name | string? | Display name |
| email | string | |
| image | string? | Avatar URL |
| isAIAgent | boolean | True for Astrid and other AI agents |
| aiAgentType | string? | Agent type identifier |

### SecureFile (on message)

| Field | Type | Notes |
|-------|------|-------|
| id | string | Use this as `fileId` for attachments |
| originalName | string | File name |
| mimeType | string | MIME type |
| fileSize | number | Bytes |
| createdAt | string | ISO 8601 |

---

## Migration Notes for iOS

### What's new (not yet in iOS):
1. **Chat channels + messages** — full messaging system per list and My Tasks
2. **Secure file attachments on messages** — upload via `/api/secure-upload/request-upload` with `channelId` context
3. **Agent typing indicators** — new SSE events `agent_typing_start` / `agent_typing_stop`
4. **File attachments on task comments** — `fileId` field on `POST /api/v1/tasks/{id}/comments`

### What's unchanged:
- Authentication (session cookies + OAuth tokens)
- SSE connection endpoint (`GET /api/sse`)
- Task and comment APIs
- Secure file upload mechanism (same endpoint, new `channelId` context option)

### Recommended implementation order:
1. **Channel resolution** — `POST /api/chat/channels` to get channel IDs
2. **Message loading** — `GET /messages` with pagination
3. **Message sending** — `POST /messages` with optimistic updates
4. **SSE integration** — subscribe to `chat_message_created/updated/deleted`
5. **Typing indicator** — subscribe to `agent_typing_start/stop`, add UI
6. **File attachments** — upload + send with `fileId`
