import { describe, it, expect } from 'vitest'
import { enrichTaskForAgent, type AgentTask, type AgentComment } from '@/lib/agent-protocol'

describe('SSE Event Format Consistency', () => {
  const mockPrismaTask = {
    id: 'task-1',
    title: 'Test Task',
    description: 'A test description',
    priority: 1,
    completed: false,
    dueDateTime: new Date('2025-06-15T10:00:00Z'),
    isAllDay: false,
    createdAt: new Date('2025-06-01T00:00:00Z'),
    updatedAt: new Date('2025-06-10T12:00:00Z'),
    lists: [
      { id: 'list-1', name: 'Work', description: 'Work tasks', color: '#3b82f6' },
    ],
    assignee: { id: 'agent-1', name: 'AI Agent', email: 'agent@test.com', isAIAgent: true },
    creator: { id: 'user-1', name: 'Jon', email: 'jon@test.com' },
    comments: [
      {
        id: 'comment-1',
        content: 'First comment',
        authorId: 'user-1',
        author: { id: 'user-1', name: 'Jon', email: 'jon@test.com', isAIAgent: false },
        createdAt: new Date('2025-06-02T08:00:00Z'),
      },
      {
        id: 'comment-2',
        content: 'Agent reply',
        authorId: 'agent-1',
        author: { id: 'agent-1', name: 'AI Agent', email: 'agent@test.com', isAIAgent: true },
        createdAt: new Date('2025-06-02T09:00:00Z'),
      },
    ],
  }

  describe('enrichTaskForAgent() produces valid AgentTask', () => {
    it('should produce all required AgentTask fields', () => {
      const result = enrichTaskForAgent(mockPrismaTask)

      // Verify all AgentTask fields exist with correct types
      expect(typeof result.id).toBe('string')
      expect(typeof result.title).toBe('string')
      expect(typeof result.description).toBe('string')
      expect(typeof result.priority).toBe('number')
      expect(typeof result.completed).toBe('boolean')
      expect(typeof result.isAllDay).toBe('boolean')
      expect(typeof result.createdAt).toBe('string')
      expect(typeof result.updatedAt).toBe('string')
      expect(Array.isArray(result.comments)).toBe(true)
    })

    it('should convert dates to ISO strings', () => {
      const result = enrichTaskForAgent(mockPrismaTask)

      expect(result.dueDateTime).toBe('2025-06-15T10:00:00.000Z')
      expect(result.createdAt).toBe('2025-06-01T00:00:00.000Z')
      expect(result.updatedAt).toBe('2025-06-10T12:00:00.000Z')
    })

    it('should extract list info from first list', () => {
      const result = enrichTaskForAgent(mockPrismaTask)

      expect(result.listId).toBe('list-1')
      expect(result.listName).toBe('Work')
      expect(result.listDescription).toBe('Work tasks')
    })

    it('should extract creator as assigner', () => {
      const result = enrichTaskForAgent(mockPrismaTask)

      expect(result.assignerName).toBe('Jon')
      expect(result.assignerId).toBe('user-1')
    })

    it('should handle null dueDateTime', () => {
      const taskNoDue = { ...mockPrismaTask, dueDateTime: null }
      const result = enrichTaskForAgent(taskNoDue)

      expect(result.dueDateTime).toBeNull()
    })

    it('should handle missing lists gracefully', () => {
      const taskNoLists = { ...mockPrismaTask, lists: [] }
      const result = enrichTaskForAgent(taskNoLists)

      expect(result.listId).toBeNull()
      expect(result.listName).toBeNull()
      expect(result.listDescription).toBeNull()
    })

    it('should handle missing creator gracefully', () => {
      const taskNoCreator = { ...mockPrismaTask, creator: null }
      const result = enrichTaskForAgent(taskNoCreator)

      expect(result.assignerName).toBeNull()
      expect(result.assignerId).toBeNull()
    })

    it('should handle missing comments gracefully', () => {
      const taskNoComments = { ...mockPrismaTask, comments: undefined }
      const result = enrichTaskForAgent(taskNoComments)

      expect(result.comments).toEqual([])
    })
  })

  describe('AgentComment format in enriched task', () => {
    it('should produce valid AgentComment objects', () => {
      const result = enrichTaskForAgent(mockPrismaTask)

      expect(result.comments).toHaveLength(2)

      const comment = result.comments[0]
      expect(typeof comment.id).toBe('string')
      expect(typeof comment.content).toBe('string')
      expect(typeof comment.authorId).toBe('string')
      expect(typeof comment.isAgent).toBe('boolean')
      expect(typeof comment.createdAt).toBe('string')
    })

    it('should correctly identify agent vs human comments', () => {
      const result = enrichTaskForAgent(mockPrismaTask)

      expect(result.comments[0].isAgent).toBe(false) // Human comment
      expect(result.comments[1].isAgent).toBe(true)  // Agent comment
    })

    it('should use author name, falling back to email', () => {
      const result = enrichTaskForAgent(mockPrismaTask)

      expect(result.comments[0].authorName).toBe('Jon')
    })

    it('should fall back to email when name is null', () => {
      const taskWithEmailOnlyAuthor = {
        ...mockPrismaTask,
        comments: [{
          id: 'c-1',
          content: 'test',
          authorId: 'u-1',
          author: { id: 'u-1', name: null, email: 'fallback@test.com', isAIAgent: false },
          createdAt: new Date(),
        }],
      }
      const result = enrichTaskForAgent(taskWithEmailOnlyAuthor)

      expect(result.comments[0].authorName).toBe('fallback@test.com')
    })

    it('should convert comment dates to ISO strings', () => {
      const result = enrichTaskForAgent(mockPrismaTask)

      expect(result.comments[0].createdAt).toBe('2025-06-02T08:00:00.000Z')
    })
  })

  describe('enrichTaskForAgent defaults', () => {
    it('should default priority to 0', () => {
      const task = { ...mockPrismaTask, priority: undefined }
      const result = enrichTaskForAgent(task)
      expect(result.priority).toBe(0)
    })

    it('should default completed to false', () => {
      const task = { ...mockPrismaTask, completed: undefined }
      const result = enrichTaskForAgent(task)
      expect(result.completed).toBe(false)
    })

    it('should default isAllDay to false', () => {
      const task = { ...mockPrismaTask, isAllDay: undefined }
      const result = enrichTaskForAgent(task)
      expect(result.isAllDay).toBe(false)
    })

    it('should default description to empty string', () => {
      const task = { ...mockPrismaTask, description: null }
      const result = enrichTaskForAgent(task)
      expect(result.description).toBe('')
    })
  })
})
