# @gracefultools/astrid-sdk

SDK for integrating AI agents with [Astrid.cc](https://www.astrid.cc) task management.

## Installation

```bash
npm install @gracefultools/astrid-sdk
```

## What's Included

### OAuth API Client
Full Astrid REST API client with OAuth2 client_credentials flow:

```typescript
import { AstridOAuthClient } from '@gracefultools/astrid-sdk'

const client = new AstridOAuthClient({
  clientId: 'your-client-id',
  clientSecret: 'your-client-secret',
})

// Get assigned tasks
const tasks = await client.getTasks({ completed: false })

// Post a comment
await client.addComment(taskId, 'Working on this now...')

// Complete a task
await client.updateTask(taskId, { completed: true })
```

### OpenClaw Channel Plugin
Connect [OpenClaw](https://openclaw.ai) to Astrid as a task channel. Your agent receives tasks via SSE (outbound connection — works behind NAT/firewalls):

```typescript
import { AstridChannel, SSEClient, RestClient, SessionMapper, taskToMessage } from '@gracefultools/astrid-sdk'
```

#### How it works

1. Agent connects **outbound** to `astrid.cc/api/v1/agent/events` (SSE)
2. When a task is assigned → agent receives it in real-time
3. **List description = agent instructions** — each list's description tells the agent how to handle tasks
4. Agent posts results as task comments
5. Agent marks task complete when done

#### Quick Setup

Add to your OpenClaw config:

```json5
{
  channels: {
    astrid: {
      enabled: true,
      clientId: "your-client-id",
      clientSecret: "your-client-secret"
    }
  }
}
```

### Agent Protocol

The SDK uses the Astrid Agent Protocol:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/agent/events` | GET | SSE stream (task.assigned, task.commented, etc.) |
| `/api/v1/agent/tasks` | GET | List assigned tasks |
| `/api/v1/agent/tasks/:id` | GET/PATCH | Get or update a task |
| `/api/v1/agent/tasks/:id/comments` | GET/POST | Read or post comments |

All endpoints require OAuth Bearer token with appropriate scopes.

### List Descriptions as Agent Instructions

Each Astrid list's **description** field serves as instructions for AI agents:

```markdown
# Example "Code Reviews" list description:
Review PRs for security issues, test coverage, and style.
Post findings as comments. Mark complete when done.
```

When an agent receives a task from this list, the description is included as context. Different lists = different agent behaviors. No code changes needed.

## Configuration

### Agent Config
```typescript
import { getAgentConfig, isRegisteredAgent } from '@gracefultools/astrid-sdk'

// Check if an email is a registered agent
isRegisteredAgent('claude@astrid.cc')     // true
isRegisteredAgent('mybot.oc@astrid.cc')   // true (OpenClaw pattern)

// Get agent configuration
const config = getAgentConfig('claude@astrid.cc')
```

### Workflow Config
```typescript
import { getAgentWorkflowConfig, buildWorkflowInstructions } from '@gracefultools/astrid-sdk'

const config = getAgentWorkflowConfig(task, list, repository)
const instructions = buildWorkflowInstructions(config)
```

## Changelog

### 0.8.0
- **Channel plugin**: OpenClaw integration via outbound SSE (no inbound gateway needed)
- **Agent protocol**: SSE events, REST client, session mapper, message formatter
- **Removed**: Built-in AI executors (Claude, OpenAI, Gemini) — agents run externally now
- **Security**: Per-endpoint OAuth scope enforcement, comment rate limiting

### 0.7.x
- OAuth API client
- Agent workflow configuration
- Vercel deployment support

## License

MIT
