# Local Testing Guide - Cloud Workflow Improvements

**Complete guide to testing Phases 1, 2, and 3 improvements locally before production deployment.**

---

## 🎯 Quick Start (5 minutes)

### **Step 1: Run Automated Test Suite**

```bash
# Run comprehensive test suite
npx tsx scripts/test-cloud-workflow-improvements.ts
```

**What it tests:**
- ✅ Trace ID generation
- ✅ Structured logging format
- ✅ Context size tracking
- ✅ Context pruning logic
- ✅ Repository context loading (ASTRID.md)
- ✅ File tree generation
- ✅ Repository context caching
- ✅ Separate context phases
- ✅ Progress endpoint structure

**Expected output:**
```
=======================================================================
Test Summary
=======================================================================

Total tests: 7
Passed: 7
Success rate: 100%

✓ All core improvements are working correctly!
  Phase 1: Trace IDs, structured logging ✓
  Phase 2: Context tracking, pruning, separation ✓
  Phase 3: Repository context, caching ✓
```

---

## 📋 Comprehensive Testing Workflow

### **Phase 1: Unit Tests (5-10 minutes)**

#### **Test 1.1: Trace ID Generation**
```bash
npx tsx scripts/test-cloud-workflow-improvements.ts
```

**Expected in console:**
```json
{
  "timestamp": "2025-01-11T22:30:00.000Z",
  "traceId": "trace-1736635800000-abc123",
  "level": "info",
  "service": "AIOrchestrator",
  "message": "AIOrchestrator created",
  "aiService": "claude"
}
```

**✅ Success criteria:**
- JSON formatted logs
- Trace ID in format `trace-<timestamp>-<random>`
- All required fields present

---

#### **Test 1.2: Context Size Tracking**
**Already covered by test suite**

Expected output:
```
✓ Small context size: 15 tokens
✓ Large context size: 5000 tokens
✓ Context near limit check: true
```

---

#### **Test 1.3: Context Pruning**
**Already covered by test suite**

Expected output:
```
Original message count: 40
Original context size: 2000 tokens
✓ Pruned message count: 7
✓ Pruned context size: 350 tokens
✓ Reduction: 82%
```

---

### **Phase 2: Progress Endpoint Testing (5 minutes)**

#### **Test 2.1: Check Endpoint Exists**
```bash
# Start dev server
npm run dev

# In another terminal, test endpoint
curl http://localhost:3000/api/coding-workflow/progress/any-task-id
```

**Expected response (404 if no workflow):**
```json
{
  "error": "No workflow found for this task",
  "taskId": "any-task-id"
}
```

**✅ Success:** Endpoint responds (even with 404)

---

#### **Test 2.2: Test with Real Workflow**
```bash
# Get a recent task ID from database
npx tsx -e "
const { createScriptPrisma } = require('./scripts/lib/script-prisma');
const prisma = createScriptPrisma();
(async () => {
  const workflow = await prisma.codingTaskWorkflow.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { taskId: true, status: true }
  });
  console.log('Task ID:', workflow?.taskId);
  console.log('Status:', workflow?.status);
})();
"

# Use the task ID from above
curl http://localhost:3000/api/coding-workflow/progress/TASK_ID | jq
```

**Expected response structure:**
```json
{
  "taskId": "...",
  "workflowId": "...",
  "status": "COMPLETED",
  "traceId": "trace-1736635800000-abc",
  "progress": {
    "phase": "COMPLETED",
    "message": "Workflow completed successfully!",
    "completedSteps": 5,
    "totalSteps": 5,
    "percentComplete": 100
  },
  "timing": {
    "startedAt": "2025-01-11T22:00:00.000Z",
    "lastUpdate": "2025-01-11T22:15:00.000Z",
    "elapsedMs": 900000,
    "estimatedRemainingMs": 0
  },
  "recentActivity": [...]
}
```

**✅ Success criteria:**
- Returns 200 OK
- All fields present
- Trace ID exists (if workflow was created after our changes)

---

### **Phase 3: Repository Context Testing (10 minutes)**

#### **Test 3.1: Verify ASTRID.md is Readable**
```bash
# Check if ASTRID.md exists in your repo
ls -la ASTRID.md

# Test loading with automated test
npx tsx scripts/test-cloud-workflow-improvements.ts
# Look for "Test 4: Repository Context Reading"
```

**Expected output:**
```
✓ Repository context loaded: 25000 characters
  Contains ASTRID.md or CLAUDE.md: true
  Contains ARCHITECTURE.md: true
```

**✅ Success:** ASTRID.md is found and loaded

**⚠️ If not found:**
- ASTRID.md exists in this repository at root level
- Make sure it's committed to your branch
- Check file permissions

---

#### **Test 3.2: Verify File Tree Generation**
**Already covered by test suite**

Expected output:
```
✓ Repository structure generated: 5000 characters
  Preview:
    ## 📁 Repository Structure
    ├── app/
    │   ├── api/
    │   └── page.tsx
    ├── components/
    ├── lib/
    ...
```

---

#### **Test 3.3: Verify Caching Works**
**Already covered by test suite**

Expected output:
```
✓ First load took: 1500ms
✓ Second load took: 5ms
✓ Cache working! Second load 99% faster
```

---

### **Phase 4: End-to-End Workflow Test (15-20 minutes)**

#### **Test 4.1: Create Test Task**

**Option A: Via Astrid UI**
1. Open http://localhost:3000
2. Create a new task with title: "Test: Simple CSS color change"
3. Description: "Change the primary button color from blue to green in components/ui/button.tsx"
4. Note the task ID (from URL: `/tasks/TASK_ID`)

**Option B: Via Script**
```bash
npx tsx -e "
const { createScriptPrisma } = require('./scripts/lib/script-prisma');
const prisma = createScriptPrisma();
(async () => {
  const list = await prisma.taskList.findFirst({
    where: { aiAgentConfiguredBy: { not: null } }
  });

  if (!list) {
    console.log('No list with AI agent configured');
    return;
  }

  const task = await prisma.task.create({
    data: {
      title: 'Test: Simple CSS color change',
      description: 'Change the primary button color from blue to green in components/ui/button.tsx',
      creatorId: list.ownerId,
      lists: { connect: { id: list.id } }
    }
  });

  console.log('Created task:', task.id);
})();
"
```

---

#### **Test 4.2: Assign to AI Agent**

**Option A: Via UI**
1. Open the task in Astrid
2. Click "Assign" → Select "Astrid Agent" or "Claude Code Agent"
3. Confirm assignment

**Option B: Via Script**
```bash
npx tsx -e "
const { createScriptPrisma } = require('./scripts/lib/script-prisma');
const prisma = createScriptPrisma();
(async () => {
  const agent = await prisma.user.findFirst({
    where: { isAIAgent: true }
  });

  if (!agent) {
    console.log('No AI agent found');
    return;
  }

  await prisma.task.update({
    where: { id: 'YOUR_TASK_ID' },
    data: { assigneeId: agent.id }
  });

  console.log('Task assigned to:', agent.name);
})();
"
```

---

#### **Test 4.3: Monitor Workflow Execution**

**Terminal 1: Application Logs**
```bash
# Watch structured logs with trace IDs
npm run dev 2>&1 | grep -E 'traceId|phase|context'
```

**Expected logs:**
```json
{"timestamp":"...","traceId":"trace-1736635800000-abc","level":"info","message":"Starting complete workflow execution"}
{"timestamp":"...","traceId":"trace-1736635800000-abc","level":"info","message":"Phase 2: Creating dedicated planning context"}
{"timestamp":"...","traceId":"trace-1736635800000-xyz","level":"info","message":"Planning orchestrator created"}
{"timestamp":"...","traceId":"trace-1736635800000-xyz","level":"info","message":"Loaded ASTRID.md from repository","size":25000}
{"timestamp":"...","traceId":"trace-1736635800000-xyz","level":"info","message":"Context size check","currentTokens":12000}
{"timestamp":"...","traceId":"trace-1736635800000-xyz","level":"info","message":"Planning phase complete (dedicated context)"}
{"timestamp":"...","traceId":"trace-1736635800000-abc","level":"info","message":"Phase 2: Creating fresh implementation context"}
{"timestamp":"...","traceId":"trace-1736635800000-def","level":"info","message":"Implementation orchestrator created"}
{"timestamp":"...","traceId":"trace-1736635800000-def","level":"info","message":"Using cached repository context"}
```

**✅ Key things to look for:**
- ✅ Different trace IDs for planning and implementation orchestrators
- ✅ "Loaded ASTRID.md from repository" message
- ✅ "Using cached repository context" on second load
- ✅ Context size tracking logs
- ✅ No "Context pruned" unless handling large task (good sign if absent)

---

**Terminal 2: Progress Endpoint Polling**
```bash
# Replace TASK_ID with your test task ID
watch -n 5 'curl -s http://localhost:3000/api/coding-workflow/progress/TASK_ID | jq ".progress, .timing"'
```

**Expected output (refreshes every 5 seconds):**
```json
{
  "phase": "PLANNING",
  "message": "Analyzing codebase and creating implementation plan...",
  "completedSteps": 1,
  "totalSteps": 5,
  "percentComplete": 20
}
{
  "startedAt": "2025-01-11T22:00:00.000Z",
  "lastUpdate": "2025-01-11T22:02:00.000Z",
  "elapsedMs": 120000,
  "estimatedRemainingMs": 480000
}
```

**Then after a few minutes:**
```json
{
  "phase": "IMPLEMENTING",
  "message": "Generating code changes...",
  "completedSteps": 3,
  "totalSteps": 5,
  "percentComplete": 60
}
```

---

**Terminal 3: Database Monitoring (Optional)**
```bash
npx tsx -e "
const { createScriptPrisma } = require('./scripts/lib/script-prisma');
const prisma = createScriptPrisma();

setInterval(async () => {
  const workflow = await prisma.codingTaskWorkflow.findUnique({
    where: { taskId: 'YOUR_TASK_ID' },
    select: { status: true, metadata: true }
  });

  console.log(new Date().toISOString(), '|', workflow?.status, '|',
    (workflow?.metadata as any)?.traceId || 'no trace');
}, 5000);
"
```

---

#### **Test 4.4: Verify Task Comments**

After workflow completes (or at any point):

```bash
npx tsx -e "
const { createScriptPrisma } = require('./scripts/lib/script-prisma');
const prisma = createScriptPrisma();
(async () => {
  const comments = await prisma.comment.findMany({
    where: { taskId: 'YOUR_TASK_ID' },
    orderBy: { createdAt: 'asc' },
    include: { author: { select: { name: true, isAIAgent: true } } }
  });

  comments.forEach(c => {
    console.log('---');
    console.log('Author:', c.author.name, c.author.isAIAgent ? '(AI)' : '');
    console.log('Content:', c.content.substring(0, 100) + '...');
  });
})();
"
```

**Expected comments:**
1. "🔍 **Analysis Started**" - Initial status
2. "🕒 **Still Analyzing**" - If planning takes >5 minutes (optional)
3. Plan comment with file changes
4. "⚙️ **Implementation Starting**" - Fresh context notification
5. Error or completion status

**✅ Success criteria:**
- AI agent posts regular status updates
- Comments include trace ID in error messages
- No generic "Unknown error" messages

---

### **Phase 5: Verification Checklist**

After running all tests, verify:

#### **✅ Phase 1: Quick Wins**
- [ ] Trace IDs appear in all logs
- [ ] Logs are JSON formatted with consistent structure
- [ ] Progress endpoint returns structured data
- [ ] Error messages include trace IDs

#### **✅ Phase 2: Context Management**
- [ ] Context size is logged before API calls
- [ ] Different trace IDs for planning vs implementation orchestrators
- [ ] No "context limit exceeded" errors
- [ ] Context pruning triggered only when needed

#### **✅ Phase 3: Repository Context**
- [ ] ASTRID.md is loaded and logged
- [ ] File tree is generated
- [ ] Cache is used on second load (check "Using cached" log)
- [ ] AI follows conventions from ASTRID.md (if workflow completes)

---

## 🔍 Debugging Failed Tests

### **Issue: "No repository found"**
**Solution:**
```bash
# Check if any lists have GitHub integration
npx tsx -e "
const { createScriptPrisma } = require('./scripts/lib/script-prisma');
const prisma = createScriptPrisma();
(async () => {
  const count = await prisma.taskList.count({
    where: { githubRepositoryId: { not: null } }
  });
  console.log('Lists with GitHub:', count);
})();
"
```

If 0, repository context tests will be skipped (expected).

---

### **Issue: "Failed to load ASTRID.md"**
**Solutions:**
1. **Check file exists:**
   ```bash
   ls -la ASTRID.md
   cat ASTRID.md | head -20
   ```

2. **Check GitHub integration:**
   - Verify GitHub token is configured
   - Test GitHub client directly:
   ```bash
   npx tsx -e "
   const { GitHubClient } = require('./lib/github-client');
   (async () => {
     try {
       const client = await GitHubClient.forUser('YOUR_USER_ID');
       const file = await client.getFile('owner/repo', 'ASTRID.md');
       console.log('✓ Can read ASTRID.md');
     } catch (err) {
       console.error('✗ Error:', err.message);
     }
   })();
   "
   ```

---

### **Issue: "Context pruning not triggered"**
**This is actually GOOD!** It means:
- Workflows are small enough to fit in 8192 tokens
- No context bloat occurring
- Phase separation is working

To force-test pruning, you'd need a very large task with 50+ file reads.

---

### **Issue: "Progress endpoint returns 404"**
**Solutions:**
1. **Check server is running:**
   ```bash
   curl http://localhost:3000/api/health
   ```

2. **Verify API route exists:**
   ```bash
   ls -la app/api/coding-workflow/progress/\[taskId\]/route.ts
   ```

3. **Check task has workflow:**
   ```bash
   npx tsx -e "
   const { createScriptPrisma } = require('./scripts/lib/script-prisma');
   const prisma = createScriptPrisma();
   (async () => {
     const workflow = await prisma.codingTaskWorkflow.findUnique({
       where: { taskId: 'YOUR_TASK_ID' }
     });
     console.log('Workflow exists:', !!workflow);
   })();
   "
   ```

---

## 📊 Expected Test Results

### **Passing Tests (100% success rate):**
```
Test Summary
=======================================================================
Total tests: 7
Passed: 7
Failed: 0

Success rate: 100%

✓ All core improvements are working correctly!
```

### **Partial Success (85% - GitHub not configured):**
```
Test Summary
=======================================================================
Total tests: 7
Passed: 5
Failed: 2 (Repository context tests)

Success rate: 71%

⚠ Some tests failed. Review errors above.
```

**This is OK if:**
- Tests 1-3 pass (Phase 1 & 2 core features)
- Only repository context tests fail
- You'll test repository features separately with real workflow

---

## 🎯 Success Criteria

**Minimum for production:**
- ✅ Tests 1-3 pass (85%+ success rate)
- ✅ Progress endpoint responds
- ✅ Trace IDs appear in logs
- ✅ Context separation confirmed (different trace IDs)

**Ideal for production:**
- ✅ All tests pass (100% success rate)
- ✅ Repository context loads successfully
- ✅ Caching works as expected
- ✅ End-to-end workflow completes

---

## 🚀 Next Steps After Testing

1. **If all tests pass:**
   ```bash
   git add .
   git commit -m "feat: implement cloud workflow improvements (Phases 1-3)"
   git push origin main
   ```

2. **Deploy and monitor:**
   - Watch first production workflow with trace IDs
   - Check success rate over first 10 tasks
   - Verify no context limit errors

3. **Collect metrics:**
   - Success rate (target: 90-95%)
   - Average duration (target: 10-20 min)
   - Context errors (target: <5%)
   - User satisfaction (qualitative)

---

## 📝 Test Log Template

Copy this to track your testing session:

```markdown
## Testing Session: Cloud Workflow Improvements

**Date:** 2025-01-11
**Tester:** [Your Name]

### Phase 1: Unit Tests
- [ ] Automated test suite run
- [ ] Success rate: ____%
- [ ] Issues found: ___________

### Phase 2: Progress Endpoint
- [ ] Endpoint responds
- [ ] Returns correct structure
- [ ] Trace IDs present
- [ ] Issues: ___________

### Phase 3: Repository Context
- [ ] ASTRID.md loaded
- [ ] File tree generated
- [ ] Caching works
- [ ] Issues: ___________

### Phase 4: End-to-End
- [ ] Task created
- [ ] Assigned to AI agent
- [ ] Workflow started
- [ ] Logs show trace IDs
- [ ] Logs show context management
- [ ] Logs show repository context
- [ ] Workflow completed: [ ] Yes [ ] No
- [ ] Duration: _____ minutes
- [ ] Issues: ___________

### Overall Assessment
**Ready for production:** [ ] Yes [ ] No
**Concerns:** ___________
**Next steps:** ___________
```

---

## 🎉 You're Ready!

Once you've completed this testing guide:
- ✅ You'll have confidence all improvements work
- ✅ You'll understand what logs to look for
- ✅ You'll know how to debug issues
- ✅ You can deploy to production with confidence

**Happy testing!** 🚀
