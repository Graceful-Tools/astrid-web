# List Descriptions as Agent Instructions

## Overview

Each Astrid list's **description** field doubles as an instruction file for AI agents. When an agent is assigned a task in a list, the list description is included as the agent's primary context — like a `claude.md` or `AGENTS.md` file gives project-level guidance.

This means **users control agent behavior per-list** just by editing the list description. No code changes, no deploys, no hardcoded workflows.

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

When an agent receives a task, the prompt is structured as:

```
## Instructions
{list.description OR minimal default}

## Task
**{task.title}**
{task.description}
Priority: {priority}
Due: {dueDate}
List: {listName}

## Conversation
{recent comments, if any}

## New Comment          ← only for comment responses
{user's latest comment}

## File Attachments
{format hint for file delivery}
```

### Where It's Used

| Path | What happens |
|------|-------------|
| `assistant-workflow/route.ts` → `buildPrompt()` | List description becomes `## Instructions` for Claude/OpenAI/Gemini direct API calls |
| `ai-agent-webhook-service.ts` → `contextInstructions` | List description included in webhook payload for external agents (Claude Code Remote, OpenClaw) |
| OpenClaw hook payload | List description flows through `buildPrompt()` into the `message` field |

### Priority Chain

Instructions are resolved in order:
1. **List description** (user-defined, highest priority)
2. **Agent config `contextInstructions`** (per-agent override, rarely used)
3. **Hardcoded default** (minimal fallback)

## Backward Compatibility

- Lists without descriptions work exactly as before
- No database migration needed (`description` field already exists on `TaskList`)
- No breaking changes to webhook payloads (new field, additive)
