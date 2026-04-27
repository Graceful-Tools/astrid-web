# Astrid AI Coding Workflow

**Works with: Claude, ChatGPT, Gemini, Cursor, Copilot, and any AI coding assistant**

---

## Quick Start

When user says **"let's fix stuff"**, **"fix stuff"**, or **"get tasks"**:

```bash
npx tsx scripts/get-project-tasks-oauth.ts
```

This shows all tasks from the configured Astrid list. User picks a task, AI implements it.

---

## Setup

### 1. Environment Variables

Add to `.env.local`:

```bash
ASTRID_OAUTH_CLIENT_ID=your_client_id
ASTRID_OAUTH_CLIENT_SECRET=your_secret
ASTRID_OAUTH_LIST_ID=your_list_uuid
```

Get credentials from your Astrid deployment's API settings.

### 2. Reference This File

Add to your AI config (CLAUDE.md, .cursorrules, CODEX.md, GEMINI.md):

```markdown
See ASTRID_WORKFLOW.md for "let's fix stuff" workflow.
```

---

## Workflow

1. **Fetch tasks** - Run the script above
2. **User selects task** - Pick a task number
3. **Implement** - Write code, tests, run quality checks
4. **Commit** - Include task ID: `fix: description (Task: abc123)`
5. **Update task** - Add comment with progress, mark complete when done

---

## Comment Commands

Post these as comments on Astrid tasks:

| Command | Action |
|---------|--------|
| `approve` | Start implementation |
| `ship it` | Merge PR and deploy |
| `change: [feedback]` | Request modifications |
| `pause` | Stop work on task |

---

## AI Agent Assignment

Assign tasks directly to AI agents for automated work:

- **Claude** - Claude Agent SDK
- **Gemini** - Gemini agent
- **OpenAI Codex** - OpenAI Codex agent

---

## Quality Checks

Before marking tasks complete:

```bash
npm run predeploy        # TypeScript + ESLint + tests
npm run test:e2e         # E2E tests (if UI changes)
```

iOS tests live in the separate [astrid-ios](https://github.com/Graceful-Tools/astrid-ios) repo.

---

## Example Session

```
User: let's fix stuff

AI: [runs script, shows tasks]
    1. Fix login button on mobile (ID: abc123)
    2. Update API docs (ID: def456)

    Which task?

User: 1

AI: [analyzes task, plans approach, implements fix]
    Done! Committed: fix: responsive login button (Task: abc123)

    Ready to ship it?

User: ship it

AI: [pushes to main, deploys]
```

---

## Troubleshooting

**"OAuth credentials not configured"**
- Check `.env.local` has `ASTRID_OAUTH_CLIENT_ID` and `ASTRID_OAUTH_CLIENT_SECRET`

**"Project list not found"**
- Update `ASTRID_OAUTH_LIST_ID` in `.env.local`
- Find list ID: open list in Astrid → Settings → List ID

**Script not found**
- Ensure the `scripts/` directory contains the required scripts

---

**Setup guide:** See docs/guides for detailed setup instructions.
