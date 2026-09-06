# Astrid Project Context

*Comprehensive project context for AI agents working on the Astrid codebase*

**This file is read by ALL AI agents** when assigned tasks. It contains project architecture, conventions, and development guidelines.

---

## Project Overview

**Astrid** is a task management system with:
- **Web App**: Next.js + React
- **iOS App**: Native SwiftUI app
- **Backend**: Next.js API routes + PostgreSQL

### Repository Structure

```
astrid-web/  (this repository)
├── app/              # Next.js App Router (pages + API)
├── components/       # React components
├── lib/              # Shared utilities and services
├── hooks/            # Custom React hooks
├── services/         # Business logic services
├── prisma/           # Database schema and migrations
├── tests/            # Vitest unit/integration tests
├── e2e/              # Playwright E2E tests
├── mcp/              # MCP server implementations
├── scripts/          # Automation scripts
├── docs/             # Documentation
└── packages/         # SDK and tool packages
    ├── astrid-sdk/            # Multi-provider AI agent SDK
    └── openclaw-astrid-channel/  # OpenClaw channel adapter
```

**Related Repository:**
- **iOS App:** https://github.com/Graceful-Tools/astrid-ios (native SwiftUI app)

---

## Technology Stack

### Web Application

| Layer | Technology |
|-------|------------|
| Framework | Next.js, React |
| Language | TypeScript |
| Database | PostgreSQL (Neon serverless) |
| ORM | Prisma |
| Auth | NextAuth.js (Google OAuth + passkeys; see `docs/AUTHENTICATION.md`) |
| Styling | Tailwind CSS + Shadcn/ui (Radix) |
| Testing | Vitest + Playwright |
| Deployment | Vercel |

Exact framework and tool versions live in
[`docs/context/stack.md`](./docs/context/stack.md), where `npm run check:docs` verifies
them against `package.json`.

### iOS Application

The native iOS app is maintained in a separate repository: https://github.com/Graceful-Tools/astrid-ios

---

## Architecture Patterns

### API Route Structure

```typescript
// app/api/[resource]/route.ts
export async function POST(request: NextRequest) {
  try {
    // 1. Authentication
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      // JSON, like the other 129 sites — not the plain-text Response this
      // sample used to show. A client cannot parse two different 401 shapes.
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // 2. Input validation
    const body = await request.json()

    // 3. Permission check
    await validateAccess(session.user.id, resourceId)

    // 4. Business logic
    const result = await prisma.resource.create({...})

    // 5. Response
    return Response.json(result)
  } catch (error) {
    // The message is logged, never returned — see Error Handling below.
    log.error({ err: error }, "Operation failed")
    return NextResponse.json(createSafeErrorResponse(error), { status: 500 })
  }
}
```

### React Component Pattern

```typescript
interface ComponentProps {
  taskId: string
  isEditable?: boolean
  className?: string
}

export function TaskComponent({
  taskId,
  isEditable = false,
  className
}: ComponentProps) {
  // 1. Hooks at top
  const [isLoading, setIsLoading] = useState(false)
  const { data, mutate } = useTaskData(taskId)

  // 2. Event handlers
  const handleUpdate = useCallback(async () => {
    // ...
  }, [taskId])

  // 3. Effects
  useEffect(() => {
    // ...
  }, [dependencies])

  // 4. Early returns
  if (!data) return null

  // 5. Render
  return (
    <div className={cn("task-component", className)}>
      {/* ... */}
    </div>
  )
}
```

### Hook Naming Convention

**Both casings are in the tree and both are correct.** `hooks/` is mostly
kebab-case, while 23 hooks — the task-detail and task-manager groups especially —
are camelCase. This section used to mandate kebab-case and illustrate it with
four files that have never existed (`use-tasks.ts`, `use-lists.ts`,
`use-auth.ts`, `use-task-operations.ts`), so it described neither the rule nor
the repository (task ff74f430).

Match the directory you are adding to rather than the rule you remember:

```typescript
// Top-level hooks: kebab-case
hooks/use-cached-data.ts
hooks/use-cache-sync.ts

// Grouped hooks: camelCase, matching their neighbours
hooks/task-detail/useTaskDetailState.ts
```

---

## AI Agent System

### Registered Agents

| Agent | Service | Purpose |
|-------|---------|---------|
| `claude@astrid.cc` | Claude API | Code generation, review |
| `openai@astrid.cc` | OpenAI API | Code generation, review |
| `gemini@astrid.cc` | Gemini API | Code generation, review |
| `codex@astrid.cc` | Local Codex CLI | Polling `/fixall` harness (not the OpenAI cloud agent) |
| `openclaw@astrid.cc` | OpenClaw Gateway | Self-hosted agent (any model) |
| `{name}.oc@astrid.cc` | OpenClaw Gateway | Named OpenClaw agents |

### List Descriptions as Agent Instructions

Each list's **description** field serves as the instruction file for AI agents working on tasks in that list. Think of it like `claude.md` or `AGENTS.md` but per-list.

**How it works:**
1. User writes markdown in the list description (List Settings → Admin → Description)
2. When an agent picks up a task, the list description is included as `## Instructions`
3. Same description works across all agent types (Claude, OpenAI, Gemini, OpenClaw)
4. Lists without descriptions get a minimal default

**Example:** A "Code Reviews" list with description:
```markdown
Review PRs for security issues, test coverage, and style.
Post findings as comments. Mark complete when done.
```

See `docs/LIST_DESCRIPTION_AS_AGENT_INSTRUCTIONS.md` for full details.

### Agent Routing

Tasks assigned to AI agents are automatically routed:
1. Agent email → service (via `lib/ai/agent-config.ts`)
2. List description loaded as agent instructions
3. For cloud agents (Claude/OpenAI/Gemini): direct API call via `assistant-workflow`
4. For OpenClaw: fire-and-forget POST to user's gateway via `/hooks/agent`
5. For Claude Code Remote: signed webhook to user's self-hosted server

### Communication Protocol

Agents communicate through **task comments**:
- Post implementation plans before coding
- Post progress updates during implementation
- Post completion summary with commit details
- Wait for user approval before marking complete

### Preview Deployments

Agents deploy feature branches to preview subdomains for review before merging:

```bash
# Deploy current branch to <branch-name>.astrid.cc
./scripts/deploy-preview.sh

# Deploy specific branch
./scripts/deploy-preview.sh feature-dark-mode
# → Live at: dark-mode.astrid.cc

# Deploy to production (after user approval)
./scripts/deploy-preview.sh --production
# → Live at: astrid.cc
```

> **Merging does not ship.** `production-deployment.yml` is `workflow_dispatch`
> only (#204), so production is released by the `--production` command above or from
> the Actions tab, and migrations apply during *that* deploy. Merged code sits on
> `main`, seen by nobody, until someone deploys it. Full rule and how to verify:
> [docs/CLI_OPERATIONS.md §0](./docs/CLI_OPERATIONS.md) — do not restate it from
> memory, it has been documented wrongly four times.

**How it works:**
- Single Vercel project (`astrid-web`) with `*.astrid.cc` wildcard domain
- Each feature branch gets its own subdomain (e.g., `feature-x.astrid.cc`)
- Multiple features can be previewed simultaneously
- User reviews preview → approves → agent merges to main → **and then deploys**

**Agent workflow with previews:**
1. Agent creates feature branch and implements changes
2. Agent runs `./scripts/deploy-preview.sh` and posts preview URL to task
3. User reviews at `<branch>.astrid.cc`
4. User comments feedback or "ship it"
5. Agent merges to main, **then runs the production deploy** — the merge alone
   ships nothing

**Setup for your own project:**
1. Add a `*.yourdomain.com` wildcard domain to your Vercel project
2. Copy `scripts/deploy-preview.sh` to your repo
3. Set `VERCEL_TOKEN` in your `.env.local`
4. Update the `--scope` flag in the script to match your Vercel team

---

## Whitelabeling

Astrid deploys under a different brand, with a different set of back-end services,
entirely through build-time configuration — no source changes.

- **Identity** (name, wordmark, slogan, domain, emails, colours, artwork) —
  `lib/brand/config.ts`
- **Capabilities** (which auth methods, sync providers and integrations exist) —
  `lib/brand/capabilities.ts`, enforced server-side, 404 when disabled
- **Voice** (reminder nags, default-list captions) — `lib/brand/copy.ts`

Never hardcode a brand literal, a brand-named asset path or a service assumption:
`npm run check:reuse` fails the build on them. Partner profiles live in `brands/` and
`npm run check:brands` runs every one as its own predeploy gate.

Full reference: **[docs/WHITELABELING.md](./docs/WHITELABELING.md)**.

## Development Workflow

### Task-Based Development

1. **Baseline Testing** - Run full test suite to establish baseline
2. **Analysis** - Understand task, explore codebase
3. **Planning** - Create implementation plan
4. **Implementation** - Write code following patterns
5. **Verification** - Run tests, fix any regressions
6. **Regression Tests** - Create tests for new functionality
7. **Quality Gates** - Pass TypeScript, lint, all tests
8. **Review** - User tests and approves

---

## Coding Workflow (Required for All AI Agents)

**CRITICAL**: This workflow is MANDATORY for all AI agents when implementing code changes.

> This section is the astrid-web expansion of the portable queue workflow. The
> user-facing copy is GENERATED from the canonical skill in
> `lib/agent-skill/astrid-queue-skill.ts` (served by the connection recipes and
> the `/api/downloads/ASTRID_WORKFLOW.md` route), so change behavior there —
> there is no hand-mirrored workflow file to keep in sync any more.

### Step 1: Analysis & Planning

1. Understand the task requirements
2. Explore relevant codebase areas
3. Create implementation plan

### Step 2: Post Strategy Comment

**Before implementing, post your strategy to the task:**

```bash
# Web repo
npx tsx scripts/add-task-comment.ts <taskId> "Strategy: [approach description]"

# iOS repo (run from astrid-web directory)
cd ../astrid-web && npx tsx scripts/add-task-comment.ts <taskId> "Strategy: [approach description]"
```

**Example:**
```
Strategy: Will fix the LoginView by updating color references from Theme to AppTheme.
This affects lines 71-104 in LoginView.swift. Will also add a regression test.
```

Wait for user feedback if needed before proceeding.

### Step 3: Implementation — RED-GREEN TDD (Mandatory for bug fixes)

Bug fixes MUST follow red-green test-driven development:

1. **RED** — first write a failing test that reproduces the bug. Run it and
   confirm it fails for the right reason. The failing test is the proof
   that the bug exists and that your fix actually addresses it.
   - Prefer a small **vitest** unit test against a pure helper. If the bug
     only manifests at the UI/integration level, also add a **Playwright**
     spec under `e2e/` that exercises the gesture/flow end-to-end.
2. **GREEN** — write the minimum code that makes the test pass.
3. **Refactor** — clean up while the tests stay green.

Cite the bug's task id (e.g. "regression for bug 35c1ad50") in the test name
or doc-comment so the link is searchable later.

For features (not bug fixes) you can write code first, but every shipped
feature still needs its regression tests (see Step 5).

Write code following established patterns (see Architecture Patterns section).

### Step 4: Post-Implementation Verification

Use the smallest targeted test while iterating. After implementation, run the
focused tests that prove the changed behavior before moving to the final gate.

**If any tests fail:**

1. **DO NOT skip or ignore failures** - Fix them immediately
2. Analyze the failure to understand what broke
3. Fix the code (prefer fixing your new code over modifying tests)
4. Re-run until all tests pass

### Step 5: Regression Testing (Required)

**ALWAYS create regression tests for new functionality:**

#### For Web Changes (TypeScript/React)

Create Vitest tests in `tests/`:
```typescript
// tests/lib/[feature].test.ts or tests/components/[component].test.ts
describe('[Feature Name]', () => {
  it('should [expected behavior]', () => {
    // Arrange
    // Act
    // Assert
  })

  it('should handle edge case [X]', () => {
    // Test edge cases
  })
})
```

#### For API Changes

Create API tests:
```typescript
// tests/api/[endpoint].test.ts
describe('API: /api/[endpoint]', () => {
  it('should return expected data', async () => {
    // Test the endpoint
  })

  it('should handle errors correctly', async () => {
    // Test error cases
  })
})
```

**After creating tests, run them:**
```bash
# Web tests
npm run test:run
```

> **Note:** For iOS changes, see the [astrid-ios repository](https://github.com/Graceful-Tools/astrid-ios).

### Step 6: Final Quality Gate

Before marking a task complete, run the standard web gate:

```bash
npm run predeploy
```

Run `npm run predeploy:full` instead when the change affects a browser flow that
requires Playwright/E2E coverage, or when the task or workflow explicitly
requires the full suite. Do not stack every gate by default, and do not present
a targeted pass as the final quality gate.

### Step 7: Post Fix Summary Comment

**After verification passes, post a summary to the task:**

```bash
# Web repo
npx tsx scripts/add-task-comment.ts <taskId> "Fixed: [what was fixed and how]"

# iOS repo (run from astrid-web directory)
cd ../astrid-web && npx tsx scripts/add-task-comment.ts <taskId> "Fixed: [what was fixed and how]"
```

**Example:**
```
Fixed: Updated LoginView.swift to use AppTheme for all color references.
Changed 10 occurrences in lines 71-104. Added regression test in LoginViewTests.swift.
Build and all tests pass.

✅ Quality Gate Passed:
- TypeScript/Swift: No errors
- Tests: X/Y passing (including N new tests)
- New regression tests: [list test files]
```

---

## Agent Working Agreements

Distilled from recurring friction across sessions. These apply to **every** AI agent (Claude, Codex, and others) working in this repo.

### Code Reuse & Consistency (reuse before you write)
- **Search for an existing helper/key/component before writing new logic.** Good
  abstractions already exist and get bypassed; current policy and reproducible
  measurements live in
  [docs/CODE_REUSE_AND_CONSISTENCY.md](./docs/CODE_REUSE_AND_CONSISTENCY.md).
- **Permission logic** lives in `lib/list-permissions.ts` /
  `lib/list-member-utils.ts`. **Never inline** `list.ownerId === user.id` or
  `list.admins.some(...)` — call `canUserManageList` / `canUserEditTasks` /
  `isListAdminOrOwner`, or reuse a `canEdit*` value already in scope.
- **User-facing copy** lives in i18n locale files (`lib/i18n/locales/*.json`) —
  use `t("…")`, never a string literal in JSX. Keep key names mirrored with the
  Apple app's `Localizable.strings` where the string is shared.
- **Guardrails:** `npm run check:reuse` reports the backlog; ESLint
  `no-restricted-syntax` warns on the inline patterns. If no helper/key fits, add
  it to the shared home — don't inline. Cite the helper/key you reused (or why
  you added a new one) in your strategy comment.

### Testing / Workflow
- **Always use TDD:** write a RED test first, then implement to green. All tests must pass before considering a task complete. (See the detailed RED-GREEN flow in *Coding Workflow → Step 3*.)
- **Auth is high-risk:** after modifying auth-related files, run the **full web test suite** (`npm run predeploy`) before committing. Behavior-changing "clean" refactors have silently broken auth tests. Prefer the minimal, behavior-preserving change over a broad rewrite.
- **GitHub Actions changes are end-to-end changes.** When editing `fixall.yml`,
  `fixstuff.yml`, or `predeploy.yml`, trace and test the complete path: runner
  labels; the exact secrets and environment variables consumed by scripts;
  versioned machine-readable JSON output; dry-run behavior that performs no
  claim or trigger; atomic eligibility and assignment revalidation; the
  authenticated trigger; and persisted job outputs. Never parse human-readable
  task text or treat a job summary as task execution.
- **Existing PR work is complete only when it is remote.** Commit and push the
  intended fix, then verify
  `gh pr view <number> --json headRefOid --jq .headRefOid` matches the intended
  local commit before reporting completion. If it does not, report the exact
  running or failed command; never describe local-only work as finished.

### Deployment
- When diagnosing webhook / worker **401** errors, verify environment variables are set **at deploy time** (not just build time) before anything else — recurring 401s traced to deploy-time env-var gaps and were fixed by redeploying with the var present.

### Task Management / Tooling
- When filing/updating Astrid tasks, use the correct **`listIds`** array field (not `listId`), and double-check **list ID vs task ID** before closing a task. The wrong field orphans tasks and causes `400`s on comment posts.

### Communication Style
- Keep responses concise; avoid exceeding output token limits during long deploys or multi-file work (overlong turns have truncated sessions). Lead with the outcome, then supporting detail.

---

## Self-Healing Build System

The codebase includes an agentic self-healing build system that automatically detects, fixes, and escalates issues.

### Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                    PRE-COMMIT (husky + lint-staged)              │
│  ┌─────────────┐   ┌─────────────┐                              │
│  │ ESLint fix  │ → │ TypeScript  │   Runs on staged files only  │
│  └─────────────┘   └─────────────┘                              │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│                    PRE-DEPLOY (self-healing loop)                │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              Self-Healing Workflow                       │    │
│  │  ┌──────┐   ┌──────────┐   ┌───────┐   ┌────────────┐  │    │
│  │  │ Test │ → │ Analyze  │ → │ Auto  │ → │ Re-test    │  │    │
│  │  │      │   │ Failure  │   │ Fix   │   │ (max 3x)   │  │    │
│  │  └──────┘   └──────────┘   └───────┘   └────────────┘  │    │
│  │       ↓ still fails                                     │    │
│  │  ┌───────────────────────────────────────────────┐     │    │
│  │  │ Create Astrid Task in Bugs & Polish list      │     │    │
│  │  └───────────────────────────────────────────────┘     │    │
│  └─────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│                    POST-DEPLOY (canary checks)                   │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────────────┐    │
│  │ Health Poll │ → │ Verify DB   │ → │ Alert if Unhealthy  │    │
│  │ /api/health │   │ Connectivity│   │ (Create Task)       │    │
│  └─────────────┘   └─────────────┘   └─────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

### Commands

```bash
# Self-healing predeploy (default - runs checks, auto-fixes, retries)
npm run predeploy

# Dry run (analyze only, no fixes applied)
npm run predeploy:dry

# CI mode (create tasks on failure, exit 1)
npm run predeploy:ci

# Basic check without self-healing
npm run predeploy:simple

# Post-deploy canary check
npm run deploy:canary
npm run deploy:canary -- --url https://your-preview.vercel.app
```

### Auto-Fixable Issues

The self-healing system can automatically fix:

| Issue | Fix Command |
|-------|-------------|
| ESLint errors | `npm run lint -- --fix` |
| Prisma client out of sync | `npx prisma generate` |
| Stale build cache | `rm -rf .next && npm run build` |

### Task Creation

When issues can't be auto-fixed, tasks are created in the **Bugs & Polish** list with:
- Detailed error output
- Fix attempts history
- Action item checklist

Configure via environment:
```bash
ASTRID_BUGS_LIST_ID=your-list-uuid  # Target list for auto-created tasks
ASTRID_OAUTH_CLIENT_ID=...          # OAuth credentials
ASTRID_OAUTH_CLIENT_SECRET=...
```

### Customization

To adapt for your codebase, edit `scripts/predeploy-self-healing.ts`:

```typescript
// Add/modify checks
private getChecks() {
  return [
    {
      name: 'Your Check',
      command: 'your-command',
      autoFixable: true,
      fixCommand: 'your-fix-command',
    },
    // ...
  ]
}
```

---

## "Let's Fix Stuff" Workflow

When triggered by "let's fix stuff", "just fix stuff", or similar:

### 1. Pull and Analyze Tasks

```bash
# For web tasks (default)
npx tsx scripts/get-astrid-tasks.ts web

# For iOS tasks
npx tsx scripts/get-astrid-tasks.ts ios

# For all tasks
npx tsx scripts/get-astrid-tasks.ts all
```

**Task List IDs (in .env.local):**
- `ASTRID_OAUTH_LIST_ID` - Web tasks list
- `ASTRID_IOS_LIST_ID` - iOS tasks list (`aa41c1a3-bd63-4c6d-9b87-42c6e0aafa36`)

Review assigned tasks and prioritize.

### 2. For Each Task/Fix

Follow the full **Coding Workflow** above:
1. Analyze the specific issue
2. Implement the fix
3. Run `npm run predeploy` to verify
4. Fix any regressions
5. Add regression tests for the fix

### 3. Ship When Ready

After all fixes pass quality gates:
- Commit changes
- Ask user: "Ready to ship it?"
- Wait for approval before deploying

---

## Quality Commands

```bash
# Quick check (TypeScript + lint)
npm run predeploy:quick

# Standard check (includes Vitest)
npm run predeploy

# Full check (includes Playwright E2E)
npm run predeploy:full

# Development server
npm run dev
```

### Testing Strategy

**Vitest** for unit/integration tests:
- Logic, utilities, hooks
- API endpoints
- Component rendering

**Playwright** for E2E tests:
- User workflows
- Navigation
- Cross-browser compatibility

```bash
# Run all Vitest tests
npm run test:run

# Run specific test file
npm test tests/lib/my-test.test.ts

# Run E2E tests
npm run test:e2e

# E2E with UI
npm run test:e2e:ui
```

---

## iOS App Integration

The native iOS app is maintained in a separate repository: https://github.com/Graceful-Tools/astrid-ios

### API Endpoints Used by iOS

The iOS app connects to the web backend and uses these endpoints:
- `/api/auth/apple` - Sign in with Apple
- `/api/auth/google` - Google Sign In
- `/api/v1/tasks` - Task CRUD
- `/api/v1/lists` - List CRUD
- `/api/sse` - Real-time updates

### Cross-Platform Changes

When modifying API endpoints or authentication:
1. Make web API changes first in this repository
2. Deploy web changes to production
3. Update iOS app in the `astrid-ios` repository to use updated API
4. See parent workspace `../CLAUDE.md` for cross-repo workflow

---

## Code Conventions

### File Naming

| Type | Convention | Example |
|------|------------|---------|
| Components | PascalCase | `TaskListView.tsx` |
| Hooks | kebab-case | `use-task-operations.ts` |
| Utils | kebab-case | `task-utils.ts` |
| API routes | kebab-case | `api/tasks/[id]/route.ts` |
| Tests | match source | `task-utils.test.ts` |

### Import Order

```typescript
// 1. External libraries
import { useState } from "react"
import { NextRequest } from "next/server"

// 2. Internal utilities
import { cn } from "@/lib/utils"

// 3. Components
import { Button } from "@/components/ui/button"

// 4. Types
import type { Task } from "@/types"
```

### Error Handling

**Never return an error's message to the client.** It carries Prisma errors,
connection strings and server paths to anyone who can provoke a 500.
`createSafeErrorResponse` returns `{ error }` in production and adds `details`
only in development.

```typescript
import { createSafeErrorResponse } from "@/lib/logging/error-sanitizer"

try {
  const result = await operation()
  return NextResponse.json(result)
} catch (error) {
  log.error({ err: error }, "Operation failed")   // the message belongs HERE
  return NextResponse.json(createSafeErrorResponse(error), { status: 500 })
}
```

A *narrowed* domain error is different: its message is written for the caller,
so returning it with a 4xx is correct.

```typescript
if (error instanceof ListImageClaimError) {
  return NextResponse.json({ error: error.message }, { status: 409 })
}
```

> This section used to prescribe `return new Response(error.message, { status: 500 })`,
> and 21 routes duly did it. `scripts/check-api-boundaries.ts` now fails any
> newly added line that returns an error message from `app/api/**` (task 17fea642).

---

## Database

### Key Models

- **User** - Authentication, settings
- **Task** - Core task data
- **TaskList** - Task organization
- **Comment** - Task comments
- **AIAgent** - Agent configurations

### Commands

```bash
# Generate Prisma client
npm run db:generate

# Push schema changes
npm run db:push

# Run migrations
npm run db:migrate

# Open Prisma Studio
npm run db:studio
```

---

## Documentation Structure

```
docs/
├── README.md           # Documentation index
├── ARCHITECTURE.md     # System architecture
├── ai-agents/          # AI agent documentation
├── context/            # Quick references
├── guides/             # Development guides
├── setup/              # Setup instructions
├── testing/            # Test documentation
└── archive/            # Historical docs
```

### Root Directory Files

Core markdown files in root:
- `CLAUDE.md` - Claude Code CLI context
- `ASTRID.md` - Project context (this file)
- `CODEX.md` - OpenAI agent context
- `GEMINI.md` - Gemini agent context
- `README.md` - Project overview

Additional root files:
- `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` - Community files
- `CHANGELOG.md` - Version history

### Packages Directory

The `packages/` directory contains reusable SDK and tool packages:

| Package | Description |
|---------|-------------|
| `astrid-sdk` | Multi-provider AI agent SDK for building integrations. Run your own agent host with `npx astrid-agent`. |
| `openclaw-astrid-channel` | OpenClaw channel adapter |

Each package has its own README with setup and usage instructions.

---

## Key Principles

### Code Quality

- Follow existing patterns in the codebase
- Keep solutions simple and focused
- Don't over-engineer or add unnecessary abstractions
- Fix ALL instances of issues (use comprehensive search)

### Testing

- Create both unit AND E2E tests for user-facing changes
- Test edge cases and error conditions
- Ensure tests pass before completing tasks

### Communication

- Post implementation plans before coding
- Include file paths with line numbers
- Explain decisions and trade-offs
- Wait for user approval before final completion

---

## Quick Reference

### Common Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start development server |
| `npm run predeploy:quick` | Quick quality check |
| `npm run predeploy` | Standard quality check |
| `npm test` | Run Vitest tests |
| `npm run test:e2e` | Run Playwright tests |
| `npm run db:studio` | Open Prisma Studio |

### Key Files

| File | Purpose |
|------|---------|
| `lib/ai/agent-config.ts` | Agent routing configuration |
| `lib/ai-orchestrator.ts` | AI workflow execution |
| `prisma/schema.prisma` | Database schema |
| `app/api/` | API endpoints |
| `components/` | React components |

---

## See Also

- **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)** - Detailed system architecture
- **[docs/API_CONTRACT.md](./docs/API_CONTRACT.md)** - Stable external/mobile API contract
- **[docs/context/conventions.md](./docs/context/conventions.md)** - Code conventions
- **[docs/guides/development-guidelines.md](./docs/guides/development-guidelines.md)** - Development standards
- **[iOS Repository](https://github.com/Graceful-Tools/astrid-ios)** - Native iOS app (separate repo)

---

*This file provides context for all AI agents working on the Astrid project.*
