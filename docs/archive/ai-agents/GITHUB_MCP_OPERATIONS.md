# GitHub MCP Operations Guide

Complete reference for GitHub repository operations available through the Astrid MCP (Model Context Protocol) server.

## Overview

The Astrid MCP server now exposes **8 comprehensive GitHub operations** that enable AI agents to interact with GitHub repositories, create branches, commit code, create pull requests, and more.

### Available Operations

1. ✅ **get_repository_file** - Read file contents from a repository
2. ✅ **list_repository_files** - List files in a directory
3. ✅ **create_branch** - Create a new branch from a base branch
4. ✅ **commit_changes** - Commit file changes to a branch
5. ✅ **create_pull_request** - Create a pull request
6. ✅ **merge_pull_request** - Merge a pull request
7. ✅ **add_pull_request_comment** - Add comments to pull requests
8. ✅ **get_repository_info** - Get repository metadata

## Prerequisites

Before using GitHub MCP operations, ensure:

1. **GitHub App Integration** - GitHub App must be installed and configured
2. **MCP Access Token** - Valid MCP token with appropriate permissions
3. **Repository Access** - User must have access to the target repository via GitHub App installation

## Operation Details

### 1. get_repository_file

Read the contents of a file from a GitHub repository.

**Parameters:**
```json
{
  "accessToken": "mcp_token_...",
  "repository": "owner/repo",
  "path": "README.md",
  "ref": "main" // optional, defaults to default branch
}
```

**Response:**
```json
{
  "success": true,
  "repository": "owner/repo",
  "path": "README.md",
  "content": "# Repository Title\n\nContent here...",
  "ref": "main"
}
```

**Example Usage:**
```javascript
// Read README.md from main branch
{
  "operation": "get_repository_file",
  "args": {
    "accessToken": "mcp_token_abc123",
    "repository": "myorg/myrepo",
    "path": "README.md"
  }
}

// Read specific file from a branch
{
  "operation": "get_repository_file",
  "args": {
    "accessToken": "mcp_token_abc123",
    "repository": "myorg/myrepo",
    "path": "src/components/Header.tsx",
    "ref": "feature-branch"
  }
}
```

### 2. list_repository_files

List all files and directories in a specific directory.

**Parameters:**
```json
{
  "accessToken": "mcp_token_...",
  "repository": "owner/repo",
  "path": "src/",  // optional, defaults to root
  "ref": "main"    // optional
}
```

**Response:**
```json
{
  "success": true,
  "repository": "owner/repo",
  "path": "src/",
  "files": [
    {
      "name": "index.ts",
      "path": "src/index.ts",
      "type": "file",
      "size": 1024
    },
    {
      "name": "components",
      "path": "src/components",
      "type": "dir",
      "size": 0
    }
  ],
  "ref": "main"
}
```

**Example Usage:**
```javascript
// List files in root directory
{
  "operation": "list_repository_files",
  "args": {
    "accessToken": "mcp_token_abc123",
    "repository": "myorg/myrepo"
  }
}

// List files in specific directory
{
  "operation": "list_repository_files",
  "args": {
    "accessToken": "mcp_token_abc123",
    "repository": "myorg/myrepo",
    "path": "src/components"
  }
}
```

### 3. create_branch

Create a new branch from a base branch.

**Parameters:**
```json
{
  "accessToken": "mcp_token_...",
  "repository": "owner/repo",
  "baseBranch": "main",
  "newBranch": "feature/new-feature"
}
```

**Response:**
```json
{
  "success": true,
  "repository": "owner/repo",
  "baseBranch": "main",
  "newBranch": "feature/new-feature",
  "message": "Branch feature/new-feature created successfully from main"
}
```

**Example Usage:**
```javascript
{
  "operation": "create_branch",
  "args": {
    "accessToken": "mcp_token_abc123",
    "repository": "myorg/myrepo",
    "baseBranch": "main",
    "newBranch": "feature/add-dark-mode"
  }
}
```

### 4. commit_changes

Commit one or more file changes to a branch.

**Parameters:**
```json
{
  "accessToken": "mcp_token_...",
  "repository": "owner/repo",
  "branch": "feature/new-feature",
  "changes": [
    {
      "path": "src/index.ts",
      "content": "console.log('Hello World');",
      "mode": "update"
    },
    {
      "path": "src/new-file.ts",
      "content": "export const foo = 'bar';",
      "mode": "create"
    }
  ],
  "commitMessage": "Add new feature implementation"
}
```

**Response:**
```json
{
  "success": true,
  "repository": "owner/repo",
  "branch": "feature/new-feature",
  "commitSha": "abc123def456",
  "commitUrl": "https://api.github.com/repos/owner/repo/git/commits/abc123",
  "message": "Committed 2 file(s) to feature/new-feature"
}
```

**Example Usage:**
```javascript
{
  "operation": "commit_changes",
  "args": {
    "accessToken": "mcp_token_abc123",
    "repository": "myorg/myrepo",
    "branch": "feature/add-dark-mode",
    "changes": [
      {
        "path": "src/styles/theme.css",
        "content": ".dark-mode { background: #1a1a1a; color: #fff; }",
        "mode": "create"
      },
      {
        "path": "src/components/ThemeToggle.tsx",
        "content": "import React from 'react';\n\nexport const ThemeToggle = () => { /* ... */ };",
        "mode": "create"
      }
    ],
    "commitMessage": "feat: implement dark mode toggle component"
  }
}
```

### 5. create_pull_request

Create a pull request from a head branch to a base branch.

**Parameters:**
```json
{
  "accessToken": "mcp_token_...",
  "repository": "owner/repo",
  "headBranch": "feature/new-feature",
  "baseBranch": "main",
  "title": "Add new feature",
  "body": "## Summary\n\nThis PR adds the new feature...\n\n## Changes\n- Added feature X\n- Updated component Y"
}
```

**Response:**
```json
{
  "success": true,
  "repository": "owner/repo",
  "pullRequest": {
    "number": 42,
    "url": "https://github.com/owner/repo/pull/42",
    "title": "Add new feature",
    "headBranch": "feature/new-feature",
    "baseBranch": "main"
  },
  "message": "Pull request #42 created successfully"
}
```

**Example Usage:**
```javascript
{
  "operation": "create_pull_request",
  "args": {
    "accessToken": "mcp_token_abc123",
    "repository": "myorg/myrepo",
    "headBranch": "feature/add-dark-mode",
    "baseBranch": "main",
    "title": "feat: Add dark mode support",
    "body": "## Summary\n\nImplements dark mode toggle with theme persistence.\n\n## Changes\n- Added ThemeToggle component\n- Created dark mode CSS styles\n- Added theme context provider\n\n## Testing\n- [x] Manual testing completed\n- [x] Dark mode persists across page reloads"
  }
}
```

### 6. merge_pull_request

Merge a pull request using a specified merge method.

**Parameters:**
```json
{
  "accessToken": "mcp_token_...",
  "repository": "owner/repo",
  "prNumber": 42,
  "mergeMethod": "squash"  // "merge", "squash", or "rebase"
}
```

**Response:**
```json
{
  "success": true,
  "repository": "owner/repo",
  "prNumber": 42,
  "mergeMethod": "squash",
  "message": "Pull request #42 merged successfully using squash method"
}
```

**Example Usage:**
```javascript
{
  "operation": "merge_pull_request",
  "args": {
    "accessToken": "mcp_token_abc123",
    "repository": "myorg/myrepo",
    "prNumber": 42,
    "mergeMethod": "squash"
  }
}
```

### 7. add_pull_request_comment

Add a comment to a pull request.

**Parameters:**
```json
{
  "accessToken": "mcp_token_...",
  "repository": "owner/repo",
  "prNumber": 42,
  "comment": "Great work! This looks ready to merge."
}
```

**Response:**
```json
{
  "success": true,
  "repository": "owner/repo",
  "prNumber": 42,
  "message": "Comment added to pull request #42 successfully"
}
```

**Example Usage:**
```javascript
{
  "operation": "add_pull_request_comment",
  "args": {
    "accessToken": "mcp_token_abc123",
    "repository": "myorg/myrepo",
    "prNumber": 42,
    "comment": "✅ Code review complete. Looks good to merge!"
  }
}
```

### 8. get_repository_info

Get repository information including default branch, visibility, etc.

**Parameters:**
```json
{
  "accessToken": "mcp_token_...",
  "repository": "owner/repo"
}
```

**Response:**
```json
{
  "success": true,
  "repository": {
    "id": 123456,
    "name": "repo",
    "fullName": "owner/repo",
    "defaultBranch": "main",
    "private": false,
    "url": "https://github.com/owner/repo",
    "cloneUrl": "https://github.com/owner/repo.git"
  }
}
```

**Example Usage:**
```javascript
{
  "operation": "get_repository_info",
  "args": {
    "accessToken": "mcp_token_abc123",
    "repository": "myorg/myrepo"
  }
}
```

## Error Handling

All GitHub MCP operations return consistent error responses:

```json
{
  "error": "Error description",
  "success": false
}
```

### Common Errors

1. **GitHub Integration Not Configured**
   ```json
   {
     "error": "GitHub integration not configured. Please connect your GitHub account in Settings → Coding Integration."
   }
   ```

2. **Invalid Access Token**
   ```json
   {
     "error": "MCP_TOKEN_INVALID: No valid MCP access token found. Please create an MCP access token in Settings → AI Agent Access first."
   }
   ```

3. **File Not Found**
   ```json
   {
     "error": "File path/to/file.ts not found in owner/repo"
   }
   ```

4. **Branch Already Exists**
   ```json
   {
     "error": "Branch feature/new-feature already exists in owner/repo"
   }
   ```

## Complete Workflow Example

Here's a complete example of using GitHub MCP operations to implement a feature:

```javascript
// 1. Get repository info to check default branch
{
  "operation": "get_repository_info",
  "args": {
    "accessToken": "mcp_token_abc123",
    "repository": "myorg/myrepo"
  }
}

// 2. List files to understand project structure
{
  "operation": "list_repository_files",
  "args": {
    "accessToken": "mcp_token_abc123",
    "repository": "myorg/myrepo",
    "path": "src"
  }
}

// 3. Read existing files for context
{
  "operation": "get_repository_file",
  "args": {
    "accessToken": "mcp_token_abc123",
    "repository": "myorg/myrepo",
    "path": "src/components/Header.tsx"
  }
}

// 4. Create feature branch
{
  "operation": "create_branch",
  "args": {
    "accessToken": "mcp_token_abc123",
    "repository": "myorg/myrepo",
    "baseBranch": "main",
    "newBranch": "feature/add-search-bar"
  }
}

// 5. Commit implementation
{
  "operation": "commit_changes",
  "args": {
    "accessToken": "mcp_token_abc123",
    "repository": "myorg/myrepo",
    "branch": "feature/add-search-bar",
    "changes": [
      {
        "path": "src/components/SearchBar.tsx",
        "content": "/* SearchBar component implementation */",
        "mode": "create"
      }
    ],
    "commitMessage": "feat: add search bar component"
  }
}

// 6. Create pull request
{
  "operation": "create_pull_request",
  "args": {
    "accessToken": "mcp_token_abc123",
    "repository": "myorg/myrepo",
    "headBranch": "feature/add-search-bar",
    "baseBranch": "main",
    "title": "feat: Add search bar to header",
    "body": "## Summary\n\nAdds search functionality to header component.\n\n## Testing\n- [x] Component renders correctly\n- [x] Search functionality works"
  }
}

// 7. Add review comment
{
  "operation": "add_pull_request_comment",
  "args": {
    "accessToken": "mcp_token_abc123",
    "repository": "myorg/myrepo",
    "prNumber": 45,
    "comment": "Implementation complete and ready for review!"
  }
}

// 8. Merge when approved
{
  "operation": "merge_pull_request",
  "args": {
    "accessToken": "mcp_token_abc123",
    "repository": "myorg/myrepo",
    "prNumber": 45,
    "mergeMethod": "squash"
  }
}
```

## Integration with AI Agents

These GitHub operations are designed to work seamlessly with AI coding agents:

### Coding Agent Cloud Workflow

The Coding Agent Cloud can now perform complete GitHub workflows:

1. **Read repository context** - Understand the codebase
2. **Create feature branches** - Isolate changes
3. **Generate and commit code** - Implement features
4. **Create pull requests** - Propose changes
5. **Add comments** - Communicate with team
6. **Merge when approved** - Deploy to production

### MCP Server Tool Definitions

All 8 operations are automatically exposed as MCP tools when using the Astrid MCP server (`mcp-server-v2.ts`).

## Testing

Run the GitHub MCP operations test suite:

```bash
npm test tests/mcp/github-repository-operations.test.ts
```

This verifies that all GitHub operations are properly configured and available.

## Security Considerations

1. **Access Token Security** - MCP tokens should be kept secure and never committed to repositories
2. **Permission Validation** - All operations validate user permissions via GitHub App installation
3. **Repository Access** - Users can only access repositories where the GitHub App is installed
4. **Audit Trail** - All operations are logged for security auditing

## Troubleshooting

### Issue: "GitHub integration not configured"

**Solution:**
1. Go to Settings → Coding Integration
2. Install and configure the Astrid GitHub App
3. Ensure the app is installed on the target repository

### Issue: "No valid MCP access token found"

**Solution:**
1. Go to Settings → AI Agent Access
2. Create a new MCP access token
3. Ensure the token has appropriate permissions (read/write)

### Issue: "Failed to authenticate GitHub App"

**Solution:**
1. Verify GitHub App credentials in environment variables
2. Check that `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, and `GITHUB_WEBHOOK_SECRET` are correctly configured
3. Verify the GitHub App installation is active

## Related Documentation

- [GitHub Coding Agent Implementation](./GITHUB_CODING_AGENT_IMPLEMENTATION.md)
- [Repository Configuration](./GITHUB_REPOSITORY_CONFIGURATION.md)
- [MCP Testing Guide](../testing/MCP_TESTING_GUIDE.md)
- [AI Agents Setup](./README.md)

## Implementation Details

**API Route:** `app/api/mcp/operations/route.ts`
**MCP Server:** `mcp/mcp-server-v2.ts`
**GitHub Client:** `lib/github-client.ts`
**Tests:** `tests/mcp/github-repository-operations.test.ts`
