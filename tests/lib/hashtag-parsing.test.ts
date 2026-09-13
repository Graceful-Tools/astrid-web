import { describe, it, expect } from 'vitest'
import { buildTaskList } from '../fixtures/domain'
import { parseTaskInput } from '@/lib/task-manager-utils'
import type { TaskList } from '@/types/task'

describe('Hashtag Parsing', () => {
  const mockLists: TaskList[] = [
    buildTaskList({
      id: 'list-1',
      name: 'Shopping',
      ownerId: 'user-1',
      color: '#3b82f6',
      privacy: 'PRIVATE',
      createdAt: new Date(),
      updatedAt: new Date(),
      isVirtual: false,
    }),
    buildTaskList({
      id: 'list-2',
      name: 'Work Tasks',
      ownerId: 'user-1',
      color: '#3b82f6',
      privacy: 'PRIVATE',
      createdAt: new Date(),
      updatedAt: new Date(),
      isVirtual: false,
    }),
    buildTaskList({
      id: 'list-3',
      name: 'Personal',
      ownerId: 'user-1',
      color: '#3b82f6',
      privacy: 'PRIVATE',
      createdAt: new Date(),
      updatedAt: new Date(),
      isVirtual: false,
    }),
    buildTaskList({
      id: 'virtual-1',
      name: 'My Tasks',
      ownerId: 'user-1',
      color: '#3b82f6',
      privacy: 'PRIVATE',
      createdAt: new Date(),
      updatedAt: new Date(),
      isVirtual: true,
    }),
  ]

  const mockSession = {
    user: {
      id: 'user-1',
      name: 'Test User',
      email: 'test@example.com',
    },
  }

  describe('Single hashtag parsing', () => {
    it('should extract list ID from single hashtag', () => {
      const result = parseTaskInput('Buy groceries #shopping', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('Buy groceries')
      expect(result.listIds).toContain('list-1')
      expect(result.listIds).toHaveLength(1)
    })

    it('should match list name with spaces using dash', () => {
      const result = parseTaskInput('Complete report #work-tasks', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('Complete report')
      expect(result.listIds).toContain('list-2')
    })

    it('should match list name with spaces using underscore', () => {
      const result = parseTaskInput('Complete report #work_tasks', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('Complete report')
      expect(result.listIds).toContain('list-2')
    })

    it('should match list name case-insensitively', () => {
      const result = parseTaskInput('Buy milk #SHOPPING', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('Buy milk')
      expect(result.listIds).toContain('list-1')
    })
  })

  describe('Multiple hashtags parsing', () => {
    it('should extract multiple list IDs from multiple hashtags', () => {
      const result = parseTaskInput('Buy groceries #shopping #personal', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('Buy groceries')
      expect(result.listIds).toContain('list-1') // Shopping
      expect(result.listIds).toContain('list-3') // Personal
      expect(result.listIds).toHaveLength(2)
    })

    it('should handle hashtags at different positions', () => {
      const result = parseTaskInput('#shopping Buy groceries and #personal items', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('Buy groceries and items')
      expect(result.listIds).toContain('list-1')
      expect(result.listIds).toContain('list-3')
    })

    it('should deduplicate list IDs if same hashtag appears multiple times', () => {
      const result = parseTaskInput('Buy #shopping items #shopping', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('Buy items')
      expect(result.listIds).toContain('list-1')
      expect(result.listIds).toHaveLength(1)
    })
  })

  describe('Hashtag with selected list', () => {
    it('should combine hashtag list with selected list', () => {
      const result = parseTaskInput('Buy groceries #shopping', 'list-3', mockSession, mockLists)

      expect(result.title).toBe('Buy groceries')
      expect(result.listIds).toContain('list-1') // Shopping from hashtag
      expect(result.listIds).toContain('list-3') // Personal from selected list
      expect(result.listIds).toHaveLength(2)
    })

    it('should not duplicate if hashtag matches selected list', () => {
      const result = parseTaskInput('Buy groceries #shopping', 'list-1', mockSession, mockLists)

      expect(result.title).toBe('Buy groceries')
      expect(result.listIds).toContain('list-1')
      expect(result.listIds).toHaveLength(1)
    })

    it('should not add selected list if it is virtual', () => {
      const result = parseTaskInput('Buy groceries #shopping', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('Buy groceries')
      expect(result.listIds).toContain('list-1')
      expect(result.listIds).not.toContain('my-tasks')
      expect(result.listIds).toHaveLength(1)
    })
  })

  describe('Hashtag with no matching list', () => {
    it('should ignore hashtag if no matching list found', () => {
      const result = parseTaskInput('Buy groceries #nonexistent', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('Buy groceries')
      expect(result.listIds).toHaveLength(0)
    })

    it('should only extract matching lists when some hashtags do not match', () => {
      const result = parseTaskInput('Buy groceries #shopping #nonexistent #personal', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('Buy groceries')
      expect(result.listIds).toContain('list-1') // Shopping
      expect(result.listIds).toContain('list-3') // Personal
      expect(result.listIds).toHaveLength(2)
    })
  })

  describe('Hashtag with other parsing features', () => {
    it('should handle hashtags with priority keywords', () => {
      const result = parseTaskInput('Buy groceries high priority #shopping', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('Buy groceries')
      expect(result.priority).toBe(2)
      expect(result.listIds).toContain('list-1')
    })

    it('should handle hashtags with date keywords', () => {
      const result = parseTaskInput('Buy groceries today #shopping', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('Buy groceries')
      expect(result.dueDateTime).toBeDefined()
      expect(result.listIds).toContain('list-1')
    })

    it('should handle hashtags with all parsing features combined', () => {
      const result = parseTaskInput('Buy groceries today high priority #shopping #personal', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('Buy groceries')
      expect(result.dueDateTime).toBeDefined()
      expect(result.priority).toBe(2)
      expect(result.listIds).toContain('list-1')
      expect(result.listIds).toContain('list-3')
      expect(result.listIds).toHaveLength(2)
    })
  })

  describe('Edge cases', () => {
    it('should handle hashtag at the very end', () => {
      const result = parseTaskInput('Buy groceries #shopping', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('Buy groceries')
      expect(result.listIds).toContain('list-1')
    })

    it('should handle hashtag at the very beginning', () => {
      const result = parseTaskInput('#shopping Buy groceries', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('Buy groceries')
      expect(result.listIds).toContain('list-1')
    })

    it('should handle multiple spaces after hashtag removal', () => {
      const result = parseTaskInput('Buy   #shopping   groceries', 'my-tasks', mockSession, mockLists)

      // Multiple spaces should be normalized to single spaces
      expect(result.title).toBe('Buy groceries')
      expect(result.listIds).toContain('list-1')
    })

    it('should not extract hashtag if it is part of a word', () => {
      // This is a limitation - our regex requires word boundaries or spaces
      const result = parseTaskInput('Use#shopping for this', 'my-tasks', mockSession, mockLists)

      // Should not match because # is not preceded by whitespace
      // Note: "for this" gets removed by the assignee keyword parser
      expect(result.title).toBe('Use#shopping')
      expect(result.listIds).toHaveLength(0)
    })

    it('should handle empty input', () => {
      const result = parseTaskInput('', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('')
      expect(result.listIds).toHaveLength(0)
    })

    it('should handle input with only hashtags', () => {
      const result = parseTaskInput('#shopping #personal', 'my-tasks', mockSession, mockLists)

      // When only hashtags are present, title falls back to original input per current implementation
      // This is acceptable behavior - user can decide if they want to allow empty titles
      expect(result.title).toBe('#shopping #personal') // Fallback to original
      expect(result.listIds).toContain('list-1')
      expect(result.listIds).toContain('list-3')
    })
  })

  describe('Special characters in hashtags', () => {
    const specialCharLists: TaskList[] = [
      buildTaskList({
        id: 'list-special-1',
        name: "Mom's Tasks",
        ownerId: 'user-1',
        color: '#3b82f6',
        privacy: 'PRIVATE',
        createdAt: new Date(),
        updatedAt: new Date(),
        isVirtual: false,
      }),
      buildTaskList({
        id: 'list-special-2',
        name: 'Work & Life',
        ownerId: 'user-1',
        color: '#3b82f6',
        privacy: 'PRIVATE',
        createdAt: new Date(),
        updatedAt: new Date(),
        isVirtual: false,
      }),
      buildTaskList({
        id: 'list-special-3',
        name: '50/50 Split',
        ownerId: 'user-1',
        color: '#3b82f6',
        privacy: 'PRIVATE',
        createdAt: new Date(),
        updatedAt: new Date(),
        isVirtual: false,
      }),
      buildTaskList({
        id: 'list-special-4',
        name: 'C++ Projects',
        ownerId: 'user-1',
        color: '#3b82f6',
        privacy: 'PRIVATE',
        createdAt: new Date(),
        updatedAt: new Date(),
        isVirtual: false,
      }),
      buildTaskList({
        id: 'list-special-5',
        name: 'Budget (2024)',
        ownerId: 'user-1',
        color: '#3b82f6',
        privacy: 'PRIVATE',
        createdAt: new Date(),
        updatedAt: new Date(),
        isVirtual: false,
      }),
    ]

    it('should handle apostrophes in hashtags', () => {
      const result = parseTaskInput("Call mom #mom's-tasks", 'my-tasks', mockSession, specialCharLists)

      expect(result.title).toBe('Call mom')
      expect(result.listIds).toContain('list-special-1')
    })

    it('should handle ampersands in hashtags', () => {
      const result = parseTaskInput('Balance tasks #work&life', 'my-tasks', mockSession, specialCharLists)

      expect(result.title).toBe('Balance tasks')
      expect(result.listIds).toContain('list-special-2')
    })

    it('should handle slashes in hashtags', () => {
      const result = parseTaskInput('Split the bill #50/50-split', 'my-tasks', mockSession, specialCharLists)

      expect(result.title).toBe('Split the bill')
      expect(result.listIds).toContain('list-special-3')
    })

    it('should handle plus signs in hashtags', () => {
      const result = parseTaskInput('Fix memory leak #c++-projects', 'my-tasks', mockSession, specialCharLists)

      expect(result.title).toBe('Fix memory leak')
      expect(result.listIds).toContain('list-special-4')
    })

    it('should handle parentheses in hashtags', () => {
      const result = parseTaskInput('Review expenses #budget-(2024)', 'my-tasks', mockSession, specialCharLists)

      expect(result.title).toBe('Review expenses')
      expect(result.listIds).toContain('list-special-5')
    })

    it('should handle multiple hashtags with special characters', () => {
      const result = parseTaskInput("Task #mom's-tasks #work&life #50/50-split", 'my-tasks', mockSession, specialCharLists)

      expect(result.title).toBe('Task')
      expect(result.listIds).toContain('list-special-1')
      expect(result.listIds).toContain('list-special-2')
      expect(result.listIds).toContain('list-special-3')
      expect(result.listIds).toHaveLength(3)
    })

    it('should still stop at whitespace', () => {
      const result = parseTaskInput('Task #work&life more text', 'my-tasks', mockSession, specialCharLists)

      expect(result.title).toBe('Task more text')
      expect(result.listIds).toContain('list-special-2')
    })

    it('should handle exact list name match with spaces converted to special chars', () => {
      const result = parseTaskInput('Task #mom\'s_tasks', 'my-tasks', mockSession, specialCharLists)

      // Should match because the matching logic handles underscore/dash variations
      expect(result.title).toBe('Task')
      expect(result.listIds).toContain('list-special-1')
    })
  })

  describe('Virtual list filtering', () => {
    it('should not match virtual lists with hashtags', () => {
      const result = parseTaskInput('Task #my-tasks', 'list-1', mockSession, mockLists)

      expect(result.title).toBe('Task')
      expect(result.listIds).not.toContain('virtual-1')
      expect(result.listIds).toContain('list-1') // Selected list only
    })
  })
})
