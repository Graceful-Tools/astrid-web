# 🛠 Troubleshooting Guide

Common issues and solutions for the Astrid Agent setup.

---

## 🚨 **Setup Issues**

### **❌ "Astrid Agent" not appearing in assignee dropdown**

**Symptoms:**
- Can't find coding agent in user search
- Dropdown shows regular users only

**Solutions:**
1. **Run the creation script:**
   ```bash
   DATABASE_URL="postgresql://postgres:password@localhost:5432/astrid_dev" npx tsx scripts/create-specific-ai-agents.ts
   ```

2. **Verify agents were created:**
   ```bash
   # Check database directly
   DATABASE_URL="postgresql://postgres:password@localhost:5432/astrid_dev" npx prisma studio
   # Look for users with emails: claude@astrid.cc and openai-codex@astrid.cc
   ```

3. **Clear browser cache** and refresh the page

---

### **❌ No implementation plan generated after assignment**

**Symptoms:**
- Task assigned to coding agent
- No workflow comment appears
- No activity in task

**Solutions:**
1. **Check AI API key configuration:**
   - Go to User Settings → API Keys
   - Verify key is saved and connection works
   - Test with a simple AI request

2. **Check browser console for errors:**
   ```bash
   # Open browser dev tools (F12)
   # Look for JavaScript errors in Console tab
   # Check Network tab for failed API calls
   ```

3. **Verify assignment detection:**
   ```bash
   # Check if coding assignment hook is working
   # Look for console logs about workflow creation
   ```

4. **Manual workflow creation (debug):**
   ```bash
   DATABASE_URL="postgresql://postgres:password@localhost:5432/astrid_dev" npx tsx scripts/test-ai-agent-workflow.ts
   ```

---

### **❌ GitHub operations failing**

**Symptoms:**
- Implementation plan generated
- "approve" comment doesn't trigger code generation
- No GitHub branch/PR created

**Solutions:**
1. **Check GitHub App configuration:**
   ```bash
   # Verify environment variables in .env.local
   GITHUB_APP_ID=123456
   GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----..."
   GITHUB_WEBHOOK_SECRET=your_secret
   ```

2. **Test GitHub API connection:**
   ```bash
   DATABASE_URL="postgresql://postgres:password@localhost:5432/astrid_dev" npx tsx scripts/test-github-integration.ts
   ```

3. **Check GitHub App permissions:**
   - Go to GitHub App settings
   - Verify permissions: Contents, Issues, PRs (Read & Write)
   - Ensure app is installed on target repository

4. **Verify webhook configuration:**
   - GitHub App → Webhook
   - URL: `http://localhost:3000/api/github/webhook`
   - Secret matches your environment variable
   - Recent deliveries show successful responses

---

## 🔧 **Runtime Issues**

### **❌ "approve" comments not triggering implementation**

**Symptoms:**
- Plan generated successfully
- Comment "approve" but nothing happens
- Workflow stays in AWAITING_APPROVAL state

**Solutions:**
1. **Check if you're the task creator:**
   - Only task creators can approve plans
   - Verify you created the original task

2. **Use exact approval keywords:**
   ```
   approve
   approved
   lgtm
   looks good
   go ahead
   proceed
   yes
   ok
   good to go
   ```

3. **Check workflow status:**
   ```bash
   # Look up workflow in database
   DATABASE_URL="postgresql://postgres:password@localhost:5432/astrid_dev" npx prisma studio
   # Find CodingTaskWorkflow table
   # Verify status is "AWAITING_APPROVAL"
   ```

4. **Check comment processing:**
   - Look for console logs about comment approval detection
   - Verify comment-approval-detector is running

---

### **❌ Generated code quality issues**

**Symptoms:**
- Code is generated but has errors
- TypeScript compilation failures
- Missing imports or dependencies

**Solutions:**
1. **Improve task description:**
   - Be more specific about requirements
   - Mention TypeScript explicitly
   - Include context about existing codebase

2. **Check AI service selection:**
   - Try different AI service (Claude vs OpenAI vs Gemini)
   - Some models perform better for certain tasks

3. **Provide better context:**
   ```
   Title: Create Button component
   Description: Build a TypeScript React button component for our Next.js app.
   Should use our existing CSS modules pattern (styles in .module.css files).
   Include props for size, variant, disabled state. Use our theme colors from globals.css.
   Must be accessible with ARIA attributes.
   ```

---

### **❌ GitHub PR merge issues**

**Symptoms:**
- "merge" comment doesn't merge PR
- PR shows conflicts or failed checks

**Solutions:**
1. **Check PR status:**
   - Ensure PR is ready to merge
   - No merge conflicts exist
   - All checks are passing

2. **Verify merge keywords:**
   ```
   merge
   ship it
   deploy
   ready to merge
   merge it
   looks good to merge
   ship
   ```

3. **Manual merge if needed:**
   - Go to GitHub PR
   - Merge manually if AI merge fails
   - Check for any blocking branch protection rules

---

## 🧪 **Debug Commands**

### **Test AI Workflow**
```bash
DATABASE_URL="postgresql://postgres:password@localhost:5432/astrid_dev" npx tsx scripts/test-ai-agent-workflow.ts
```

### **Test GitHub Integration**
```bash
DATABASE_URL="postgresql://postgres:password@localhost:5432/astrid_dev" npx tsx scripts/test-github-integration.ts
```

### **Test Complete Flow**
```bash
DATABASE_URL="postgresql://postgres:password@localhost:5432/astrid_dev" npx tsx scripts/test-complete-ai-workflow.ts
```

### **Check Database State**
```bash
DATABASE_URL="postgresql://postgres:password@localhost:5432/astrid_dev" npx prisma studio
```

### **View Logs**
```bash
# Check server logs for errors
npm run dev

# Look for these log patterns:
# ✅ [AI Orchestration] ...
# ❌ [AI Orchestration] ...
# 🤖 [Coding Assignment] ...
# ✅ [CommentApproval] ...
```

---

## 📞 **Getting Help**

### **Log Analysis**
When reporting issues, include:
1. Browser console errors
2. Server log output
3. Database workflow state
4. GitHub App delivery logs

### **Environment Check**
Verify all required environment variables:
```bash
echo $GITHUB_APP_ID
echo $GITHUB_WEBHOOK_SECRET
# Don't echo private key for security
```

### **Quick Reset**
If all else fails, try a clean reset:
```bash
# 1. Delete coding agent user from database
# 2. Re-run create-coding-agent script
# 3. Recreate GitHub App connection
# 4. Test with simple task
```

---

## ✅ **Prevention Tips**

- **Test with simple tasks first** before complex implementations
- **Keep AI API keys up to date** and monitor usage limits
- **Regularly check GitHub App permissions** and installation status
- **Monitor browser console** for JavaScript errors during development
- **Use descriptive task titles and requirements** for better AI results

**Most issues are related to configuration - double-check all setup steps!** 🚀