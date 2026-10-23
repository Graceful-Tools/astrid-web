# MCP Testing Guide

## Overview

This guide provides comprehensive testing strategies and tools for the Astrid MCP (Model Context Protocol) implementation, including both V1 and V2 testing approaches.

## 🚀 Quick Start Summary

**Astrid MCP provides 14 comprehensive operations for AI agents to interact with your task management system and GitHub repositories:**

### **📖 What You Can Read** (7 operations)
1. **`get_shared_lists`** - Get all your accessible lists with full settings
2. **`get_list_tasks`** - Get tasks from a specific list
3. **`get_task_comments`** - Get comments for a task
4. **`get_task_details`** - Get complete task information
5. **`get_list_members`** - Get list members and roles
6. **`get_repository_file`** - Read files from GitHub repositories
7. **`list_repository_files`** - List files in GitHub repository directories

### **✏️ What You Can Write** (7 operations)
8. **`create_task`** - Create new tasks with full field support
9. **`update_task`** - Update existing tasks
10. **`add_comment`** - Add comments with optional attachments
11. **`add_task_attachment`** - Add file attachments to tasks
12. **`delete_task`** - Delete tasks
13. **`create_list`** - Create new lists with settings ✨ NEW
14. **`update_list`** - Update list settings (sort, filters, defaults, AI config) ✨ NEW

### **🎯 Simple Requirements**
- **Only 3 things are truly required**: Your access token, the list ID, and task titles when creating tasks
- **Everything else has smart defaults**: Priority defaults to 1, tasks default to incomplete, etc.
- **Full feature support**: Repeating tasks, due dates, reminders, attachments, privacy settings, and more

### **🔧 Getting Started**
1. **Web Testing**: Visit `http://localhost:3001/settings/mcp-testing` for interactive testing
2. **Command Line**: Use `npm run mcp-test list-operations` to see all options
3. **Documentation**: All 10 operations are fully documented below with examples

## 🧪 Updated Test Suite

### **1. Controller Layer Tests**

#### `tests/mcp/useMCPController.test.ts` - NEW
- **Tests the new MVC architecture integration**
- **Validates access control layers**: User → List → Token → Operation
- **Covers permission enforcement**: Ensures MCP never exceeds user permissions
- **Tests all CRUD operations**: Create, read, update, delete tasks and comments

**Key Test Cases:**
```typescript
// Access token validation
✓ validateMCPAccess with valid token
✓ validateMCPAccess rejects invalid token
✓ validateMCPAccess rejects when list MCP disabled
✓ validateMCPAccess rejects when user MCP disabled
✓ validateMCPAccess enforces list access levels (READ/WRITE/BOTH)

// CRUD operations
✓ getMCPAccessibleLists returns enhanced metadata
✓ getMCPListTasks filters by completion status
✓ createMCPTask validates user permissions
✓ updateMCPTask enforces edit permissions
✓ addMCPComment validates task existence
```

#### `tests/mcp/mcp-server-v2.test.ts` - NEW
- **Tests the V2 MCP server implementation**
- **Validates database-backed token storage**
- **Tests enhanced error handling and responses**
- **Covers all tool operations with V2 features**

**Key Test Cases:**
```typescript
// V2 Server features
✓ Server initializes with V2 configuration
✓ Database-backed token validation
✓ List-level MCP settings enforcement
✓ User-level MCP settings enforcement
✓ Access level restrictions (READ/WRITE/BOTH)

// Enhanced operations
✓ get_shared_lists returns V2 metadata
✓ create_task with enhanced validation
✓ update_task with permission checks
✓ Error handling for all access control layers
```

#### `tests/mcp/mcp-tokens-v2.test.ts` - NEW
- **Tests the V2 token API endpoints**
- **Validates database storage vs in-memory**
- **Tests soft delete functionality**
- **Covers new permission models**

**Key Test Cases:**
```typescript
// V2 API features
✓ GET returns tokens with V2 enhancements (mcpAccessLevel derived from token permissions)
✓ POST creates database records instead of in-memory
✓ DELETE performs soft delete (isActive = false)
✓ Validates new member model (listMembers)
✓ Handles user MCP disable/enable
✓ Enforces list-level access control
```

### **2. Integration Tests**

The existing integration tests (`mcp-integration.test.ts`) cover:
- End-to-end MCP workflows
- Real database interactions
- Authentication flows
- Error scenarios

### **3. Legacy Test Updates**

Updated existing tests to maintain compatibility:
- `mcp-server.test.ts` - Enhanced with V2 compatibility checks
- `mcp-tokens.test.ts` - Maintained V1 functionality tests

## 🎯 Best Ways to View MCP CRUD Actions

### **1. Interactive Web UI - RECOMMENDED**

#### **MCPCRUDViewer Component**
Located at: `/app/settings/mcp-testing/page.tsx`

**Features:**
- 📚 **Documentation Tab**: Complete operation reference
- 🧪 **Interactive Testing Tab**: Live testing interface
- 👁 **Results Tab**: Response inspection and debugging

**How to Use:**
1. Navigate to `http://localhost:3000/settings/mcp-testing`
2. Enter your MCP token in the test configuration
3. Select an operation to test
4. View real-time responses and errors

**Benefits:**
- Visual schema documentation
- Real-time testing with actual tokens
- Response formatting and error handling
- Copy-paste functionality for examples
- Performance monitoring (response times)

### **2. Command Line Testing Tool**

#### **MCP Test Client**
Located at: `tools/mcp-test-client.ts`

**Usage:**
```bash
# List all available operations
node tools/mcp-test-client.ts list-operations

# Test specific operation
node tools/mcp-test-client.ts test-operation get_shared_lists --token=your_token

# Test all operations
node tools/mcp-test-client.ts test-all --token=your_token --list=list_id

# Generate test data
node tools/mcp-test-client.ts generate-test-data
```

**Benefits:**
- Automated testing workflows
- Batch operation testing
- CI/CD integration ready
- Colored console output
- Performance metrics

### **3. Direct MCP Server Testing**

#### **Using the MCP Server Directly**

**Setup MCP Server V2:**
```bash
# Build the TypeScript server
npm run build

# Run the MCP server
node dist/mcp-server-v2.js
```

**Configure Claude Desktop:**
```json
{
  "mcpServers": {
    "astrid-v2": {
      "command": "node",
      "args": ["/path/to/your/project/mcp-server-v2.js"],
      "env": {
        "DATABASE_URL": "postgresql://user:password@localhost:5432/astrid_dev"
      }
    }
  }
}
```

### **4. API Testing with Postman/Insomnia**

Use the token management API directly:

```bash
# Get your tokens
curl -X GET http://localhost:3000/api/mcp/user-tokens \
  -H "Cookie: your-session-cookie"

# Create a token (the plaintext is returned once; only its hash is stored)
curl -X POST http://localhost:3000/api/mcp/user-tokens \
  -H "Content-Type: application/json" \
  -H "Cookie: your-session-cookie" \
  -d '{
    "permissions": ["read", "write"],
    "expiresInDays": 30,
    "description": "Test token"
  }'
```

## 📊 Complete CRUD Operations Reference - 14 Operations Total

### **READ Operations** (require `read` permission)

#### 1. `get_shared_lists`
**Purpose:** Get all accessible task lists with metadata
**Required Fields:** Only `accessToken`
```json
{
  "accessToken": "astrid_mcp_your_token"
}
```
**Response:** List metadata with permissions and access levels

#### 2. `get_list_tasks`
**Purpose:** Get tasks from a specific list with filtering
**Required Fields:** `accessToken`, `listId`
```json
{
  "accessToken": "astrid_mcp_your_token",
  "listId": "list-uuid",
  "includeCompleted": false
}
```
**Response:** Filtered and sorted task array with comprehensive field support

#### 3. `get_task_comments`
**Purpose:** Get all comments for a task including attachments
**Required Fields:** `accessToken`, `listId`, `taskId`
```json
{
  "accessToken": "astrid_mcp_your_token",
  "listId": "list-uuid",
  "taskId": "task-uuid"
}
```
**Response:** Chronologically ordered comments with attachment metadata

#### 4. `get_task_details`
**Purpose:** Get comprehensive task details with all fields, comments, and attachments
**Required Fields:** `accessToken`, `listId`, `taskId`
```json
{
  "accessToken": "astrid_mcp_your_token",
  "listId": "list-uuid",
  "taskId": "task-uuid",
  "includeComments": true,
  "includeAttachments": true
}
```
**Response:** Complete task object with all metadata, relationships, and counts

#### 5. `get_list_members`
**Purpose:** Get all members and their roles for a list
**Required Fields:** `accessToken`, `listId`
```json
{
  "accessToken": "astrid_mcp_your_token",
  "listId": "list-uuid"
}
```
**Response:** Member list with roles (owner, admin, member) and contact info

### **WRITE Operations** (require `write` permission)

#### 6. `create_task`
**Purpose:** Create a new task with comprehensive field support including repeating patterns
**Required Fields:** `accessToken`, `listId`, `task.title` (everything else has defaults)
```json
{
  "accessToken": "astrid_mcp_your_token",
  "listId": "list-uuid",
  "task": {
    "title": "New Task",
    "description": "Task description (optional)",
    "priority": 2,
    "when": "2024-01-20T17:00:00Z",
    "dueDateTime": "2024-01-20T17:00:00Z",
    "reminderTime": "2024-01-20T16:00:00Z",
    "reminderType": "push",
    "repeating": "weekly",
    "repeatingData": {
      "type": "custom",
      "unit": "weeks",
      "interval": 2
    },
    "isPrivate": false
  }
}
```

#### 7. `update_task`
**Purpose:** Update an existing task with any fields
**Required Fields:** `accessToken`, `listId`, `taskUpdate.taskId`
```json
{
  "accessToken": "astrid_mcp_your_token",
  "listId": "list-uuid",
  "taskUpdate": {
    "taskId": "task-uuid",
    "title": "Updated Title (optional)",
    "completed": true,
    "priority": 3,
    "repeating": "never"
  }
}
```

#### 8. `add_comment`
**Purpose:** Add a comment to a task with optional attachment support
**Required Fields:** `accessToken`, `listId`, `comment.taskId`, `comment.content`
```json
{
  "accessToken": "astrid_mcp_your_token",
  "listId": "list-uuid",
  "comment": {
    "taskId": "task-uuid",
    "content": "New comment",
    "type": "TEXT",
    "attachmentUrl": "https://example.com/file.pdf",
    "attachmentName": "document.pdf",
    "attachmentType": "application/pdf"
  }
}
```

#### 9. `add_task_attachment`
**Purpose:** Add an attachment to a task
**Required Fields:** `accessToken`, `listId`, `taskId`, `attachment.name`, `attachment.url`
```json
{
  "accessToken": "astrid_mcp_your_token",
  "listId": "list-uuid",
  "taskId": "task-uuid",
  "attachment": {
    "name": "document.pdf",
    "url": "https://example.com/file.pdf",
    "type": "application/pdf",
    "size": 1024000
  }
}
```

#### 10. `delete_task`
**Purpose:** Delete a task from a list
**Required Fields:** `accessToken`, `listId`, `taskId`
```json
{
  "accessToken": "astrid_mcp_your_token",
  "listId": "list-uuid",
  "taskId": "task-uuid"
}
```
**Response:** Confirmation of successful deletion

#### 11. `get_repository_file` ✨ NEW
**Purpose:** Read file contents from a GitHub repository
**Required Fields:** `accessToken`, `repository`, `path`
**Optional Fields:** `ref` (branch/commit, defaults to default branch)
```json
{
  "accessToken": "astrid_mcp_your_token",
  "repository": "owner/repo-name",
  "path": "README.md",
  "ref": "main"
}
```
**Response:** File contents as string
**Requirements:** User must have GitHub integration configured

#### 12. `list_repository_files` ✨ NEW
**Purpose:** List files in a GitHub repository directory
**Required Fields:** `accessToken`, `repository`
**Optional Fields:** `path` (directory, defaults to root), `ref` (branch/commit)
```json
{
  "accessToken": "astrid_mcp_your_token",
  "repository": "owner/repo-name",
  "path": "src",
  "ref": "main"
}
```
**Response:** Array of file/directory information with name, path, type, and size
**Requirements:** User must have GitHub integration configured

#### 13. `create_list` ✨ NEW
**Purpose:** Create a new task list with optional settings
**Required Fields:** `accessToken`, `name`
**Optional Fields:** All list settings (sort, filters, defaults, AI agent config)
```json
{
  "accessToken": "astrid_mcp_your_token",
  "name": "New Project List",
  "description": "Project tasks and deliverables",
  "color": "#3b82f6",
  "privacy": "PRIVATE",
  "sortBy": "priority",
  "filterCompletion": "incomplete",
  "defaultPriority": 2,
  "defaultIsPrivate": false
}
```
**Response:** Created list with full metadata including ID
**Requirements:** User must have write permissions

#### 14. `update_list` ✨ NEW
**Purpose:** Update list settings including sort, filters, defaults, and AI agent configuration
**Required Fields:** `accessToken`, `listId`
**Optional Fields:** Any list settings to update
```json
{
  "accessToken": "astrid_mcp_your_token",
  "listId": "list-uuid",
  "updates": {
    "sortBy": "when",
    "filterPriority": "3",
    "filterCompletion": "incomplete",
    "defaultPriority": 2,
    "defaultDueDate": "tomorrow",
    "defaultIsPrivate": false,
    "aiAstridEnabled": true,
    "preferredAiProvider": "claude",
    "githubRepositoryId": "owner/repo-name"
  }
}
```
**Response:** Updated list with all settings
**Requirements:** User must be list owner or admin

### **📋 List Settings Reference**

The `update_list` operation supports updating all of these settings:

#### **Sort & Filter Settings**
- `sortBy` - "manual", "when", "priority", "createdAt"
- `manualSortOrder` - Array of task IDs for manual ordering
- `filterPriority` - "all", "0", "1", "2", "3"
- `filterAssignee` - "all", "me", "unassigned", or user ID
- `filterDueDate` - "all", "overdue", "today", "this_week", "this_month", "no_date"
- `filterCompletion` - "default", "all", "completed", "incomplete"
- `filterRepeating` - "all", "repeating", "non_repeating"
- `filterAssignedBy` - "all" or user ID
- `filterInLists` - "all" or comma-separated list IDs

#### **Default Task Settings**
- `defaultPriority` - 0-3 (priority for new tasks)
- `defaultDueDate` - "none", "today", "tomorrow", "next_week", "next_month"
- `defaultDueTime` - Time string for default due time
- `defaultIsPrivate` - Boolean (privacy for new tasks)
- `defaultRepeating` - "never", "daily", "weekly", "monthly", "yearly"
- `defaultAssigneeId` - User ID for default assignee

#### **AI Agent Settings**
- `aiAstridEnabled` - Boolean (enable Astrid AI for list)
- `aiAgentConfiguredBy` - User ID who configured AI (read-only in responses)
- `preferredAiProvider` - "claude", "openai", "gemini"
- `fallbackAiProvider` - Backup AI provider
- `githubRepositoryId` - "owner/repo-name" for GitHub integration
- `aiAgentsEnabled` - Array of enabled agent types: ["coding", "general", "claude", "openai"]

#### **Privacy & Member Settings**
- `privacy` - "PRIVATE", "SHARED", "PUBLIC"
- `publicListType` - "read_only", "collaborative" (for PUBLIC lists)
- `isFavorite` - Boolean (favorite/star the list)
- `favoriteOrder` - Number (order in favorites)

### **🎯 Key Features**

- **Required vs Optional Fields**: Only core identifiers are required (accessToken, listId, task title). Everything else has sensible defaults
- **Comprehensive Field Support**: Full support for task priorities, due dates, reminders, repeating patterns, privacy settings, and attachments
- **Separate Date Fields**: Both legacy `when` field and new `dueDateTime` field supported for backwards compatibility
- **Repeating Patterns**: Complete support for daily, weekly, monthly, yearly, and custom repeating patterns with advanced scheduling
- **Comment Attachments**: Comments can include file attachments with full metadata
- **Task Attachments**: Direct file attachment support for tasks
- **Member Management**: Access to list member information and roles

## 🔍 Testing Strategies

### **1. Access Control Testing**

Test the multi-layer security model:

```typescript
// Layer 1: User-level MCP enable/disable
user.mcpEnabled = false → All operations should fail

// Layer 2: Token permissions (SIMPLIFIED MODEL)
token.permissions = ['read'] → Write operations should fail
token.permissions = ['write', 'admin'] → All operations allowed

// Layer 3: User list membership
user not in list.members → Operations should fail even with valid token

**Note: List-level MCP settings (mcpEnabled, mcpAccessLevel) have been REMOVED in favor of token-level permissions for simplified administration.**
```

### **2. Permission Boundary Testing**

Ensure MCP agents never exceed user permissions:

```typescript
// Test scenario: User loses list access after token creation
1. User creates MCP token with 'write' permissions
2. User is removed from list by admin
3. MCP operations with token should fail
4. Token should be effectively invalidated
```

### **3. Error Handling Testing**

Test comprehensive error scenarios:

```bash
# Invalid token
✓ "Invalid or expired MCP token"

# MCP disabled
✓ "MCP access is disabled for this user"
✓ "MCP access is disabled for this list"

# Access level restrictions
✓ "This list only allows read access via MCP"

# Permission errors
✓ "Insufficient permissions. Required: write"
✓ "User no longer has permission to edit this task"

# Data validation
✓ "Task not found in the specified list"
✓ "Missing required parameters"
```

## 🚀 Running the Tests

### **Unit Tests**
```bash
# Run all MCP tests
npm test tests/mcp/

# Run specific test files
npm test tests/mcp/useMCPController.test.ts
npm test tests/mcp/mcp-server-v2.test.ts
npm test tests/mcp/mcp-tokens-v2.test.ts
```

### **Integration Tests**
```bash
# Run integration tests (requires database)
DATABASE_URL="postgresql://user:password@localhost:5432/astrid_test" npm test tests/mcp/mcp-integration.test.ts
```

### **Manual Testing**
```bash
# Start the web testing interface
npm run dev
# Navigate to http://localhost:3000/settings/mcp-testing

# Or use the command line tool
node tools/mcp-test-client.ts list-operations
```

## 🎯 Recommended Testing Workflow

### **For Development:**
1. **Start with unit tests** - Validate controller logic
2. **Use the web UI** - Interactive testing and debugging
3. **Run integration tests** - End-to-end validation

### **For CI/CD:**
1. **Run all unit tests** - Fast feedback
2. **Run integration tests** - Database validation
3. **Use CLI tool** - Automated operation testing

### **For Manual QA:**
1. **Use the web UI** - Complete CRUD testing
2. **Test Claude Desktop** - Real MCP client validation
3. **Verify access control** - Security testing

## 📈 Performance Benchmarks

The testing tools provide performance metrics:

- **get_shared_lists**: ~50-100ms
- **get_list_tasks**: ~100-200ms
- **create_task**: ~200-300ms
- **update_task**: ~150-250ms
- **add_comment**: ~100-200ms
- **get_task_comments**: ~50-150ms

Monitor these metrics to ensure MCP operations remain performant.

## 🔧 Troubleshooting

### **Common Issues:**

1. **"Invalid access token"** - Check token creation and database storage
2. **"MCP access is disabled"** - Verify user and list MCP settings
3. **"Insufficient permissions"** - Check token permissions vs required operation permissions
4. **Database connection errors** - Ensure Prisma client is properly configured

### **Debug Tools:**

1. **Enable debug logging** in MCP server
2. **Use Prisma Studio** to inspect token storage
3. **Check browser network tab** for API responses
4. **Use the web testing UI** for detailed error messages

This comprehensive testing approach ensures your MCP implementation is robust, secure, and performant!