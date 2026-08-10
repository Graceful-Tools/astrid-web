import type { Task, TaskList } from '@/types/task'
import { unwrapTask } from '@/lib/v1-response'
import { parseRelativeDate } from '@/lib/date-utils'
import { createLogger } from '@/lib/logger'

const log = createLogger('task-creation-utils')


export interface TaskCreationData {
  title: string
  description?: string
  priority?: number
  repeating?: string
  customRepeatingData?: any
  isPrivate?: boolean
  dueDateTime?: Date | string | null
  isAllDay?: boolean
  assigneeId?: string | null
  listIds?: string[]
}

export interface TaskCreationDependencies {
  effectiveSession: any
  lists: TaskList[]
  availableUsers: any[]
  selectedListId: string
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>
  toast: any
  apiPost: any
  refreshLists: () => Promise<void>
}

export function applyListDefaults(taskData: TaskCreationData, targetList: TaskList | null, selectedListId: string): TaskCreationData {
  // First, determine the due date from defaults
  let dueDateTime = taskData.dueDateTime ?? (
    selectedListId === "today"
      ? parseRelativeDate("today")
      : (targetList?.defaultDueDate && targetList.defaultDueDate !== "none"
          ? parseRelativeDate(targetList.defaultDueDate)
          : undefined)
  )

  // Determine if this should be an all-day task
  let isAllDay = taskData.isAllDay ?? (targetList?.defaultDueTime === null)

  // Apply defaultDueTime if the task doesn't already have a due date with time
  // This ensures that list defaults for time are applied to new tasks
  if (!taskData.dueDateTime && targetList?.defaultDueTime !== undefined) {
    // If no date exists yet but we have a default time, create today's date
    if (!dueDateTime) {
      dueDateTime = new Date()
      dueDateTime.setHours(0, 0, 0, 0) // Start at midnight
    }

    // Convert dueDateTime to Date if it's a string
    const dateToModify = typeof dueDateTime === 'string' ? new Date(dueDateTime) : new Date(dueDateTime)

    // Apply the default time
    if (targetList.defaultDueTime !== null) {
      // Specific time (HH:MM format)
      const [hours, minutes] = targetList.defaultDueTime.split(':').map(Number)
      if (!isNaN(hours) && !isNaN(minutes)) {
        dateToModify.setHours(hours, minutes, 0, 0)
        isAllDay = false
      }
    } else {
      // null means "all day" - ensure midnight
      dateToModify.setHours(0, 0, 0, 0)
      isAllDay = true
    }

    dueDateTime = dateToModify
  }

  const result = {
    ...taskData,
    priority: taskData.priority ?? targetList?.defaultPriority ?? 0,
    repeating: taskData.repeating ?? targetList?.defaultRepeating ?? "never",
    isPrivate: taskData.isPrivate ?? targetList?.defaultIsPrivate ?? true,
    dueDateTime,
    isAllDay,
    assigneeId: taskData.assigneeId !== undefined ? taskData.assigneeId : (
      targetList?.defaultAssigneeId === "unassigned" ? null : targetList?.defaultAssigneeId
    ),
  }

  return result
}

export function createTempTask(
  taskData: TaskCreationData,
  tempTaskId: string,
  dependencies: Pick<TaskCreationDependencies, 'effectiveSession' | 'lists' | 'availableUsers'>
): Task {
  return {
    id: tempTaskId,
    title: taskData.title,
    description: taskData.description || "",
    priority: (taskData.priority as 0 | 1 | 2 | 3) || 0,
    repeating: (taskData.repeating as "custom" | "never" | "daily" | "weekly" | "monthly" | "yearly") || "never",
    isPrivate: taskData.isPrivate ?? true,
    completed: false,
    dueDateTime: taskData.dueDateTime ? (typeof taskData.dueDateTime === 'string' ? new Date(taskData.dueDateTime) : taskData.dueDateTime) : undefined,
    isAllDay: taskData.isAllDay ?? false,
    assignee: taskData.assigneeId
      ? dependencies.availableUsers.find(u => u.id === taskData.assigneeId) || {
          id: taskData.assigneeId,
          name: "Unknown User",
          email: "unknown@example.com",
          image: null,
          createdAt: new Date(),
        }
      : (taskData.assigneeId === null ? null : dependencies.effectiveSession.user),
    assigneeId: taskData.assigneeId === null ? null : (taskData.assigneeId || dependencies.effectiveSession.user.id),
    creator: dependencies.effectiveSession.user,
    creatorId: dependencies.effectiveSession.user.id,
    lists: taskData.listIds
      ?.map((listId: string) => dependencies.lists.find((l: TaskList) => l.id === listId))
      .filter((list): list is TaskList => Boolean(list)) || [],
    comments: [],
    attachments: [],
    repeatFrom: 'COMPLETION_DATE',
    occurrenceCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

export function mapTaskDataForApi(taskData: TaskCreationData) {
  // Simple mapping - defaults have already been applied by applyTaskDefaultsWithPriority
  // We just need to convert "unassigned" string to null if it somehow got through
  const assigneeId = taskData.assigneeId === "unassigned" ? null : taskData.assigneeId

  // Convert Date to ISO string for API
  let dueDateTimeValue: string | undefined = undefined
  if (taskData.dueDateTime) {
    if (taskData.dueDateTime instanceof Date) {
      dueDateTimeValue = taskData.dueDateTime.toISOString()
    } else if (typeof taskData.dueDateTime === 'string') {
      dueDateTimeValue = taskData.dueDateTime
    }
  }

  return {
    title: taskData.title,
    description: taskData.description || '',
    priority: taskData.priority || 0,
    repeating: taskData.repeating || 'never',
    customRepeatingData: taskData.customRepeatingData || null,
    isPrivate: taskData.isPrivate ?? true,
    dueDateTime: dueDateTimeValue,
    isAllDay: taskData.isAllDay ?? false,
    assigneeId,
    listIds: taskData.listIds || []
  }
}

export async function handleTaskCreationOptimistic(
  taskData: TaskCreationData,
  dependencies: TaskCreationDependencies
): Promise<Task | null> {
  const tempTaskId = `temp-${Date.now()}`

  try {
    // Create temporary task and add to UI immediately
    const tempTask = createTempTask(taskData, tempTaskId, dependencies)
    dependencies.setTasks(prev => [tempTask, ...prev])

    // Show optimistic success immediately
    dependencies.toast({
      title: "Success",
      description: "Task created successfully!",
      duration: 1500,
    })

    try {
      // Send the actual request with proper field mapping
      const apiTaskData = mapTaskDataForApi(taskData)

      const response = await dependencies.apiPost("/api/v1/tasks", apiTaskData)
      // v1 wraps the new task in { task, meta }; legacy returned it bare.
      const realTask = unwrapTask<Task>(await response.json())

      // Validate the response has the expected task structure
      if (!realTask) {
        throw new Error('Invalid task response from server')
      }

      // Replace temporary task with real task
      dependencies.setTasks(prevTasks => prevTasks.map(task =>
        task.id === tempTaskId ? realTask : task
      ))

      // Refresh lists to update task counts
      await dependencies.refreshLists()

      return realTask
    } catch (error) {
      log.error({ err: error }, "❌ Error creating task:")
      log.error({
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      }, "❌ Error details:")

      // Rollback: Remove the temporary task on error
      log.info("🔄 Rolling back optimistic task creation")
      dependencies.setTasks(prevTasks => prevTasks.filter(task => task.id !== tempTaskId))

      const errorMessage = error instanceof Error ? error.message : "Unknown error"
      dependencies.toast({
        title: "Error",
        description: `Failed to create task: ${errorMessage}`,
        variant: "destructive",
        duration: 3000,
      })
      throw error
    }

  } catch (error) {
    log.error({ err: error }, "Error creating task:")
    dependencies.toast({
      title: "Error",
      description: "Failed to create task. Please try again.",
      variant: "destructive",
      duration: 1500,
    })
    return null
  }
}

export async function validateSession(
  effectiveSession: any,
  sessionStatus: string,
  toast: any
): Promise<boolean> {
  if (!effectiveSession?.user) {
    // If we're authenticated but don't have session data yet, implement a short retry
    if (sessionStatus === "authenticated") {
      // Wait a short moment and retry once
      await new Promise(resolve => setTimeout(resolve, 100))

      // Re-check session after brief wait
      if (!effectiveSession?.user) {
        toast({
          title: "Session Loading",
          description: "Please try creating the task again in a moment...",
          variant: "default",
          duration: 3000
        })
        return false
      }
    } else {
      log.error({ sessionStatus, hasSession: !!effectiveSession }, 'No user session available for task creation')

      if (sessionStatus === "loading") {
        toast({
          title: "Please wait",
          description: "Loading your session...",
          variant: "default"
        })
      } else {
        toast({
          title: "Authentication Error",
          description: "Please log in to create tasks",
          variant: "destructive"
        })
      }
      return false
    }
  }

  return true
}