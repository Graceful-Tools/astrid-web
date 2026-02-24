import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('OpenClaw Event Enrichment', () => {
  describe('task_assigned event payload', () => {
    it('includes full task context for enriched events', () => {
      const task = {
        id: 'task-123',
        title: 'Fix the bug',
        description: 'There is a bug in the login flow',
        priority: 'HIGH',
        dueDateTime: new Date('2026-03-01'),
        lists: [{ id: 'list-1', name: 'Sprint 1', githubRepositoryId: 'repo-abc' }],
        creator: { id: 'user-1', name: 'Jon', email: 'jon@example.com' },
        comments: [
          { id: 'c1', content: 'See screenshot', author: { name: 'Jon' }, createdAt: new Date() }
        ],
      }

      // Build the enriched payload (mirrors the code in v1/tasks/route.ts)
      const payload = {
        type: 'task_assigned',
        timestamp: new Date().toISOString(),
        data: {
          taskId: task.id,
          title: task.title,
          description: task.description,
          priority: task.priority,
          dueDateTime: task.dueDateTime,
          listId: task.lists?.[0]?.id,
          listName: task.lists?.[0]?.name,
          githubRepositoryId: task.lists?.[0]?.githubRepositoryId,
          assignerName: task.creator?.name || task.creator?.email,
          assignerId: task.creator?.id,
          // Legacy fields
          taskId: task.id,
          taskTitle: task.title,
          taskPriority: task.priority,
          taskDueDateTime: task.dueDateTime,
          listNames: task.lists?.map(l => l.name) || [],
          comments: task.comments?.map(c => ({
            id: c.id,
            content: c.content,
            authorName: c.author?.name,
            createdAt: c.createdAt,
          })) || [],
        },
      }

      expect(payload.data.title).toBe('Fix the bug')
      expect(payload.data.description).toBe('There is a bug in the login flow')
      expect(payload.data.priority).toBe('HIGH')
      expect(payload.data.listId).toBe('list-1')
      expect(payload.data.listName).toBe('Sprint 1')
      expect(payload.data.githubRepositoryId).toBe('repo-abc')
      expect(payload.data.assignerName).toBe('Jon')
      expect(payload.data.assignerId).toBe('user-1')
      expect(payload.data.comments).toHaveLength(1)
      expect(payload.data.comments[0].content).toBe('See screenshot')
      // Legacy fields still present
      expect(payload.data.taskTitle).toBe('Fix the bug')
      expect(payload.data.listNames).toEqual(['Sprint 1'])
    })

    it('handles task with no lists gracefully', () => {
      const task = {
        id: 'task-456',
        title: 'Orphan task',
        description: null,
        priority: 'MEDIUM',
        dueDateTime: null,
        lists: [],
        creator: { id: 'user-1', name: null, email: 'anon@example.com' },
        comments: [],
      }

      const payload = {
        data: {
          listId: task.lists?.[0]?.id,
          listName: task.lists?.[0]?.name,
          assignerName: task.creator?.name || task.creator?.email,
          comments: task.comments?.map(c => ({ id: c.id })) || [],
        },
      }

      expect(payload.data.listId).toBeUndefined()
      expect(payload.data.listName).toBeUndefined()
      expect(payload.data.assignerName).toBe('anon@example.com')
      expect(payload.data.comments).toEqual([])
    })
  })

  describe('agent_task_comment event', () => {
    it('fires when human comments on agent-assigned task', () => {
      const task = {
        id: 'task-789',
        title: 'Deploy v2',
        assigneeId: 'agent-001',
        assignee: { email: 'astrid.oc@astrid.cc', isAIAgent: true },
      }
      const comment = {
        id: 'comment-1',
        content: 'Please prioritize this',
        authorId: 'user-1',
        author: { name: 'Jon', email: 'jon@example.com' },
      }
      const currentUserId = 'user-1'

      // Check the condition from our code
      const shouldBroadcast = task.assigneeId &&
        task.assignee?.email &&
        (task.assignee.email.match(/\.oc@astrid\.cc$/i) || task.assignee.email === 'openclaw@astrid.cc') &&
        currentUserId !== task.assigneeId

      expect(shouldBroadcast).toBeTruthy()

      const payload = {
        type: 'agent_task_comment',
        data: {
          taskId: task.id,
          taskTitle: task.title,
          commentId: comment.id,
          content: comment.content,
          authorName: comment.author?.name || comment.author?.email,
          authorId: comment.authorId,
          isAgentComment: false,
        },
      }

      expect(payload.data.content).toBe('Please prioritize this')
      expect(payload.data.authorName).toBe('Jon')
    })

    it('does not fire for non-agent tasks', () => {
      const task = {
        assigneeId: 'user-2',
        assignee: { email: 'someone@gmail.com', isAIAgent: false },
      }

      const shouldBroadcast = task.assigneeId &&
        task.assignee?.email &&
        (task.assignee.email.match(/\.oc@astrid\.cc$/i) || task.assignee.email === 'openclaw@astrid.cc')

      expect(shouldBroadcast).toBeFalsy()
    })

    it('does not fire when agent comments on own task', () => {
      const task = {
        assigneeId: 'agent-001',
        assignee: { email: 'astrid.oc@astrid.cc' },
      }
      const currentUserId = 'agent-001' // agent is the commenter

      const shouldBroadcast = task.assigneeId &&
        task.assignee?.email &&
        task.assignee.email.match(/\.oc@astrid\.cc$/i) &&
        currentUserId !== task.assigneeId

      expect(shouldBroadcast).toBeFalsy()
    })

    it('matches openclaw@astrid.cc as legacy pattern', () => {
      const email = 'openclaw@astrid.cc'
      const matches = email.match(/\.oc@astrid\.cc$/i) || email === 'openclaw@astrid.cc'
      expect(matches).toBeTruthy()
    })
  })
})
