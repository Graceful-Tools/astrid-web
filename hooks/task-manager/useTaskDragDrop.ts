import { useState, useCallback, useRef, useEffect } from "react"
import { flushSync } from "react-dom"
import { apiPost, apiPut } from "@/lib/api"
import { useToast } from "@/hooks/use-toast"
import type { Task, TaskList } from "@/types/task"
import { resolvePromotion, shouldShowPromoteTarget } from "@/lib/subtask-promotion"

// Type for task operations hook return value
interface TaskOperations {
  updateTaskLists: (taskId: string, listIds: string[], currentTask?: Task) => Promise<Task | null>
}

const arraysEqual = (a: string[], b: string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index])

export interface UseTaskDragDropProps {
  tasks: Task[]
  lists: TaskList[]
  selectedListId: string
  currentUserId: string | null
  manualSortActive: boolean
  myTasksManualSortOrder: string[] | undefined
  setMyTasksManualSortOrder: (order: string[]) => void
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>
  setLists: React.Dispatch<React.SetStateAction<TaskList[]>>
  setSelectedTaskId: (id: string) => void
  newTaskOperations: TaskOperations
}

export interface UseTaskDragDropReturn {
  // State
  activeDragTaskId: string | null
  dragOverListId: string | null
  isShiftDrag: boolean
  dragTargetTaskId: string | null
  dragTargetPosition: 'above' | 'below' | 'end' | null
  manualSortPreviewActive: boolean
  /** True while a task that HAS a parent is in flight — the only time unnesting means anything. */
  promoteTargetVisible: boolean

  // Handlers
  handleTaskDragStart: (taskId: string) => void
  handleTaskDragEnd: () => void
  handleListDragEnter: (listId: string, shiftKey: boolean) => void
  handleListDragLeave: (listId: string) => void
  handleListDragOver: (listId: string, shiftKey: boolean) => void
  handleTaskDropOnList: (listId: string, options: { shiftKey: boolean }) => Promise<void>
  handleTaskDragHover: (taskId: string, position: 'above' | 'below') => void
  handleTaskDragLeaveTask: (taskId: string) => void
  handleTaskDragHoverEnd: () => void
  handleTaskDropOnPromoteTarget: () => Promise<void>
}

export function useTaskDragDrop({
  tasks,
  lists,
  selectedListId,
  currentUserId,
  manualSortActive,
  myTasksManualSortOrder,
  setMyTasksManualSortOrder,
  setTasks,
  setLists,
  setSelectedTaskId,
  newTaskOperations
}: UseTaskDragDropProps): UseTaskDragDropReturn {
  const { toast } = useToast()

  // Drag state
  const [activeDragTaskId, setActiveDragTaskId] = useState<string | null>(null)
  const [dragOverListId, setDragOverListId] = useState<string | null>(null)
  const [isShiftDrag, setIsShiftDrag] = useState(false)
  const [dragTargetTaskId, setDragTargetTaskId] = useState<string | null>(null)
  const [dragTargetPosition, setDragTargetPosition] = useState<'above' | 'below' | 'end' | null>(null)

  // Refs
  const dropHandledRef = useRef(false)
  const lastDragOverListIdRef = useRef<string | null>(null)
  const dragPreviewRef = useRef<HTMLDivElement | null>(null)
  const lastDragUpdateRef = useRef<{
    time: number
    taskId: string
    position: 'above' | 'below'
  } | null>(null)
  const manualDragListIdRef = useRef<string | null>(null)

  // Computed
  const manualSortPreviewActive = manualSortActive || (!!activeDragTaskId && manualDragListIdRef.current === selectedListId)

  // Listen for shift key during drag
  useEffect(() => {
    if (!activeDragTaskId || typeof window === "undefined") {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Shift") {
        setIsShiftDrag(true)
      }
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Shift") {
        setIsShiftDrag(false)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", handleKeyUp)

    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("keyup", handleKeyUp)
    }
  }, [activeDragTaskId])

  // Helper to apply manual order locally
  const applyManualOrderLocally = useCallback((order: string[], listId: string, isMyTasksList: boolean, userId: string | null, movedTaskId?: string) => {
    console.log('[ManualOrder] applyManualOrderLocally called:', { isMyTasksList, listId, orderLength: order.length })
    flushSync(() => {
      if (isMyTasksList) {
        // Update My Tasks preferences (synced via SSE)
        console.log('[ManualOrder] Updating My Tasks manual order:', order)
        setMyTasksManualSortOrder(order)
      } else {
        setLists(prev => prev.map(item =>
          item.id === listId
            ? { ...item, manualSortOrder: order }
            : item
        ))
      }

      setTasks(prev => {
        const originalIndexMap = new Map<string, number>()
        prev.forEach((task, index) => originalIndexMap.set(task.id, index))

        const manualIndexMap = new Map<string, number>(order.map((id, index) => [id, index]))
        const manualSize = order.length

        const belongsToManualOrder = (task: Task) => {
          if (isMyTasksList) {
            if (!userId) return false
            return task.assigneeId === userId || (task.assigneeId === null && task.creatorId === userId)
          }
          return task.lists ? task.lists.some(taskList => taskList && taskList.id === listId) : false
        }

        const next = [...prev]
        next.sort((a, b) => {
          const rankA = belongsToManualOrder(a)
            ? (manualIndexMap.get(a.id) ?? manualSize + (originalIndexMap.get(a.id) ?? manualSize))
            : manualSize + (originalIndexMap.get(a.id) ?? manualSize)

          const rankB = belongsToManualOrder(b)
            ? (manualIndexMap.get(b.id) ?? manualSize + (originalIndexMap.get(b.id) ?? manualSize))
            : manualSize + (originalIndexMap.get(b.id) ?? manualSize)

          if (rankA !== rankB) {
            return rankA - rankB
          }

          return (originalIndexMap.get(a.id) ?? 0) - (originalIndexMap.get(b.id) ?? 0)
        })

        return next
      })

      if (movedTaskId) {
        setSelectedTaskId(movedTaskId)
      }
    })
  }, [setLists, setMyTasksManualSortOrder, setTasks, setSelectedTaskId])

  // Reset manual drag state
  const resetManualDragState = useCallback(() => {
    setDragTargetTaskId(null)
    setDragTargetPosition(null)
    manualDragListIdRef.current = null
    lastDragUpdateRef.current = null
  }, [])

  // Clear all drag state
  const clearTaskDragState = useCallback(() => {
    setActiveDragTaskId(null)
    setDragOverListId(null)
    setIsShiftDrag(false)
    dropHandledRef.current = false
    lastDragOverListIdRef.current = null
    lastDragUpdateRef.current = null
    resetManualDragState()
  }, [resetManualDragState])

  // Drag start handler
  const handleTaskDragStart = useCallback((taskId: string) => {
    resetManualDragState()
    setActiveDragTaskId(taskId)
    setIsShiftDrag(false)
    dropHandledRef.current = false
    lastDragOverListIdRef.current = null
    lastDragUpdateRef.current = null
    manualDragListIdRef.current = manualSortActive ? selectedListId : null
  }, [manualSortActive, resetManualDragState, selectedListId])

  // List drag handlers
  const handleListDragEnter = useCallback((listId: string, shiftKey: boolean) => {
    if (!activeDragTaskId) {
      return
    }
    setDragOverListId(listId)
    setIsShiftDrag(shiftKey)
    lastDragOverListIdRef.current = listId
  }, [activeDragTaskId])

  const handleListDragLeave = useCallback((listId: string) => {
    setDragOverListId(current => (current === listId ? null : current))
  }, [])

  const handleListDragOver = useCallback((listId: string, shiftKey: boolean) => {
    if (!activeDragTaskId) {
      return
    }
    setIsShiftDrag(shiftKey)

    if (dragOverListId !== listId) {
      setDragOverListId(listId)
    }
    lastDragOverListIdRef.current = listId
  }, [activeDragTaskId, dragOverListId])

  // Task hover handlers for manual sorting
  const handleTaskDragHover = useCallback((taskId: string, position: 'above' | 'below') => {
    if (!manualSortActive || !activeDragTaskId || manualDragListIdRef.current !== selectedListId) {
      return
    }
    if (taskId === activeDragTaskId) {
      return
    }
    if (dragTargetTaskId === taskId && dragTargetPosition === position) {
      return
    }

    const now = performance.now()
    const cooldown = 80
    if (lastDragUpdateRef.current) {
      const { time, taskId: lastTaskId, position: lastPosition } = lastDragUpdateRef.current
      const elapsed = now - time

      if (taskId !== lastTaskId && elapsed < cooldown) {
        if (process.env.NODE_ENV === 'development') {
          console.log('[ManualSort] hover throttled', { taskId, position, because: 'cooldown' })
        }
        return
      }

      if (taskId === lastTaskId && position !== lastPosition) {
        if (elapsed < cooldown / 2) {
          return
        }
      }
    }

    if (process.env.NODE_ENV === 'development') {
      console.log('[ManualSort] hover', {
        taskId,
        position,
        dragTaskId: activeDragTaskId,
        listId: manualDragListIdRef.current
      })
    }
    setDragTargetTaskId(taskId)
    setDragTargetPosition(position)
    lastDragUpdateRef.current = { time: now, taskId, position }
  }, [manualSortActive, activeDragTaskId, selectedListId, dragTargetTaskId, dragTargetPosition])

  const handleTaskDragLeaveTask = useCallback((taskId: string) => {
    if (!manualSortActive) {
      return
    }
    if (dragTargetTaskId === taskId) {
      setDragTargetTaskId(null)
      setDragTargetPosition(null)
    }
  }, [manualSortActive, dragTargetTaskId])

  const handleTaskDragHoverEnd = useCallback(() => {
    if (!manualSortActive || !activeDragTaskId || manualDragListIdRef.current !== selectedListId) {
      return
    }
    if (dragTargetTaskId === null && dragTargetPosition === 'end') {
      return
    }
    if (process.env.NODE_ENV === 'development') {
      console.log('[ManualSort] hover end (bottom)', {
        dragTaskId: activeDragTaskId,
        listId: manualDragListIdRef.current
      })
    }
    setDragTargetTaskId(null)
    setDragTargetPosition('end')
  }, [manualSortActive, activeDragTaskId, selectedListId, dragTargetTaskId, dragTargetPosition])

  // Commit manual reorder
  const commitManualReorder = useCallback(async (): Promise<boolean> => {
    const orderTargetTaskId = dragTargetTaskId
    const orderTargetPosition = dragTargetPosition
    const listId = manualDragListIdRef.current
    const taskId = activeDragTaskId
    const userId = currentUserId

    if (!manualSortActive || !listId || !taskId || !orderTargetPosition || (orderTargetPosition !== 'end' && !orderTargetTaskId)) {
      return false
    }

    const isMyTasksList = listId === 'my-tasks'
    const list = lists.find(item => item.id === listId)

    if (!isMyTasksList) {
      if (!list || list.isVirtual) {
        return false
      }
    }

    let listTasks: Task[]
    if (isMyTasksList) {
      if (!userId) {
        return false
      }
      listTasks = tasks.filter(task =>
        task.assigneeId === userId ||
        (task.assigneeId === null && task.creatorId === userId)
      )
    } else {
      listTasks = tasks.filter(task =>
        task.lists && task.lists.some(taskList => taskList && taskList.id === listId)
      )
    }

    if (listTasks.length === 0) {
      return false
    }

    const listTaskIds = listTasks.map(task => task.id)
    if (!listTaskIds.includes(taskId)) {
      return false
    }

    const existingManualOrder = isMyTasksList
      ? (myTasksManualSortOrder || []).filter(id => listTaskIds.includes(id))
      : (Array.isArray((list as any)?.manualSortOrder)
          ? (list!.manualSortOrder as string[]).filter(id => listTaskIds.includes(id))
          : [])

    const normalizedOrder = [...existingManualOrder]
    listTaskIds.forEach(id => {
      if (!normalizedOrder.includes(id)) {
        normalizedOrder.push(id)
      }
    })

    const previousOrder = [...normalizedOrder]

    const sourceIndex = normalizedOrder.indexOf(taskId)
    if (sourceIndex === -1) {
      return false
    }
    normalizedOrder.splice(sourceIndex, 1)

    let targetIndex: number
    if (orderTargetPosition === 'end') {
      targetIndex = normalizedOrder.length
    } else {
      const currentIndex = normalizedOrder.indexOf(orderTargetTaskId!)
      targetIndex = currentIndex === -1
        ? normalizedOrder.length
        : currentIndex + (orderTargetPosition === 'below' ? 1 : 0)
    }

    normalizedOrder.splice(targetIndex, 0, taskId)

    if (arraysEqual(previousOrder, normalizedOrder)) {
      return false
    }

    applyManualOrderLocally(normalizedOrder, listId, isMyTasksList, userId ?? null, taskId)

    if (isMyTasksList) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[ManualSort] commit My Tasks reorder', {
          order: normalizedOrder,
          taskId,
          targetPosition: orderTargetPosition
        })
      }
      dropHandledRef.current = true
      resetManualDragState()
      return true
    }

    dropHandledRef.current = true
    resetManualDragState()

    if (process.env.NODE_ENV === 'development') {
      console.log('[ManualSort] commit list reorder', {
        listId,
        order: normalizedOrder,
        taskId,
        targetPosition: orderTargetPosition
      })
    }

    try {
      const response = await apiPost(`/api/lists/${listId}/manual-order`, {
        order: normalizedOrder
      })

      if (response.ok) {
        const updatedList = await response.json()
        if (updatedList && updatedList.id) {
          setLists(prev =>
            prev.map(item =>
              item.id === updatedList.id
                ? { ...item, ...updatedList }
                : item
            )
          )
        }
        return true
      }

      const errorText = await response.text()
      throw new Error(errorText || 'Failed to save manual order')
    } catch (error) {
      console.error('Error saving manual order:', error)
      applyManualOrderLocally(previousOrder, listId, isMyTasksList, userId ?? null)
      toast({
        title: "Unable to update order",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
        duration: 3000
      })
      return false
    }
  }, [
    dragTargetTaskId,
    dragTargetPosition,
    manualSortActive,
    lists,
    tasks,
    activeDragTaskId,
    setLists,
    resetManualDragState,
    toast,
    myTasksManualSortOrder,
    currentUserId,
    applyManualOrderLocally
  ])

  // Only while a subtask is in flight (task b00a1f94).
  const draggedTask = activeDragTaskId ? tasks.find(item => item.id === activeDragTaskId) : null
  const promoteTargetVisible = shouldShowPromoteTarget(draggedTask)

  /**
   * Drop on "move out of subtask": clear the parent link.
   *
   * Optimistic, because the row has to visibly leave its nesting the moment you
   * let go — waiting for the round trip is what makes a drag feel broken.
   */
  const handleTaskDropOnPromoteTarget = useCallback(async () => {
    const task = activeDragTaskId ? tasks.find(item => item.id === activeDragTaskId) : null
    const promotion = resolvePromotion(task)
    if (!task || !promotion) {
      clearTaskDragState()
      return
    }

    dropHandledRef.current = true
    const previousParentId = task.parentTaskId

    setTasks(prev => prev.map(item =>
      item.id === task.id ? { ...item, parentTaskId: null } : item
    ))

    try {
      // Calls the API directly rather than through `newTaskOperations`: the
      // hook is constructed with `newTaskOperations: null as any` and never
      // reconnected, so anything routed through it fails into a catch. Tracked
      // separately; this path must not inherit that.
      const response = await apiPut(`/api/tasks/${promotion.taskId}`, {
        ...task,
        parentTaskId: null,
      })
      if (!response.ok) {
        const detail = await response.text()
        throw new Error(detail || "Failed to move task out of its parent")
      }

      toast({
        title: "Moved out of subtask",
        description: `"${task.title}" is now a top-level task.`,
        duration: 2500,
      })
    } catch (error) {
      setTasks(prev => prev.map(item =>
        item.id === task.id ? { ...item, parentTaskId: previousParentId } : item
      ))
      toast({
        title: "Unable to move task",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      })
    } finally {
      clearTaskDragState()
    }
  }, [activeDragTaskId, tasks, toast, clearTaskDragState, setTasks])

  // Drop on list handler
  const handleTaskDropOnList = useCallback(async (listId: string, options: { shiftKey: boolean }) => {
    if (!activeDragTaskId) {
      return
    }
    dropHandledRef.current = true

    const targetList = lists.find(list => list.id === listId)
    if (!targetList || targetList.isVirtual) {
      clearTaskDragState()
      return
    }

    const task = tasks.find(item => item.id === activeDragTaskId)
    if (!task) {
      clearTaskDragState()
      return
    }

    const baseTaskLists = [...(task.lists || [])]
    const selectedList = selectedListId ? lists.find(list => list.id === selectedListId) : null
    if (selectedList && !selectedList.isVirtual && !baseTaskLists.some(list => list.id === selectedList.id)) {
      baseTaskLists.push(selectedList)
    }

    const originalTaskLists = baseTaskLists.map(list => ({ ...list }))

    const currentListIds = baseTaskLists
      .map(list => list.id)
      .filter((id): id is string => typeof id === "string")
    const uniqueCurrentIds = Array.from(new Set(currentListIds))

    const shouldAdd = options.shiftKey || isShiftDrag
    const nextListIds = shouldAdd
      ? Array.from(new Set([...uniqueCurrentIds, listId]))
      : [listId]

    const addedListIds = nextListIds.filter(id => !uniqueCurrentIds.includes(id))
    const removedListIds = uniqueCurrentIds.filter(id => !nextListIds.includes(id))

    const manualOrderSnapshots = new Map<string, string[] | undefined>()
    lists.forEach(existingList => {
      if (existingList.sortBy !== 'manual') {
        return
      }
      if (addedListIds.includes(existingList.id) || removedListIds.includes(existingList.id)) {
        manualOrderSnapshots.set(
          existingList.id,
          Array.isArray((existingList as any).manualSortOrder)
            ? [...(existingList.manualSortOrder as string[])]
            : undefined
        )
      }
    })

    const hasChange =
      uniqueCurrentIds.length !== nextListIds.length ||
      uniqueCurrentIds.some(id => !nextListIds.includes(id))

    if (!hasChange) {
      toast({
        title: "No changes applied",
        description: "Task is already associated with that list.",
        duration: 2500
      })
      clearTaskDragState()
      return
    }

    const nextListIdSet = new Set(nextListIds)
    const nextListObjects = [
      ...baseTaskLists.filter(list => list && nextListIdSet.has(list.id)),
      ...lists.filter(list => nextListIdSet.has(list.id))
    ]

    if (targetList && !nextListObjects.some(list => list.id === targetList.id)) {
      nextListObjects.push(targetList)
    }

    const dedupedNextLists = nextListObjects.reduce<TaskList[]>((acc, list) => {
      if (!list || acc.some(existing => existing.id === list.id)) {
        return acc
      }
      return [...acc, list]
    }, [])

    setLists(prev => prev.map(list => {
      if (list.sortBy !== 'manual') {
        return list
      }

      let manualOrder = Array.isArray((list as any).manualSortOrder)
        ? (list.manualSortOrder as string[])
        : []

      let changed = false

      if (addedListIds.includes(list.id) && !manualOrder.includes(task.id)) {
        manualOrder = [...manualOrder, task.id]
        changed = true
      }

      if (removedListIds.includes(list.id) && manualOrder.includes(task.id)) {
        manualOrder = manualOrder.filter(id => id !== task.id)
        changed = true
      }

      if (!changed) {
        return list
      }

      return {
        ...list,
        manualSortOrder: manualOrder
      }
    }))

    setTasks(prev =>
      prev.map(item =>
        item.id === task.id ? { ...item, lists: dedupedNextLists } : item
      )
    )

    try {
      const updatedTask = await newTaskOperations.updateTaskLists(activeDragTaskId, nextListIds, task)

      if (!updatedTask) {
        throw new Error("Failed to update task lists")
      }

      toast({
        title: shouldAdd ? "Task added to list" : "Task moved to list",
        description: (() => {
          if (shouldAdd) {
            const originalNames = originalTaskLists.map(list => list.name).join(', ')
            return `"${updatedTask.title}" now appears in ${targetList.name}${
              originalNames ? ` as well as ${originalNames}` : ''
            }.`
          }
          return `"${updatedTask.title}" moved to ${targetList.name}.`
        })(),
        duration: 2500
      })
    } catch (error) {
      setLists(prev => prev.map(list => {
        if (!manualOrderSnapshots.has(list.id)) {
          return list
        }
        return {
          ...list,
          manualSortOrder: manualOrderSnapshots.get(list.id)
        }
      }))
      setTasks(prev =>
        prev.map(item =>
          item.id === task.id ? { ...item, lists: originalTaskLists } : item
        )
      )
      const detail = typeof error === 'object' && error !== null ? (error as any).detail : null
      const detailMessage = typeof detail === 'string'
        ? detail
        : detail?.error || detail?.message
      const message = detailMessage
        ? detailMessage
        : error instanceof Error
          ? error.message
          : "Unable to update task lists"
      toast({
        title: "Unable to update task",
        description: message,
        variant: "destructive"
      })
    } finally {
      lastDragOverListIdRef.current = null
      clearTaskDragState()
    }
  }, [activeDragTaskId, lists, tasks, newTaskOperations, toast, clearTaskDragState, isShiftDrag, selectedListId, setLists, setTasks])

  // Drag end handler
  const handleTaskDragEnd = useCallback(() => {
    if (manualSortActive && manualDragListIdRef.current) {
      void (async () => {
        const handled = await commitManualReorder()
        if (handled) {
          clearTaskDragState()
          return
        }

        if (!dropHandledRef.current && lastDragOverListIdRef.current) {
          await handleTaskDropOnList(lastDragOverListIdRef.current, { shiftKey: isShiftDrag })
        } else {
          clearTaskDragState()
        }
      })()
      return
    }

    if (!dropHandledRef.current && lastDragOverListIdRef.current) {
      void handleTaskDropOnList(lastDragOverListIdRef.current, { shiftKey: isShiftDrag })
    } else {
      clearTaskDragState()
    }
  }, [manualSortActive, commitManualReorder, clearTaskDragState, handleTaskDropOnList, isShiftDrag])

  return {
    // State
    activeDragTaskId,
    dragOverListId,
    isShiftDrag,
    dragTargetTaskId,
    dragTargetPosition,
    manualSortPreviewActive,
    promoteTargetVisible,

    // Handlers
    handleTaskDragStart,
    handleTaskDragEnd,
    handleListDragEnter,
    handleListDragLeave,
    handleListDragOver,
    handleTaskDropOnList,
    handleTaskDragHover,
    handleTaskDragLeaveTask,
    handleTaskDragHoverEnd,
    handleTaskDropOnPromoteTarget
  }
}
