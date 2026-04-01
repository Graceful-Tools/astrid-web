# Tools-Based AI Coding Architecture

**Status**: ✅ Implemented (2024-10-04)

## 🎯 Overview

The tools-based AI architecture gives Claude **direct access to coding tools** instead of orchestrating AI calls. This approach is more reliable, transparent, and aligns with how Claude Code works locally.

## 🔧 Architecture Comparison

### ❌ Old: Orchestrator-Based (Deprecated)
```
User → Astrid → AIOrchestrator → Claude API → Parse Response → GitHub/Vercel
                                   ↑______________|
                            (Nested AI calls, complex flow)
```

**Problems:**
- AIOrchestrator calls Claude, creating nested AI interactions
- Complex orchestration: planning → approval → implementation
- Prone to failures in orchestration chain
- Not leveraging Claude's native tool use capabilities

### ✅ New: Tools-Based (Current)
```
User → Astrid → Claude (with tools) ⟷ GitHub/Vercel/Task APIs
                        ↑
                    Direct tool access via MCP
```

**Benefits:**
- Claude has **direct access** to all tools via MCP operations
- Uses Claude's native tool use (function calling)
- Simpler, more reliable workflow
- Agent can autonomously debug deployment issues
- Follows established patterns from Claude Code

## 📋 Available Tools

### 1. GitHub Repository Tools (via MCP)

#### Read Operations
- **`get_repository_file`** - Read file contents
  ```typescript
  { path: "src/index.ts", ref?: "main" }
  ```

- **`list_repository_files`** - Browse directory structure
  ```typescript
  { path: "src/", ref?: "main" }
  ```

- **`get_repository_info`** - Get repository metadata
  ```typescript
  { repository: "owner/repo" }
  ```

#### Write Operations
- **`create_branch`** - Create new branch
  ```typescript
  { baseBranch: "main", newBranch: "fix/issue-123" }
  ```

- **`commit_changes`** - Commit file changes
  ```typescript
  {
    branch: "fix/issue-123",
    changes: [
      { path: "file.ts", content: "...", mode: "create" }
    ],
    commitMessage: "fix: resolve issue"
  }
  ```

- **`create_pull_request`** - Create PR
  ```typescript
  {
    headBranch: "fix/issue-123",
    baseBranch: "main",
    title: "Fix issue",
    body: "## Changes\n..."
  }
  ```

- **`merge_pull_request`** - Merge approved PR
  ```typescript
  { prNumber: 123, mergeMethod: "squash" }
  ```

### 2. Vercel Deployment Tools (NEW! via MCP)

#### Deployment Operations
- **`deploy_to_staging`** - Deploy branch to Vercel
  ```typescript
  { branch: "fix/issue-123", commitSha?: "abc123" }
  ```

- **`get_deployment_status`** - Check deployment state
  ```typescript
  { deploymentId: "dpl_abc123" }
  ```

#### Debugging Tools (CRITICAL for autonomous fixes)
- **`get_deployment_logs`** - Get build logs
  ```typescript
  { deploymentId: "dpl_abc123" }
  ```

- **`get_deployment_errors`** - Get error details
  ```typescript
  { deploymentId: "dpl_abc123" }
  ```

- **`list_deployments`** - List recent deployments
  ```typescript
  { repository: "owner/repo", limit: 10 }
  ```

### 3. Task Management Tools (via MCP)

- **`add_task_comment`** - Post updates
  ```typescript
  { content: "## Progress Update\n..." }
  ```

- **`update_task_status`** - Update task
  ```typescript
  { isCompleted: true }
  ```

## 🔄 Workflow Example

### Autonomous Workflow with Tools

1. **User assigns task to coding agent**

2. **Astrid triggers tools-based workflow**:
   ```typescript
   POST /api/coding-workflow/start-tools-workflow
   {
     taskId: "task-123",
     repository: "owner/repo"
   }
   ```

3. **Claude receives task with tools**:
   ```typescript
   // System prompt
   "You are an expert developer with autonomous coding capabilities.

   ## Tools Available:
   - get_repository_file - Read code
   - create_branch - Create branch
   - commit_changes - Commit code
   - deploy_to_staging - Deploy to Vercel
   - get_deployment_logs - Debug deployment
   - add_task_comment - Update user

   ## Task:
   Fix the search button not clearing search value

   Repository: owner/repo

   Begin implementation now."
   ```

4. **Claude autonomously**:
   - Calls `get_repository_file` to read relevant code
   - Calls `list_repository_files` to explore structure
   - Calls `create_branch` to create feature branch
   - Calls `commit_changes` to fix the issue
   - Calls `create_pull_request` to create PR
   - Calls `deploy_to_staging` to deploy
   - Calls `get_deployment_status` to check deployment
   - If deployment fails:
     - Calls `get_deployment_logs` to read error logs
     - Analyzes the error
     - Fixes the issue with `commit_changes`
     - Redeploys with `deploy_to_staging`
   - Calls `add_task_comment` to post staging URL
   - Waits for user approval

5. **User approves** → Claude calls `merge_pull_request`

## 🚀 Implementation Files

### Core Implementation
- **`lib/ai-tools-agent.ts`** - Tools-based agent with Claude API integration
  - `CODING_TOOLS` - Complete tool definitions for Claude
  - `executeTool()` - Tool execution via MCP
  - `runClaudeWithTools()` - Main workflow loop

- **`app/api/coding-workflow/start-tools-workflow/route.ts`** - Workflow trigger endpoint

### MCP Operations (Enhanced)
- **`app/api/mcp/operations/route.ts`** - MCP operations dispatcher
  - GitHub operations (existing)
  - **NEW: Vercel deployment operations**
    - `deploy_to_staging`
    - `get_deployment_status`
    - `get_deployment_logs`
    - `get_deployment_errors`
    - `list_deployments`

- **`lib/vercel-client.ts`** - Vercel API client
  - **NEW: Log reading methods**
    - `getDeploymentLogs()` - Build logs
    - `getRuntimeLogs()` - Runtime logs
    - `getDeploymentErrors()` - Error extraction
    - `listDeployments()` - Deployment history

### Integration
- **`hooks/use-coding-assignment-detector.ts`** - Assignment detection
  - Updated to use tools-based workflow instead of orchestrator

## 🔍 Key Differences from Orchestrator

| Aspect | Old (Orchestrator) | New (Tools-Based) |
|--------|-------------------|-------------------|
| **AI Calls** | Nested (Astrid calls Claude to call Claude) | Direct (Claude has tools) |
| **Tool Access** | Indirect via orchestrator | Direct via MCP |
| **Debugging** | Limited, no log access | Full: reads Vercel logs, debugs errors |
| **Autonomy** | Requires orchestration flow | Fully autonomous with tools |
| **Reliability** | Prone to orchestration failures | Simpler, more reliable |
| **Transparency** | Hidden in orchestrator | All tool calls visible |

## 🛠️ Setup Requirements

### For Users (Cloud Workflow)
As documented in `/settings/coding-integration`:

1. **AI API Key** (Claude or OpenAI) - Required
2. **GitHub Integration** - Connect GitHub account
3. **MCP Token** - Created automatically or via Settings → MCP Access
4. **Repository Configuration** - Set in List Settings

### For Development (Local Workflow)
As documented in `CLAUDE.md`:

1. **OAuth Credentials** - Add to `.env.local`:
   ```bash
   ASTRID_OAUTH_CLIENT_ID=your_client_id
   ASTRID_OAUTH_CLIENT_SECRET=your_client_secret
   ASTRID_OAUTH_LIST_ID=your_list_id
   ```

2. **Task Script** - Create `scripts/get-project-tasks.ts`

3. **Claude Code** - Add to `CLAUDE.md`:
   ```markdown
   ## Trigger: "let's fix stuff"
   When user says "let's fix stuff", IMMEDIATELY run:
   ```bash
   npx tsx scripts/get-project-tasks.ts
   ```

## 🎯 Benefits Summary

### 1. **Reliability**
- Simpler architecture = fewer failure points
- No nested AI calls that can fail
- Direct MCP access reduces latency

### 2. **Autonomy**
- Claude can read deployment logs
- Can debug and fix deployment issues
- Can retry deployments autonomously
- No human intervention needed for common issues

### 3. **Transparency**
- All tool calls are logged
- User can see exactly what Claude is doing
- Easy to debug if issues occur

### 4. **Extensibility**
- Easy to add new tools (just add to `CODING_TOOLS`)
- Each tool is a simple MCP operation
- No orchestrator complexity to update

### 5. **Consistency**
- Same tools work in cloud (Astrid) and local (Claude Code)
- Unified workflow across environments
- Follows established patterns

## 📊 Testing

### Manual Testing
1. Assign task to "Astrid Agent" (Claude) or "OpenAI Agent"
2. Verify tools-based workflow starts:
   ```
   ✅ Tools Workflow] Starting for task: task-123
   ✅ Tools Workflow] Starting Claude with tools...
   ```
3. Monitor Claude's tool usage in logs
4. Verify Claude can:
   - Read repository files
   - Create branches
   - Commit changes
   - Deploy to staging
   - Read deployment logs (if deploy fails)
   - Fix issues autonomously
   - Post updates to task

### Example Log Output
```
🤖 [AI Tools Agent] Iteration 1/20
🔧 [AI Tools Agent] Executing tool: get_repository_file
✅ [AI Tools Agent] Tool result: { success: true, content: "..." }

🤖 [AI Tools Agent] Iteration 2/20
🔧 [AI Tools Agent] Executing tool: create_branch
✅ [AI Tools Agent] Tool result: { success: true, branch: "fix/..." }

🤖 [AI Tools Agent] Iteration 3/20
🔧 [AI Tools Agent] Executing tool: commit_changes
✅ [AI Tools Agent] Tool result: { success: true, sha: "..." }

🤖 [AI Tools Agent] Iteration 4/20
🔧 [AI Tools Agent] Executing tool: deploy_to_staging
✅ [AI Tools Agent] Tool result: { deploymentId: "dpl_..." }

🤖 [AI Tools Agent] Iteration 5/20
🔧 [AI Tools Agent] Executing tool: get_deployment_status
✅ [AI Tools Agent] Tool result: { state: "READY", url: "..." }

✅ [AI Tools Agent] Workflow complete
```

## 🚨 Migration from Orchestrator

### What Changed
1. **Entry Point**: Now uses `/api/coding-workflow/start-tools-workflow` instead of `/api/coding-workflow/start-ai-orchestration`

2. **Agent Logic**: Now in `lib/ai-tools-agent.ts` instead of `lib/ai-orchestrator.ts`

3. **Tool Access**: Direct MCP operations instead of orchestrator methods

### What Stayed the Same
1. **User Experience**: Still assign to coding agent
2. **Workflow Phases**: Still follows Phase 1 (Analysis) → Phase 2 (Implementation) → Phase 3 (Review)
3. **MCP Operations**: Same operations, just accessed differently
4. **GitHub Integration**: No changes to GitHub setup

### Deprecated Files (kept for reference)
- `lib/ai-orchestrator.ts` - Old orchestrator-based approach
- `app/api/coding-workflow/start-ai-orchestration/route.ts` - Old workflow trigger

## 🔮 Future Enhancements

### Planned Tools
- [ ] **Run Tests** - Execute test suite in CI
  ```typescript
  { testCommand: "npm test", branch: "fix/..." }
  ```

- [ ] **Check Code Quality** - Run linting/type checking
  ```typescript
  { checks: ["lint", "typecheck"], branch: "fix/..." }
  ```

- [ ] **Read CI Logs** - Get GitHub Actions logs
  ```typescript
  { workflowRunId: 123 }
  ```

- [ ] **Database Operations** - Run migrations safely
  ```typescript
  { migration: "add_column", environment: "staging" }
  ```

### Potential AI Providers
- ✅ Claude (current)
- ✅ OpenAI (supported)
- [ ] Gemini (planned)
- [ ] Local LLMs (planned)

## 📚 Related Documentation

- **[Architecture Overview](./ARCHITECTURE.md)** - System design
- **[Coding Integration Setup](../app/settings/coding-integration/page.tsx)** - User setup guide
- **[CLAUDE.md](../CLAUDE.md)** - Development workflow
- **[MCP Operations](../app/api/mcp/operations/route.ts)** - Available MCP tools
- **[GitHub Client](../lib/github-client.ts)** - GitHub API implementation
- **[Vercel Client](../lib/vercel-client.ts)** - Vercel API implementation

---

**Last Updated**: 2024-10-04
**Status**: ✅ Production Ready
**Owner**: AI Coding Workflow Team
