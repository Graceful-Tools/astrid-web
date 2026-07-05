# Setting Up Astrid.cc Workflow for Your Development Project

Complete guide for integrating Astrid.cc task management with AI coding agents for automated workflows.

## Overview

Astrid.cc provides OAuth-based API access that allows AI agents to:
- Pull tasks from your project lists
- Post implementation plans and progress updates
- Mark tasks complete when done
- Track development progress in one place

This guide shows you how to set up this workflow for your own project.

---

## Prerequisites

- Node.js project with TypeScript support
- Account on [astrid.cc](https://astrid.cc)
- AI coding agent (Claude Code, GitHub Copilot, Cursor, etc.)

---

## Step 1: Create Project List on Astrid.cc

1. **Sign up/Login** at [astrid.cc](https://astrid.cc)

2. **Create a new list** for your project:
   - Click "+ New List"
   - Name it something like "My Project Tasks" or "Project Name - Development"
   - Choose a color and icon (optional)

3. **Add your development tasks**:
   - Create tasks for bugs, features, improvements
   - Set priorities (1 = low, 2 = medium, 3 = high)
   - Add descriptions with requirements and context
   - Assign to yourself or your AI agent

4. **Get your List ID**:
   - Open the list you just created
   - Copy the UUID from the URL bar:
     ```
     https://astrid.cc/lists/a623f322-4c3c-49b5-8a94-d2d9f00c82ba
                            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                            This is your List ID
     ```
   - Save this for later

---

## Step 2: Create OAuth Client

1. **Navigate to API Access Settings**:
   - Go to [astrid.cc/settings/api-access](https://astrid.cc/settings/api-access)
   - Click "Create OAuth Client"

2. **Configure OAuth Client**:
   ```
   Name: My Project AI Agent
   Description: Automated task workflow for [Your Project Name]
   Grant Types: ✅ client_credentials
   Scopes:
     ✅ tasks:read
     ✅ tasks:write
     ✅ lists:read
     ✅ comments:read
     ✅ comments:write
     ✅ user:read (optional)
   ```

3. **Save and Copy Credentials**:
   - Click "Create"
   - **IMMEDIATELY copy the Client ID and Client Secret**
   - ⚠️ **The secret is shown only once!** Store it securely
   - Example format:
     ```
     Client ID:     astrid_client_<your-client-id>
     Client Secret: <shown-once-store-securely>
     ```

---

## Step 3: Install Required Files

### Option A: Clone from Astrid Repository

```bash
# Clone the example scripts
git clone https://github.com/Graceful-Tools/astrid-res-www-www.git astrid-workflow
cd astrid-workflow

# Copy required files to your project
cp scripts/get-astrid-tasks.ts YOUR_PROJECT/scripts/
cp scripts/analyze-task.ts YOUR_PROJECT/scripts/
cp scripts/add-task-comment.ts YOUR_PROJECT/scripts/
cp scripts/complete-task-with-workflow.ts YOUR_PROJECT/scripts/
cp lib/oauth-api-client.ts YOUR_PROJECT/lib/
```

### Option B: Manual Installation

Create these files in your project:

**`lib/oauth-api-client.ts`** - OAuth API client (see repository for full implementation)

**`scripts/get-astrid-tasks.ts`** - Pull tasks from Astrid.cc
**`scripts/analyze-task.ts`** - Get detailed task analysis
**`scripts/add-task-comment.ts`** - Post comments to tasks
**`scripts/complete-task-with-workflow.ts`** - Mark tasks complete

Find complete file contents in: [github.com/Graceful-Tools/astrid-res-www-www](https://github.com/Graceful-Tools/astrid-res-www-www)

### Install Dependencies

```bash
npm install dotenv @types/node
# or
yarn add dotenv @types/node
```

---

## Step 4: Configure Environment Variables

Create or update `.env.local` in your project root:

```bash
# Astrid.cc OAuth Configuration (Production API)
ASTRID_OAUTH_CLIENT_ID=astrid_client_xxxxxxxxxxxxx
ASTRID_OAUTH_CLIENT_SECRET=your_secret_here
ASTRID_OAUTH_LIST_ID=your-list-id-uuid
```

**Security Notes:**
- ✅ Add `.env.local` to `.gitignore`
- ✅ Never commit OAuth credentials to version control
- ✅ Use different credentials for each project/environment
- ✅ Regenerate secrets if exposed

---

## Step 5: Test OAuth Connection

Verify your setup works:

```bash
# Test OAuth connection and pull tasks
npx tsx scripts/get-astrid-tasks.ts
```

**Expected output:**
```
📋 Pulling latest uncompleted tasks from "My Project Tasks"...

🔐 Obtaining OAuth access token...
✅ Access token obtained

🎯 Fetching tasks from "My Project Tasks" list...

📝 Uncompleted tasks (3 total):

1. ★★★ Fix authentication bug
   ID: e2386275-6513-4a6f-bbba-040b2dd0600f
   Priority: 3/3 | Due: 2025-11-15
   Description: Users can't login with Google OAuth...

2. ★★ Add dark mode support
   ID: 1309929d-24a0-4c9e-99a9-37fd24ae4c3e
   Priority: 2/3 | Due: No due date

3. ★ Update README documentation
   ID: 010a775c-035b-4d90-b180-193a0ee0eff1
   Priority: 1/3 | Due: No due date

🎯 Please select a task number to work on!
```

---

## Step 6: Configure Your AI Agent

### For Claude Code

Create or update `CLAUDE.md` in your project root:

````markdown
# Project Development Context

## Task Workflow

When starting development work:

1. **Pull available tasks:**
   ```bash
   npx tsx scripts/get-astrid-tasks.ts
   ```

2. **Analyze selected task:**
   ```bash
   npx tsx scripts/analyze-task.ts <taskId>
   ```

3. **Post implementation plan:**
   ```bash
   npx tsx scripts/add-task-comment.ts <taskId> "Implementation plan: ..."
   ```

4. **Mark complete when done:**
   ```bash
   npx tsx scripts/complete-task-with-workflow.ts <taskId>
   ```

## Workflow Trigger

When user says "let's fix stuff" or "start working", IMMEDIATELY run:
```bash
npx tsx scripts/get-astrid-tasks.ts
```
````

### For Other AI Agents

Add similar instructions to your agent's configuration file:
- **Cursor**: Update `.cursorrules`
- **GitHub Copilot**: Add to workspace instructions
- **Windsurf**: Update project context
- **Custom agents**: Add to system prompts

---

## Step 7: Start Using the Workflow

### Basic Usage

1. **Pull tasks:**
   ```bash
   npx tsx scripts/get-astrid-tasks.ts
   ```

2. **Select a task** from the list (copy the task ID)

3. **Analyze task details:**
   ```bash
   npx tsx scripts/analyze-task.ts e2386275-6513-4a6f-bbba-040b2dd0600f
   ```

4. **Work on the task** (your AI agent implements the fix)

5. **Post progress updates:**
   ```bash
   npx tsx scripts/add-task-comment.ts <taskId> "Fixed authentication issue by updating OAuth config"
   ```

6. **Mark complete:**
   ```bash
   npx tsx scripts/complete-task-with-workflow.ts <taskId>
   ```

### Advanced Usage

**Filter by priority:**
```bash
# Modify get-astrid-tasks.ts to filter by priority >= 2
const tasks = await client.getTasks(listId, false)
const highPriority = tasks.data.filter(t => t.priority >= 2)
```

**Bulk operations:**
```bash
# Complete multiple tasks
npx tsx scripts/complete-task-with-workflow.ts task-id-1 task-id-2 task-id-3
```

**Custom automation:**
```typescript
// Create your own workflow scripts
import { OAuthAPIClient } from '@/lib/oauth-api-client'

const client = new OAuthAPIClient()
// ... your custom logic
```

---

## Common Issues & Troubleshooting

### Issue: "No valid authentication found"

**Cause:** Using `Authorization: Bearer` header (known production issue)

**Solution:** Use `X-OAuth-Token` header instead:

```typescript
// ❌ Don't use this
fetch('https://astrid.cc/api/v1/tasks', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
})

// ✅ Use this instead
fetch('https://astrid.cc/api/v1/tasks', {
  headers: {
    'X-OAuth-Token': token
  }
})
```

All provided scripts already use the correct header.

### Issue: "Failed to obtain access token"

**Possible causes:**
- Invalid Client ID or Client Secret
- OAuth client was deleted or disabled
- Network connectivity issues

**Solution:**
1. Verify credentials in `.env.local` match your OAuth client
2. Check OAuth client is active at astrid.cc/settings/api-access
3. Test connection: `curl https://astrid.cc/api/health`

### Issue: "List not found" or empty task list

**Possible causes:**
- Wrong List ID in `.env.local`
- List was deleted or made private
- OAuth client doesn't have access to the list

**Solution:**
1. Verify List ID from browser URL
2. Ensure list exists and has tasks
3. Check list privacy settings (make sure it's not private)

### Debug Mode

Enable debug logging:

```bash
# Create debug script
npx tsx scripts/debug-production-oauth.ts
```

This will test:
- ✅ OAuth token generation
- ✅ Token validation
- ✅ API endpoint access
- ✅ Header configuration

---

## API Reference

### OAuth Token Generation

**Endpoint:** `POST https://astrid.cc/api/v1/oauth/token`

**Request:**
```json
{
  "grant_type": "client_credentials",
  "client_id": "astrid_client_...",
  "client_secret": "your_secret"
}
```

**Response:**
```json
{
  "access_token": "astrid_...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "tasks:read tasks:write ..."
}
```

### Get Tasks

**Endpoint:** `GET https://astrid.cc/api/v1/tasks`

**Query Parameters:**
- `listId` - Filter by list ID (required)
- `completed` - Include completed tasks (default: false)
- `includeComments` - Include task comments (default: false)

**Headers:**
```
X-OAuth-Token: astrid_...
Content-Type: application/json
```

### Add Task Comment

**Endpoint:** `POST https://astrid.cc/api/v1/tasks/{taskId}/comments`

**Body:**
```json
{
  "content": "Your comment text here"
}
```

### Update Task Status

**Endpoint:** `PATCH https://astrid.cc/api/v1/tasks/{taskId}`

**Body:**
```json
{
  "completed": true
}
```

---

## Best Practices

### Task Organization

1. **Use priorities effectively:**
   - Priority 3 (★★★): Critical bugs, urgent features
   - Priority 2 (★★): Important improvements
   - Priority 1 (★): Nice-to-have, documentation

2. **Write clear task descriptions:**
   - Include context and requirements
   - Link to related issues/docs
   - Provide acceptance criteria

3. **Use task comments for progress:**
   - Post implementation plans
   - Share progress updates
   - Document decisions made

### Security

1. **Protect OAuth credentials:**
   - Never commit to git
   - Use environment variables
   - Rotate secrets periodically

2. **Limit OAuth scopes:**
   - Only grant necessary permissions
   - Use read-only scopes when possible
   - Create separate clients for different purposes

3. **Monitor API usage:**
   - Review OAuth client activity at astrid.cc/settings/api-access
   - Revoke compromised credentials immediately
   - Use separate credentials per environment

### Automation

1. **Integrate with CI/CD:**
   ```yaml
   # .github/workflows/update-tasks.yml
   name: Update Tasks
   on:
     push:
       branches: [main]
   jobs:
     update-tasks:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v3
         - run: npx tsx scripts/update-completed-tasks.ts
           env:
             ASTRID_OAUTH_CLIENT_ID: ${{ secrets.ASTRID_CLIENT_ID }}
             ASTRID_OAUTH_CLIENT_SECRET: ${{ secrets.ASTRID_CLIENT_SECRET }}
   ```

2. **Create custom workflows:**
   - Auto-assign tasks to AI agents
   - Sync with GitHub Issues
   - Generate progress reports
   - Track time spent per task

---

## Example: Complete Development Session

```bash
# 1. Start work session
$ npx tsx scripts/get-astrid-tasks.ts
# Output: Shows 5 uncompleted tasks

# 2. Select high-priority task
$ npx tsx scripts/analyze-task.ts e2386275-6513-4a6f-bbba-040b2dd0600f
# Output: Shows full task details, comments, related PRs

# 3. Post implementation plan
$ npx tsx scripts/add-task-comment.ts e2386275-6513-4a6f-bbba-040b2dd0600f \
  "Implementation plan:
  1. Update OAuth config in auth.ts
  2. Add error handling for token expiry
  3. Create tests for auth flow
  ETA: 2 hours"

# 4. Work on implementation (AI agent writes code)

# 5. Post progress update
$ npx tsx scripts/add-task-comment.ts e2386275-6513-4a6f-bbba-040b2dd0600f \
  "✅ OAuth config updated
  ✅ Error handling added
  🔄 Writing tests..."

# 6. Complete task
$ npx tsx scripts/complete-task-with-workflow.ts e2386275-6513-4a6f-bbba-040b2dd0600f
# Output: ✅ Task marked complete with final summary
```

---

## Resources

- **Astrid.cc Documentation:** [astrid.cc/docs](https://astrid.cc/docs)
- **OAuth 2.0 Spec:** [RFC 6749](https://tools.ietf.org/html/rfc6749)
- **Example Implementation:** [github.com/Graceful-Tools/astrid-res-www-www](https://github.com/Graceful-Tools/astrid-res-www-www)
- **API Reference:** [astrid.cc/docs/api](https://astrid.cc/docs/api)

---

## Support

Need help? Try these resources:

1. **Check the troubleshooting section** above
2. **Review debug logs:** Run `scripts/debug-production-oauth.ts`
3. **Test OAuth manually:** Use curl or Postman
4. **Contact support:** support@astrid.cc
5. **Community:** [GitHub Discussions](https://github.com/Graceful-Tools/astrid-res-www-www/discussions)

---

**Happy automating! 🚀**

*Last updated: 2025-11-10*
