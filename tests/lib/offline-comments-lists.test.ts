import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { offlineDB, OfflineCommentOperations, OfflineIdMappingOperations, OfflineListOperations, OfflineTaskOperations } from '@/lib/offline-db'
import { OfflineSyncManager } from '@/lib/offline-sync'

describe('Offline Comments and Lists', () => {
  beforeEach(async () => {
    // Clear database before each test
    await offlineDB.clearAll()
  })

  afterEach(async () => {
    // Clean up after tests
    await offlineDB.clearAll()
  })

  describe('OfflineCommentOperations', () => {
    it('should save and retrieve comments', async () => {
      const comment = {
        id: 'comment-1',
        taskId: 'task-1',
        authorId: 'user-1',
        content: 'Test comment',
        type: 'TEXT' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        parentCommentId: null
      }

      await OfflineCommentOperations.saveComment(comment as any)
      const retrieved = await OfflineCommentOperations.getComment('comment-1')

      expect(retrieved).toBeDefined()
      expect(retrieved?.content).toBe('Test comment')
      expect(retrieved?.taskId).toBe('task-1')
    })

    it('should get comments by task ID', async () => {
      const comments = [
        {
          id: 'comment-1',
          taskId: 'task-1',
          authorId: 'user-1',
          content: 'Comment 1',
          type: 'TEXT' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
          parentCommentId: null
        },
        {
          id: 'comment-2',
          taskId: 'task-1',
          authorId: 'user-1',
          content: 'Comment 2',
          type: 'TEXT' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
          parentCommentId: null
        },
        {
          id: 'comment-3',
          taskId: 'task-2',
          authorId: 'user-1',
          content: 'Comment 3',
          type: 'TEXT' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
          parentCommentId: null
        }
      ]

      await OfflineCommentOperations.saveComments(comments as any)
      const task1Comments = await OfflineCommentOperations.getCommentsByTask('task-1')

      expect(task1Comments).toHaveLength(2)
      expect(task1Comments.map(c => c.id)).toEqual(['comment-1', 'comment-2'])
    })

    it('should delete comments', async () => {
      const comment = {
        id: 'comment-1',
        taskId: 'task-1',
        authorId: 'user-1',
        content: 'Test comment',
        type: 'TEXT' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        parentCommentId: null
      }

      await OfflineCommentOperations.saveComment(comment as any)
      await OfflineCommentOperations.deleteComment('comment-1')

      const retrieved = await OfflineCommentOperations.getComment('comment-1')
      expect(retrieved).toBeUndefined()
    })
  })

  describe('OfflineIdMappingOperations', () => {
    it('should save and retrieve ID mappings', async () => {
      await OfflineIdMappingOperations.saveMapping('temp-123', 'real-456', 'task')

      const realId = await OfflineIdMappingOperations.getRealId('temp-123')
      expect(realId).toBe('real-456')
    })

    it('should get temp ID from real ID', async () => {
      await OfflineIdMappingOperations.saveMapping('temp-123', 'real-456', 'task')

      const tempId = await OfflineIdMappingOperations.getTempId('real-456')
      expect(tempId).toBe('temp-123')
    })

    it('should return undefined for non-existent mappings', async () => {
      const realId = await OfflineIdMappingOperations.getRealId('non-existent')
      expect(realId).toBeUndefined()
    })

    it('should clear old mappings', async () => {
      // Create old mapping (8 days ago)
      const oldTimestamp = Date.now() - (8 * 24 * 60 * 60 * 1000)
      await offlineDB.idMappings.put({
        tempId: 'old-temp',
        realId: 'old-real',
        entity: 'task',
        timestamp: oldTimestamp
      })

      // Create new mapping
      await OfflineIdMappingOperations.saveMapping('new-temp', 'new-real', 'task')

      // Clear mappings older than 7 days
      await OfflineIdMappingOperations.clearOldMappings(7 * 24 * 60 * 60 * 1000)

      const oldMapping = await OfflineIdMappingOperations.getRealId('old-temp')
      const newMapping = await OfflineIdMappingOperations.getRealId('new-temp')

      expect(oldMapping).toBeUndefined()
      expect(newMapping).toBe('new-real')
    })
  })

  describe('Offline Comment Sync with ID Mapping', () => {
    it('should queue comment mutation with temp task ID', async () => {
      const mutation = await OfflineSyncManager.queueMutation(
        'create',
        'comment',
        'temp-comment-123',
        '/api/tasks/temp-task-456/comments',
        'POST',
        { content: 'Test comment', type: 'TEXT' },
        'temp-task-456' // parentId
      )

      expect(mutation).toBeDefined()
      expect(mutation.entity).toBe('comment')
      expect(mutation.parentId).toBe('temp-task-456')
      expect(mutation.tempId).toBe('temp-comment-123')
    })

    it('should handle comment sync dependencies', async () => {
      // Create task mapping
      await OfflineIdMappingOperations.saveMapping('temp-task-456', 'real-task-789', 'task')

      // Queue comment mutation that depends on task
      await OfflineSyncManager.queueMutation(
        'create',
        'comment',
        'temp-comment-123',
        '/api/tasks/temp-task-456/comments',
        'POST',
        { content: 'Test comment', type: 'TEXT' },
        'temp-task-456'
      )

      const pendingMutations = await OfflineSyncManager.getPendingMutations()
      expect(pendingMutations).toHaveLength(1)
      expect(pendingMutations[0].parentId).toBe('temp-task-456')
    })
  })

  describe('Offline List Creation', () => {
    it('should create list with temp ID offline', async () => {
      const tempList = {
        id: 'temp-list-123',
        name: 'Test List',
        description: 'Test Description',
        color: '#3b82f6',
        privacy: 'PRIVATE' as const,
        ownerId: 'user-1',
        owner: { id: 'user-1', name: 'Test User', email: 'test@test.com', createdAt: new Date() },
        createdAt: new Date(),
        updatedAt: new Date(),
        tasks: [],
        members: [],
        admins: [],
        isFavorite: false,
        favoriteOrder: null,
        listMembers: [],
        defaultAssigneeId: null,
        defaultPriority: 0 as const,
        defaultRepeating: 'never' as any,
        defaultIsPrivate: true,
        defaultDueDate: 'none' as const
      }

      await OfflineListOperations.saveList(tempList)
      const retrieved = await OfflineListOperations.getList('temp-list-123')

      expect(retrieved).toBeDefined()
      expect(retrieved?.name).toBe('Test List')
      expect(retrieved?.id).toBe('temp-list-123')
    })

    it('should queue list creation mutation', async () => {
      const mutation = await OfflineSyncManager.queueMutation(
        'create',
        'list',
        'temp-list-123',
        '/api/lists',
        'POST',
        { name: 'Test List', description: '', color: '#3b82f6' },
        undefined
      )

      expect(mutation).toBeDefined()
      expect(mutation.entity).toBe('list')
      expect(mutation.tempId).toBe('temp-list-123')
      expect(mutation.parentId).toBeUndefined()
    })

    it('should map list temp ID to real ID after sync', async () => {
      await OfflineIdMappingOperations.saveMapping('temp-list-123', 'real-list-789', 'list')

      const realId = await OfflineIdMappingOperations.getRealId('temp-list-123')
      expect(realId).toBe('real-list-789')
    })
  })

  describe('Database Storage Info', () => {
    it('should track all entity counts', async () => {
      // Add test data
      await OfflineTaskOperations.saveTask({
        id: 'task-1',
        title: 'Test Task',
        completed: false,
        createdAt: new Date(),
        updatedAt: new Date()
      } as any)

      await OfflineListOperations.saveList({
        id: 'list-1',
        name: 'Test List',
        createdAt: new Date(),
        updatedAt: new Date()
      } as any)

      await OfflineCommentOperations.saveComment({
        id: 'comment-1',
        taskId: 'task-1',
        content: 'Test',
        createdAt: new Date(),
        updatedAt: new Date()
      } as any)

      await OfflineIdMappingOperations.saveMapping('temp-1', 'real-1', 'task')

      const info = await offlineDB.getStorageInfo()

      expect(info.tasks).toBe(1)
      expect(info.lists).toBe(1)
      expect(info.comments).toBe(1)
      expect(info.idMappings).toBe(1)
      expect(info.total).toBeGreaterThanOrEqual(4)
    })
  })

  describe('Comment Queuing for Offline Tasks', () => {
    it('should allow comments on tasks with temp IDs', async () => {
      // Create offline task
      const tempTask = {
        id: 'temp-task-123',
        title: 'Offline Task',
        completed: false,
        createdAt: new Date(),
        updatedAt: new Date()
      }
      await OfflineTaskOperations.saveTask(tempTask as any)

      // Create offline comment
      const tempComment = {
        id: 'temp-comment-456',
        taskId: 'temp-task-123',
        authorId: 'user-1',
        content: 'Offline comment',
        type: 'TEXT' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        parentCommentId: null
      }
      await OfflineCommentOperations.saveComment(tempComment as any)

      // Queue comment mutation
      await OfflineSyncManager.queueMutation(
        'create',
        'comment',
        'temp-comment-456',
        '/api/tasks/temp-task-123/comments',
        'POST',
        { content: 'Offline comment', type: 'TEXT' },
        'temp-task-123'
      )

      // Verify comment was saved
      const comments = await OfflineCommentOperations.getCommentsByTask('temp-task-123')
      expect(comments).toHaveLength(1)
      expect(comments[0].content).toBe('Offline comment')

      // Verify mutation was queued
      const mutations = await OfflineSyncManager.getPendingMutations()
      expect(mutations).toHaveLength(1)
      expect(mutations[0].entity).toBe('comment')
      expect(mutations[0].parentId).toBe('temp-task-123')
    })

    it('should handle comment sync after task syncs', async () => {
      // Simulate task being synced first
      await OfflineIdMappingOperations.saveMapping('temp-task-123', 'real-task-789', 'task')

      // Verify comment mutation can be resolved
      const realTaskId = await OfflineIdMappingOperations.getRealId('temp-task-123')
      expect(realTaskId).toBe('real-task-789')

      // Comment mutation should be updatable with real task ID
      await OfflineSyncManager.queueMutation(
        'create',
        'comment',
        'temp-comment-456',
        '/api/tasks/temp-task-123/comments',
        'POST',
        { content: 'Comment', type: 'TEXT' },
        'temp-task-123'
      )

      const mutations = await OfflineSyncManager.getPendingMutations()
      expect(mutations[0].parentId).toBe('temp-task-123')
    })
  })
})
