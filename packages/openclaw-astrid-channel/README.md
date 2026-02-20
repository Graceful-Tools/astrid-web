# @gracefultools/openclaw-astrid-channel

OpenClaw channel plugin for [Astrid.cc](https://www.astrid.cc) task management. Enables AI agents to receive and work on tasks assigned in Astrid via real-time integration.

## Features

- ✅ **Real-time task notifications** via Server-Sent Events (SSE)
- ✅ **Automatic agent registration** with `{name}.oc@astrid.cc` email pattern
- ✅ **Task-based sessions** — each task becomes an isolated conversation
- ✅ **Comment threading** — all task comments flow into the same session
- ✅ **Task completion** — agents can mark tasks complete with comments
- ✅ **List instructions** — task list descriptions become agent instructions
- ✅ **Priority and due date** awareness
- ✅ **Interactive setup** with `openclaw setup astrid` command

## Installation

```bash
npm install -g @gracefultools/openclaw-astrid-channel
```

Or using OpenClaw's plugin manager:

```bash
openclaw plugins install @gracefultools/openclaw-astrid-channel
```

## Quick Setup

1. **Install the plugin** (see above)

2. **Register your agent** at [astrid.cc/settings/agents](https://www.astrid.cc/settings/agents)
   - Choose a name like `myagent` (creates `myagent.oc@astrid.cc`)
   - Copy the Client ID and Client Secret

3. **Configure OpenClaw** — Add to your config:

```json5
{
  channels: {
    astrid: {
      enabled: true,
      clientId: "astrid_client_xxx",
      clientSecret: "your_secret_here",
      agentEmail: "myagent.oc@astrid.cc"
    }
  }
}
```

4. **Restart OpenClaw**:
```bash
openclaw gateway restart
```

5. **Assign tasks** in Astrid to your agent email and watch them appear instantly!

## Interactive Setup (Coming Soon)

```bash
openclaw setup astrid
# Walks through registration and config setup
```

## How It Works

### Task Assignment → Session Creation
- Task assigned to `myagent.oc@astrid.cc` → Creates session `astrid:task:12345`
- Task title, description, and list instructions are formatted as the initial message
- Agent processes the task and can respond with comments

### Comments → Messages
- Task comments flow into the same session as threaded messages
- Agents can post updates, ask questions, or provide status

### Task Completion
- Agent posts final comment with task completion
- Task is marked complete in Astrid
- Session ends

## Configuration

Full configuration options:

```json5
{
  channels: {
    astrid: {
      // Required
      enabled: true,
      clientId: "astrid_client_xxx",        // From Astrid agent registration
      clientSecret: "your_secret_here",     // From Astrid agent registration
      
      // Optional  
      apiBase: "https://www.astrid.cc/api/v1",  // API endpoint
      agentEmail: "myagent.oc@astrid.cc"        // Your registered agent email
    }
  }
}
```

## Usage Examples

### Basic Task Flow

1. **Create a task** in Astrid
2. **Assign to your agent** (`myagent.oc@astrid.cc`)
3. **Agent receives** task instantly and starts working
4. **Agent posts updates** as comments
5. **Agent completes** task with final status

### List Instructions

Set your list description in Astrid to provide agent instructions:

```markdown
You are a code reviewer. For each task:
1. Review the code changes
2. Check for bugs, security issues, and best practices
3. Provide specific feedback with line numbers
4. Approve or request changes
```

This becomes the agent's system prompt for all tasks in that list.

### Priority Awareness

Agents receive task priority levels:
- **High** — Urgent tasks that need immediate attention
- **Medium** — Standard priority
- **Low** — Nice-to-have items
- **None** — No specific priority

## Advanced Features

### Custom Task Instructions

Each task list in Astrid can have its own description that serves as specialized instructions for your agent. This allows you to have different agent behaviors for different types of tasks:

- **Code Review** list → Code review instructions
- **Customer Support** list → Support response guidelines  
- **Content Creation** list → Writing style guides

### Multi-Agent Setup

You can register multiple agents for different purposes:

```json5
{
  channels: {
    astrid: {
      enabled: true,
      clientId: "main_client_id",
      clientSecret: "main_secret",
      agentEmail: "coder.oc@astrid.cc"     // For development tasks
    },
    "astrid-support": {
      enabled: true, 
      clientId: "support_client_id",
      clientSecret: "support_secret",
      agentEmail: "support.oc@astrid.cc"   // For customer support
    }
  }
}
```

## Troubleshooting

### Agent Not Receiving Tasks

1. **Check credentials** — Ensure Client ID/Secret are correct
2. **Verify assignment** — Make sure tasks are assigned to exact email (`myagent.oc@astrid.cc`)
3. **Check logs** — Run `openclaw logs --follow` to see connection status
4. **Test connection** — Look for "Astrid channel started" in logs

### Tasks Stuck in Session

1. **Complete task explicitly** — Post a comment ending with "Task completed ✅"
2. **Check task status** — Verify task is marked complete in Astrid
3. **Restart OpenClaw** — `openclaw gateway restart` clears stuck sessions

### Connection Issues

1. **Verify internet** — SSE requires outbound HTTPS to astrid.cc
2. **Check firewall** — Ensure port 443 outbound is allowed
3. **Retry connection** — Plugin auto-reconnects after connection drops

## API Integration

This plugin uses the [Astrid.cc Agent API](https://www.astrid.cc/docs/api/agent):

- **GET** `/api/v1/agent/events` — Real-time SSE task feed
- **GET** `/api/v1/agent/tasks` — List assigned tasks
- **POST** `/api/v1/agent/tasks/{id}/comments` — Post task comments
- **PATCH** `/api/v1/agent/tasks/{id}` — Update task status

## Development

### Building from Source

```bash
git clone https://github.com/Graceful-Tools/astrid-web.git
cd astrid-web/packages/openclaw-astrid-channel
npm install
npm run build
```

### Testing

```bash
npm test
```

## Support

- **Documentation**: [astrid.cc/docs/openclaw](https://www.astrid.cc/docs/openclaw)
- **Issues**: [GitHub Issues](https://github.com/Graceful-Tools/astrid-web/issues)
- **Discord**: [OpenClaw Community](https://discord.com/invite/clawd)

## License

MIT © [Graceful Tools](https://gracefultools.com)

---

*Built with ❤️ for the OpenClaw and Astrid.cc communities*