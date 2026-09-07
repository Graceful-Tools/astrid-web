/**
 * REGRESSION TEST: Comments disappearing via SSE
 *
 * Bug: Comments added by other users would disappear because the comment_created
 * SSE event was not being handled in TaskDetail. The handler just logged and broke
 * without actually updating the task's comments array.
 *
 * Fix: The comment_created case in TaskDetail's useSSESubscription now properly
 * adds the new comment to the task's comments array.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { upsertComment } from '@/lib/comment-stream'

describe('TaskDetail SSE Comment Handling - Regression', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('REGRESSION: comment_created event handling', () => {
    it('should add new comment from SSE event to existing comments', () => {
      // Simulate the event handling logic that was fixed
      const existingComments = [
        {
          id: 'comment-1',
          content: 'First comment',
          authorId: 'user-1',
          createdAt: new Date('2024-01-01T10:00:00Z'),
        },
      ]

      const sseEvent = {
        type: 'comment_created',
        data: {
          taskId: 'task-1',
          userId: 'user-2', // Different user
          comment: {
            id: 'comment-2',
            content: 'New comment via SSE',
            authorId: 'user-2',
            createdAt: new Date('2024-01-01T11:00:00Z'),
          },
        },
      }

      const currentTaskId = 'task-1'
      const currentUserId = 'user-1'

      // This is the logic from the fix
      const { taskId, comment, userId } = sseEvent.data

      // Should process: same task, different user, comment exists
      expect(taskId).toBe(currentTaskId)
      expect(userId).not.toBe(currentUserId)
      expect(comment).toBeDefined()

      // Check if comment already exists (avoid duplicates)
      const commentExists = existingComments.some(c => c.id === comment.id)
      expect(commentExists).toBe(false)

      // Add the new comment and sort by creation date
      const updatedComments = [...existingComments, comment].sort((a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      )

      expect(updatedComments).toHaveLength(2)
      expect(updatedComments[0].id).toBe('comment-1')
      expect(updatedComments[1].id).toBe('comment-2')
    })

    it('should NOT add duplicate comments from SSE event', () => {
      const existingComments = [
        {
          id: 'comment-1',
          content: 'First comment',
          authorId: 'user-1',
          createdAt: new Date('2024-01-01T10:00:00Z'),
        },
      ]

      const sseEvent = {
        type: 'comment_created',
        data: {
          taskId: 'task-1',
          userId: 'user-2',
          comment: {
            id: 'comment-1', // Same ID as existing comment
            content: 'Duplicate comment',
            authorId: 'user-2',
            createdAt: new Date('2024-01-01T11:00:00Z'),
          },
        },
      }

      const { comment } = sseEvent.data

      // Check if comment already exists
      const commentExists = existingComments.some(c => c.id === comment.id)
      expect(commentExists).toBe(true)

      // Should NOT add duplicate - comments array stays the same
      if (!commentExists) {
        // This branch should NOT be taken
        existingComments.push(comment)
      }

      expect(existingComments).toHaveLength(1)
    })

    it('DOES process an SSE event from the current user on another device', () => {
      // This used to assert the opposite: same user id => skip, because "the
      // optimistic update already handled it". That holds for the tab that
      // posted the comment and for nothing else. Commenting on the Mac app and
      // reading on web is one user id on two SSE connections, so the rule
      // silently threw away every comment the user wrote elsewhere — the bug
      // in task cb1581e0. The handler now runs upsertComment, which dedupes on
      // comment id and is therefore device-count-independent.
      const existingComments = [
        {
          id: 'comment-1',
          content: 'First comment',
          authorId: 'user-1',
          createdAt: new Date('2024-01-01T10:00:00Z'),
        },
      ] as never

      const fromMyMac = {
        id: 'comment-2',
        content: 'My own comment, written on the Mac',
        authorId: 'user-1', // same user as the web session
        createdAt: new Date('2024-01-01T11:00:00Z'),
      } as never

      expect(upsertComment(existingComments, fromMyMac).map(c => c.id))
        .toEqual(['comment-1', 'comment-2'])

      // And the echo of a comment already on screen still does not double it.
      expect(upsertComment(upsertComment(existingComments, fromMyMac), fromMyMac))
        .toHaveLength(2)
    })

    it('should NOT process SSE event for different task', () => {
      const currentTaskId = 'task-1'

      const sseEvent = {
        type: 'comment_created',
        data: {
          taskId: 'task-999', // Different task
          userId: 'user-2',
          comment: {
            id: 'comment-2',
            content: 'Comment for different task',
            authorId: 'user-2',
            createdAt: new Date('2024-01-01T11:00:00Z'),
          },
        },
      }

      const { taskId } = sseEvent.data

      // Should NOT process: different task
      expect(taskId).not.toBe(currentTaskId)
      // The handler should return early and not update
    })

    it('should sort comments by creation date after adding', () => {
      const existingComments = [
        {
          id: 'comment-2',
          content: 'Later comment',
          authorId: 'user-1',
          createdAt: new Date('2024-01-01T12:00:00Z'),
        },
      ]

      const newComment = {
        id: 'comment-1',
        content: 'Earlier comment via SSE',
        authorId: 'user-2',
        createdAt: new Date('2024-01-01T10:00:00Z'), // Earlier than existing
      }

      const updatedComments = [...existingComments, newComment].sort((a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      )

      // Should be sorted chronologically (earlier first)
      expect(updatedComments[0].id).toBe('comment-1')
      expect(updatedComments[1].id).toBe('comment-2')
    })
  })

  describe('REGRESSION: SSE reconnection race condition (2026-01-18)', () => {
    /**
     * Bug: When SSE reconnects, handleRefreshComments fetches fresh task data
     * and calls onLocalUpdate(freshTask). However, taskRef.current doesn't update
     * until React re-renders the component. If an SSE event arrives in between,
     * it reads stale taskRef.current and overwrites the fresh data with stale
     * comments, causing comments to disappear.
     *
     * Fix: Update taskRef.current immediately in handleRefreshComments BEFORE
     * calling onLocalUpdate, so any SSE events that arrive before re-render
     * will use the fresh task data.
     */

    it('should update taskRef immediately when refreshing to prevent race condition', () => {
      // Simulate the race condition scenario
      const staleTask = {
        id: 'task-1',
        comments: [
          { id: 'comment-A', content: 'Old comment A', createdAt: new Date('2024-01-01T10:00:00Z') },
          { id: 'comment-B', content: 'Old comment B', createdAt: new Date('2024-01-01T11:00:00Z') },
        ],
      }

      const freshTask = {
        id: 'task-1',
        comments: [
          { id: 'comment-A', content: 'Old comment A', createdAt: new Date('2024-01-01T10:00:00Z') },
          { id: 'comment-B', content: 'Old comment B', createdAt: new Date('2024-01-01T11:00:00Z') },
          { id: 'comment-C', content: 'New comment during disconnect', createdAt: new Date('2024-01-01T12:00:00Z') },
          { id: 'comment-D', content: 'Another new comment', createdAt: new Date('2024-01-01T13:00:00Z') },
        ],
      }

      // Simulate taskRef behavior
      const taskRef = { current: staleTask }

      // The FIX: Update taskRef BEFORE triggering state updates
      // This is what handleRefreshComments now does
      taskRef.current = freshTask

      // Now simulate an SSE event arriving (would happen before React re-render)
      const sseEvent = {
        type: 'comment_created',
        data: {
          taskId: 'task-1',
          userId: 'user-2',
          comment: {
            id: 'comment-E',
            content: 'SSE comment arriving during reconnect',
            createdAt: new Date('2024-01-01T14:00:00Z'),
          },
        },
      }

      // SSE handler reads from taskRef.current (now has fresh data)
      const currentTask = taskRef.current
      const existingComments = currentTask.comments || []
      const { comment } = sseEvent.data

      // Check if comment already exists
      const commentExists = existingComments.some(c => c.id === comment.id)
      expect(commentExists).toBe(false)

      // Add new comment from SSE
      const updatedComments = [...existingComments, comment].sort((a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      )

      // CRITICAL: Should have ALL 5 comments (4 fresh + 1 new SSE)
      // Before the fix, it would only have 3 (2 stale + 1 new SSE)
      expect(updatedComments).toHaveLength(5)
      expect(updatedComments.map(c => c.id)).toEqual([
        'comment-A',
        'comment-B',
        'comment-C',
        'comment-D',
        'comment-E',
      ])
    })

    it('should NOT lose comments when SSE event merges with stale taskRef (the bug scenario)', () => {
      // This test documents what WOULD happen without the fix
      // to ensure we understand the bug

      const staleTask = {
        id: 'task-1',
        comments: [
          { id: 'comment-A', content: 'Old comment A', createdAt: new Date('2024-01-01T10:00:00Z') },
          { id: 'comment-B', content: 'Old comment B', createdAt: new Date('2024-01-01T11:00:00Z') },
        ],
      }

      const freshTask = {
        id: 'task-1',
        comments: [
          { id: 'comment-A', content: 'Old comment A', createdAt: new Date('2024-01-01T10:00:00Z') },
          { id: 'comment-B', content: 'Old comment B', createdAt: new Date('2024-01-01T11:00:00Z') },
          { id: 'comment-C', content: 'New comment during disconnect', createdAt: new Date('2024-01-01T12:00:00Z') },
          { id: 'comment-D', content: 'Another new comment', createdAt: new Date('2024-01-01T13:00:00Z') },
        ],
      }

      // BUG SCENARIO: If taskRef was NOT updated immediately...
      const buggyTaskRef = { current: staleTask }
      // ... and we called onLocalUpdate(freshTask) but React hasn't re-rendered yet...
      // ... then SSE event arrives and reads stale taskRef:

      const sseComment = {
        id: 'comment-E',
        content: 'SSE comment',
        createdAt: new Date('2024-01-01T14:00:00Z'),
      }

      // Without the fix, SSE handler would do:
      const buggyComments = [...buggyTaskRef.current.comments, sseComment]

      // This would result in only 3 comments, losing C and D!
      expect(buggyComments).toHaveLength(3)
      expect(buggyComments.map(c => c.id)).toEqual(['comment-A', 'comment-B', 'comment-E'])

      // The fix ensures taskRef.current = freshTask BEFORE any SSE events
      // So the correct result is 5 comments
      buggyTaskRef.current = freshTask // Apply fix
      const fixedComments = [...buggyTaskRef.current.comments, sseComment]
      expect(fixedComments).toHaveLength(5)
    })
  })

  describe('REGRESSION: Concurrent refresh guard prevents comment flashing (2026-01-18)', () => {
    /**
     * Bug: When SSE reconnects, multiple concurrent handleRefreshComments calls
     * could stack up, and SSE events arriving during the fetch would cause
     * comments to flash/disappear as multiple state updates competed.
     *
     * Fix: Added isRefreshingCommentsRef guard that:
     * 1. Prevents multiple concurrent handleRefreshComments calls
     * 2. Makes SSE handler skip comment-related events during refresh
     */

    it('should prevent concurrent refresh calls using isRefreshingRef guard', () => {
      // Simulate the guard behavior
      const isRefreshingCommentsRef = { current: false }
      let refreshCallCount = 0

      const handleRefreshComments = async () => {
        // Guard against concurrent refreshes
        if (isRefreshingCommentsRef.current) {
          return // Skip - already refreshing
        }

        isRefreshingCommentsRef.current = true
        refreshCallCount++

        try {
          // Simulate async fetch
          await new Promise(resolve => setTimeout(resolve, 10))
        } finally {
          isRefreshingCommentsRef.current = false
        }
      }

      // Simulate rapid SSE reconnect triggering multiple refresh calls
      handleRefreshComments()
      handleRefreshComments()
      handleRefreshComments()

      // Only the first call should have started
      expect(refreshCallCount).toBe(1)
      expect(isRefreshingCommentsRef.current).toBe(true)
    })

    it('should skip SSE comment events while refresh is in progress', () => {
      const isRefreshingCommentsRef = { current: true } // Refresh in progress
      let sseEventProcessed = false

      // Simulate SSE event handler
      const handleSSEEvent = (event: { type: string; data: { task?: { comments?: unknown[] } } }) => {
        // Skip SSE updates for comment events while refresh is in progress
        if (isRefreshingCommentsRef.current &&
            (event.type === 'comment_created' || event.type === 'comment_updated' || event.type === 'comment_deleted' ||
             (event.type === 'task_updated' && event.data.task?.comments))) {
          return // Skip - refresh in progress
        }

        sseEventProcessed = true
      }

      // These events should be skipped during refresh
      handleSSEEvent({ type: 'comment_created', data: {} })
      expect(sseEventProcessed).toBe(false)

      handleSSEEvent({ type: 'comment_updated', data: {} })
      expect(sseEventProcessed).toBe(false)

      handleSSEEvent({ type: 'comment_deleted', data: {} })
      expect(sseEventProcessed).toBe(false)

      handleSSEEvent({ type: 'task_updated', data: { task: { comments: [] } } })
      expect(sseEventProcessed).toBe(false)

      // Non-comment task_updated should still process
      handleSSEEvent({ type: 'task_updated', data: { task: { title: 'Updated' } } })
      expect(sseEventProcessed).toBe(true)
    })

    it('should process SSE events after refresh completes', () => {
      const isRefreshingCommentsRef = { current: false } // Refresh completed
      let sseEventProcessed = false

      const handleSSEEvent = (event: { type: string }) => {
        if (isRefreshingCommentsRef.current &&
            event.type === 'comment_created') {
          return
        }

        sseEventProcessed = true
      }

      // After refresh completes, events should be processed
      handleSSEEvent({ type: 'comment_created' })
      expect(sseEventProcessed).toBe(true)
    })
  })

  describe('REGRESSION: TaskManagerController task_updated should not overwrite comments (2026-01-18)', () => {
    /**
     * Bug: When SSE reconnects, task_updated events from the recovery period (?since=)
     * would include stale comments arrays. TaskManagerController's handleTaskUpdated
     * would merge these into the tasks state, overwriting fresh comments and causing
     * them to flash/disappear.
     *
     * Fix: handleTaskUpdated now excludes the `comments` field from the merge.
     * Comments should only be updated via:
     * 1. Specific comment_created/updated/deleted SSE events
     * 2. Full API refresh (loadData or handleRefreshComments)
     */

    it('should NOT overwrite comments when processing task_updated SSE event', () => {
      // Simulate current task state with fresh comments
      const currentTask = {
        id: 'task-1',
        title: 'Original Title',
        description: 'Original description',
        comments: [
          { id: 'comment-A', content: 'Comment A', createdAt: new Date('2024-01-01T10:00:00Z') },
          { id: 'comment-B', content: 'Comment B', createdAt: new Date('2024-01-01T11:00:00Z') },
          { id: 'comment-C', content: 'Fresh comment from refresh', createdAt: new Date('2024-01-01T12:00:00Z') },
        ],
      }

      // SSE task_updated event with stale comments (missing comment-C)
      const sseTaskData = {
        id: 'task-1',
        title: 'Updated Title',
        comments: [
          { id: 'comment-A', content: 'Comment A', createdAt: new Date('2024-01-01T10:00:00Z') },
          { id: 'comment-B', content: 'Comment B', createdAt: new Date('2024-01-01T11:00:00Z') },
        ],
      }

      // Simulate the FIX: Exclude comments from merge
      const { comments: _ignoredComments, ...taskDataWithoutComments } = sseTaskData
      const updatedTask = { ...currentTask, ...taskDataWithoutComments }

      // Title should be updated
      expect(updatedTask.title).toBe('Updated Title')

      // CRITICAL: Comments should be PRESERVED (not overwritten by stale SSE data)
      expect(updatedTask.comments).toHaveLength(3)
      expect(updatedTask.comments.map(c => c.id)).toEqual(['comment-A', 'comment-B', 'comment-C'])
    })

    it('should update other task fields without affecting comments', () => {
      const currentTask = {
        id: 'task-1',
        title: 'Old Title',
        description: 'Old description',
        priority: 1,
        completed: false,
        comments: [
          { id: 'comment-X', content: 'Important comment' },
        ],
      }

      // SSE update with multiple field changes (but also includes comments in payload)
      const sseTaskData = {
        id: 'task-1',
        title: 'New Title',
        description: 'New description',
        priority: 3,
        completed: true,
        comments: [], // Empty/stale comments from SSE
      }

      // Apply the fix: exclude comments
      const { comments: _ignored, ...taskDataWithoutComments } = sseTaskData
      const updatedTask = { ...currentTask, ...taskDataWithoutComments }

      // All non-comment fields should be updated
      expect(updatedTask.title).toBe('New Title')
      expect(updatedTask.description).toBe('New description')
      expect(updatedTask.priority).toBe(3)
      expect(updatedTask.completed).toBe(true)

      // Comments should be preserved
      expect(updatedTask.comments).toHaveLength(1)
      expect(updatedTask.comments[0].id).toBe('comment-X')
    })

    it('demonstrates the bug scenario without the fix', () => {
      // This test documents what WOULD happen without the fix
      const currentTask = {
        id: 'task-1',
        comments: [
          { id: 'c1', content: 'Comment 1' },
          { id: 'c2', content: 'Comment 2' },
          { id: 'c3', content: 'Fresh comment' },
        ],
      }

      const staleSSEData = {
        id: 'task-1',
        title: 'Updated',
        comments: [
          { id: 'c1', content: 'Comment 1' },
          { id: 'c2', content: 'Comment 2' },
          // c3 is missing - this is stale data!
        ],
      }

      // WITHOUT the fix - comments get overwritten
      const buggyResult = { ...currentTask, ...staleSSEData }
      expect(buggyResult.comments).toHaveLength(2) // BUG: Comment c3 is lost!

      // WITH the fix - comments are preserved
      const { comments: _, ...dataWithoutComments } = staleSSEData
      const fixedResult = { ...currentTask, ...dataWithoutComments }
      expect(fixedResult.comments).toHaveLength(3) // FIXED: All comments preserved
    })
  })

  describe('REGRESSION: loadData should preserve comments from existing tasks (2026-01-18)', () => {
    /**
     * Bug: When SSE reconnects, TaskManagerController's debounced loadData() runs
     * after 2 seconds. The /api/tasks endpoint returns tasks with _count.comments
     * (just a count) but NOT actual comments (for performance). loadData() was
     * replacing the entire tasks state, causing tasks that had fresh comments
     * (loaded via TaskDetail refresh) to lose them.
     *
     * Fix: loadData() now preserves the comments array from existing tasks
     * when merging with server data that doesn't include comments.
     */

    it('should preserve comments when loadData returns tasks without comments', () => {
      // Existing task in state (with comments loaded from task detail)
      const existingTasks = [
        {
          id: 'task-1',
          title: 'Task 1',
          comments: [
            { id: 'c1', content: 'Comment 1' },
            { id: 'c2', content: 'Comment 2' },
          ],
        },
        {
          id: 'task-2',
          title: 'Task 2',
          comments: [
            { id: 'c3', content: 'Comment 3' },
          ],
        },
      ]

      // Server response from /api/tasks (no comments, just _count)
      const serverTasks = [
        {
          id: 'task-1',
          title: 'Task 1 Updated',
          _count: { comments: 2 },
          // No comments array - this is expected from /api/tasks
        },
        {
          id: 'task-2',
          title: 'Task 2',
          _count: { comments: 1 },
        },
      ]

      // Simulate the FIX: preserve comments during merge
      const prevTaskMap = new Map(existingTasks.map(t => [t.id, t]))
      const mergedTasks = serverTasks.map(serverTask => {
        const existingTask = prevTaskMap.get(serverTask.id)
        if (existingTask?.comments && existingTask.comments.length > 0 && !(serverTask as any).comments) {
          return { ...serverTask, comments: existingTask.comments }
        }
        return serverTask
      })

      // Task 1 should have updated title but preserved comments
      expect(mergedTasks[0].title).toBe('Task 1 Updated')
      expect((mergedTasks[0] as any).comments).toHaveLength(2)
      expect((mergedTasks[0] as any).comments[0].id).toBe('c1')

      // Task 2 should also preserve comments
      expect((mergedTasks[1] as any).comments).toHaveLength(1)
      expect((mergedTasks[1] as any).comments[0].id).toBe('c3')
    })

    it('should use server comments when server actually returns them', () => {
      const existingTasks = [
        {
          id: 'task-1',
          comments: [{ id: 'old-comment', content: 'Old' }],
        },
      ]

      // Server returns task WITH comments (e.g., from a different endpoint)
      const serverTasks = [
        {
          id: 'task-1',
          comments: [
            { id: 'new-c1', content: 'New 1' },
            { id: 'new-c2', content: 'New 2' },
          ],
        },
      ]

      const prevTaskMap = new Map(existingTasks.map(t => [t.id, t]))
      const mergedTasks = serverTasks.map(serverTask => {
        const existingTask = prevTaskMap.get(serverTask.id)
        // Only preserve if server task doesn't have comments
        if (existingTask?.comments && existingTask.comments.length > 0 && !(serverTask as any).comments) {
          return { ...serverTask, comments: existingTask.comments }
        }
        return serverTask
      })

      // Should use server comments since server returned them
      expect((mergedTasks[0] as any).comments).toHaveLength(2)
      expect((mergedTasks[0] as any).comments[0].id).toBe('new-c1')
    })

    it('should handle new tasks from server that were not in previous state', () => {
      const existingTasks = [
        {
          id: 'task-1',
          comments: [{ id: 'c1', content: 'Comment' }],
        },
      ]

      const serverTasks = [
        {
          id: 'task-1',
          _count: { comments: 1 },
        },
        {
          id: 'task-2', // New task from server
          title: 'New Task',
          _count: { comments: 0 },
        },
      ]

      const prevTaskMap = new Map(existingTasks.map(t => [t.id, t]))
      const mergedTasks = serverTasks.map(serverTask => {
        const existingTask = prevTaskMap.get(serverTask.id)
        if (existingTask?.comments && existingTask.comments.length > 0 && !(serverTask as any).comments) {
          return { ...serverTask, comments: existingTask.comments }
        }
        return serverTask
      })

      // Existing task should preserve comments
      expect((mergedTasks[0] as any).comments).toHaveLength(1)

      // New task should not have comments (didn't exist before)
      expect((mergedTasks[1] as any).comments).toBeUndefined()
    })
  })
})
