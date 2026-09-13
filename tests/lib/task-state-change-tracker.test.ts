import { describe, it, expect } from 'vitest'
import { detectTaskStateChanges, formatStateChangesAsComment, TaskWithRelations } from '@/lib/task-state-change-tracker'

describe('Task State Change Tracker', () => {
  const baseTask: TaskWithRelations = {
    id: 'task-1',
    title: 'Test Task',
    description: 'Description',
    priority: 1,
    completed: false,
    dueDateTime: new Date('2025-11-20T00:00:00Z'),
    isAllDay: false,
    repeating: 'never',
    repeatingData: null,
    isPrivate: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    assigneeId: 'user-1',
    creatorId: 'creator-1',
    originalTaskId: null,
    sourceListId: null,
    reminderSent: false,
    reminderTime: null,
    reminderType: null,
    aiAgentId: null,
    occurrenceCount: 0,
    repeatFrom: 'COMPLETION_DATE',
    assignee: {
      id: 'user-1',
      name: 'Alice',
      email: 'alice@example.com',
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      isActive: true,
      pendingEmail: null,
      emailVerificationToken: null,
      emailTokenExpiresAt: null,
      password: null,
      aiAssistantSettings: null,
      defaultDueTime: null,
      mcpEnabled: true,
      mcpSettings: null,
      aiAgentConfig: null,
      aiAgentType: null,
      isAIAgent: false,
      webhookUrl: null,
      defaultNewListMcpAccessLevel: 'WRITE',
      defaultNewListMcpEnabled: true,
      defaultTaskDueOffset: null,
      emailToTaskEnabled: true,
      emailToTaskListId: null,
      invitedBy: null,
      isPlaceholder: false,
      statsCompletedTasks: 0,
      statsInspiredTasks: 0,
      statsSupportedTasks: 0,
      statsLastCalculated: null,
    },
    lists: [
      {
        id: 'list-1',
        name: 'Work Tasks',
        color: '#3b82f6',
        imageUrl: null,
        privacy: 'PRIVATE',
        createdAt: new Date(),
        updatedAt: new Date(),
        ownerId: 'owner-1',
        defaultAssigneeId: null,
        defaultPriority: 0,
        defaultRepeating: 'never',
        defaultIsPrivate: true,
        defaultDueDate: 'none',
        aiAstridEnabled: false,
        copyCount: 0,
        defaultDueTime: null,
        favoriteOrder: null,
        filterAssignedBy: null,
        filterAssignee: null,
        filterCompletion: null,
        filterDueDate: null,
        filterInLists: null,
        filterPriority: null,
        filterRepeating: null,
        isFavorite: false,
        isVirtual: false,
        sortBy: null,
        virtualListType: null,
        mcpAccessLevel: 'WRITE',
        mcpEnabled: false,
        aiAgentsEnabled: [],
        fallbackAiProvider: null,
        githubRepositoryId: null,
        preferredAiProvider: null,
        aiAgentConfiguredBy: null,
        manualSortOrder: null,
        publicListType: null,
      }
    ],
  }

  describe('detectTaskStateChanges', () => {
    it('should detect priority change', () => {
      const oldTask = { ...baseTask, priority: 1 }
      const newTask = { ...baseTask, priority: 3 }

      const changes = detectTaskStateChanges(oldTask, newTask, 'Jon Paris')

      expect(changes).toHaveLength(1)
      expect(changes[0].field).toBe('priority')
      expect(changes[0].description).toBe('changed priority from ! to !!!')
    })

    it('should detect priority change to none', () => {
      const oldTask = { ...baseTask, priority: 2 }
      const newTask = { ...baseTask, priority: 0 }

      const changes = detectTaskStateChanges(oldTask, newTask, 'Jon Paris')

      expect(changes).toHaveLength(1)
      expect(changes[0].field).toBe('priority')
      expect(changes[0].description).toBe('changed priority from !! to none')
    })

    it('should detect due date change', () => {
      const oldTask = { ...baseTask, dueDateTime: null }
      const newTask = { ...baseTask, dueDateTime: new Date('2025-10-10T12:00:00Z') }

      const changes = detectTaskStateChanges(oldTask, newTask, 'Bill Joe')

      // Detects both date and time changes when going from null to a full datetime
      expect(changes.length).toBeGreaterThanOrEqual(1)
      expect(changes.some(c => c.field === 'dueDateTime')).toBe(true)
      const dateChange = changes.find(c => c.description.includes('due date'))
      expect(dateChange?.description).toContain('2025')
    })

    it('should detect due date removal', () => {
      const oldTask = { ...baseTask, dueDateTime: new Date('2025-10-10T12:00:00Z') }
      const newTask = { ...baseTask, dueDateTime: null }

      const changes = detectTaskStateChanges(oldTask, newTask, 'Bill Joe')

      // Detects both date and time changes when going from a full datetime to null
      expect(changes.length).toBeGreaterThanOrEqual(1)
      expect(changes.some(c => c.field === 'dueDateTime')).toBe(true)
      const dateChange = changes.find(c => c.description.includes('due date'))
      expect(dateChange?.description).toContain('no date set')
    })

    it('should detect assignee change', () => {
      const oldTask = { ...baseTask, assigneeId: null, assignee: null }
      const newTask = {
        ...baseTask,
        assigneeId: 'user-2',
        assignee: {
          ...baseTask.assignee!,
          id: 'user-2',
          name: 'Joseph',
        },
      }

      const changes = detectTaskStateChanges(oldTask, newTask, 'Admin')

      expect(changes).toHaveLength(1)
      expect(changes[0].field).toBe('assigneeId')
      expect(changes[0].description).toBe('reassigned from Unassigned to Joseph')
    })

    it('should detect task completion', () => {
      const oldTask = { ...baseTask, completed: false }
      const newTask = { ...baseTask, completed: true }

      const changes = detectTaskStateChanges(oldTask, newTask, 'Jeff')

      expect(changes).toHaveLength(1)
      expect(changes[0].field).toBe('completed')
      expect(changes[0].description).toBe('marked this as complete')
    })

    it('should detect task reopening', () => {
      const oldTask = { ...baseTask, completed: true }
      const newTask = { ...baseTask, completed: false }

      const changes = detectTaskStateChanges(oldTask, newTask, 'Jeff')

      expect(changes).toHaveLength(1)
      expect(changes[0].field).toBe('completed')
      expect(changes[0].description).toBe('marked this as incomplete')
    })

    it('should detect list addition', () => {
      const newList = {
        id: 'list-2',
        name: 'Fun Things To Do',
        description: null,
        color: '#10b981',
        imageUrl: null,
        privacy: 'PRIVATE' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        ownerId: 'owner-1',
        defaultAssigneeId: null,
        defaultPriority: 0,
        defaultRepeating: 'never' as const,
        defaultIsPrivate: true,
        defaultDueDate: 'none',
        aiAstridEnabled: false,
        copyCount: 0,
        defaultDueTime: null,
        favoriteOrder: null,
        filterAssignedBy: null,
        filterAssignee: null,
        filterCompletion: null,
        filterDueDate: null,
        filterInLists: null,
        filterPriority: null,
        filterRepeating: null,
        isFavorite: false,
        isVirtual: false,
        sortBy: null,
        virtualListType: null,
        mcpAccessLevel: 'WRITE' as const,
        mcpEnabled: false,
        aiAgentsEnabled: [],
        fallbackAiProvider: null,
        githubRepositoryId: null,
        preferredAiProvider: null,
        aiAgentConfiguredBy: null,
        manualSortOrder: null,
        publicListType: null,
      }

      const oldTask = { ...baseTask }
      const newTask = { ...baseTask, lists: [...baseTask.lists!, newList] }

      const changes = detectTaskStateChanges(oldTask, newTask, 'frank')

      expect(changes).toHaveLength(1)
      expect(changes[0].field).toBe('lists')
      expect(changes[0].description).toBe('added this to list "Fun Things To Do"')
    })

    it('should detect list removal', () => {
      const oldTask = { ...baseTask }
      const newTask = { ...baseTask, lists: [] }

      const changes = detectTaskStateChanges(oldTask, newTask, 'frank')

      expect(changes).toHaveLength(1)
      expect(changes[0].field).toBe('lists')
      expect(changes[0].description).toBe('removed this from list "Work Tasks"')
    })

    it('should detect multiple changes', () => {
      const oldTask = {
        ...baseTask,
        priority: 1,
        completed: false,
        assigneeId: null,
        assignee: null,
      }
      const newTask = {
        ...baseTask,
        priority: 3,
        completed: true,
        assigneeId: 'user-2',
        assignee: {
          ...baseTask.assignee!,
          id: 'user-2',
          name: 'Joseph',
        },
      }

      const changes = detectTaskStateChanges(oldTask, newTask, 'Admin')

      expect(changes).toHaveLength(3)
      expect(changes.map(c => c.field)).toEqual(['priority', 'assigneeId', 'completed'])
    })

    it('should return empty array when no changes detected', () => {
      const changes = detectTaskStateChanges(baseTask, baseTask, 'User')

      expect(changes).toHaveLength(0)
    })
  })

  describe('formatStateChangesAsComment', () => {
    it('should format single change correctly', () => {
      const changes = [
        { field: 'priority', description: 'changed priority from !! to !!!' }
      ]

      const comment = formatStateChangesAsComment(changes, 'Jon Paris')

      expect(comment).toBe('Jon Paris changed priority from !! to !!!')
    })

    it('should format multiple changes as inline text with commas and "and"', () => {
      const changes = [
        { field: 'priority', description: 'changed priority from !! to !!!' },
        { field: 'dueDateTime', description: 'changed due date from "no date set" to "October 10, 2025"' },
        { field: 'assigneeId', description: 'reassigned from Unassigned to Joseph' },
      ]

      const comment = formatStateChangesAsComment(changes, 'Jon Paris')

      // New inline format: "Jon Paris changed priority from !! to !!!, changed due date..., and reassigned..."
      expect(comment).toContain('Jon Paris')
      expect(comment).toContain('changed priority from !! to !!!')
      expect(comment).toContain('changed due date')
      expect(comment).toContain('Oct 10, 2025') // Shortened month name
      expect(comment).toContain('and reassigned from Unassigned to Joseph')
    })

    it('should capitalize first letter in bulleted list', () => {
      const changes = [
        { field: 'completed', description: 'marked this as complete' }
      ]

      const comment = formatStateChangesAsComment(changes, 'Jeff')

      expect(comment).toBe('Jeff marked this as complete')
    })

    it('should return empty string for no changes', () => {
      const comment = formatStateChangesAsComment([], 'User')

      expect(comment).toBe('')
    })
  })
})
