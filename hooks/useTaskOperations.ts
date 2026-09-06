import { useCallback, useState } from 'react'
import { DEFAULT_LIST_COLOR } from '@/lib/brand/colors'
import { useToast } from '@/hooks/use-toast'
import { apiPost, apiPut, apiDelete } from '@/lib/api'
import { playTaskCreateSound, playTaskCompleteSound } from '@/lib/task-sounds'
import type { Task, TaskList } from '@/types/task'
import type { CreateTaskData as ApiCreateTaskData, UpdateTaskData as ApiUpdateTaskData } from '@/types/api'
import type { CustomRepeatingPattern } from '@/types/repeating'
import { OfflineSyncManager, isOfflineMode } from '@/lib/offline-sync'
import { OfflineTaskOperations, OfflineListOperations } from '@/lib/offline-db'
import { nanoid } from 'nanoid'
import { safeResponseJson, hasRequiredFields } from '@/lib/safe-parse'
import { unwrapTask } from '@/lib/v1-response'

interface UserSession {
  user?: {
    id: string
    name?: string | null
    email?: string | null
    image?: string | null
  }
}

interface UseTaskOperationsProps {
  onTaskCreated?: (task: Task) => void
  onTaskUpdated?: (task: Task) => void
  onTaskDeleted?: (taskId: string) => void
  onError?: (error: string) => void
  session?: UserSession | null // Current user session for offline metadata
}

interface CreateTaskData {
  title: string
  description?: string
  priority?: number
  dueDate?: Date | string | null
  dueDateTime?: Date | string | null  // New field - preferred over dueDate
  assigneeId?: string | null
  listIds?: string[]
  repeating?: string
  customRepeatingData?: CustomRepeatingPattern | null
  /** Board column at creation — a role, resolved by the board (task f58ece7c). */
  statusRole?: ApiCreateTaskData['statusRole']
}

interface UpdateTaskData extends Partial<CreateTaskData> {
  completed?: boolean
}

export const useTaskOperations = ({
  onTaskCreated,
  onTaskUpdated,
  onTaskDeleted,
  onError,
  session
}: UseTaskOperationsProps = {}) => {
  const { toast } = useToast()

  // Loading states
  const [isCreating, setIsCreating] = useState(false)
  const [isUpdating, setIsUpdating] = useState<Record<string, boolean>>({})
  const [isDeleting, setIsDeleting] = useState<Record<string, boolean>>({})

  const createTask = useCallback(async (taskData: CreateTaskData): Promise<Task | null> => {
    setIsCreating(true)
    try {
      // Play creation sound immediately (optimistic)
      playTaskCreateSound()

      // Prefer dueDateTime over dueDate (dueDateTime is the new standard with time support)
      const dateValue = taskData.dueDateTime || taskData.dueDate

      // Determine if this is an all-day task
      // If date is at midnight (00:00:00), treat as all-day task
      let isAllDay = false
      if (dateValue) {
        const date = new Date(dateValue)
        isAllDay = date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0
      }

      const apiData: ApiCreateTaskData = {
        title: taskData.title,
        description: taskData.description || '',
        priority: (taskData.priority || 0) as 0 | 1 | 2 | 3,
        dueDateTime: dateValue ? new Date(dateValue) : undefined,
        isAllDay,  // Explicitly set isAllDay based on time component
        assigneeId: taskData.assigneeId || undefined,
        listIds: taskData.listIds || [],
        repeating: taskData.repeating as any || 'never',
        customRepeatingData: taskData.customRepeatingData,
        // Dropping this here is how "add to Ready" landed tasks in Inbox —
        // the board sends it and POST /api/v1/tasks persists it (task f58ece7c).
        statusRole: taskData.statusRole
      }

      // Check if offline
      if (isOfflineMode()) {
        // Get current user data from session
        const currentUser = session?.user
        const userId = currentUser?.id || ''
        const userName = currentUser?.name || 'Offline User'
        const userEmail = currentUser?.email || ''

        // Build list relationships from listIds
        const listRelationships: TaskList[] = []
        if (taskData.listIds && taskData.listIds.length > 0) {
          // Try to load list data from IndexedDB for proper relationships
          for (const listId of taskData.listIds) {
            try {
              const list = await OfflineListOperations.getList(listId)
              if (list) {
                listRelationships.push(list)
              } else {
                // If list not in cache, create minimal stub for UI display
                listRelationships.push({
                  id: listId,
                  name: `List ${listId.slice(0, 8)}`, // Placeholder name
                  description: '',
                  color: DEFAULT_LIST_COLOR,
                  privacy: 'PRIVATE' as const,
                  ownerId: userId,
                  owner: {
                    id: userId,
                    name: userName,
                    email: userEmail,
                    createdAt: new Date()
                  },
                  createdAt: new Date(),
                  updatedAt: new Date(),
                  tasks: [],
                  members: [],
                  admins: [],
                  isFavorite: false,
                  favoriteOrder: null,
                  listMembers: [],
                  defaultAssigneeId: null,
                  defaultPriority: 0,
                  defaultRepeating: 'never',
                  defaultIsPrivate: true,
                  defaultDueDate: 'none'
                } as TaskList)
              }
            } catch (error) {
              console.warn(`Failed to load list ${listId} from offline storage`, error)
            }
          }
        }

        // Create optimistic task with temporary ID and PROPER metadata
        const tempTask: Task = {
          id: `temp-${nanoid()}`,
          title: taskData.title,
          description: taskData.description || '',
          priority: (taskData.priority || 0) as 0 | 1 | 2 | 3,
          completed: false,
          dueDateTime: taskData.dueDate ? new Date(taskData.dueDate) : null,
          assigneeId: taskData.assigneeId || null,
          repeating: (taskData.repeating as any) || 'never',
          createdAt: new Date(),
          updatedAt: new Date(),
          isPrivate: false,
          lists: listRelationships, // ✅ FIX: Include actual list relationships
          attachments: [],
          comments: [],
          creator: {
            id: userId,
            name: userName,
            email: userEmail,
            createdAt: new Date()
          }, // ✅ FIX: Use real creator data from session
          creatorId: userId, // ✅ FIX: Set proper creator ID
          repeatFrom: 'COMPLETION_DATE',
          occurrenceCount: 0
        }

        // Save to IndexedDB
        await OfflineTaskOperations.saveTask(tempTask)

        // Queue mutation for sync
        await OfflineSyncManager.queueMutation(
          'create',
          'task',
          tempTask.id,
          '/api/v1/tasks',
          'POST',
          apiData
        )

        onTaskCreated?.(tempTask)
        toast({
          title: "Task created (offline)",
          description: `"${tempTask.title}" will sync when online.`
        })

        return tempTask
      }

      // Online - normal API call
      const response = await apiPost('/api/v1/tasks', apiData)
      // v1 returns { task, meta }; legacy returned the task bare. Without the
      // unwrap the required-fields check below fails and a successful create
      // reports as a failure.
      const data = unwrapTask<Task>(await safeResponseJson<Task | { task: Task }>(response, null))

      if (data && hasRequiredFields(data, ['id', 'title'])) {
        // Save to IndexedDB for offline cache
        await OfflineTaskOperations.saveTask(data)

        // Track successful task creation

        onTaskCreated?.(data)
        toast({
          title: "Task created",
          description: `"${data.title}" has been created.`
        })

        return data
      }

      throw new Error('Failed to create task')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create task'
      onError?.(errorMessage)
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive"
      })
      return null
    } finally {
      setIsCreating(false)
    }
  }, [onTaskCreated, onError, toast, session])

  const updateTask = useCallback(async (taskId: string, updates: UpdateTaskData, currentTaskContext?: Task): Promise<Task | null> => {
    setIsUpdating(prev => ({ ...prev, [taskId]: true }))
    try {
      // Get existing task first to check if completion status is changing
      // Try IndexedDB first (works for both offline and online due to caching)
      let existingTask: Task | null = null
      try {
        existingTask = await OfflineTaskOperations.getTask(taskId) || null
      } catch (error) {
        console.debug('[useTaskOperations] Could not get task from cache:', error)
      }

      if (!existingTask && currentTaskContext) {
        existingTask = currentTaskContext
      }

      // Play completion sound if task is being marked as complete
      if (existingTask && updates.completed !== undefined) {
        playTaskCompleteSound(existingTask.completed, updates.completed)
      }

      const fallbackTitle = existingTask?.title || currentTaskContext?.title || ''
      const finalTitle = updates.title ?? fallbackTitle

      if (!finalTitle || !finalTitle.trim()) {
        throw new Error('Task title is required')
      }

      // Determine dueDateTime and isAllDay from updates
      let dueDateTime: Date | undefined = undefined
      let isAllDay: boolean | undefined = undefined

      // Check both dueDateTime (new) and dueDate (legacy) fields
      const dateField = (updates as any).dueDateTime ?? updates.dueDate
      const isAllDayField = (updates as any).isAllDay

      if (dateField !== undefined || isAllDayField !== undefined) {
        if (dateField) {
          const date = new Date(dateField)
          dueDateTime = date
          // Use explicit isAllDay if provided, otherwise infer from time component
          isAllDay = isAllDayField ?? (date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0)
        } else {
          // Clearing the date
          dueDateTime = undefined
          isAllDay = false
        }
      }

      // When completing a task, send the browser's local date
      // This is needed for all-day repeating tasks with COMPLETION_DATE mode
      // The server uses this to correctly calculate the next occurrence
      // without timezone confusion (e.g., 9pm PST = 5am UTC next day)
      let localCompletionDate: string | undefined
      if (updates.completed === true) {
        const now = new Date()
        // Format as YYYY-MM-DD in local timezone
        localCompletionDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      }

      const apiData: Partial<ApiUpdateTaskData> = {
        title: finalTitle,
        description: updates.description ?? existingTask?.description ?? currentTaskContext?.description,
        priority: (updates.priority ?? existingTask?.priority ?? currentTaskContext?.priority) as 0 | 1 | 2 | 3 | undefined,
        completed: updates.completed ?? existingTask?.completed ?? currentTaskContext?.completed,
        dueDateTime,
        isAllDay,
        assigneeId: updates.assigneeId === undefined
          ? existingTask?.assigneeId ?? currentTaskContext?.assigneeId ?? undefined
          : updates.assigneeId || undefined,
        listIds: updates.listIds,
        repeating: (updates.repeating ?? existingTask?.repeating ?? currentTaskContext?.repeating) as any,
        ...(localCompletionDate && { localCompletionDate })
      }

      // Check if offline
      if (isOfflineMode()) {
        // Get existing task from IndexedDB (already fetched above for completion check)
        const task = existingTask || await OfflineTaskOperations.getTask(taskId)

        if (!task) {
          throw new Error('Task not found in offline storage')
        }

        // ✅ FIX: Handle list assignment updates offline
        let updatedLists = task.lists
        if (updates.listIds !== undefined) {
          // Load list data from IndexedDB for proper relationships
          updatedLists = []
          for (const listId of updates.listIds) {
            try {
              const list = await OfflineListOperations.getList(listId)
              if (list) {
                updatedLists.push(list)
              } else {
                // Create minimal stub if list not in cache
                const currentUser = session?.user
                const userId = currentUser?.id || ''
                const userName = currentUser?.name || 'Offline User'
                const userEmail = currentUser?.email || ''

                updatedLists.push({
                  id: listId,
                  name: `List ${listId.slice(0, 8)}`,
                  description: '',
                  color: DEFAULT_LIST_COLOR,
                  privacy: 'PRIVATE' as const,
                  ownerId: userId,
                  owner: {
                    id: userId,
                    name: userName,
                    email: userEmail,
                    createdAt: new Date()
                  },
                  createdAt: new Date(),
                  updatedAt: new Date(),
                  tasks: [],
                  members: [],
                  admins: [],
                  isFavorite: false,
                  favoriteOrder: null,
                  listMembers: [],
                  defaultAssigneeId: null,
                  defaultPriority: 0,
                  defaultRepeating: 'never',
                  defaultIsPrivate: true,
                  defaultDueDate: 'none'
                } as TaskList)
              }
            } catch (error) {
              console.warn(`Failed to load list ${listId} from offline storage`, error)
            }
          }
        }

        // Apply updates optimistically
        const updatedTask: Task = {
          ...task,
          ...(updates.title !== undefined && { title: updates.title }),
          ...(updates.description !== undefined && { description: updates.description }),
          ...(updates.priority !== undefined && { priority: updates.priority as 0 | 1 | 2 | 3 }),
          ...(updates.completed !== undefined && { completed: updates.completed }),
          ...(updates.dueDate !== undefined && { dueDateTime: updates.dueDate ? new Date(updates.dueDate) : null }), // ✅ FIX: Use dueDateTime not dueDate
          ...(updates.assigneeId !== undefined && { assigneeId: updates.assigneeId }),
          lists: updatedLists, // ✅ FIX: Update lists array with proper relationships
          updatedAt: new Date()
        }

        // Save to IndexedDB
        await OfflineTaskOperations.saveTask(updatedTask)

        // Queue mutation for sync
        // PUT /api/v1/tasks/[id], matching the online path above. The queued
        // mutation used to be PATCH /api/tasks/[id]; that route exports
        // GET/PUT/DELETE only, so replay hit a 405 and the edit never reached
        // the server — invisibly, since IndexedDB still held it. Legacy PUT is
        // no good either: it rejects a body with no title, and this is a
        // partial update. (Task 22fb004d)
        await OfflineSyncManager.queueMutation(
          'update',
          'task',
          taskId,
          `/api/v1/tasks/${taskId}`,
          'PUT',
          apiData
        )

        // Track completion changes
        if (updates.completed !== undefined && existingTask && updates.completed !== existingTask.completed) {
          const trackProps = {
            taskId,
            listId: updatedTask.lists?.[0]?.id,
            hasDescription: !!updatedTask.description,
            hasDueDate: !!updatedTask.dueDateTime,
            priority: updatedTask.priority,
            isRepeating: updatedTask.repeating !== 'never',
          }
          if (updates.completed) {
          } else {
          }
        }

        // Track task edits (non-completion changes)
        if (existingTask) {
          const fieldsChanged: string[] = []
          if (updates.title !== undefined && updates.title !== existingTask.title) fieldsChanged.push('title')
          if (updates.description !== undefined && updates.description !== existingTask.description) fieldsChanged.push('description')
          if (updates.priority !== undefined && updates.priority !== existingTask.priority) fieldsChanged.push('priority')
          if (updates.dueDate !== undefined) fieldsChanged.push('dueDate')
          if (updates.assigneeId !== undefined && updates.assigneeId !== existingTask.assigneeId) fieldsChanged.push('assignee')
          if (updates.listIds !== undefined) fieldsChanged.push('lists')
          if (updates.repeating !== undefined && updates.repeating !== existingTask.repeating) fieldsChanged.push('repeating')

          if (fieldsChanged.length > 0) {
          }
        }

        // Notify success
        onTaskUpdated?.(updatedTask)
        toast({
          title: "Task updated (offline)",
          description: "Changes will sync when online."
        })

        return updatedTask
      }

      // Online - normal API call
      const response = await apiPut(`/api/v1/tasks/${taskId}`, apiData)
      const data = await safeResponseJson<Task | { task: Task }>(response, null)
      const taskData = unwrapTask<Task>(data)

      if (taskData) {
        // Save to IndexedDB for offline cache
        await OfflineTaskOperations.saveTask(taskData)

        // Track completion changes
        if (updates.completed !== undefined && existingTask && updates.completed !== existingTask.completed) {
          const trackProps = {
            taskId,
            listId: taskData.lists?.[0]?.id,
            hasDescription: !!taskData.description,
            hasDueDate: !!taskData.dueDateTime,
            priority: taskData.priority,
            isRepeating: taskData.repeating !== 'never',
          }
          if (updates.completed) {
          } else {
          }
        }

        // Track task edits (non-completion changes)
        if (existingTask) {
          const fieldsChanged: string[] = []
          if (updates.title !== undefined && updates.title !== existingTask.title) fieldsChanged.push('title')
          if (updates.description !== undefined && updates.description !== existingTask.description) fieldsChanged.push('description')
          if (updates.priority !== undefined && updates.priority !== existingTask.priority) fieldsChanged.push('priority')
          if (updates.dueDate !== undefined) fieldsChanged.push('dueDate')
          if (updates.assigneeId !== undefined && updates.assigneeId !== existingTask.assigneeId) fieldsChanged.push('assignee')
          if (updates.listIds !== undefined) fieldsChanged.push('lists')
          if (updates.repeating !== undefined && updates.repeating !== existingTask.repeating) fieldsChanged.push('repeating')

          if (fieldsChanged.length > 0) {
          }
        }

        onTaskUpdated?.(taskData)

        return taskData
      }

      throw new Error('Failed to update task - unexpected response format')
    } catch (error) {
      const detail = typeof error === 'object' && error !== null ? (error as any).detail : null
      const detailMessage = typeof detail === 'string'
        ? detail
        : detail?.error || detail?.message
      const errorMessage = detailMessage
        ? detailMessage
        : error instanceof Error
          ? error.message
          : 'Failed to update task'
      onError?.(errorMessage)
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive"
      })
      return null
    } finally {
      setIsUpdating(prev => ({ ...prev, [taskId]: false }))
    }
  }, [onTaskUpdated, onError, toast, session])

  const deleteTask = useCallback(async (taskId: string): Promise<boolean> => {
    setIsDeleting(prev => ({ ...prev, [taskId]: true }))
    try {
      // Check if offline
      if (isOfflineMode()) {
        // Delete from IndexedDB immediately
        await OfflineTaskOperations.deleteTask(taskId)

        // Queue mutation for sync
        await OfflineSyncManager.queueMutation(
          'delete',
          'task',
          taskId,
          `/api/v1/tasks/${taskId}`,
          'DELETE'
        )

        onTaskDeleted?.(taskId)
        toast({
          title: "Task deleted (offline)",
          description: "Deletion will sync when online."
        })

        return true
      }

      // Online - normal API call
      await apiDelete(`/api/v1/tasks/${taskId}`)

      // Remove from IndexedDB cache
      await OfflineTaskOperations.deleteTask(taskId)

      // Track successful deletion

      onTaskDeleted?.(taskId)
      toast({
        title: "Task deleted",
        description: "The task has been deleted."
      })

      return true
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete task'
      onError?.(errorMessage)
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive"
      })
      return false
    } finally {
      setIsDeleting(prev => ({ ...prev, [taskId]: false }))
    }
  }, [onTaskDeleted, onError, toast])

  const toggleTaskCompletion = useCallback(async (task: Task): Promise<Task | null> => {
    return updateTask(task.id, { completed: !task.completed }, task)
  }, [updateTask])

  const updateTaskPriority = useCallback(async (taskId: string, priority: number): Promise<Task | null> => {
    return updateTask(taskId, { priority })
  }, [updateTask])

  const updateTaskAssignee = useCallback(async (taskId: string, assigneeId: string | null): Promise<Task | null> => {
    return updateTask(taskId, { assigneeId })
  }, [updateTask])

  const updateTaskDueDate = useCallback(async (taskId: string, dueDate: Date | string | null): Promise<Task | null> => {
    return updateTask(taskId, { dueDate })
  }, [updateTask])

  const updateTaskLists = useCallback(async (taskId: string, listIds: string[], currentTask?: Task): Promise<Task | null> => {
    return updateTask(taskId, { listIds }, currentTask)
  }, [updateTask])

  return {
    createTask,
    updateTask,
    deleteTask,
    toggleTaskCompletion,
    updateTaskPriority,
    updateTaskAssignee,
    updateTaskDueDate,
    updateTaskLists,
    // Loading states
    isCreating,
    isUpdating,
    isDeleting,
    // Check if any operation is in progress
    isAnyOperationPending: isCreating || Object.values(isUpdating).some(Boolean) || Object.values(isDeleting).some(Boolean)
  }
}
