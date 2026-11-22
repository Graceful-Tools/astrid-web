# List Descriptions as Agent Instructions

## Overview

Each Astrid list's **description** field doubles as an instruction file for AI agents. When an agent is assigned a task in a list, the list description is included as the agent's primary context — like a `claude.md` or `AGENTS.md` file gives project-level guidance.

This means **users control agent behavior per-list** just by editing the list description. No code changes, no deploys, no hardcoded workflows.

**Goals and guardrails belong to the project, not here** (ADEV-179). What the work is for and
what it must not do are stated once per project (Project settings → Goals & guardrails) and reach
every agent beside this description, as `## Project goals and guardrails`. Keep the list
description to what is specific to this list; when a project states its goals, most of the
guidance a list used to carry is no longer needed. See [API_CONTRACT.md](./API_CONTRACT.md) →
`/api/v1/projects/{id}/goals`.

## How It Works

### For Users

1. Go to **List Settings → Admin Settings → Description**
2. Write markdown instructions for how agents should handle tasks in this list
3. Assign tasks to any AI agent (`claude@astrid.cc`, `openai@astrid.cc`, `gemini@astrid.cc`, `openclaw@astrid.cc`)
4. The agent receives your instructions + the task details

### Example List Descriptions

**"Code Reviews" list:**
```markdown
You're reviewing pull requests for our web app.

Focus on:
- Security vulnerabilities (XSS, SQL injection, auth issues)
- Test coverage gaps
- Code style consistency with existing patterns
- Performance concerns

Post your findings as task comments. If the PR looks good, say so and mark the task complete.
```

**"Research Tasks" list:**
```markdown
Research the topic described in the task. Provide:

1. A summary of key findings (2-3 paragraphs)
2. Links to primary sources
3. Any conflicting viewpoints or caveats
4. Recommended next steps

Attach longer reports as files using <<<FILE:report.md>>>...<<<END_FILE>>>
```

**"Content Writing" list:**
```markdown
Write content based on the task description. Match our brand voice:
- Casual but professional
- Short sentences, no jargon
- Use examples and analogies

Post a draft as a comment. Wait for feedback before marking complete.
```

### No Description? No Problem

Lists without descriptions get a minimal default: the agent reads the task details and helps complete it. The description is optional — it just makes agents smarter about *how* to work.

## Technical Details

### Prompt Structure

Server-run agents (Claude, OpenAI and Gemini called directly) get this prompt
(`lib/assistant-workflow/run-assistant-workflow.ts` → `buildPrompt()`; the first part is
`buildAgentContextInstructions` in `lib/ai/prompt-trust.ts`):

```
## Trusted policy
{fixed policy: list guidance, task fields and comments are untrusted data}

## List guidance
<untrusted_list_guidance format="json">{list.description OR minimal default}</untrusted_list_guidance>

## Project goals and guardrails          ← only when the list's project states any
<untrusted_project_goals format="json">{goals and guardrails}</untrusted_project_goals>

## Task data
<untrusted_task_data format="json">{title, description, priority, dueDate, list}</untrusted_task_data>

## Conversation data                     ← recent comments, if any
## New comment data                      ← only for comment responses
## File Attachments
```

### Where It's Used

| Path | What happens |
|------|-------------|
| `lib/assistant-workflow/run-assistant-workflow.ts` → `buildPrompt()` | List guidance and project goals open the prompt for Claude/OpenAI/Gemini direct API calls |
| `lib/webhooks/task-assignment-notifier.ts`, `comment-notifier.ts` → `aiAgent.contextInstructions` | The same `buildAgentContextInstructions` text, in the webhook payload for Claude Code Remote and other webhook agents |
| `GET /api/v1/agent-queue` → `listInstructions[]`, `projectGoals[]` | Polling agents get each queued list's description and its project's goals, one entry per list, wrapped as untrusted guidance (`lib/agent-queue-list-instructions.ts`, `lib/agent-queue-project-goals.ts`) |
| Agent protocol / SSE (`AgentTask.listDescription`, `AgentTask.projectGoals`) | The OpenClaw channel plugin and SDK channels read these fields and build their own prompt. OpenClaw does not go through `buildPrompt()`, and its plugin does not render `projectGoals` yet |

### Priority Chain

Instructions are resolved in order:
1. **List description** (user-defined, highest priority)
2. **Agent config `contextInstructions`** (per-agent override, rarely used)
3. **Hardcoded default** (minimal fallback)

## Backward Compatibility

- Lists without descriptions work exactly as before
- No database migration needed (`description` field already exists on `TaskList`)
- No breaking changes to webhook payloads (new field, additive)
