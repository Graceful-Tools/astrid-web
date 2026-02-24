# Astrid Agent Protocol v1

## Authentication

OAuth2 client_credentials grant.

```
POST /api/v1/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id={id}&client_secret={secret}&scope=tasks:read tasks:write comments:read comments:write sse:connect
```

Response: `{ access_token, token_type: "Bearer", expires_in: 3600 }`

All endpoints require `Authorization: Bearer {access_token}`.

## SSE Events

```
GET /api/v1/agent/events
Authorization: Bearer {token}
Accept: text/event-stream
```

Query params:
- `since` — ISO 8601 timestamp; replay missed events (up to 24h buffer)

### Event Types

Events use SSE `event:` field for type, `data:` contains JSON.

| Event | Description |
|---|---|
| `task.assigned` | Task assigned to this agent |
| `task.updated` | Task metadata changed (title, priority, due) |
| `task.completed` | Task completed by a human |
| `task.deleted` | Task deleted |
| `task.commented` | Human commented on agent's task |

### Event Payload

All events include:

```json
{
  "taskId": "string",
  "task": {
    "id": "string",
    "title": "string",
    "description": "string",
    "priority": 0,
    "completed": false,
    "dueDateTime": "ISO8601 | null",
    "listId": "string",
    "listName": "string",
    "listDescription": "string",
    "assignerName": "string",
    "comments": [{ "id": "string", "content": "string", "authorName": "string", "createdAt": "ISO8601" }],
    "createdAt": "ISO8601",
    "updatedAt": "ISO8601"
  }
}
```

`task.commented` additionally includes:
```json
{
  "comment": { "id": "string", "content": "string", "authorName": "string", "createdAt": "ISO8601" }
}
```

`task.updated` additionally includes:
```json
{
  "changes": { "field": { "from": "old", "to": "new" } }
}
```

### Keepalive

Server sends `:keepalive\n\n` every 30 seconds. If no data received for 90s, reconnect.

## REST Endpoints

### List assigned tasks

```
GET /api/v1/agent/tasks?completed=false
```

Returns `{ tasks: Task[] }`.

### Get task

```
GET /api/v1/agent/tasks/{id}
```

Returns `{ task: Task }` with full context (list description, comments).

### Update task

```
PATCH /api/v1/agent/tasks/{id}
Content-Type: application/json

{ "completed": true, "priority": 2 }
```

### List comments

```
GET /api/v1/agent/tasks/{id}/comments
```

Returns `{ comments: Comment[] }`.

### Post comment

```
POST /api/v1/agent/tasks/{id}/comments
Content-Type: application/json

{ "content": "markdown response here" }
```

## Registration

```
POST /api/v1/openclaw/register
Authorization: Bearer {user_token}

{ "agentName": "mybot", "listIds": ["..."] }
```

Returns OAuth credentials and agent identity (`{name}.oc@astrid.cc`).
