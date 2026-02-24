# Claude Code CLI - Operational Context

*Local Claude Code CLI workflow for the Astrid web app*

**Repository:** https://github.com/Graceful-Tools/astrid-web
**iOS App:** https://github.com/Graceful-Tools/astrid-ios (separate repo)

**Note:** This file is for **Claude Code CLI only** (local development). Cloud AI agents should read **ASTRID.md** for project context.

---

## Permissions Setup

**CRITICAL**: Claude Code reads permissions from `.claude/settings.local.json`.

- Always check `.claude/settings.local.json` for current permissions
- Template available at `.claude/settings.json.example`
- **JSON does NOT support comments** - file must be valid JSON

### Validate Permissions (Run at Session Start)

```bash
npm run validate:settings:fix
```

This will:
- Check if `.claude/settings.local.json` exists
- Validate JSON syntax (no comments, no trailing commas)
- Auto-fix common issues
- Display permissions summary

---

## Deployment Approval Workflow

**NEVER DEPLOY TO PRODUCTION WITHOUT EXPLICIT USER APPROVAL**

### "Ship It" - Full Deployment

When user says **"ship it"**, execute the complete deployment sequence:

1. **Merge PR** (if on a feature branch):
   ```bash
   git checkout main
   git pull origin main
   git merge <feature-branch>
   ```

2. **Push to main**:
   ```bash
   git push origin main
   ```

3. **Trigger Vercel production deployment**:
   ```bash
   npx vercel --prod --yes --no-dotenv
   ```

### Asking for Approval

- **ALWAYS ASK** before deploying: "Ready to ship it?" or "Ship to production?"
- **WAIT** for explicit approval ("ship it", "yes", "deploy")
- **DO NOT** combine commit and push without asking
- "Ship it" is the final approval to merge, push, and deploy

**Standard workflow:**
1. Commit locally: `git commit -m "fix: changes"` (autonomous)
2. ASK: "Ready to ship it?" or "Ship to production?"
3. WAIT for user response
4. After "ship it" approval:
   - Merge PR if on branch
   - Push to main
   - Deploy to Vercel

### Example: Complete "Ship It" Flow

**Scenario 1: Local Claude Code session**
```
User: "ship it"

Claude Code executes:
1. git checkout main
2. git pull origin main
3. git merge feature-branch  # if on a branch
4. git push origin main
5. npx vercel --prod --yes --no-dotenv
6. Mark Astrid task as complete (if working on a task)
```

**Scenario 2: User comments "ship it" on Astrid task**
```
User comments "ship it" on the task

Claude Code detects comment and executes:
1. npx tsx scripts/get-astrid-tasks.ts  # Fetch task details
2. Check for associated PR (from task metadata or recent commits)
3. git fetch origin
4. git checkout main
5. git pull origin main
6. gh pr merge <PR-number> --merge  # Merge the PR
7. git pull origin main  # Get merged changes
8. npx vercel --prod --yes --no-dotenv  # Deploy to production
9. npx tsx scripts/complete-task-with-workflow.ts <taskId>  # Mark complete
```

**How it works:**
- AI agents create PRs when working on tasks
- When user comments "ship it" on the task, Claude Code merges and deploys
- This workflow bridges Astrid task management with production deployment

---

## Vercel Deployment Workflow

**IMPORTANT: Vercel auto-deploy is DISABLED. Use CLI for all deployments.**

This project uses **manual Vercel CLI deployments** (not GitHub auto-deploy) for:
- Preview builds control
- Multiple build type support
- Direct deployment oversight

### CRITICAL: NEVER Pull From Vercel

**NEVER run these commands - they destroy `.env.local`:**
- `vercel pull` - FORBIDDEN
- `vercel link` - FORBIDDEN
- `vercel env pull` - FORBIDDEN

These commands download Vercel's env vars and **overwrite your local secrets**.

**ONLY use Vercel CLI to push deployments:**
```bash
export VERCEL_TOKEN=$(grep "^VERCEL_TOKEN=" .env.local | cut -d'=' -f2 | tr -d '\r"')
npx vercel --prod --yes --token="$VERCEL_TOKEN"
```

**Environment variables in `.env.local`:**
- `VERCEL_PROD` - production project ID (newastrid → astrid.cc)
- `VERCEL_STAGING` - staging project ID (astrid-web)
- `VERCEL_TOKEN` - auth token (works for both)

**If `.vercel/project.json` doesn't exist**, create it manually for production:
```json
{"projectId":"prj_MUWxfWJ9lIZOi2clHPZhlHsYqSiy","orgId":"team_gFxp7fWaX7e8tUPt8Vt3YXl0","projectName":"newastrid"}
```

**NEVER run `vercel link`** - it will nuke your `.env.local`.

### Standard Deployment Flow

```bash
# After user approves push to main
git push origin main

# Extract token and deploy (avoids sourcing .env.local which may have issues)
export VERCEL_TOKEN=$(grep "^VERCEL_TOKEN=" .env.local | cut -d'=' -f2 | tr -d '\r"')
npx vercel --prod --yes --token="$VERCEL_TOKEN"
```

### Force Production Rebuild

To trigger a fresh production build without code changes:

```bash
export VERCEL_TOKEN=$(grep "^VERCEL_TOKEN=" .env.local | cut -d'=' -f2 | tr -d '\r"')
npx vercel --prod --yes --token="$VERCEL_TOKEN"
```

**Note:** Vercel token must be configured. See `.env.local` for `VERCEL_TOKEN`.
**Note:** GitHub Actions workflows exist for CI but NOT for auto-deploy.

---

## Preview Links

When AI agents create PRs, preview deployments are available.

### Web (Vercel Preview)

- Use `vercel` CLI to create preview deployments
- Preview URL shown in CLI output
- Production deploys require `vercel --prod --yes`

**Note:** GitHub auto-deploy is disabled. Use CLI for all deployments.

---

## Handling "Ship It" on Astrid Tasks

**AUTOMATED:** The Claude agent worker automatically detects "ship it" comments and triggers deployment!

When you comment "ship it" on an Astrid task (where an AI agent has been working), the worker automatically:

1. ✅ Detects the "ship it" comment (polls every 30 seconds)
2. ✅ Extracts PR number from task comments
3. ✅ Merges PR to main via GitHub API
4. ✅ Vercel auto-deploys via GitHub webhook
5. ✅ Marks task as complete
6. ✅ Posts deployment confirmation to task

### How It Works

The `claude-agent-worker.ts` polls Astrid tasks and checks for "ship it" comments after completion markers:

**Automatic workflow:**
```
1. AI agent creates PR and posts link to task
2. User reviews PR preview and comments "ship it" on task
3. Worker detects comment on next poll (≤30s)
4. Worker merges PR #X to main
5. GitHub webhook triggers Vercel production deploy
6. Worker posts "🎉 Deployment Complete!" to task
7. Task marked as complete
```

### Manual Ship It (Fallback)

If automation fails or for manual deployment:

```bash
# Pull tasks and identify ship it comment
npx tsx scripts/get-astrid-tasks.ts

# Manual deployment
git fetch origin
git checkout main
gh pr merge <PR-number> --merge
git push origin main
npx vercel --prod --yes --no-dotenv
npx tsx scripts/complete-task-with-workflow.ts <taskId>
```

**Context:** AI agents working on tasks create PRs. User reviews on Astrid, comments "ship it", and automation completes deployment.

---

## Workflow Trigger: "Let's Fix Stuff"

When user says "let's fix stuff", "just fix stuff", or similar:

```bash
# 1. Validate permissions
npm run validate:settings:fix

# 2. Establish baseline
npm run predeploy:full

# 3. Check deployment (may fail if Vercel not configured - OK)
npm run monitor:vercel

# 4. Pull tasks
npx tsx scripts/get-astrid-tasks.ts
```

**See [ASTRID.md](./ASTRID.md) > "Coding Workflow"** for the full required workflow including:
- Strategy comment posting (Step 3)
- Implementation and verification
- Fix summary comment posting (Step 8)

**See [ASTRID.md](./ASTRID.md) > "Let's Fix Stuff Workflow"** for task script documentation.

---

## OAuth Setup (Task Management Integration)

**Required in `.env.local`:**
```bash
ASTRID_OAUTH_CLIENT_ID=your_client_id
ASTRID_OAUTH_CLIENT_SECRET=your_secret_here
ASTRID_OAUTH_LIST_ID=your-list-id-uuid
```

**Create OAuth Client:**
1. Visit your Astrid deployment's API settings
2. Click "Create OAuth Client"
3. Grant Types: `client_credentials`
4. Scopes: `tasks:read`, `tasks:write`, `lists:read`, `comments:read`, `comments:write`

**Important:** Use `X-OAuth-Token` header (not `Authorization: Bearer`) for API requests.

---

## Quality Gates

```bash
# Quick check (TypeScript + lint)
npm run predeploy:quick

# Standard check (Vitest + TypeScript + ESLint)
npm run predeploy

# Full check with E2E (slower)
npm run predeploy:full

# Run specific test
npm test [test-file]

# Run E2E tests
npm run test:e2e -- [specific-test]
```

---

## Integration Test Auto-Fix Workflow

When user says "fix tests", "run tests", or "auto-fix tests":

### 1. Establish Baseline

```bash
# Run full test suite to see current state
npm run predeploy:full
```

Document which tests are passing vs failing BEFORE making changes.

### 2. Run Individual Test Suites (for detailed output)

```bash
# Run Vitest unit tests
npm run test:run

# Run Playwright E2E tests (auth tests only without credentials)
npm run test:e2e
```

### 3. Analyze Failures

For Playwright failures:
- Check test output for specific assertions
- Run individual test with debug: `npm run test:e2e:debug -- [test-file]`
- Tests requiring auth are skipped without `PLAYWRIGHT_TEST_EMAIL`

### 4. Fix and Verify

```bash
# After fixing, re-run the failing test
npm run test:e2e -- [specific-test.spec.ts]

# Then run full suite to ensure no regressions
npm run predeploy:full
```

### 5. Add Regression Tests (If Fixing Bugs)

If the test failure revealed a bug that was fixed:
- Create a regression test that would have caught the bug
- Follow test patterns in **ASTRID.md > Coding Workflow > Step 5**

### Test File Locations

| Test Type | Location | Command |
|-----------|----------|---------|
| Vitest unit tests | `tests/` | `npm run test:run` |
| Playwright E2E | `e2e/*.spec.ts` | `npm run test:e2e` |

**Note:** iOS tests are in the separate `astrid-ios` repository.

---

## iOS Development

**iOS is now in a separate repository:** https://github.com/Graceful-Tools/astrid-ios

For iOS development, testing, and releases, clone the iOS repo separately.

---

## Development Workflow

### Default: Work on Main Branch

- Commit directly to main for bug fixes, improvements, tests
- Only create branches when user explicitly requests

### User Approval Points

1. **Task selection** - Confirm task and approach
2. **Implementation plan** - Post to task as comment
3. **Before deployment** - ALWAYS ask "Ready to ship it?" or "Ship to production?"
4. **After "ship it"** - Merge PR, push to main, deploy to Vercel, mark task complete

### Autonomous Actions (No Approval Needed)

- Code analysis and exploration
- Implementation and testing
- Local commits
- Posting task comments
- Documentation updates

---

## Pre-Approved Commands

These commands run without asking (configured in settings):

- `git add`, `git commit`, `git checkout`, `git log`, `git status`
- `npm run *` (dev, build, test, lint, predeploy, etc.)
- `npx tsx *` (all TypeScript scripts)
- `npx tsc`, `npx prisma *`, `npx next lint`

**Still requires approval:**
- `git push` + `vercel --prod` - Always ask "Ready to ship it?" first
- `git merge` (merging PRs) - Part of "ship it" workflow
- Database destructive operations
- File deletions outside project

---

## Documentation Rules

**Root directory markdown files:**
- `CLAUDE.md` - Claude Code CLI context (this file)
- `ASTRID.md` - Project context for all AI agents
- `CODEX.md` - OpenAI agent context
- `GEMINI.md` - Gemini agent context
- `README.md` - Project overview

**All other docs go in `/docs/` subdirectories.**

---

## Multi-Agent Setup

The AI agent worker supports multiple AI providers. Users can assign tasks to different AI agents:

### Supported Agents

| Agent | Provider | Model | Capabilities |
|-------|----------|-------|--------------|
| Claude | Claude | Claude Agent SDK | Best coding experience, native tool use |
| OpenAI Codex | OpenAI | GPT-4o | Function calling for file operations |
| Gemini | Gemini | Gemini 1.5 Pro | Function calling for file operations |

### API Keys Required

Add to `.env.local` for each provider you want to use:

```bash
# Claude - Recommended
ANTHROPIC_API_KEY=sk-ant-...

# OpenAI
OPENAI_API_KEY=sk-...

# Google Gemini
GEMINI_API_KEY=...
```

**Get API Keys:**
- Claude: https://console.anthropic.com/settings/keys
- OpenAI: https://platform.openai.com/api-keys
- Gemini: https://aistudio.google.com/apikey

### Running the Worker

```bash
# Run the multi-agent worker (monitors all configured agents)
npx tsx scripts/ai-agent-worker.ts

# Process a specific task
npx tsx scripts/ai-agent-worker.ts <taskId>
```

The worker automatically routes tasks to the correct AI service based on which agent the task is assigned to.

---

## Astrid SDK

Run AI coding agents with full CLI capabilities (file editing, bash, git) on any device.

**Install:**
```bash
npm install -g @gracefultools/astrid-sdk
```

### Three Modes

| Mode | Command | Best For |
|------|---------|----------|
| **API** | `npx astrid-agent` | Cloud execution via Claude Agent SDK API |
| **Terminal** | `npx astrid-agent --terminal` | Local Claude Code CLI (remote control your local CLI) |
| **Webhook** | `npx astrid-agent serve` | Always-on servers (fly.io, VPS) |

### Terminal Mode (Multi-Provider Local Execution)

Processes tasks locally using Claude Code CLI, OpenAI API, or Gemini API with local tool execution. Routes to the correct provider based on task assignee.

```bash
# Required: Astrid OAuth credentials
export ASTRID_OAUTH_CLIENT_ID=your-client-id
export ASTRID_OAUTH_CLIENT_SECRET=your-secret
export ASTRID_OAUTH_LIST_ID=your-list-id

# Provider API keys (configure at least one)
export OPENAI_API_KEY=sk-...           # For openai@astrid.cc tasks
export GEMINI_API_KEY=AIza...          # For gemini@astrid.cc tasks
# Claude uses local CLI, no API key needed for terminal mode

# Start terminal mode
cd /your/project
npx astrid-agent --terminal

# With options
npx astrid-agent --terminal --model=sonnet --cwd=/path/to/project --max-turns=100
```

**Terminal Mode Environment Variables:**

| Variable | Description | Default |
|----------|-------------|---------|
| `ASTRID_TERMINAL_MODE` | Enable terminal mode | `false` |
| `DEFAULT_PROJECT_PATH` | Project directory | current dir |
| **Claude** | | |
| `CLAUDE_MODEL` | Claude model | `opus` |
| `CLAUDE_MAX_TURNS` | Max turns | `50` |
| **OpenAI** | | |
| `OPENAI_API_KEY` | OpenAI API key | - |
| `OPENAI_MODEL` | OpenAI model | `o4-mini` |
| `OPENAI_MAX_TURNS` | Max turns | `50` |
| **Gemini** | | |
| `GEMINI_API_KEY` | Gemini API key | - |
| `GEMINI_MODEL` | Gemini model | `gemini-2.5-flash` |
| `GEMINI_MAX_TURNS` | Max turns | `50` |

**How Terminal Mode Works:**
1. Agent polls Astrid for tasks assigned to AI agents
2. Routes based on assignee:
   - `claude@astrid.cc` → Claude Code CLI (local)
   - `openai@astrid.cc` → OpenAI API + local tools
   - `gemini@astrid.cc` → Gemini API + local tools
3. Executes in your project directory with file/bash tools
4. Results posted back to Astrid as comments
5. Claude sessions stored in `~/.astrid-agent/terminal-sessions.json`

### API Mode (Default)

Uses Claude Agent SDK API for cloud execution. Best for CI/CD and servers without Claude Code CLI.

```bash
# Environment
export ANTHROPIC_API_KEY=sk-ant-...
export ASTRID_OAUTH_CLIENT_ID=your-client-id
export ASTRID_OAUTH_CLIENT_SECRET=your-secret
export ASTRID_OAUTH_LIST_ID=your-list-id

# Start polling (API mode)
npx astrid-agent
```

### Webhook Mode (For Servers)

Receives instant task notifications. Requires a permanent IP or domain.

```bash
# Environment
export ANTHROPIC_API_KEY=sk-ant-...
export ASTRID_WEBHOOK_SECRET=your-webhook-secret

# Start server
npx astrid-agent serve --port=3001
```

Then configure your webhook URL in Astrid Settings.

### Supported Providers

| Agent Email | Provider | Default Model |
|-------------|----------|---------------|
| `claude@astrid.cc` | Claude | Claude Code CLI (opus) |
| `openai@astrid.cc` | OpenAI | o4-mini |
| `gemini@astrid.cc` | Google Gemini | gemini-2.5-flash |

### Key Differences: Terminal vs API Mode

| Feature | API Mode | Terminal Mode |
|---------|----------|---------------|
| Execution | Cloud (Claude Agent SDK) | Local (Claude Code CLI) |
| Requires | API key only | Claude Code CLI installed |
| Session Resume | No | Yes (`--resume` flag) |
| Best For | CI/CD, servers | Local dev, complex tasks |
| Project Access | Clones repo | Uses local files directly |

---

## Quick Reference

| Command | Purpose |
|---------|---------|
| `npm run validate:settings:fix` | Validate permissions |
| `npm run predeploy:quick` | Quick type + lint check |
| `npm run predeploy` | Self-healing check (auto-fix + retry) |
| `npm run predeploy:simple` | Basic check (no auto-fix) |
| `npm run predeploy:full` | Full check with E2E |
| `npm run predeploy:dry` | Analyze only, no fixes |
| `npm run predeploy:ci` | CI mode (exit 1 on failure) |
| `npm run deploy:canary` | Verify production health post-deploy |
| `npm run test:e2e` | Run Playwright E2E tests |
| `npm run dev` | Start dev server |
| **Deployment** | |
| `npx vercel --prod --yes --no-dotenv` | Deploy to production (ALWAYS use --no-dotenv!) |
| `gh pr merge <PR#> --merge` | Merge PR |
| **Astrid Tasks** | |
| `npx tsx scripts/get-astrid-tasks.ts` | Pull tasks |
| `npx tsx scripts/analyze-task.ts <id>` | Analyze task |
| `npx tsx scripts/complete-task-with-workflow.ts <id>` | Mark task complete |

### Common Workflows

| Scenario | Action |
|----------|--------|
| User says "ship it" (local session) | Merge PR → push main → `npx vercel --prod --yes --no-dotenv` → `npm run deploy:canary` |
| User comments "ship it" on Astrid task | Fetch tasks → merge PR → push main → deploy → canary → mark complete |
| Check for ship it comments | `npx tsx scripts/get-astrid-tasks.ts` and look for user "ship it" comments |
| Build failing | Run `npm run predeploy` to auto-fix and retry |

---

## See Also

- **[ASTRID.md](./ASTRID.md)** - Project architecture and patterns (all AI agents read this)
- **[docs/README.md](./docs/README.md)** - Full documentation index
- **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)** - System architecture
- **[.claude/README.md](./.claude/README.md)** - Permissions configuration guide

---

*This file is for Claude Code CLI only. For project context, see ASTRID.md.*
