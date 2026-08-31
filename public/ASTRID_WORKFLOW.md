# Astrid AI Coding Workflow

**Works with: Claude, ChatGPT, Gemini, Cursor, Copilot, and any AI coding assistant**

> This is the canonical workflow for Astrid work. Drop it in your project root.
> Repository-local agent files (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`, etc.)
> may add platform commands and safety rules, but must not weaken or duplicate
> this process.

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

## Required workflow

### 1. Fetch and select the task

Fetch the appropriate Astrid task list, review scope and constraints, and use
the task ID in commit messages, tests, and task comments. Do not begin a
materially different task merely because it appears nearby in the codebase.

### 2. Analyze and post a strategy comment

Before implementation, inspect the relevant code and tests, then post a short
strategy comment on the Astrid task. State the affected area, the intended
behavior, the regression-test plan, and any cross-platform or offline/API
compatibility constraint. Pause for clarification when the task would require a
meaningful product, architecture, or deployment decision.

### 3. Implement bug fixes with RED–GREEN–refactor TDD

Bug fixes are mandatory red–green TDD work:

1. **RED:** write the smallest regression test that reproduces the reported
   behavior. Run it and confirm that it fails for the expected reason.
2. **GREEN:** make the smallest production change that makes that test pass.
3. **REFACTOR:** improve the implementation only while all relevant tests stay
   green.

Name the test or add a doc-comment with the Astrid task ID, for example
`regression for task abc123`. A feature may begin implementation before its
test, but it must ship with focused regression coverage and edge-case tests.

### 4. Verify and report

Use the smallest targeted test while iterating, then run the repository's
required final quality gate after implementation. Do not skip, mute, or rewrite
a failing test to make it pass; identify and fix the cause. For user-visible
flows, add or run an integration/E2E or UI test when a focused unit test cannot
prove the behavior. Do not present a targeted pass as the final quality gate.

Post a completion comment to the Astrid task with the behavior changed, tests
run, and any follow-up risk. Mark it complete only after the quality gates pass
and any required approval/deployment process has been satisfied.

### 5. Platform adapters

- **Web:** follow `CLAUDE.md` / `AGENTS.md` for local setup, API versioning,
  deployment approval, and the web quality commands.
- **iOS:** follow `astrid-ios/AGENTS.md` or `CLAUDE.md` for Xcode commands,
  service-layer write paths, unified outbox/offline behavior, repeating-task
  contracts, and old API-version compatibility.

### Commit convention

When committing completed work, include the task ID, for example:

```text
fix: preserve offline task completion (Task: abc123)
```

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
