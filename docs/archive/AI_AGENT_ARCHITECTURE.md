# AI Agent Architecture - Command/Event Pattern

## 🏗️ **New Architecture Overview**

This document describes the new AI agent architecture that eliminates infinite loops through proper separation of concerns using Command and Event patterns.

## 🎯 **Key Principles**

### **1. Command-Query Separation (CQS)**
- **Commands**: One-way operations that change state (no return loops)
- **Queries**: Read-only operations that return data (no side effects)
- **Events**: Read-only notifications (never trigger new commands)

### **2. Clear Ownership**
- **Command Handler**: Owns all AI agent state changes
- **Event Handler**: Owns all notifications and read-only operations
- **API Routes**: Only initiate commands, never directly mutate AI agent state

### **3. Prevents Circular Dependencies**
```
❌ OLD: Comments → Workflows → Commands → Comments (INFINITE LOOP)
✅ NEW: Commands → Events → Notifications (ONE-WAY FLOW)
```

## 🔧 **Architecture Components**

### **AIAgentCommandHandler** (`lib/ai-agent-command-handler.ts`)
**Responsibility**: Execute all AI agent commands exactly once

**Commands**:
- `ASSIGN_TASK`: Assign task to AI agent (user-initiated only)
- `PROCESS_APPROVAL`: Handle user approvals
- `HANDLE_CHANGE_REQUEST`: Process change requests
- `POST_STATUS_UPDATE`: Create AI agent comments

**Key Features**:
- ✅ **Duplicate prevention**: Commands processed exactly once
- ✅ **Initiated-by tracking**: Only user-initiated commands trigger AI processing
- ✅ **Event emission**: All state changes emit read-only events
- ✅ **Error handling**: Failures emit error events, don't crash system

**Example Usage**:
```typescript
const commandHandler = getAIAgentCommandHandler(prisma)

await commandHandler.executeCommand({
  type: 'ASSIGN_TASK',
  taskId: 'task-123',
  aiAgentId: 'ai-agent-456',
  initiatedBy: 'USER', // Critical: prevents loops
  payload: { assignedBy: 'user-789' },
  timestamp: new Date()
})
```

### **AIAgentEventHandler** (`lib/ai-agent-event-handler.ts`)
**Responsibility**: Handle read-only events and notifications

**Events**:
- `TASK_ASSIGNED`: AI agent assigned to task
- `PROCESSING_STARTED`: AI agent started processing
- `COMMENT_POSTED`: AI agent posted comment
- `ERROR_OCCURRED`: AI agent encountered error

**Key Features**:
- ✅ **Read-only operations**: Never mutates database state
- ✅ **Notification routing**: SSE, push notifications, audit logs
- ✅ **User filtering**: Only notifies human users (excludes AI agents)
- ✅ **Failure isolation**: Event processing failures don't break commands

**Example Event Flow**:
```typescript
// Command executes → Event emitted → Notifications sent
ASSIGN_TASK command → TASK_ASSIGNED event → SSE + Push notifications
```

## 🚨 **Anti-Patterns to Avoid**

### **❌ Don't: Direct Database Mutations in Event Handlers**
```typescript
// BAD: Event handler creating comments
await prisma.comment.create({ ... }) // Creates circular dependency!
```

### **❌ Don't: Commands Triggered by AI Agents**
```typescript
// BAD: AI agent triggering new commands
if (initiatedBy === 'AI_AGENT') {
  await executeCommand({ ... }) // Creates infinite loops!
}
```

### **❌ Don't: Workflow Processing in Comments**
```typescript
// BAD: AI comments triggering workflows
if (isAIAgentComment) {
  await processWorkflowAction(...) // Creates assignment loops!
}
```

## ✅ **Correct Usage Patterns**

### **✅ Do: User-Initiated Commands Only**
```typescript
// GOOD: Only users can initiate AI agent commands
if (initiatedBy === 'USER') {
  await commandHandler.executeCommand({ ... })
}
```

### **✅ Do: Events for Notifications**
```typescript
// GOOD: Events trigger read-only notifications
await eventHandler.handleEvent({
  type: 'TASK_ASSIGNED',
  // ... event data
})
```

### **✅ Do: Separate Comment Creation**
```typescript
// GOOD: Commands create comments directly
await prisma.comment.create({
  content: message,
  taskId,
  authorId: aiAgentId,
  // Skip workflow processing for AI comments
})
```

## 🔄 **Migration from Old Architecture**

### **Deprecated Components**
- ❌ `AIAgentWebhookService.notifyTaskAssignment()`
- ❌ `AIOrchestrationService.startTaskProcessing()`
- ❌ Direct `prisma.comment.create()` in AI workflows
- ❌ Workflow processing for AI agent comments

### **Migration Steps**
1. **Replace webhook calls** with command execution
2. **Remove direct orchestration** service usage
3. **Use command handler** for all AI agent operations
4. **Let events handle** notifications automatically

### **Before/After Example**

**❌ OLD (Circular Dependencies)**:
```typescript
// Task assignment triggers multiple services
await aiAgentWebhookService.notifyTaskAssignment(taskId, agentId)
  → creates AIOrchestrationService instance
  → calls startTaskProcessing()
  → creates comment via prisma.comment.create()
  → comment triggers workflow processing
  → workflow creates more task assignments
  → INFINITE LOOP!
```

**✅ NEW (Command/Event Pattern)**:
```typescript
// Task assignment triggers single command
await commandHandler.executeCommand({
  type: 'ASSIGN_TASK',
  taskId,
  aiAgentId,
  initiatedBy: 'USER'
})
  → command executes once
  → emits TASK_ASSIGNED event
  → event handler sends notifications
  → NO FURTHER COMMANDS TRIGGERED
  → LOOP-FREE!
```

## 🧪 **Testing the New Architecture**

### **Verification Steps**
1. **Assign task to AI agent** → Should see single command execution
2. **Check SSE notifications** → Should receive assignment notifications
3. **Monitor for loops** → Should see "already processing" messages if attempted
4. **Verify isolation** → Event failures shouldn't break commands

### **Debug Commands**
```typescript
// Check command processing status
commandHandler.isProcessing('ASSIGN_TASK', taskId, aiAgentId)

// View event history
commandHandler.getEventLog(taskId)
```

## 📈 **Benefits of New Architecture**

### **🛡️ Loop Prevention**
- **Duplicate command protection**: Same command never executes twice
- **Initiator validation**: Only users can start AI agent processing
- **Event isolation**: Notifications never trigger new commands

### **🔧 Maintainability**
- **Single responsibility**: Each component has one clear job
- **Predictable flow**: Commands → Events → Notifications
- **Easy debugging**: Clear audit trail of all operations

### **⚡ Performance**
- **No infinite loops**: CPU usage stays normal
- **Efficient notifications**: Events batch notifications optimally
- **Graceful failures**: Errors don't cascade or crash system

### **🧪 Testability**
- **Command isolation**: Commands can be tested independently
- **Event mocking**: Events can be verified without side effects
- **Deterministic behavior**: Same inputs always produce same outputs

## 🎯 **Next Steps**

1. **Monitor production** for loop elimination
2. **Deprecate old services** gradually
3. **Add more command types** as needed (e.g., CANCEL_PROCESSING)
4. **Enhance event types** for richer notifications
5. **Add command queuing** for high-volume scenarios

This architecture fundamentally solves the infinite loop problem by ensuring AI agent operations flow in one direction only: Commands → Events → Notifications, with no circular dependencies possible.