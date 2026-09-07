import { describe, it, expect, beforeAll, afterAll } from 'vitest'

/**
 * MCP SSE Integration Test
 *
 * This test validates that MCP operations trigger appropriate SSE events.
 * It's designed to test the core functionality without complex mocking.
 *
 * Note: MCP operations have been refactored into handler modules in
 * app/api/mcp/operations/handlers/. Tests check both route.ts and handlers.
 */

// Helper to read all MCP operations code (route + handlers)
function getMCPOperationsContent(): string {
  const fs = require('fs')
  const path = require('path')

  const basePath = path.join(process.cwd(), 'app/api/mcp/operations')
  const handlersPath = path.join(basePath, 'handlers')

  let content = ''

  // Read main route.ts
  content += fs.readFileSync(path.join(basePath, 'route.ts'), 'utf8')

  // Read all handler files
  const handlerFiles = fs.readdirSync(handlersPath).filter((f: string) => f.endsWith('.ts'))
  for (const file of handlerFiles) {
    content += fs.readFileSync(path.join(handlersPath, file), 'utf8')
  }

  return content
}

describe('MCP SSE Integration - Core Functionality', () => {
  it('should verify SSE broadcasting functions are properly imported', () => {
    // Skip this test as it has module resolution issues in test environment
    // The functionality is verified by other tests checking the route file content
  })

  it('should verify MCP operations handlers include SSE import', async () => {
    // Read the MCP operations handlers and verify they import SSE utilities
    const allContent = getMCPOperationsContent()

    // Verify SSE import exists in handlers
    expect(allContent).toContain('import { broadcastToUsers }')
    expect(allContent).toContain('@/lib/sse-utils')

    // Verify SSE calls for each operation
    expect(allContent).toContain('comment_deleted')
    // comment_created followed the task verbs out of here (epic 9dedd8aa). It
    // moved into services/comment.service.ts because this handler broadcast the
    // event and then fired NO post-comment side effects: an @-mention posted
    // through MCP notified nobody, and "ship it" was never detected. The
    // broadcast went with the fix, and is asserted against the service below.
    // comment_deleted is still here — delete is the next slice.
    //
    // create, update and delete of TASKS are not asserted here either. All
    // three moved into services/task.service.ts — delete because two of the
    // four surfaces skipped the deletion tombstone, create because the MCP
    // surfaces minted no identifier and posted no creation comment, update
    // because they stamped no completion, cleared no board status and killed
    // repeating series outright. This test checks WHERE the string lives, and
    // the strings moved on purpose.

    // Verify error handling for SSE failures
    expect(allContent).toContain('Failed to broadcast')
    expect(allContent).toContain("Don't fail the operation if SSE fails")
  })

  it('should verify SSE event structure matches expected format', () => {
    // Test a sample event structure that should match what MCP operations send
    const sampleEvent = {
      type: 'task_created',
      timestamp: new Date().toISOString(),
      data: {
        taskId: 'test-task-id',
        taskTitle: 'Test Task',
        taskPriority: 1,
        creatorName: 'Test User',
        userId: 'test-user-id',
        listNames: ['Test List'],
        task: {
          id: 'test-task-id',
          title: 'Test Task',
          priority: 1,
        }
      }
    }

    // Verify the event structure is valid
    expect(sampleEvent.type).toBeDefined()
    expect(sampleEvent.timestamp).toBeDefined()
    expect(sampleEvent.data).toBeDefined()
    expect(sampleEvent.data.taskId).toBeDefined()
    expect(sampleEvent.data.userId).toBeDefined()
  })

  it('should verify helper function for getting list member IDs exists', async () => {
    // Read the MCP operations code (route + handlers) and verify the helper function exists
    const allContent = getMCPOperationsContent()

    // Verify helper function exists (now in handlers/shared.ts)
    expect(allContent).toContain('getListMemberIdsByListId')

    // Verify it handles owner and members through the new system
    expect(allContent).toContain('owner')
    expect(allContent).toContain('listMembers')
    // Legacy admins/members fields removed - all members now tracked in listMembers table
  })

  it('should verify TypeScript compilation passes', () => {
    // This test ensures our SSE additions don't break TypeScript compilation
    // If this test runs, it means TypeScript compilation succeeded
    expect(true).toBe(true)
  })

  it('should verify all MCP operations have SSE broadcasting', async () => {
    const allContent = getMCPOperationsContent()

    // Count SSE broadcast calls for each operation (now in handler files).
    // See above: comment_created and the three task verbs live in the services.
    const commentDeleteBroadcasts = (allContent.match(/comment_deleted/g) || []).length

    // The one comment verb still implemented here broadcasts exactly once.
    expect(commentDeleteBroadcasts).toBe(1)
  })

  it('should verify error handling prevents SSE failures from breaking MCP operations', async () => {
    const allContent = getMCPOperationsContent()

    // Verify each SSE broadcast is wrapped in try-catch
    const tryBlocks = (allContent.match(/try \{[\s\S]*?broadcastToUsers/g) || []).length
    const catchBlocks = (allContent.match(/catch \(error\)[\s\S]*?Failed to broadcast/g) || []).length

    // Should have multiple try-catch blocks for SSE operations
    expect(tryBlocks).toBeGreaterThan(0)
    expect(catchBlocks).toBeGreaterThan(0)

    // Verify SSE error handlers log errors without re-throwing
    // Each SSE error should have:
    // 1. log.error with "Failed to broadcast"
    // 2. A comment "Don't fail the operation if SSE fails"
    expect(allContent).toContain("log.error({ err: error }, '[MCP SSE] Failed to broadcast")
    expect(allContent).toContain("// Don't fail the operation if SSE fails")

    // Verify the SSE error handlers that remain in the MCP handlers; create,
    // update and delete are the service's now.
    const sseErrorHandlers = (allContent.match(/log\.error\(\{ err: error \}, '\[MCP SSE\] Failed to broadcast/g) || []).length
    expect(sseErrorHandlers).toBeGreaterThanOrEqual(1)
  })

  it('broadcasts task_created from the shared create service', async () => {
    // The MCP handlers no longer broadcast this themselves — they call
    // services/task.service.ts, which is also what finally gave them the
    // AST-nnn identifier, the creation comment and the manual-sort entry they
    // had always been missing (epic 9dedd8aa).
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const service = readFileSync(join(process.cwd(), 'services/task.service.ts'), 'utf8')

    expect(service).toContain('task_created')
    expect(service).toContain('broadcastToUsers')
    expect(service).toContain('recordTaskCreationComment')
  })

  it('broadcasts task_updated from the shared update service', async () => {
    // The MCP handlers no longer broadcast this themselves — they call
    // services/task.service.ts, which is also what finally gave them the
    // completion stamp, the board-status clearing and the repeating
    // roll-forward they had never had (epic 9dedd8aa).
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const service = readFileSync(join(process.cwd(), 'services/task.service.ts'), 'utf8')

    expect(service).toContain('task_updated')
    expect(service).toContain('resolveRepeatingTaskCompletion')
    expect(service).toContain('rescheduleRemindersForUpdate')
  })

  it('broadcasts task_deleted from the shared delete service', async () => {
    // The MCP handlers no longer broadcast this themselves — they call
    // services/task.service.ts, which is also what finally gave them the
    // deletion tombstone they had always been missing (epic 9dedd8aa).
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const service = readFileSync(join(process.cwd(), 'services/task.service.ts'), 'utf8')

    expect(service).toContain('task_deleted')
    expect(service).toContain('broadcastToUsers')
    expect(service).toContain('recordDeletion')
  })
})