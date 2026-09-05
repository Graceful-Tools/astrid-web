# GitHub Repository Configuration for AI Agents

This guide explains how to configure GitHub repositories for AI agent integration in Astrid task lists.

## Overview

For the AI coding agent to create branches and pull requests, each list with AI agents enabled **must have a GitHub repository configured**. Without this configuration, the agent cannot determine where to push code changes.

## Prerequisites

- ✅ GitHub App installed and connected (see [setup-checklist.md](./setup-checklist.md))
- ✅ User has GitHub integration connected
- ✅ AI agents enabled on the task list

## How to Configure Repository in List Settings

### Step 1: Open List Settings

1. Navigate to your task list (e.g., "Astrid Bugs & Polish")
2. Click the list settings icon (⚙️) or "List Settings" button
3. Go to the "AI Agents" or "GitHub Integration" section

### Step 2: Select Target Repository

1. In the **GitHub Repository** dropdown, select the repository where the AI agent should create branches and PRs
2. Common choices:
   - `astrid-res/www` - Main Astrid web application
   - `jonparis/astrid-res-www` - Personal fork
   - Or any other repository you want the agent to modify

### Step 3: Save Configuration

1. Click "Save" or "Update List Settings"
2. Verify the repository is saved by checking the list settings again

## Verification

You can verify your configuration using the provided script:

```bash
npx tsx scripts/check-repo-connections.ts
```

This will show:
- ✅ Lists with AI agents enabled
- ✅ GitHub repository configured for each list
- ✅ Available repositories from your GitHub integration
- ⚠️  Lists missing repository configuration

## Example Output

```
List: "Astrid Bugs & Polish" (ID: abc123...)
  Owner: Jon Paris (jonparis@gmail.com)
  GitHub Repository: astrid-res/www ✅
  AI Agents Enabled: ✅
  GitHub Integration:
    Installation ID: 86901706
    Available Repositories: 22
      - astrid-res/www ✅ (CONFIGURED IN LIST)
      - jonparis/config
      - jonparis/quote_vote
```

## How It Works

When a task is assigned to the AI agent:

1. **GitHub Actions Workflow** triggers (`astrid-coding-agent.yml`)
2. Workflow calls `/api/coding-agent/github-trigger` with task ID
3. API route validates authentication and loads task
4. **AI Orchestrator** reads the list's `githubRepositoryId` field
5. Agent creates a new branch in the configured repository
6. Agent commits code changes to the branch
7. Agent creates a pull request with the implementation

## Architecture Flow

```
Task Assignment
    ↓
GitHub Actions Workflow
    ↓
POST /api/coding-agent/github-trigger
    ↓
AI Orchestrator.createForTask()
    ↓
Finds first list with githubRepositoryId configured
    ↓
GitHubClient.forUser() → Creates branch/PR in configured repo
```

## Troubleshooting

### ❌ "No GitHub repository configured for AI agent"

**Problem**: The list doesn't have a repository configured.

**Solution**:
1. Go to List Settings
2. Select a repository from the dropdown
3. Save changes

### ❌ "GitHub integration not found"

**Problem**: User doesn't have GitHub App installed.

**Solution**:
1. Go to Settings → AI Agents → GitHub Integration
2. Click "Connect GitHub App"
3. Install the GitHub App on your repositories

### ⚠️  "Repository not accessible"

**Problem**: The configured repository is not in the user's GitHub integration.

**Solution**:
1. Verify the repository name is correct (format: `owner/repo`)
2. Check that the GitHub App has access to this repository
3. Re-install the GitHub App if needed

## Database Schema Reference

### TaskList Model

```prisma
model TaskList {
  id                  String   @id @default(cuid())
  name                String
  githubRepositoryId  String?  // Format: "owner/repo-name"
  aiAgentsEnabled     Json?    @default("[]") // Array of enabled agent types
  owner               User     @relation(fields: [ownerId], references: [id])
  // ... other fields
}
```

### GitHubIntegration Model

```prisma
model GitHubIntegration {
  id              String   @id @default(cuid())
  userId          String   @unique
  installationId  Int
  repositories    Json     // Array of repository objects
  user            User     @relation(fields: [userId], references: [id])
  // ... other fields
}
```

## API References

- **GitHub Trigger**: `POST /api/coding-agent/github-trigger`
- **Workflow Status**: `GET /api/coding-workflow/status/:taskId`
- **Repository Validation**: See `lib/ai-orchestrator.ts:1025` (`resolveTargetRepository`)

## Related Documentation

- [GitHub Coding Agent Implementation](./GITHUB_CODING_AGENT_IMPLEMENTATION.md)
- [Setup Checklist](./setup-checklist.md)
- [Troubleshooting Guide](./troubleshooting.md)

## Quick Configuration Script

To quickly check and identify lists that need repository configuration:

```bash
# Check all lists with AI agents
npx tsx scripts/check-repo-connections.ts

# Look for lists marked with:
# ❌ NOT CONFIGURED

# Then configure those lists via the UI
```

---

**Last Updated**: 2024-09-30
**Maintained By**: Astrid Development Team
