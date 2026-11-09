# Testing GitHub Coding Agent Locally

## 🧪 Local Testing Guide

### Prerequisites

1. ✅ GitHub App configured in `.env.local`
2. ✅ GitHub integration set up for your user account
3. ✅ AI API key configured (Claude or OpenAI)
4. ✅ Test repository accessible via GitHub App

### Step 1: Verify Your Setup

```bash
# Run the verification script
DATABASE_URL="postgresql://postgres:password@localhost:5432/astrid_dev" npx tsx scripts/verify-github-agent-fix.ts
```

**Expected output:**
- ✅ AI agents exist
- ✅ AI agents have NO GitHub integrations
- ✅ Your user has GitHub integration
- ✅ Code fix verified

### Step 2: Create a Test List with GitHub Repository

```bash
# Run this script to create a test list
DATABASE_URL="postgresql://postgres:password@localhost:5432/astrid_dev" npx tsx -e "
import { createScriptPrisma } from './scripts/lib/script-prisma';
const prisma = createScriptPrisma();

async function setup() {
  // Get your user ID (replace with actual email)
  const user = await prisma.user.findUnique({
    where: { email: 'YOUR_EMAIL@example.com' },
    include: { githubIntegration: true }
  });

  if (!user) throw new Error('User not found');

  // Get a repository from your GitHub integration
  const repos = JSON.parse(user.githubIntegration.repositories);
  const testRepo = repos[0].fullName; // e.g., 'jonparis/astrid-res-www'

  // Create test list
  const list = await prisma.taskList.create({
    data: {
      name: 'AI Agent Test List',
      ownerId: user.id,
      githubRepositoryId: testRepo,
      aiAgentsEnabled: true,
      aiAgentConfiguredBy: user.id,
      preferredAiProvider: 'claude' // or 'openai'
    }
  });

  console.log('✅ Test list created:', list.id);
  console.log('   - Repository:', testRepo);
  console.log('   - AI configured by:', user.email);

  await prisma.\$disconnect();
}

setup();
"
```

### Step 3: Start the Development Server

```bash
npm run dev
```

### Step 4: Test the Workflow

1. **Navigate to your test list** at `http://localhost:3000`

2. **Create a simple coding task:**
   ```
   Title: Add a hello world function
   Description: Create a simple TypeScript function that returns "Hello World"
   ```

3. **Assign to AI Agent:**
   - Click the assignee dropdown
   - Search for "Claude" or "OpenAI"
   - Select the AI agent

4. **Watch the workflow:**
   - The AI will analyze and create an implementation plan
   - It will autonomously generate code
   - It will create a GitHub branch
   - It will commit the code
   - It will create a pull request

### Step 5: Monitor the Process

**In your terminal, watch for logs:**
```
🤖 [AIOrchestrator] Selected AI provider: claude
📂 [AIOrchestrator] Target repository: jonparis/test-repo
🧠 [AI Orchestration] Starting workflow for: { workflowId, taskId, userId }
🚀 [AIOrchestrator] Starting complete workflow execution
✅ [AIOrchestrator] Pull request created: 123
```

**In your browser:**
- Check the task comments for updates
- The AI will post:
  - Analysis complete
  - Implementation plan
  - Code generation progress
  - GitHub PR link
  - Staging deployment link (if Vercel configured)

### Step 6: Verify GitHub Integration

Check your GitHub repository:
1. New branch created: `astrid-code-assistant/[timestamp]-[task-name]`
2. Commits on the branch with generated code
3. Pull request opened against main branch

### 🔍 Debugging Tips

**If the workflow fails:**

1. **Check API logs:**
   ```bash
   # Watch the development server console for errors
   ```

2. **Verify GitHub client authentication:**
   ```bash
   DATABASE_URL="postgresql://postgres:password@localhost:5432/astrid_dev" npx tsx -e "
   import { createScriptPrisma } from './scripts/lib/script-prisma';
   const prisma = createScriptPrisma();

   async function test() {
     const user = await prisma.user.findUnique({
       where: { email: 'YOUR_EMAIL@example.com' },
       include: { githubIntegration: true }
     });

     console.log('User GitHub integration:', {
       userId: user.id,
       installationId: user.githubIntegration?.installationId,
       hasRepos: !!user.githubIntegration?.repositories
     });

     await prisma.\$disconnect();
   }
   test();
   "
   ```

3. **Check workflow status:**
   ```bash
   DATABASE_URL="postgresql://postgres:password@localhost:5432/astrid_dev" npx tsx -e "
   import { createScriptPrisma } from './scripts/lib/script-prisma';
   const prisma = createScriptPrisma();

   async function check() {
     const workflows = await prisma.codingTaskWorkflow.findMany({
       orderBy: { createdAt: 'desc' },
       take: 5,
       include: { task: true }
     });

     workflows.forEach(w => {
       console.log('Workflow:', {
         id: w.id,
         task: w.task.title,
         status: w.status,
         repository: w.repositoryId,
         branch: w.workingBranch,
         pr: w.pullRequestNumber
       });
     });

     await prisma.\$disconnect();
   }
   check();
   "
   ```

4. **Manually test GitHub API access:**
   ```bash
   DATABASE_URL="postgresql://postgres:password@localhost:5432/astrid_dev" npx tsx -e "
   import { GitHubClient } from './lib/github-client';

   async function testGitHub() {
     const client = await GitHubClient.forUser('YOUR_USER_ID');
     const repos = await client.getInstallationRepositories();
     console.log('Accessible repositories:', repos.map(r => r.fullName));
   }
   testGitHub();
   "
   ```

### 🎯 Expected End-to-End Flow

1. ✅ Task assigned to AI agent
2. ✅ Workflow created in database
3. ✅ AI generates implementation plan
4. ✅ AI posts plan as comment
5. ✅ AI generates code autonomously
6. ✅ GitHub client authenticates with YOUR credentials
7. ✅ Branch created in repository
8. ✅ Code committed to branch
9. ✅ Pull request created
10. ✅ PR link posted to task comments

### 🚨 Common Issues

**"No GitHub integration found for user"**
- The `aiAgentConfiguredBy` field is not set on the list
- Or that user doesn't have a GitHub integration
- Fix: Ensure your test list has `aiAgentConfiguredBy: YOUR_USER_ID`

**"No AI providers available"**
- Your user doesn't have API keys configured
- Fix: Add API keys in Settings → AI Agents

**"Repository not found"**
- The `githubRepositoryId` on the list is wrong
- Or your GitHub App doesn't have access to that repo
- Fix: Verify repository name format is `owner/repo`

**GitHub App permission errors:**
- Verify your GitHub App has these permissions:
  - Contents: Read & Write
  - Pull requests: Read & Write
  - Issues: Read & Write

### 📝 Cleanup After Testing

```bash
# Delete test workflows
DATABASE_URL="postgresql://postgres:password@localhost:5432/astrid_dev" npx tsx -e "
import { createScriptPrisma } from './scripts/lib/script-prisma';
const prisma = createScriptPrisma();

async function cleanup() {
  // Delete test workflows
  await prisma.codingTaskWorkflow.deleteMany({
    where: {
      task: { title: { contains: 'hello world' } }
    }
  });

  // Delete test tasks
  await prisma.task.deleteMany({
    where: { title: { contains: 'hello world' } }
  });

  // Delete test list
  await prisma.taskList.deleteMany({
    where: { name: 'AI Agent Test List' }
  });

  console.log('✅ Test data cleaned up');
  await prisma.\$disconnect();
}
cleanup();
"

# Delete GitHub test branches
gh api repos/OWNER/REPO/git/refs/heads/astrid-code-assistant -X DELETE
```

### 🎉 Success Criteria

Your local testing is successful when:
- ✅ AI agent responds to task assignment
- ✅ Implementation plan is generated and posted
- ✅ Code is generated autonomously
- ✅ GitHub branch is created using YOUR credentials
- ✅ Code is committed to the branch
- ✅ Pull request is created
- ✅ No errors in server logs
- ✅ Task comments show the complete workflow

You're now ready to test the GitHub coding agent locally! 🚀
