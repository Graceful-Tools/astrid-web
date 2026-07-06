# 🤖 Astrid Agent Setup Guide

**Transform your coding workflow with AI-powered development assistance!**

The Astrid Agent can automatically analyze coding tasks, generate implementation plans, write production-ready code, and manage GitHub workflows - all through simple task assignments and comment approvals.

---

## 📋 **Prerequisites**

Before you begin, ensure you have:
- [ ] An Astrid account with admin access
- [ ] A GitHub repository you want to work with
- [ ] GitHub repository admin permissions
- [ ] API key for at least one AI service (Claude, OpenAI, Gemini, or GitHub Copilot)

---

## 🚀 **Setup Steps**

### **Step 1: Configure AI Service**

1. **Go to User Settings** → **API Keys**
2. **Add your AI service key:**
   - **Claude**: Get API key from [console.anthropic.com](https://console.anthropic.com)
   - **OpenAI**: Get API key from [platform.openai.com](https://platform.openai.com)
   - **Gemini**: Get API key from [aistudio.google.com](https://aistudio.google.com)
   - **GitHub Copilot**: OpenAI-compatible provider (base URL `https://api.githubcopilot.com`)
3. **Save and test** the connection

### **Step 2: Create GitHub App**

1. **Go to GitHub** → **Settings** → **Developer settings** → **GitHub Apps**
2. **Click "New GitHub App"**
3. **Fill in the form:**

   ```
   GitHub App name: astrid-code-assistant-[your-username]
   Homepage URL: http://localhost:3000
   Webhook URL: http://localhost:3000/api/github/webhook
   Webhook secret: [generate a secure random string]
   ```

4. **Set Repository permissions:**
   - **Contents**: Read & Write
   - **Issues**: Read & Write
   - **Metadata**: Read
   - **Pull requests**: Read & Write
   - **Checks**: Read & Write

5. **Subscribe to events:**
   - [x] Issue comments
   - [x] Pull requests
   - [x] Check runs
   - [x] Check suites
   - [x] Push

6. **Where can this GitHub App be installed?**
   - Select "Only on this account"

7. **Create the app** and note down:
   - App ID
   - Generate and download private key (.pem file)

### **Step 3: Setup Environment Variables**

1. **Copy the private key:**
   ```bash
   # Put your downloaded .pem file in the project root
   cp ~/Downloads/astrid-code-assistant-*.private-key.pem ./github-app-private-key.pem

   # Run the setup script to format it properly
   node scripts/setup-private-key.js
   ```

2. **Add to your .env.local:**
   ```bash
   # GitHub App Configuration
   GITHUB_APP_ID=your_app_id_here
   GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
   [your formatted private key here]
   -----END RSA PRIVATE KEY-----"
   GITHUB_WEBHOOK_SECRET=your_webhook_secret_here
   ```

### **Step 4: Install GitHub App on Repository**

1. **Go to your GitHub App settings**
2. **Click "Install App"** in the left sidebar
3. **Choose your account/organization**
4. **Select repositories:**
   - Choose "Selected repositories"
   - Select the repository you want to work with
5. **Click "Install"**

### **Step 5: Create Coding Agent User**

Run this script to create the AI agent user:

```bash
DATABASE_URL="postgresql://postgres:password@localhost:5432/astrid_dev" npx tsx scripts/create-coding-agent.ts
```

Expected output:
```
✅ Coding Agent created successfully
✅ Default coding list created
✅ MCP tokens configured
🤖 Astrid Agent is ready!
```

### **Step 6: Connect GitHub Integration**

1. **Go to User Settings** → **GitHub Integration**
2. **Click "Connect GitHub App"**
3. **Fill in your GitHub App details:**
   - App ID: [from Step 2]
   - Installation ID: [found in GitHub App installations]
   - Private Key: [paste the formatted key]
   - Webhook Secret: [from Step 2]
4. **Select repositories** you want to enable
5. **Save configuration**

---

## 🔗 **Step 7: Configure Staging & Preview Links (Optional)**

Enable automatic preview links in task comments when AI creates PRs:

### **Web Staging (Vercel)**

Vercel preview links are automatic if you have Vercel's GitHub integration enabled. The worker will poll for the preview URL and post it to the task.

**Required:**
```bash
# Add to .env.local
VERCEL_TOKEN=your-vercel-token  # Get from vercel.com/account/tokens
```

### **iOS TestFlight**

When iOS files are changed, the worker can post TestFlight links after deployment.

**Option A: Simple Setup (Static Link)**

Just add your public TestFlight link:
```bash
# Add to .env.local
TESTFLIGHT_PUBLIC_LINK=https://testflight.apple.com/join/YOUR_CODE
```

Find your link: App Store Connect → Your App → TestFlight → External Testing → Public Link

**Option B: Advanced Setup (App Store Connect API)**

Get richer info including Xcode Cloud build status and build numbers:

1. **Create API Key:**
   - Go to App Store Connect → Users and Access → Keys
   - Click "+" to create a new key
   - Role: "Developer" or "Admin"
   - Download the .p8 file (only available once!)
   - Note the Key ID and Issuer ID

2. **Add to .env.local:**
   ```bash
   ASC_KEY_ID=XXXXXXXXXX
   ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   ASC_APP_ID=1234567890  # From App Store Connect URL
   ASC_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIGT...your key...\n-----END PRIVATE KEY-----"
   ```

3. **What you get:**
   - Xcode Cloud build status (running, succeeded, failed)
   - Build numbers and versions
   - Dynamic TestFlight public link discovery
   - Rich formatted comments with build details

**Test your configuration:**
```bash
npx tsx scripts/test-staging-links.ts
```

**iOS file detection patterns** (for projects with iOS code):
- `ios-app/`, `ios/` directories
- `*.swift`, `*.xcodeproj`, `*.xcworkspace`
- `Info.plist`, `*.entitlements`, `Podfile`

> **Note:** The Astrid iOS app is in a separate repository: https://github.com/Graceful-Tools/astrid-ios

---

## 🧪 **Testing Your Setup**

### **Test 1: Basic Assignment**

1. **Create a new task:**
   ```
   Title: Create a reusable Button component
   Description: Build a TypeScript React button component with props for size, variant, and onClick handler
   ```

2. **Assign to "Astrid Agent"**
   - Search for "Astrid" in the assignee dropdown
   - Select the user with "CODING AGENT" badge

3. **Expected behavior:**
   - Task automatically gets a coding workflow
   - AI generates an implementation plan
   - Plan appears as a comment on the task

### **Test 2: Approval Workflow**

1. **Review the AI-generated plan**
2. **Reply with approval:**
   ```
   approve
   ```
   (or: "approved", "lgtm", "looks good", "proceed")

3. **Expected behavior:**
   - AI starts implementing the code
   - New GitHub branch created: `astrid-code-assistant/[timestamp]-create-reusable-button`
   - Code files committed to branch
   - Pull request created
   - Comment with PR link posted to task

### **Test 3: Code Review & Merge**

1. **Check the GitHub pull request**
   - Review the generated code
   - Verify it matches the requirements

2. **Merge the code (optional):**
   ```
   merge
   ```
   (or: "ship it", "deploy", "merge it")

3. **Expected behavior:**
   - Pull request automatically merged
   - Branch cleaned up
   - Task marked as completed

---

## ✅ **Success Criteria**

Your setup is working correctly if:
- [x] You can assign tasks to "Astrid Agent"
- [x] AI generates implementation plans automatically
- [x] "approve" comments trigger code generation
- [x] GitHub branches and PRs are created automatically
- [x] Generated code is production-ready and follows best practices
- [x] "merge" comments merge PRs automatically

---

## 🛠 **Troubleshooting**

### **Common Issues:**

**❌ "Astrid Agent" not found in assignee dropdown**
- Run the create-coding-agent script
- Check that the agent user was created in the database

**❌ No implementation plan generated**
- Verify AI API key is configured and working
- Check browser console for errors
- Ensure task is assigned to the coding agent

**❌ GitHub operations fail**
- Verify GitHub App has correct permissions
- Check that webhook URL is accessible
- Confirm private key format is correct

**❌ Approval comments don't trigger implementation**
- Ensure you're the task creator (only creators can approve)
- Check that workflow is in "AWAITING_APPROVAL" status
- Verify comment contains approval keywords

### **Debug Commands:**

```bash
# Test AI API connection
DATABASE_URL="postgresql://postgres:password@localhost:5432/astrid_dev" npx tsx scripts/test-ai-agent-workflow.ts

# Check GitHub App configuration
DATABASE_URL="postgresql://postgres:password@localhost:5432/astrid_dev" npx tsx scripts/test-github-integration.ts

# Test complete workflow
DATABASE_URL="postgresql://postgres:password@localhost:5432/astrid_dev" npx tsx scripts/test-complete-ai-workflow.ts
```

---

## 🤖 **AI Agent Registry & Development**

### **Current Registered AI Agents**

The system currently supports these AI agents:
- `claude@astrid.cc` - Claude-based coding assistant
- `openai-codex@astrid.cc` - OpenAI Codex-based assistant

### **Adding New AI Agents**

To add a new AI agent to the system:

#### **Step 1: Update the AI Agent Registry**

Edit `/lib/ai-agent-registry.ts` and add the new agent email to the `AI_AGENT_EMAILS` array:

```typescript
const AI_AGENT_EMAILS = [
  'claude@astrid.cc',
  'openai-codex@astrid.cc',
  'new-agent@astrid.cc',  // ← Add your new agent here
] as const
```

#### **Step 2: Create the AI Agent User**

Create a database user for the new agent:

```typescript
const newAgent = await prisma.user.create({
  data: {
    name: 'New Agent Name',
    email: 'new-agent@astrid.cc',
    isAIAgent: true,
    aiAgentType: 'your_agent_type',
    isActive: true
  }
})
```

#### **Step 3: Configure Agent-Specific Logic**

If your agent needs custom behavior:

1. **Update the AI Orchestrator** (`/lib/ai-orchestrator.ts`)
2. **Add agent-specific prompts** and configuration
3. **Update webhook handling** if different from existing agents

#### **Step 4: Test the Integration**

```bash
# Test the new agent registration
npx tsx -e "
import { getAIAgentRegistryStats } from './lib/ai-agent-registry';
console.log('Registry stats:', getAIAgentRegistryStats());
"

# Verify no notification loops
# Assign a task to the new agent and post a comment to test
```

### **Important Notes for Developers**

⚠️ **Critical**: The AI Agent Registry prevents infinite comment loops by:
- Identifying AI agents by exact email match (not domain pattern)
- Preventing AI agents from receiving webhook notifications about their own comments
- Excluding AI agents from SSE comment notifications to prevent feedback loops

📋 **When adding agents, ensure**:
- Use the `@astrid.cc` domain for consistency
- Set `isAIAgent: true` in the database
- Test that the agent doesn't create comment loops
- Document any agent-specific configuration

🔧 **The registry provides these utilities**:
- `isAIAgentEmail(email)` - Check if email belongs to AI agent
- `isSessionUserAIAgent(sessionUser)` - Check session user
- `isDatabaseUserAIAgent(user)` - Check database user object
- `getRegisteredAIAgentEmails()` - Get all registered emails

---

## 🎯 **What's Next?**

Once your setup is working, you can:

1. **Create complex coding tasks** - The AI can handle full feature implementations
2. **Use with team repositories** - Multiple developers can approve and review AI-generated code
3. **Integrate with CI/CD** - Generated PRs can trigger your existing build and test workflows
4. **Customize the AI prompts** - Modify the orchestrator to match your coding standards
5. **Add new AI agents** - Follow the registry process above to expand AI capabilities

---

## 📞 **Need Help?**

If you encounter issues:
1. Check the troubleshooting section above
2. Review the browser console for errors
3. Check the application logs for detailed error messages
4. Ensure all environment variables are correctly set

**Happy coding with your AI assistant!** 🚀✨