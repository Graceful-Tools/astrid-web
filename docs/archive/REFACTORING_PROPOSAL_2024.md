# Historical Refactoring Proposal: Code Architecture Improvements

*Analysis and recommendations for improving code maintainability*

**Created:** 2024-11-27
**Updated:** 2026-08-13 (hygiene review, task 79b322b0)
**Status:** In Progress

---

## Executive Summary

The codebase has several large files and architectural patterns that make it difficult
for AI agents to work efficiently. This proposal identifies the key issues and provides
a phased refactoring plan.

**The dominant issue is no longer file size — it is the duplicated `/api/*` ↔ `/api/v1/*`
surface.** See [2026-08-13 review](#2026-08-13-review) for the current measurements.

Every number there comes from a shell one-liner you can re-run rather than from an
impression — but note that §2 of that review was **wrong in its first draft** and is
corrected in place. It reported a missing client API layer that in fact exists under a
name the audit did not grep for. Counts are only as good as the pattern that produced
them; re-derive before planning against any of them.

---

## 2026-08-13 review

Measured on `main` at commit `c2d0625`. Prior sections below this one describe the
2024-11-27 state and are kept as history — **their numbers are stale, do not plan from
them.** (Ten of the numbers in the older sections were re-checked during this review and
every one had moved; most improved, one got worse.)

### 1. Duplicated legacy ↔ v1 route implementations — the big one

37 paths exist under both `app/api/` and `app/api/v1/`. They split into two groups:

| Shape | Count | Cost |
|---|---|---|
| v1 re-exports the legacy handler (≤50 lines) | 9 | ~free, cannot drift |
| v1 reimplements the endpoint independently | **28** | **7,376 legacy + 5,903 v1 lines** |

Two strategies coexist for the same problem and the expensive one is the default.

**This is not a tidiness argument — the duplication ships bugs.** Task 92e582c6 (closed
2026-08-13) was `GET /api/v1/tasks/:id` returning 403 where legacy returned 200, because
the two implementations grew different access checks. Task 641a7615 found v1 dropping
`secureFiles`, so attachments vanished on refresh. Both were the same root cause.

Known live divergence, not yet fixed: legacy `PUT /api/tasks/:id` calls
`recordStateChangeComment` (lib/task-update-handler.ts); v1's PUT does not. Both record
`TaskEvent`s, so this is a difference in the *comment* trail only — but it is a
difference, and nothing tests that the two paths agree.

The re-export pattern (`app/api/v1/chat/channels/route.ts` is 9 lines) is the proven fix
wherever v1 needs no response-envelope change.

### 2. The client API layer exists and is bypassed

The helpers are already here:

- `lib/api.ts` — `apiCall`, `apiGet`, `apiPost`, `apiPut`, `apiDelete`, plus
  cache-invalidation subscribers
- `lib/v1-response.ts` — `unwrapTask`, `unwrapList`, `unwrapComment`, `unwrapEnvelope`

Adoption is the problem:

| | files |
|---|---|
| import `@/lib/api` | **5** |
| import `@/lib/v1-response` | 12 |
| hand-roll `fetch('/api/…')` | **71** (189 call sites) |

Zero files do both, so this is not half-migrated modules — it is 71 files that never
picked the helpers up.

The concrete cost: v1 returns `{ task, meta }` where legacy returned the task directly.
A call site that forgets to unwrap does not error — it reads `undefined` and takes a
silently wrong branch. `unwrapTask` exists to prevent exactly that, and 59 of the 71
files do not import it.

> **This section was wrong in the first draft of this review** and is corrected here. It
> claimed there was no client layer and proposed building one, because the audit grepped
> for `lib/api-client*` and `apiFetch`/`apiClient` — the names I expected rather than the
> names in the repo. The lesson generalises to the rest of this document: a grep that
> finds nothing is evidence about the grep as much as about the code. The raw-fetch count
> is corrected from 222 to 189 for the same reason (the higher figure double-counted call
> sites matching more than one pattern).

### 3. God files — mixed progress

| File | 2024-11-27 | 2026-08-13 | |
|---|---|---|---|
| `app/api/mcp/operations/route.ts` | 2,972 | **349** | split into `handlers/` ✅ |
| `mcp/mcp-server-v2.ts` | 1,454 | **257** | ✅ |
| `hooks/useTaskManagerController.ts` | 2,775 | **1,613** | 139 → 65 hook calls ✅ |
| `lib/ai-orchestrator.ts` | 2,642 | **1,532** | ✅ |
| `app/api/tasks/[id]/route.ts` | 1,237 | **1,004** | ✅ |
| `components/TaskManager/MainContent/MainContent.tsx` | 1,226 | **997** | ✅ |
| `components/task-detail/CommentSection.tsx` | 1,189 | **776** | ✅ |
| `components/task-detail.tsx` | 1,514 | **1,624** | ⚠️ **grew 7% after being flagged** |

`components/task-detail.tsx` is now the largest file in the repo. It is the one god file
that moved backwards while under a documented refactor program.

**Not on this list on purpose:** `lib/cache-manager.ts` (935 lines) is a saga, not a god
file — splitting it was evaluated and closed won't-split. Do not re-propose it.

### 4. Type erosion at the API boundary

357 `: any` annotations repo-wide, **115 of them in `app/api/`**, including 11
`const data: any = {}` request-body accumulators in route handlers. The boundary that most
needs a checked shape is the one with the least typing.

### 5. Prisma reaches everywhere

Direct `@/lib/prisma` importers: **219 files**, up from 127 in 2024. The service layer
proposed below was never built, and the trend has gone the other way. Either build it or
strike it from this doc — a target nobody moves toward is noise in a planning document.

### 6. Route test coverage is uneven

341 unit/component test files, 0 Playwright specs under `tests/e2e`. Of 100 v1 route
files, **57 have no test that so much as mentions their path**. (Grep-based, so it is a
coarse signal — a route may be covered by a test that names it differently — but the
gap is too wide to be an artifact of the method.)

---

## Progress Summary

### Completed
- [x] **Removed 7,524 lines of dead code** - Unused MCP components deleted
- [x] **Created lib/ai/ module structure** - Centralized AI-related code
- [x] **Extracted AI clients** - OpenAI and Gemini clients to lib/ai/clients/
- [x] **Deleted duplicate CRUD viewers** - Both were unused, removed entirely
- [x] **Deleted legacy MCP V1 server** - mcp-server.ts (738 lines) + build-mcp.js (60 lines)
- [x] **Extracted Claude client** - lib/ai/clients/claude.ts (418 lines)
- [x] **Extracted file path utilities** - lib/ai/file-path-utils.ts (136 lines)
- [x] **Extracted AI prompt templates** - lib/ai/prompts.ts (217 lines)
- [x] **Extracted response parser utilities** - lib/ai/response-parser.ts (270 lines)
- [x] **Created shared Prisma includes** - lib/task-query-utils.ts (80 lines)
- [x] **Removed dead context management methods** - getContextSize, isContextNearLimit, pruneContext

### In Progress
- [ ] useTaskManagerController cleanup (duplicate state identified)

### ai-orchestrator.ts Progress
- Original: 3,370 lines
- After Claude client extraction: 3,114 lines
- After file-path-utils extraction: 2,998 lines
- After prompt templates extraction: 2,905 lines
- After dead code removal: 2,840 lines
- After response-parser extraction: **2,642 lines**
- **Total reduction: 728 lines (21.6%)**

---

## Critical Issues Identified

> **Historical — 2024-11-27.** Every table in this section has been superseded by the
> [2026-08-13 review](#2026-08-13-review). Kept for the record of what was believed then.

### 1. God Files (>1000 lines)

| File | Lines | Status |
|------|-------|--------|
| `app/api/mcp/operations/route.ts` | 2,972 | MCP protocol - required complexity |
| `hooks/useTaskManagerController.ts` | 2,775 | Duplicate state removed, continue consolidation |
| `lib/ai-orchestrator.ts` | 2,642 | ✅ Refactored (4 modules extracted, 728 lines reduced) |
| `components/task-detail.tsx` | 1,514 | Oversized component |
| `mcp/mcp-server-v2.ts` | 1,454 | MCP server implementation |
| `app/api/tasks/[id]/route.ts` | 1,237 | Shared includes extracted to task-query-utils.ts |
| `components/TaskManager/MainContent/MainContent.tsx` | 1,226 | Too large |
| `components/task-detail/CommentSection.tsx` | 1,189 | Could be split |

### 2. Code Duplication - RESOLVED

| Files | Status |
|-------|--------|
| `components/mcp-crud-viewer.tsx` | ✅ DELETED (dead code) |
| `components/api-crud-viewer.tsx` | ✅ DELETED (dead code) |

**Resolution:** Both files were unused and deleted, removing 2,292 lines.

### 3. Missing Architecture Layers

**Current State:**
```
API Routes → Prisma (direct) → Database
    ↓
  Hooks → API Routes
    ↓
Components
```

**Problem:** 127 files import Prisma directly. No service layer for business logic.

**Target State:**
```
API Routes → Services → Repositories → Database
    ↓
  Hooks → API Routes (thin)
    ↓
Components
```

### 4. Hook Anti-Pattern

`useTaskManagerController.ts` has:
- 139 useState/useCallback/useMemo/useEffect calls
- 2,848 lines of code
- Single export function

This is a "God Hook" that does everything.

---

## Proposed Architecture

### New Service Layer Structure

```
services/
├── interfaces/
│   ├── task.service.ts
│   ├── list.service.ts
│   ├── comment.service.ts
│   └── ai-orchestration.service.ts (existing)
├── implementations/
│   ├── task.service.ts
│   ├── list.service.ts
│   ├── comment.service.ts
│   └── ai-orchestration.service.ts (existing)
└── index.ts (service registry)
```

### Split AI Orchestrator

**Current:** 2,998 lines (down from 3,370)

**Current Structure:**
```
lib/ai/
├── index.ts              (45 lines) - Centralized exports ✅
├── agent-config.ts       (~100 lines) - AI agent routing ✅
├── types.ts              (67 lines) - Shared type definitions ✅
├── file-path-utils.ts    (136 lines) - File path variation generation ✅
└── clients/
    ├── index.ts          (14 lines) - Client exports ✅
    ├── openai.ts         (82 lines) - OpenAI API client ✅
    ├── gemini.ts         (83 lines) - Gemini API client ✅
    └── claude.ts         (418 lines) - Claude API client with tool loop ✅

lib/ai-orchestrator.ts    (2,998 lines) - Main orchestrator (reduced 372 lines total)
```

**Next Steps:**
```
lib/ai/
├── planning-service.ts   (400 lines) - Plan generation
├── github-integration.ts (400 lines) - GitHub operations
└── workflow-manager.ts   (300 lines) - Workflow state
```

### Split useTaskManagerController

**Current:** 2,848 lines - **Partially refactored**

**Existing Hooks (not fully integrated):**
```
hooks/
├── useTaskManagerController.ts  (2,848 lines) - Still monolithic
├── useTaskManagerLayout.ts      (239 lines) - Layout/responsive ✅
├── useTaskManagerModals.ts      (112 lines) - Modal management ✅
├── useTaskOperations.ts         (exists) - Task CRUD operations ✅
├── useFilterState.ts            (exists) - Filter management ✅
└── use-sse-subscription.ts      (exists) - SSE events ✅
```

**Issue:** The controller duplicates state that exists in the layout/modal hooks.
TaskManager.tsx uses both separately but they're not integrated.

**Next Steps:**
1. Remove duplicate state from controller
2. Pass layout/modal hooks through to controller
3. Extract drag-and-drop state to separate hook

### Split Large Components

**task-detail.tsx (1,514 lines) →**
```
components/task-detail/
├── TaskDetail.tsx           (200 lines) - Main container
├── TaskHeader.tsx           (150 lines) - Title, status
├── TaskBody.tsx             (150 lines) - Description, fields
├── TaskActions.tsx          (100 lines) - Action buttons
├── TaskFieldEditors.tsx     (exists)
└── CommentSection.tsx       (exists, could split further)
```

---

## Phased Implementation Plan

### Phase 1: Quick Wins (Low Risk)

**Week 1: Eliminate Obvious Duplication**

1. **Merge CRUD viewers**
   ```tsx
   // Before: 2 files, 2,292 lines total
   <MCPCRUDViewer />
   <APICRUDViewer />

   // After: 1 file, ~1,200 lines
   <CRUDViewer mode="mcp" />
   <CRUDViewer mode="api" />
   ```

2. **Extract AI Client Classes**
   - Move `callClaude`, `callOpenAI`, `callGemini` to separate files
   - No behavior change, just file reorganization

### Phase 2: Service Layer (Medium Risk)

**Week 2-3: Create Task Service**

1. Create `services/implementations/task.service.ts`
2. Move business logic from `app/api/tasks/[id]/route.ts`
3. Keep API route as thin wrapper

```typescript
// Before: 1,342 lines in API route
export async function PUT(request: NextRequest) {
  // 200+ lines of business logic
}

// After: API route ~50 lines
export async function PUT(request: NextRequest) {
  const session = await getServerSession(authConfig)
  if (!session) return unauthorized()

  const taskService = getTaskService()
  const result = await taskService.updateTask(taskId, body, session.user.id)
  return NextResponse.json(result)
}
```

### Phase 3: Hook Decomposition (Medium Risk)

**Week 3-4: Split useTaskManagerController**

1. Extract `useTaskState` - Core task data
2. Extract `useListState` - List data and selection
3. Extract `useTaskFiltering` - Filter logic
4. Keep controller as coordinator

### Phase 4: Component Splitting (Low Risk)

**Week 4-5: Split Large Components**

1. Split `task-detail.tsx` into sub-components
2. Split `MainContent.tsx` into focused components
3. Use composition pattern

---

## File Size Guidelines

After refactoring, enforce:

| File Type | Max Lines | Rationale |
|-----------|-----------|-----------|
| Components | 400 | AI can understand in one context |
| Hooks | 300 | Focused responsibility |
| Services | 500 | Business logic boundary |
| API Routes | 150 | Thin wrapper only |
| Utilities | 200 | Single purpose |

---

## Priority Order

1. **High Priority (Blocks AI Agents)**
   - [x] ~~Merge duplicate CRUD viewers~~ → Deleted as dead code
   - [x] Extract AI clients to lib/ai/clients/ → OpenAI, Gemini, and Claude done
   - [x] Remove duplicate state from controller → 2833 → 2775 lines
   - [x] Extract Claude client with tool loop → 418 lines in claude.ts

2. **Medium Priority (Improves Maintainability)**
   - [ ] Create Task Service
   - [ ] Create List Service
   - [ ] Split `task-detail.tsx`

3. **Lower Priority (Nice to Have)**
   - [ ] Split `MainContent.tsx`
   - [ ] Consolidate API utilities
   - [ ] Add repository layer

---

## Risk Mitigation

### Testing Strategy

1. **Before splitting:** Ensure test coverage exists
2. **During refactoring:** Keep behavior identical
3. **After splitting:** Run full test suite

**Current Status:** 3,820 tests pass (`npm run predeploy` on `main`, 2026-08-13). The
1,369 figure this line used to carry was the 2024-11-27 count.

### Rollback Plan

- Create feature branch for each phase
- Merge only after CI passes
- Keep old code paths initially (feature flag)

---

## Metrics for Success

| Metric | Original | Current | Target |
|--------|----------|---------|--------|
| Max file size | 3,459 lines | 2,905 lines | <500 lines |
| Files >1000 lines | 8 | 6 | 0 |
| Duplicated code | ~2,300 lines | 0 | 0 |
| Dead code removed | 0 | 13,960+ lines | - |
| Service layer files | 4 | 8 | 10+ |

---

## Completed Changes

### 2024-11-27: AI Prompt Templates Extraction

**Created lib/ai/prompts.ts (217 lines):**

- `PLANNING_CORE_INSTRUCTIONS`, `IMPLEMENTATION_CORE_INSTRUCTIONS` - Core AI instructions
- `PLANNING_MODE_INSTRUCTIONS`, `IMPLEMENTATION_MODE_INSTRUCTIONS` - Mode-specific instructions
- `buildMinimalPlanningPrompt()` - Planning prompt builder
- `formatRepositoryGuidelines()` - Repository guidelines formatter
- Various prompt rule constants

**ai-orchestrator.ts reduction:** 2,998 → 2,905 lines (-93 lines)

### 2024-11-27: Task Query Utilities Extraction

**Created lib/task-query-utils.ts (80 lines):**

- `TASK_FULL_INCLUDE` - Standard Prisma include for full task with relations
- `LIST_WITH_MEMBERS_INCLUDE` - List include with member information
- `COMMENT_WITH_REPLIES_INCLUDE` - Comment include with replies
- TypeScript types for query results

**app/api/tasks/[id]/route.ts reduction:** 1,342 → 1,237 lines (-105 lines)

### 2024-11-27: File Path Utilities Extraction

**Extracted file path utilities to lib/ai/file-path-utils.ts (136 lines):**

- `generateFilePathVariations()` - Generates path variations for file lookups
- `kebabToCamel()` - Converts kebab-case to camelCase
- `kebabToPascal()` - Converts kebab-case to PascalCase
- Updated `lib/ai/index.ts` to export utilities

**ai-orchestrator.ts reduction:** 3,114 → 2,998 lines (-116 lines)

### 2024-11-27: Claude Client Extraction

**Extracted Claude API client to lib/ai/clients/claude.ts (418 lines):**

The Claude client with tool use loop was extracted from ai-orchestrator.ts:
- `lib/ai/clients/claude.ts` - Full Claude API client with:
  - Tool use loop (up to 12 iterations)
  - Rate limiting integration with WorkflowQueue
  - Context pruning to stay within token limits
  - Prompt caching support
- Updated `lib/ai/clients/index.ts` to export Claude client
- Simplified `callClaude` method in orchestrator (320 → 65 lines)

**ai-orchestrator.ts reduction:** 3,370 → 3,114 lines (-256 lines)

### 2024-11-27: AI Module Extraction

1. **Created lib/ai/ directory structure:**
   - `lib/ai/index.ts` - Centralized exports
   - `lib/ai/agent-config.ts` - AI agent routing (moved from lib/)
   - `lib/ai/types.ts` - Shared type definitions
   - `lib/ai/clients/` - AI provider clients

2. **Extracted AI Clients:**
   - `lib/ai/clients/openai.ts` - OpenAI API client (82 lines)
   - `lib/ai/clients/gemini.ts` - Gemini API client (83 lines)
   - `lib/ai/clients/claude.ts` - Claude API client (418 lines)
   - Updated `lib/ai-orchestrator.ts` to use extracted clients

3. **Deleted Dead Code (7,524 lines):**
   - `components/mcp-crud-viewer.tsx`
   - `components/api-crud-viewer.tsx`
   - `components/mcp-token-manager.tsx`
   - `components/mcp-token-manager-v2.tsx`
   - `components/mcp-token-manager-user.tsx`
   - `components/mcp-list-settings-modal.tsx`
   - `hooks/useMCPController.ts`
   - `tests/mcp/` directory (7 test files)

4. **Deleted Legacy MCP V1 Server (798 lines):**
   - `mcp/mcp-server.ts` (738 lines) - superseded by OAuth server
   - `mcp/build-mcp.js` (60 lines) - build script for V1
   - Updated `package.json` - removed `build:mcp` script
   - Updated `tsconfig.json` - removed V1 exclusions
   - Updated `mcp/README.md` - removed V1 documentation

### useTaskManagerController Cleanup

**Removed duplicate modal state (15 lines):**
- `showPublicBrowser`, `setShowPublicBrowser` - used from modals hook
- `editingListName`, `setEditingListName` - used from modals hook
- `tempListName`, `setTempListName` - used from modals hook
- `editingListDescription`, `setEditingListDescription` - used from modals hook
- `tempListDescription`, `setTempListDescription` - used from modals hook

**Kept with TODO (architectural debt):**
- `showAddListModal` - Used by handleCreateList to close modal after creation
  - BUG: Controller and modals hook have separate state, not synchronized
  - Modals hook opens the modal, controller closes it - state mismatch

**Removed from useTaskManagerLayout (14 lines):**
- `isTaskPaneClosing`, `taskPanePosition`, `selectedTaskElement`, `selectedTaskRect`
- These duplicated controller state that was actually being used

**Removed deprecated functions from layout-detection.ts (25 lines):**
- `isLegacyMobile()`, `isLegacyNarrowDesktop()`, `isLegacyDesktopWide()`

**Controller line count:** 2848 → 2833 lines

### 2024-11-27: Additional Controller Cleanup

**Removed more duplicate state from useTaskManagerController (58 lines total):**

State variables removed (managed by useTaskManagerModals):
- `showSettingsPopover`, `setShowSettingsPopover`
- `showLeaveListMenu`, `setShowLeaveListMenu`
- `quickTaskInput`, `setQuickTaskInput`

State variables removed (managed by useTaskManagerLayout):
- `showHamburgerMenu`, `setShowHamburgerMenu`
- `justReturnedFromTaskDetail`, `setJustReturnedFromTaskDetail`

Removed dead useEffects:
- Close popovers when list changes (logic now in TaskManager.tsx)
- Close task detail when opening popovers (logic now in TaskManager.tsx)

Removed dead handlers:
- `handleQuickTaskKeyDown` - recreated in TaskManager.tsx using modals state
- `handleAddTaskButtonClick` - recreated in TaskManager.tsx using modals state

**Controller line count:** 2833 → 2775 lines

### 2024-11-27: Delete Deprecated AI Tools Agent

**Deleted deprecated code (1,908 lines):**
- `lib/ai-tools-agent.ts` (1,872 lines) - Deprecated, replaced by AIOrchestrator
- `app/api/test-tools-workflow/route.ts` (36 lines) - Test route marked for deletion

The `ai-tools-agent.ts` was marked as deprecated in the AI_AGENT_CONSOLIDATION_ANALYSIS.md
(January 11, 2025). All workflows now use AIOrchestrator directly.

### 2024-11-27: Delete Unused Hooks

**Deleted hooks only used in tests (2,651 lines total):**

Hooks deleted:
- `hooks/useUIState.ts` (177 lines) - Legacy hook replaced by controller/layout/modals
- `hooks/useDataManager.ts` (587 lines) - Never used in production
- `hooks/useListOperations.ts` (239 lines) - Never imported
- `hooks/useSound.ts` (137 lines) - Sound effects never implemented
- `hooks/useDebounce.ts` (196 lines) - Never imported
- `hooks/useLocalStorage.ts` (157 lines) - Only used in tests
- `hooks/useSecureFileUpload.ts` (172 lines) - Only referenced in docs
- `hooks/use-tasks.ts` (183 lines) - Never imported
- `hooks/use-lists.ts` (52 lines) - Never imported

Test files deleted:
- `tests/hooks/useUIState.test.ts` (208 lines)
- `tests/hooks/useDataManager.test.ts` (171 lines)
- `tests/hooks/useSound.test.ts` (208 lines)
- `tests/hooks/useLocalStorage-immediate-updates.test.ts` (216 lines)
- Removed useListOperations tests from `operation-loading-states.test.ts` (39 lines)

**Test suite:** 1,369 → 1,322 tests (47 tests removed with dead code)
**Test files:** 116 → 112 files

### 2024-11-27: Additional Dead Code Removal

**Deleted unused files (458 lines):**
- `components/TaskManagerView.native.example.tsx` (339 lines) - Example/doc code never imported
- `lib/db.ts` (17 lines) - Raw SQL client, Prisma is used instead
- `lib/sync-timestamps.ts` (102 lines) - Never imported

**Cumulative dead code removed:** 13,960+ lines

---

## Next Steps

1. **Continue Claude client extraction** - Most complex due to tool loop
2. **Split large components** - task-detail.tsx, MainContent.tsx
3. **Create service layer** - Extract business logic from API routes

---

*This proposal is a living document. Update as refactoring progresses.*
