# @gracefultools/openclaw-astrid-channel

OpenClaw channel plugin for [Astrid.cc](https://www.astrid.cc) task management.

Thin wrapper around [`@gracefultools/astrid-sdk`](https://www.npmjs.com/package/@gracefultools/astrid-sdk) v0.8.0 — all protocol logic, message formatting, and SSE handling live in the SDK.

## Installation

```bash
npm install @gracefultools/openclaw-astrid-channel
```

This will also install `@gracefultools/astrid-sdk` as a dependency.

## Configuration

Add to your `openclaw.json`:

```json
{
  "channels": {
    "astrid": {
      "enabled": true,
      "clientId": "your_client_id",
      "clientSecret": "your_client_secret"
    }
  }
}
```

### Options

| Option | Default | Description |
|---|---|---|
| `clientId` | *required* | OAuth client ID from Astrid |
| `clientSecret` | *required* | OAuth client secret |
| `apiBase` | `https://www.astrid.cc/api/v1` | Astrid API base URL |
| `agentEmail` | auto-detected | Agent email (`name.oc@astrid.cc`) |
| `lists` | all | List IDs to monitor |
| `pollIntervalMs` | `30000` | Polling fallback interval |

## How it works

1. Connects to Astrid via SSE (Server-Sent Events) with OAuth2 authentication
2. Receives task assignments and comments in real-time
3. Maps each task to an OpenClaw session
4. Posts agent responses as task comments
5. Supports task completion via the `complete` action

All message formatting (priority indicators, list instructions, previous conversation history) is handled by the SDK's `taskToMessage()` and `commentToMessage()` functions.

## Setup

1. Go to **Settings > AI Agents > OpenClaw** in Astrid
2. Create an agent — you'll get a `clientId` and `clientSecret`
3. Add them to your OpenClaw config
4. Start OpenClaw — tasks assigned to your agent will create sessions automatically

## Programmatic Usage

```typescript
import { AstridOpenClawChannel } from '@gracefultools/openclaw-astrid-channel'

const channel = new AstridOpenClawChannel({
  enabled: true,
  clientId: 'your_client_id',
  clientSecret: 'your_client_secret',
})

await channel.start({
  injectMessage: (msg) => console.log('Received:', msg.content),
  log: (level, message) => console.log(`[${level}] ${message}`),
})
```

## Protocol

See [Agent Protocol](https://www.astrid.cc/docs/openclaw) for the full API specification.

## Troubleshooting

### Connection issues

- Verify your `clientId` and `clientSecret` are correct
- Check that your agent has `sse:connect` scope
- The SSE stream reconnects automatically with exponential backoff

### No messages received

- Ensure tasks are assigned to your agent's email
- Check that the `lists` config includes the relevant list IDs (or omit to monitor all)

### Task completion not working

- The `complete` action requires `tasks:write` scope on your OAuth client
