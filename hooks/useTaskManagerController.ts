import React, { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useToast } from "@/hooks/use-toast"
import { useTaskOperations } from "@/hooks/useTaskOperations"
import { playTaskCompleteSound } from "@/lib/task-sounds"
import { useFilterState } from "@/hooks/useFilterState"
import { useMyTasksPreferences } from "@/hooks/useMyTasksPreferences"
import { useUserSettings } from "@/hooks/useUserSettings"
import { useOptimisticListInfo } from "@/hooks/use-optimistic-list-info"
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api"
import { applyVirtualListFilter, getListDisplayInfo } from "@/lib/virtual-list-utils"
import { getColumnCount, getLayoutType } from "@/lib/layout-detection"
import {
  parseTaskInput,
  getTaskCountForList,
  getSavedFilterTaskCount,
  canEditListSettings,
  getFixedListTaskCount
} from "@/lib/task-manager-utils"
import {
  mapTaskDataForApi,
} from '@/lib/task-creation-utils'
import { applyTaskDefaultsWithPriority } from '@/lib/task-defaults-priority'
import type { Task, TaskList } from "@/types/task"
import { trackListCreated, trackListDeleted, trackListEdited } from "@/lib/analytics"
import { preloadUserAvatars } from "@/lib/image-cache"

// Import composable hooks
import {
  useTaskListState,
  useTaskNavigation,
  useTaskPaneState,
  useTaskSelection,
  useTaskDragDrop
} from "@/hooks/task-manager"

interface UseTaskManagerControllerProps {
  initialSelectedListId?: string
  initialSelectedTaskId?: string
  listMetadata?: any
  taskMetadata?: any
  isMobile?: boolean
  is1Column?: boolean
  setMobileView?: (view: 'list' | 'task') => void
  handleMobileBack?: () => void
  setShowMobileSidebar?: (show: boolean) => void
}

// Import session handling
let useSession: any = () => ({ data: null, status: "loading" })

// Allow tests to override the session hook
if (typeof window !== "undefined" && (window as any).__TEST_USE_SESSION__) {
  useSession = (window as any).__TEST_USE_SESSION__
} else if (typeof window !== "undefined" && !window.location.hostname.includes("vusercontent.net")) {
  try {
    const { useSession: nextAuthUseSession } = require("next-auth/react")
    useSession = nextAuthUseSession
  } catch (error) {
    console.warn("NextAuth not available:", error)
  }
}

export function useTaskManagerController({
  initialSelectedListId,
  initialSelectedTaskId,
  listMetadata,
  taskMetadata,
  isMobile: externalIsMobile,
  setMobileView: externalSetMobileView,
  handleMobileBack: externalHandleMobileBack,
  setShowMobileSidebar
}: UseTaskManagerControllerProps) {
  // Session management
  const sessionResult = useSession()
  const sessionData = sessionResult?.data || null
  const sessionStatus = sessionResult?.status || "loading"
  const effectiveSession = sessionData
  const { toast } = useToast()
  const router = useRouter()

  // My Tasks preferences (synced across devices via SSE)
  const myTasksPreferences = useMyTasksPreferences()

  // User settings (synced across devices via SSE)
  const { smartTaskCreationEnabled } = useUserSettings()

  // Layout state (managed externally by useTaskManagerLayout)
  const isMobile = externalIsMobile || false

  // Modal states
  const [showAddListModal, setShowAddListModal] = useState(false)
  const [showImagePicker, setShowImagePicker] = useState(false)
  const [selectedListForImagePicker, setSelectedListForImagePicker] = useState<TaskList | null>(null)
  const [isCreatingTask, setIsCreatingTask] = useState(false)

  // Refs
  const taskManagerRef = useRef<HTMLDivElement>(null)
  const isScrollingToNewTaskRef = useRef<boolean>(false)

  // Session ready state
  const isSessionReady = useMemo(() => {
    return sessionStatus === "authenticated" && effectiveSession?.user
  }, [sessionStatus, effectiveSession])

  // === COMPOSABLE HOOKS ===

  // Task pane state (needs to be initialized early for closeTaskPaneAnimated)
  // We'll initialize this after selection, but define a temporary setter
  const [tempSelectedTaskId, setTempSelectedTaskId] = useState<string>(initialSelectedTaskId || "")
  const [tempSelectedTaskElement, setTempSelectedTaskElement] = useState<HTMLElement | null>(null)

  const taskPaneState = useTaskPaneState({
    selectedTaskId: tempSelectedTaskId,
    isMobile,
    setSelectedTaskId: setTempSelectedTaskId,
    setSelectedTaskElement: setTempSelectedTaskElement
  })

  // Navigation state (list selection, mobile view, etc.)
  const navigationState = useTaskNavigation({
    initialSelectedListId,
    isMobile,
    setMobileView: externalSetMobileView,
    initialSelectedTaskId,
    loading: false, // Will be updated
    tasks: [], // Will be updated
    selectedTaskId: tempSelectedTaskId,
    setSelectedTaskId: setTempSelectedTaskId
  })

  // Task list state (tasks, lists, loading, SSE updates)
  const listState = useTaskListState({
    effectiveSession,
    selectedListId: navigationState.selectedListId,
    setSelectedListId: navigationState.setSelectedListId,
    setSelectedTaskId: setTempSelectedTaskId,
    selectedTaskId: tempSelectedTaskId
  })

  // Update navigation hook with actual task data for auto-open from URL
  useEffect(() => {
    if (initialSelectedTaskId && !listState.loading && listState.tasks.length > 0) {
      const taskExists = listState.tasks.some(t => t.id === initialSelectedTaskId)
      if (taskExists && tempSelectedTaskId !== initialSelectedTaskId) {
        setTempSelectedTaskId(initialSelectedTaskId)
        if (isMobile && externalSetMobileView) {
          requestAnimationFrame(() => {
            externalSetMobileView('task')
          })
        }
      }
    }
  }, [initialSelectedTaskId, listState.loading, listState.tasks, tempSelectedTaskId, isMobile, externalSetMobileView])

  // Close task details when switching lists
  const previousSelectedListId = useRef(navigationState.selectedListId)
  useEffect(() => {
    if (previousSelectedListId.current !== navigationState.selectedListId && tempSelectedTaskId) {
      setTempSelectedTaskId("")
    }
    previousSelectedListId.current = navigationState.selectedListId
  }, [navigationState.selectedListId, tempSelectedTaskId])

  // Task selection state
  const selectionState = useTaskSelection({
    initialSelectedTaskId,
    finalFilteredTasks: [], // Will be updated with filtered tasks below
    isMobile,
    selectedListId: navigationState.selectedListId,
    finalTasks: listState.finalTasks,
    closeTaskPaneAnimated: taskPaneState.closeTaskPaneAnimated,
    setMobileView: externalSetMobileView,
    setShowMobileSidebar
  })

  // Sync selection state with temp state (since we had to bootstrap them)
  useEffect(() => {
    if (selectionState.selectedTaskId !== tempSelectedTaskId) {
      // Keep them in sync - selection state is the source of truth after initial render
    }
  }, [selectionState.selectedTaskId, tempSelectedTaskId])

  // Use selection state as the canonical source
  const selectedTaskId = tempSelectedTaskId
  const setSelectedTaskId = setTempSelectedTaskId
  const selectedTaskElement = tempSelectedTaskElement
  const setSelectedTaskElement = setTempSelectedTaskElement
  const selectedTaskRect = selectionState.selectedTaskRect
  const setSelectedTaskRect = selectionState.setSelectedTaskRect
  const isKeyboardScrollingRef = selectionState.isKeyboardScrollingRef

  // Filter state management
  const newFilterState = useFilterState({
    selectedListId: navigationState.selectedListId,
    currentList: listState.lists.find(l => l.id === navigationState.selectedListId),
    getManualOrder: useCallback((listId: string) => {
      const collectRelevantTaskIds = () => {
        if (listId === 'my-tasks') {
          if (!listState.currentUserId) {
            return []
          }
          return listState.tasks
            .filter(task =>
              task.assigneeId === listState.currentUserId ||
              (task.assigneeId === null && task.creatorId === listState.currentUserId)
            )
            .map(task => task.id)
        }

        return listState.tasks
          .filter(task => task.lists && task.lists.some(taskList => taskList && taskList.id === listId))
          .map(task => task.id)
      }

      let baseOrder: string[] = []

      if (listId === 'my-tasks') {
        baseOrder = [...(myTasksPreferences.filters.manualSortOrder || [])]
      } else {
        const list = listState.lists.find(item => item.id === listId)
        if (list && Array.isArray((list as any).manualSortOrder)) {
          baseOrder = (list.manualSortOrder as string[]).filter((id): id is string => typeof id === 'string')
        }
      }

      const relevantTaskIds = collectRelevantTaskIds()
      const sanitizedOrder = baseOrder.filter(id => relevantTaskIds.includes(id))
      const missingTaskIds = relevantTaskIds.filter(id => !sanitizedOrder.includes(id))
      let workingOrder = [...sanitizedOrder, ...missingTaskIds]

      return workingOrder.length > 0 ? workingOrder : undefined
    }, [listState.lists, myTasksPreferences.filters.manualSortOrder, listState.tasks, listState.currentUserId])
  })

  const manualSortActive = useMemo(() => {
    if (!navigationState.selectedListId) return false
    if (navigationState.selectedListId === 'my-tasks') {
      return newFilterState.filters.sortBy === "manual"
    }
    const list = listState.lists.find(item => item.id === navigationState.selectedListId)
    if (!list || list.isVirtual) {
      return false
    }
    return newFilterState.filters.sortBy === "manual"
  }, [listState.lists, navigationState.selectedListId, newFilterState.filters.sortBy])

  // Task drag and drop
  const dragDropState = useTaskDragDrop({
    tasks: listState.tasks,
    lists: listState.lists,
    selectedListId: navigationState.selectedListId,
    currentUserId: listState.currentUserId,
    manualSortActive,
    myTasksManualSortOrder: myTasksPreferences.filters.manualSortOrder,
    setMyTasksManualSortOrder: myTasksPreferences.setters.setManualSortOrder,
    setTasks: listState.setTasks,
    setLists: listState.setLists,
    setSelectedTaskId,
    newTaskOperations: null as any // Will be set after newTaskOperations is defined
  })

  // Filtered tasks
  const finalFilteredTasks = useMemo(() => {
    try {
      const currentList = listState.lists.find(l => l.id === navigationState.selectedListId)
      let filtered = [...listState.finalTasks]

      // Check if we're in universal search mode
      const isUniversalSearch = newFilterState.filters.search.trim().length > 0

      // Skip list pre-filtering if in universal search mode
      if (!isUniversalSearch) {
        if (navigationState.selectedListId === "my-tasks") {
          const myTasksList = {
            id: "my-tasks",
            name: "My Tasks",
            isVirtual: true,
            virtualListType: "my-tasks" as const,
            filterAssignee: undefined,
            filterDueDate: undefined,
            filterCompletion: undefined,
            filterAssignedBy: undefined,
            filterPriority: undefined,
            filterInLists: undefined
          }
          filtered = applyVirtualListFilter(filtered, myTasksList as any, effectiveSession?.user?.id || '')
        } else if (currentList) {
          if (currentList.isVirtual) {
            filtered = applyVirtualListFilter(filtered, currentList, effectiveSession?.user?.id || '')
          } else {
            filtered = filtered.filter(task =>
              task.lists && task.lists.some(taskList => taskList.id === navigationState.selectedListId)
            )
          }
        }
      }

      filtered = newFilterState.applyFiltersToTasks(
        filtered,
        effectiveSession?.user?.id,
        listState.lists,
        !isUniversalSearch,
        false
      )

      return filtered
    } catch (error) {
      console.error("Error filtering tasks:", error)
      return listState.finalTasks
    }
  }, [listState.finalTasks, listState.lists, navigationState.selectedListId, effectiveSession?.user?.id, newFilterState])

  // Selected task
  const selectedTask = useMemo(() => {
    const task = listState.finalTasks.find((task: Task) => task.id === selectedTaskId)
    if (process.env.NODE_ENV === 'development' && selectedTaskId && !task) {
      console.log('[useTaskManagerController] selectedTask computation - TASK NOT FOUND:', {
        selectedTaskId,
        finalTasksCount: listState.finalTasks.length,
        isOptimisticId: selectedTaskId.startsWith('temp-')
      })
    }
    return task
  }, [listState.finalTasks, selectedTaskId])

  // Task operations hook
  const newTaskOperations = useTaskOperations({
    session: effectiveSession,
    onTaskCreated: (task) => {
      listState.setTasks(prev => [task, ...prev])

      const shouldAutoOpen = getColumnCount() >= 2
      if (shouldAutoOpen) {
        if (process.env.NODE_ENV === 'development') {
          console.log('[useTaskManagerController] onTaskCreated - auto-opening task detail for multi-column layout:', {
            taskId: task.id,
            taskTitle: task.title,
            columnCount: getColumnCount(),
            layoutType: getLayoutType()
          })
        }
        setSelectedTaskId(task.id)
      }

      toast({
        title: "Task created",
        description: `"${task.title}" has been added`,
        duration: 2000,
      })
    },
    onTaskUpdated: (updatedTask) => {
      listState.setTasks(prev => prev.map(task =>
        task.id === updatedTask.id ? updatedTask : task
      ))
    },
    onTaskDeleted: (taskId) => {
      listState.setTasks(prev => prev.filter(task => task.id !== taskId))
      if (selectedTaskId === taskId) {
        setSelectedTaskId("")
      }
      toast({
        title: "Task deleted",
        description: "The task has been removed",
        duration: 2000,
      })
    }
  })

  // Now we need to reconnect dragDropState with newTaskOperations
  // Since we can't reassign, we'll use the operations directly in handlers below

  // Derived state
  const availableUsers = useMemo(() => {
    const allUsers = new Map()

    listState.lists.forEach(list => {
      if (list.owner) allUsers.set(list.owner.id, list.owner)
      if (list.listMembers) {
        list.listMembers.forEach(lm => {
          if (lm.user) allUsers.set(lm.user.id, lm.user)
        })
      }
    })

    listState.finalTasks.forEach(task => {
      if (task.assignee) allUsers.set(task.assignee.id, task.assignee)
      if (task.creator) allUsers.set(task.creator.id, task.creator)
    })

    return Array.from(allUsers.values())
  }, [listState.lists, listState.finalTasks])

  // Memoized count functions for sidebar
  const getTaskCountForListMemo = useCallback((listId: string) => {
    return getTaskCountForList(listState.finalTasks, listId)
  }, [listState.finalTasks])

  const getSavedFilterTaskCountMemo = useCallback((list: TaskList) => {
    return getSavedFilterTaskCount(listState.finalTasks, list, effectiveSession?.user?.id)
  }, [listState.finalTasks, effectiveSession?.user?.id])

  const getFixedListTaskCountMemo = useCallback((listType: string) => {
    return getFixedListTaskCount(listState.finalTasks, listType, effectiveSession?.user?.id)
  }, [listState.finalTasks, effectiveSession?.user?.id])

  // Permission functions
  const listPermissionCacheRef = useRef<Map<string, boolean>>(new Map())
  useEffect(() => {
    listPermissionCacheRef.current.clear()
  }, [effectiveSession?.user?.id, listState.lists])

  const canEditListSettingsById = useCallback((list: TaskList) => {
    const cacheKey = `${list.id}-${effectiveSession?.user?.id}-${list.ownerId}`
    const cache = listPermissionCacheRef.current
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey)!
    }
    const result = canEditListSettings(list, effectiveSession?.user?.id)
    cache.set(cacheKey, result)
    return result
  }, [effectiveSession?.user?.id])

  // Optimistic list info for instant switching
  const { currentListInfo } = useOptimisticListInfo({
    selectedListId: navigationState.selectedListId,
    lists: listState.lists,
    getListDisplayInfo
  })

  const getSelectedListInfo = useCallback(() => currentListInfo, [currentListInfo])

  // Close task detail
  const closeTaskDetail = useCallback(() => {
    setSelectedTaskId("")
    setSelectedTaskElement(null)

    if (selectedTaskId) {
      const task = listState.finalTasks.find(t => t.id === selectedTaskId)
      if (task && task.lists && task.lists.length > 0) {
        const primaryListId = task.lists[0].id
        window.history.replaceState(null, '', `/lists/${primaryListId}`)
      } else if (navigationState.selectedListId !== "my-tasks") {
        window.history.replaceState(null, '', `/lists/${navigationState.selectedListId}`)
      } else {
        window.history.replaceState(null, '', '/')
      }
    }
  }, [setSelectedTaskId, setSelectedTaskElement, selectedTaskId, listState.finalTasks, navigationState.selectedListId])

  // Task click handler
  const handleTaskClick = useCallback((taskId: string, taskElement?: HTMLElement) => {
    setShowMobileSidebar?.(false)

    const task = listState.finalTasks.find(t => t.id === taskId)

    if (selectedTaskId === taskId) {
      taskPaneState.closeTaskPaneAnimated()
      if (isMobile) {
        navigationState.setMobileViewSafe('list')
      }
      if (task && task.lists && task.lists.length > 0) {
        const primaryListId = task.lists[0].id
        window.history.replaceState(null, '', `/lists/${primaryListId}`)
      } else if (navigationState.selectedListId !== "my-tasks") {
        window.history.replaceState(null, '', `/lists/${navigationState.selectedListId}`)
      } else {
        window.history.replaceState(null, '', '/')
      }
      return
    }

    setSelectedTaskId(taskId)

    if (taskElement) {
      setSelectedTaskElement(taskElement)
      setSelectedTaskRect(taskElement.getBoundingClientRect())
    }

    if (navigationState.selectedListId !== "my-tasks") {
      window.history.replaceState(null, '', `/lists/${navigationState.selectedListId}?task=${taskId}`)
    } else {
      window.history.replaceState(null, '', `/?task=${taskId}`)
    }

    if (isMobile) {
      navigationState.setMobileViewSafe('task')
    }
  }, [
    selectedTaskId,
    isMobile,
    navigationState,
    taskPaneState,
    listState.finalTasks,
    setSelectedTaskId,
    setSelectedTaskElement,
    setSelectedTaskRect,
    setShowMobileSidebar
  ])

  // === TASK MANAGEMENT METHODS ===

  const handleUpdateTask = useCallback(async (updatedTask: Task) => {
    try {
      const originalTask = listState.tasks.find(task => task.id === updatedTask.id)
      if (!originalTask) {
        throw new Error("Task not found")
      }

      const optimisticTask = { ...updatedTask, updatedAt: new Date() }
      listState.setTasks(prevTasks => {
        return prevTasks.map((task) => {
          if (task.id === optimisticTask.id) {
            playTaskCompleteSound(task.completed, optimisticTask.completed)
            return optimisticTask
          }
          return task
        })
      })

      toast({
        title: "Success",
        description: "Task updated successfully!",
        duration: 1500,
      })

      try {
        const apiData = {
          ...updatedTask,
          listIds: updatedTask.lists?.map(list => list.id) || [],
          assigneeId: updatedTask.assignee?.id || null
        }
        delete (apiData as any).lists
        delete (apiData as any).assignee

        const response = await apiPut(`/api/tasks/${updatedTask.id}`, apiData)
        const realUpdatedTask = await response.json()

        listState.setTasks(prevTasks => prevTasks.map((task) =>
          task.id === realUpdatedTask.id ? realUpdatedTask : task
        ))

      } catch (error) {
        console.error("Error updating task:", error)
        listState.setTasks(prevTasks => prevTasks.map((task) =>
          task.id === originalTask.id ? originalTask : task
        ))
        toast({
          title: "Error",
          description: "Failed to update task. Please try again.",
          variant: "destructive",
          duration: 1500,
        })
        throw error
      }

    } catch (error) {
      console.error("Error updating task:", error)
      toast({
        title: "Error",
        description: "Failed to update task. Please try again.",
        variant: "destructive",
        duration: 1500,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listState.tasks, listState.setTasks, toast])

  const handleLocalUpdateTask = useCallback((updatedTaskOrFn: Task | ((taskId: string, currentTask: Task) => Task)) => {
    listState.setTasks(prevTasks => prevTasks.map(task => {
      if (typeof updatedTaskOrFn === 'function') {
        return updatedTaskOrFn(task.id, task)
      } else if (task.id === updatedTaskOrFn.id) {
        return { ...task, ...updatedTaskOrFn }
      }
      return task
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listState.setTasks]) as (updatedTaskOrFn: Task | ((taskId: string, currentTask: Task) => Task)) => void

  const handleToggleTaskComplete = useCallback(async (taskId: string) => {
    const taskToUpdate = listState.tasks.find((task) => task.id === taskId)
    if (taskToUpdate) {
      await handleUpdateTask({ ...taskToUpdate, completed: !taskToUpdate.completed })
    }
  }, [listState.tasks, handleUpdateTask])

  const handleDeleteTask = useCallback(async (taskId: string) => {
    try {
      const taskToDelete = listState.tasks.find(task => task.id === taskId)
      if (!taskToDelete) {
        throw new Error("Task not found")
      }

      listState.setTasks(prevTasks => prevTasks.filter((task) => task.id !== taskId))

      const shouldClosePage = selectedTaskId === taskId
      const isMobileDevice = externalIsMobile

      toast({
        title: "Success",
        description: "Task deleted successfully!",
        duration: 1500,
      })

      try {
        await apiDelete(`/api/tasks/${taskId}`)

        if (shouldClosePage) {
          setSelectedTaskId("")
          if (isMobileDevice && externalHandleMobileBack) {
            externalHandleMobileBack()
          }
        }

      } catch (error) {
        console.error("Error deleting task:", error)
        listState.setTasks(prevTasks => [taskToDelete, ...prevTasks])

        if (shouldClosePage) {
          setSelectedTaskId("")
          if (isMobileDevice && externalHandleMobileBack) {
            externalHandleMobileBack()
          }
        }

        toast({
          title: "Error",
          description: "Failed to delete task. Please try again.",
          variant: "destructive",
          duration: 1500,
        })
        throw error
      }
    } catch (error) {
      console.error("Error deleting task:", error)
      toast({
        title: "Error",
        description: "Failed to delete task. Please try again.",
        variant: "destructive",
        duration: 1500,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listState.tasks, listState.setTasks, selectedTaskId, toast, externalIsMobile, externalHandleMobileBack, setSelectedTaskId])

  const handleCreateTask = useCallback(async (
    taskTitle: string,
    options?: { priority?: number; assigneeId?: string | null; navigateToDetail?: boolean }
  ): Promise<string | null> => {
    if (!effectiveSession?.user || !taskTitle.trim() || isCreatingTask) {
      return null
    }

    setIsCreatingTask(true)

    try {
      const parsedTask = parseTaskInput(taskTitle.trim(), navigationState.selectedListId, effectiveSession, listState.lists, !smartTaskCreationEnabled)

      const currentList = navigationState.selectedListId !== "my-tasks"
        ? listState.lists.find(l => l.id === navigationState.selectedListId) || null
        : null

      const hashtagLists = parsedTask.listIds
        .map(listId => listState.lists.find(l => l.id === listId))
        .filter((list): list is TaskList => list !== undefined)

      const myTasksFilterDefaults = navigationState.selectedListId === "my-tasks" ? {
        priority: myTasksPreferences.filters.priority,
        dueDate: myTasksPreferences.filters.dueDate,
      } : undefined

      const parsedValuesWithOverrides = {
        priority: options?.priority !== undefined ? options.priority : parsedTask.priority,
        assigneeId: options?.assigneeId !== undefined ? options.assigneeId : parsedTask.assigneeId,
        dueDateTime: parsedTask.dueDateTime || undefined,
        repeating: parsedTask.repeating,
        isPrivate: parsedTask.isPrivate,
      }

      const defaults = applyTaskDefaultsWithPriority({
        parsedValues: parsedValuesWithOverrides,
        currentList,
        hashtagLists,
        userId: effectiveSession.user.id,
        myTasksFilters: myTasksFilterDefaults,
      })

      const taskDataWithDefaults = {
        title: parsedTask.title,
        description: "",
        listIds: parsedTask.listIds.length > 0 ? parsedTask.listIds : (navigationState.selectedListId !== "my-tasks" ? [navigationState.selectedListId] : []),
        priority: defaults.priority,
        dueDateTime: defaults.dueDateTime,
        isAllDay: defaults.isAllDay,
        assigneeId: defaults.assigneeId,
        repeating: defaults.repeating,
        isPrivate: defaults.isPrivate,
        customRepeatingData: parsedTask.customRepeatingData || null,
      }

      toast({
        title: "Creating task...",
        description: `"${taskTitle}" is being added`,
        duration: 1500,
      })

      const apiTaskData = mapTaskDataForApi(taskDataWithDefaults)
      await newTaskOperations.createTask(apiTaskData)

      return null

    } catch (error) {
      console.error('Error creating task:', error)
      toast({
        title: "Error",
        description: "Failed to create task. Please try again.",
        variant: "destructive",
        duration: 2000,
      })
      return null
    } finally {
      setIsCreatingTask(false)
    }
  }, [effectiveSession, navigationState.selectedListId, listState.lists, newTaskOperations, toast, isCreatingTask, myTasksPreferences.filters.priority, myTasksPreferences.filters.dueDate, smartTaskCreationEnabled])

  const handleQuickCreateTask = useCallback(async (
    title: string,
    options?: { priority?: number; assigneeId?: string | null; navigateToDetail?: boolean }
  ): Promise<string | null> => {
    try {
      await handleCreateTask(title, options)
      return null
    } catch (error) {
      console.error('Error in quick create:', error)
      return null
    }
  }, [handleCreateTask])

  const handleCreateNewTask = useCallback(() => {
    console.log('handleCreateNewTask called')
  }, [])

  // === LIST MANAGEMENT METHODS ===

  const handleCreateList = useCallback(async (listData: { name: string; description: string; memberEmails: string[] }) => {
    try {
      const response = await fetch('/api/lists', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: listData.name,
          description: listData.description,
          privacy: 'PRIVATE',
          memberEmails: listData.memberEmails
        })
      })

      if (!response.ok) {
        throw new Error('Failed to create list')
      }

      const newList = await response.json()
      listState.setLists(prev => [...prev, newList])

      trackListCreated({
        listId: newList.id,
        isShared: listData.memberEmails && listData.memberEmails.length > 0,
        hasGitIntegration: false,
        isPublic: newList.privacy === 'PUBLIC',
      })

      toast({
        title: "List created",
        description: `"${listData.name}" has been created`,
        duration: 2000,
      })

      setShowAddListModal(false)
      await listState.loadData()

      if (newList?.id) {
        navigationState.setSelectedListId(newList.id)
      }

    } catch (error) {
      console.error('Error creating list:', error)
      toast({
        title: "Error",
        description: "Failed to create list. Please try again.",
        variant: "destructive",
        duration: 2000,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listState.setLists, listState.loadData, toast, navigationState.setSelectedListId])

  const handleCopyList = useCallback(async (listId: string) => {
    try {
      const sourceList = [...listState.lists, ...listState.publicLists].find(l => l.id === listId)
      const isUserOwnerOrAdmin = sourceList && (
        sourceList.ownerId === effectiveSession?.user?.id ||
        sourceList.admins?.some(admin => admin.id === effectiveSession?.user?.id)
      )

      const shouldAssignToUser = !navigationState.isViewingFromFeatured || !isUserOwnerOrAdmin

      const response = await apiPost(`/api/lists/${listId}/copy`, {
        includeTasks: true,
        preserveTaskAssignees: false,
        assignToUser: shouldAssignToUser
      })

      if (!response.ok) {
        throw new Error('Failed to copy list')
      }

      const result = await response.json()

      if (result.list) {
        listState.setLists(prev => [...prev, result.list])

        if (result.list?.id) {
          navigationState.setSelectedListId(result.list.id)
        }

        if (result.list.tasks && result.list.tasks.length > 0) {
          const tasksWithLists = result.list.tasks.map((task: any) => {
            if (!task.lists || task.lists.length === 0) {
              return {
                ...task,
                lists: [{ id: result.list.id, name: result.list.name }]
              }
            }
            return task
          })

          listState.setTasks(prev => [...tasksWithLists, ...prev])

          const shouldAutoOpen = getColumnCount() >= 2
          if (shouldAutoOpen && tasksWithLists.length > 0) {
            setSelectedTaskId(tasksWithLists[0].id)
          }
        }
      }

      toast({
        title: "List copied",
        description: `"${result.list?.name || 'List'}" has been copied${result.copiedTasksCount ? ` with ${result.copiedTasksCount} tasks` : ''}`,
        duration: 3000,
      })

    } catch (error) {
      console.error('Error copying list:', error)
      toast({
        title: "Error",
        description: "Failed to copy list. Please try again.",
        variant: "destructive",
        duration: 2000,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast, navigationState.setSelectedListId, listState.setLists, listState.setTasks, setSelectedTaskId, listState.lists, listState.publicLists, effectiveSession, navigationState.isViewingFromFeatured])

  const handleCopyTask = useCallback(async (taskId: string, targetListId?: string, includeComments?: boolean) => {
    try {
      const response = await apiPost(`/api/tasks/${taskId}/copy`, {
        targetListId,
        preserveDueDate: true,
        preserveAssignee: false,
        includeComments: includeComments || false
      })

      if (!response.ok) {
        throw new Error('Failed to copy task')
      }

      const result = await response.json()

      if (result.task) {
        if (!result.task.lists || result.task.lists.length === 0) {
          result.task.lists = targetListId ? [{ id: targetListId }] : []
        }

        const taskWithLists = {
          ...result.task,
          lists: result.task.lists || (targetListId ? [{ id: targetListId }] : [])
        }

        listState.setTasks(prev => {
          if (prev.some(t => t.id === taskWithLists.id)) {
            return prev
          }
          return [taskWithLists, ...prev]
        })

        const shouldAutoOpen = getColumnCount() >= 2
        if (shouldAutoOpen) {
          setSelectedTaskId(taskWithLists.id)
        }
      } else {
        throw new Error('No task data returned from API')
      }

      toast({
        title: "Task copied",
        description: `"${result.task.title}" has been copied${includeComments ? ' with comments' : ''}`,
        duration: 3000,
      })

    } catch (error) {
      console.error('Error copying task:', error)
      toast({
        title: "Error",
        description: "Failed to copy task. Please try again.",
        variant: "destructive",
        duration: 2000,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast, listState.setTasks, setSelectedTaskId])

  const handleDeleteList = useCallback(async (listId: string) => {
    try {
      const listToDelete = listState.lists.find(l => l.id === listId)
      const taskCount = listToDelete?.tasks?.length || 0

      await apiDelete(`/api/lists/${listId}`)

      trackListDeleted({ listId, taskCount })

      listState.setLists(prev => {
        const updatedLists = prev.filter(list => list.id !== listId)

        if (navigationState.selectedListId === listId) {
          const nextListId = updatedLists.length > 0 ? updatedLists[0].id : "my-tasks"
          navigationState.setSelectedListId(nextListId)
        }

        return updatedLists
      })

      toast({
        title: "Success",
        description: "List deleted successfully!",
        duration: 1500,
      })
    } catch (error) {
      console.error("Error deleting list:", error)
      toast({
        title: "Error",
        description: "Failed to delete list. Please try again.",
        variant: "destructive",
        duration: 1500,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listState.lists, listState.setLists, navigationState.selectedListId, navigationState.setSelectedListId, toast])

  const handleUpdateList = useCallback(async (updatedList: TaskList) => {
    if (!effectiveSession?.user) return

    try {
      const originalList = listState.lists.find(l => l.id === updatedList.id)
      const fieldsChanged: string[] = []
      if (originalList) {
        if (originalList.name !== updatedList.name) fieldsChanged.push('name')
        if (originalList.description !== updatedList.description) fieldsChanged.push('description')
        if (originalList.privacy !== updatedList.privacy) fieldsChanged.push('privacy')
        if (originalList.color !== updatedList.color) fieldsChanged.push('color')
        if (originalList.isFavorite !== updatedList.isFavorite) fieldsChanged.push('isFavorite')
        if (originalList.defaultPriority !== updatedList.defaultPriority) fieldsChanged.push('defaultPriority')
        if (originalList.defaultAssigneeId !== updatedList.defaultAssigneeId) fieldsChanged.push('defaultAssignee')
        if (originalList.defaultDueDate !== updatedList.defaultDueDate) fieldsChanged.push('defaultDueDate')
      }

      listState.setLists((prevLists: TaskList[]) =>
        prevLists.map((list: TaskList) =>
          list.id === updatedList.id ? updatedList : list
        )
      )

      const response = await apiPut(`/api/lists/${updatedList.id}`, updatedList)

      if (!response.ok) {
        await listState.loadData()
        throw new Error(`Failed to update list: ${response.status} ${response.statusText}`)
      }

      const result = await response.json()

      if (fieldsChanged.length > 0) {
        trackListEdited({
          listId: updatedList.id,
          fieldsChanged,
        })
      }

      listState.setLists((prevLists: TaskList[]) =>
        prevLists.map((list: TaskList) =>
          list.id === result.id ? result : list
        )
      )

      toast({
        title: "List updated",
        description: `"${updatedList.name}" has been updated successfully.`,
        duration: 2000,
      })

    } catch (error) {
      console.error('Error updating list:', error)
      toast({
        title: "Error",
        description: `Failed to update list settings: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: "destructive",
        duration: 3000,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listState.lists, listState.setLists, listState.loadData, effectiveSession?.user, toast])

  const handleToggleListFavorite = useCallback(async (listId: string) => {
    if (!effectiveSession?.user) return

    const list = listState.lists.find(l => l.id === listId)
    if (!list) return

    try {
      const updatedList = { ...list, isFavorite: !list.isFavorite }
      await handleUpdateList(updatedList)
    } catch (error) {
      console.error('Error toggling list favorite:', error)
      toast({
        title: "Error",
        description: "Failed to update list favorite status",
        variant: "destructive",
        duration: 2000,
      })
    }
  }, [listState.lists, handleUpdateList, effectiveSession, toast])

  const handleSaveListFilters = useCallback(async (listId: string, filters: Partial<TaskList>) => {
    if (!effectiveSession?.user) return

    const list = listState.lists.find(l => l.id === listId)
    if (!list) return

    if (!canEditListSettings(list, effectiveSession.user.id)) {
      return
    }

    try {
      const updatedList = { ...list, ...filters }
      await handleUpdateList(updatedList)
    } catch (error) {
      console.error('Error saving list filters:', error)
      toast({
        title: "Error",
        description: "Failed to save list filters",
        variant: "destructive",
        duration: 2000,
      })
    }
  }, [listState.lists, handleUpdateList, effectiveSession, toast])

  const handleLeaveList = useCallback(async (list: TaskList, isOwnerLeaving?: boolean) => {
    if (!effectiveSession?.user) return
    try {
      listState.setLists((prevLists: TaskList[]) => prevLists.filter(l => l.id !== list.id))

      toast({
        title: "Success",
        description: `Left "${list.name}" successfully`,
        duration: 2000,
      })

      const response = await apiPost(`/api/lists/${list.id}/leave`, {})

      if (navigationState.selectedListId === list.id) {
        const remainingLists = listState.lists.filter(l => l.id !== list.id)
        const nextListId = remainingLists.length > 0 ? remainingLists[0].id : 'all'
        navigationState.setSelectedListId(nextListId)
      }
    } catch (error) {
      console.error('Error leaving list:', error)
      await listState.loadData()
      toast({
        title: "Error",
        description: "Failed to leave list. Please try again.",
        duration: 2000,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listState.lists, listState.setLists, listState.loadData, navigationState.selectedListId, navigationState.setSelectedListId, effectiveSession, toast])

  // Image picker handlers
  const handleListImageClick = useCallback((listId: string) => {
    const list = listState.lists.find(l => l.id === listId) || listMetadata

    if (list && canEditListSettings(list, effectiveSession?.user?.id)) {
      setSelectedListForImagePicker(list)
      setShowImagePicker(true)
    } else if (list) {
      toast({
        title: "Access Denied",
        description: "Only list owners and admins can change list images.",
        variant: "destructive",
        duration: 3000,
      })
    }
  }, [listState.lists, listMetadata, effectiveSession?.user, toast])

  const handleImagePickerSelect = useCallback(async (imageUrl: string, type: 'placeholder' | 'custom' | 'generated') => {
    if (!selectedListForImagePicker) return

    try {
      const updatedList = { ...selectedListForImagePicker, imageUrl }
      await apiPut(`/api/lists/${selectedListForImagePicker.id}`, { imageUrl })

      listState.setLists(prevLists =>
        prevLists.map(list =>
          list.id === selectedListForImagePicker.id ? updatedList : list
        )
      )

      setShowImagePicker(false)
      setSelectedListForImagePicker(null)

      toast({
        title: "Image Updated",
        description: "List image has been successfully updated.",
        duration: 2000,
      })
    } catch (error) {
      console.error('Error updating list image:', error)
      toast({
        title: "Error",
        description: "Failed to update list image. Please try again.",
        variant: "destructive",
        duration: 3000,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedListForImagePicker, listState.setLists, toast])

  const handleImagePickerCancel = useCallback(() => {
    setShowImagePicker(false)
    setSelectedListForImagePicker(null)
  }, [])

  // === KEYBOARD SHORTCUT HANDLERS ===

  const handleSelectNextTask = useCallback(() => {
    if (!finalFilteredTasks.length) return
    const currentIndex = finalFilteredTasks.findIndex(task => task.id === selectedTaskId)
    const nextIndex = currentIndex < finalFilteredTasks.length - 1 ? currentIndex + 1 : 0
    const nextTask = finalFilteredTasks[nextIndex]
    if (nextTask) {
      // Navigate to task
      setSelectedTaskId(nextTask.id)

      document.querySelectorAll('[data-task-id]').forEach(el => {
        if (el instanceof HTMLElement) {
          el.style.pointerEvents = 'none'
          setTimeout(() => { el.style.pointerEvents = '' }, 0)
        }
      })

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const taskElement = document.querySelector(`[data-task-id="${nextTask.id}"]`) as HTMLElement
          if (taskElement) {
            setSelectedTaskElement(taskElement)
            setSelectedTaskRect(taskElement.getBoundingClientRect())
            isKeyboardScrollingRef.current = true
            taskElement.scrollIntoView({
              behavior: 'smooth',
              block: 'nearest',
              inline: 'nearest'
            })
            setTimeout(() => {
              isKeyboardScrollingRef.current = false
            }, 500)
          }
        })
      })
    }
  }, [finalFilteredTasks, selectedTaskId, setSelectedTaskId, setSelectedTaskElement, setSelectedTaskRect, isKeyboardScrollingRef])

  const handleSelectPreviousTask = useCallback(() => {
    if (!finalFilteredTasks.length) return
    const currentIndex = finalFilteredTasks.findIndex(task => task.id === selectedTaskId)
    const prevIndex = currentIndex > 0 ? currentIndex - 1 : finalFilteredTasks.length - 1
    const prevTask = finalFilteredTasks[prevIndex]
    if (prevTask) {
      setSelectedTaskId(prevTask.id)

      document.querySelectorAll('[data-task-id]').forEach(el => {
        if (el instanceof HTMLElement) {
          el.style.pointerEvents = 'none'
          setTimeout(() => { el.style.pointerEvents = '' }, 0)
        }
      })

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const taskElement = document.querySelector(`[data-task-id="${prevTask.id}"]`) as HTMLElement
          if (taskElement) {
            setSelectedTaskElement(taskElement)
            setSelectedTaskRect(taskElement.getBoundingClientRect())
            isKeyboardScrollingRef.current = true
            taskElement.scrollIntoView({
              behavior: 'smooth',
              block: 'nearest',
              inline: 'nearest'
            })
            setTimeout(() => {
              isKeyboardScrollingRef.current = false
            }, 500)
          }
        })
      })
    }
  }, [finalFilteredTasks, selectedTaskId, setSelectedTaskId, setSelectedTaskElement, setSelectedTaskRect, isKeyboardScrollingRef])

  const handleToggleTaskPanel = useCallback(() => {
    if (selectedTaskId) {
      closeTaskDetail()
    }
  }, [selectedTaskId, closeTaskDetail])

  const handleCycleListFilters = useCallback(() => {
    const systemLists = ["my-tasks", "today", "not-in-list", "public", "assigned"]
    const allListIds = [...systemLists, ...listState.lists.map(list => list.id)]
    const currentIndex = allListIds.findIndex(id => id === navigationState.selectedListId)
    const nextIndex = (currentIndex + 1) % allListIds.length
    navigationState.setSelectedListId(allListIds[nextIndex])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listState.lists, navigationState.selectedListId, navigationState.setSelectedListId])

  const handleJumpToDate = useCallback(() => {
    navigationState.setSelectedListId("today")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigationState.setSelectedListId])

  const handleNewTask = useCallback(() => {
    handleCreateNewTask()
  }, [handleCreateNewTask])

  const handleCompleteTask = useCallback(() => {
    if (selectedTask) {
      handleToggleTaskComplete(selectedTask.id)
    }
  }, [selectedTask, handleToggleTaskComplete])

  const handlePostponeTask = useCallback(async () => {
    if (!selectedTask) return
    const newDueDate = new Date()
    newDueDate.setDate(newDueDate.getDate() + 7)
    const updatedTask = { ...selectedTask, dueDate: newDueDate }
    await handleUpdateTask(updatedTask)
  }, [selectedTask, handleUpdateTask])

  const handleRemoveDueDate = useCallback(async () => {
    if (!selectedTask) return
    const updatedTask = { ...selectedTask, dueDate: null }
    await handleUpdateTask(updatedTask)
  }, [selectedTask, handleUpdateTask])

  const handleSetPriority = useCallback(async (priority: 0 | 1 | 2 | 3) => {
    if (!selectedTask) return
    const updatedTask = { ...selectedTask, priority }
    await handleUpdateTask(updatedTask)
  }, [selectedTask, handleUpdateTask])

  const handleMakeDueDateEarlier = useCallback(async () => {
    if (!selectedTask) return
    const currentDate = selectedTask.dueDate ? new Date(selectedTask.dueDate) : new Date()
    currentDate.setDate(currentDate.getDate() - 1)
    const updatedTask = { ...selectedTask, dueDate: currentDate }
    await handleUpdateTask(updatedTask)
  }, [selectedTask, handleUpdateTask])

  const handleMakeDueDateLater = useCallback(async () => {
    if (!selectedTask) return
    const currentDate = selectedTask.dueDate ? new Date(selectedTask.dueDate) : new Date()
    currentDate.setDate(currentDate.getDate() + 1)
    const updatedTask = { ...selectedTask, dueDate: currentDate }
    await handleUpdateTask(updatedTask)
  }, [selectedTask, handleUpdateTask])

  const handleEditTaskLists = useCallback(() => {
    if (selectedTask && !selectedTaskId) {
      setSelectedTaskId(selectedTask.id)
    }
  }, [selectedTask, selectedTaskId, setSelectedTaskId])

  const handleEditTaskTitle = useCallback(() => {
    if (selectedTask && !selectedTaskId) {
      setSelectedTaskId(selectedTask.id)
    }
  }, [selectedTask, selectedTaskId, setSelectedTaskId])

  const handleEditTaskDescription = useCallback(() => {
    if (selectedTask && !selectedTaskId) {
      setSelectedTaskId(selectedTask.id)
    }
  }, [selectedTask, selectedTaskId, setSelectedTaskId])

  const handleAddTaskComment = useCallback(() => {
    if (selectedTask && !selectedTaskId) {
      setSelectedTaskId(selectedTask.id)
    }
  }, [selectedTask, selectedTaskId, setSelectedTaskId])

  const handleAssignToNoOne = useCallback(async () => {
    if (!selectedTask) return
    const updatedTask = { ...selectedTask, assigneeId: null }
    await handleUpdateTask(updatedTask)
  }, [selectedTask, handleUpdateTask])

  const [showHotkeyMenu, setShowHotkeyMenu] = useState(false)

  const handleShowHotkeyMenu = useCallback(() => {
    setShowHotkeyMenu(true)
  }, [])

  const handleListCopied = useCallback(async (copiedList: any) => {
    if (copiedList) {
      listState.setLists(prev => [...prev, copiedList])

      if (copiedList?.id) {
        navigationState.setSelectedListId(copiedList.id)
      }

      if (copiedList.tasks && copiedList.tasks.length > 0) {
        const tasksWithLists = copiedList.tasks.map((task: any) => {
          if (!task.lists || task.lists.length === 0) {
            return {
              ...task,
              lists: [{ id: copiedList.id, name: copiedList.name }]
            }
          }
          return task
        })

        listState.setTasks(prev => [...tasksWithLists, ...prev])

        const shouldAutoOpen = getColumnCount() >= 2
        if (shouldAutoOpen && tasksWithLists.length > 0) {
          setSelectedTaskId(tasksWithLists[0].id)
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listState.setLists, navigationState.setSelectedListId, listState.setTasks, setSelectedTaskId])

  // === RETURN ===

  return {
    // State
    tasks: listState.tasks,
    lists: listState.lists,
    publicTasks: listState.publicTasks,
    publicLists: listState.publicLists,
    collaborativePublicLists: listState.collaborativePublicLists,
    suggestedPublicLists: listState.suggestedPublicLists,
    loading: listState.loading,
    isCreatingTask,
    selectedTaskId,
    isTaskPaneClosing: taskPaneState.isTaskPaneClosing,
    taskPanePosition: taskPaneState.taskPanePosition,
    setTaskPanePosition: taskPaneState.setTaskPanePosition,
    selectedTaskElement,
    selectedTaskRect,
    recentlyChangedList: navigationState.recentlyChangedList,
    showAddListModal,
    showImagePicker,
    selectedListForImagePicker,
    searchValue: newFilterState.filters.search,
    activeDragTaskId: dragDropState.activeDragTaskId,
    dragOverListId: dragDropState.dragOverListId,
    isShiftDrag: dragDropState.isShiftDrag,
    dragTargetTaskId: dragDropState.dragTargetTaskId,
    dragTargetPosition: dragDropState.dragTargetPosition,

    // Computed state
    finalTasks: listState.finalTasks,
    finalFilteredTasks,
    availableUsers,
    selectedListId: navigationState.selectedListId,
    selectedTask,
    isSessionReady,
    effectiveSession,
    isViewingFromFeatured: navigationState.isViewingFromFeatured,
    manualSortPreviewActive: dragDropState.manualSortPreviewActive,
    manualSortActive,

    // Count functions
    getTaskCountForListMemo,
    getSavedFilterTaskCountMemo,
    getFixedListTaskCountMemo,
    getSelectedListInfo,

    // Permission functions
    canEditListSettingsMemo: canEditListSettingsById,

    // State setters
    setSelectedListId: navigationState.setSelectedListId,
    setTasks: listState.setTasks,
    setLists: listState.setLists,
    setPublicTasks: listState.setPublicTasks,
    setLoading: listState.setLoading,
    setSelectedTaskId,
    setIsTaskPaneClosing: taskPaneState.setIsTaskPaneClosing,
    setSelectedTaskElement,
    setSelectedTaskRect,
    setRecentlyChangedList: navigationState.setRecentlyChangedList,
    setShowAddListModal,
    setShowImagePicker,
    setSelectedListForImagePicker,
    setSearchValue: newFilterState.setSearch,

    // Hooks and utilities
    newTaskOperations,
    newFilterState,
    taskManagerRef,
    isKeyboardScrollingRef,

    // Business logic methods
    loadData: listState.loadData,
    handleManualRefresh: listState.handleManualRefresh,
    handleTaskClick,
    handleUpdateTask,
    handleLocalUpdateTask,
    handleToggleTaskComplete,
    handleDeleteTask,
    closeTaskDetail,
    handleCreateTask,
    handleQuickCreateTask,
    handleCreateNewTask,
    handleCreateList,
    handleCopyList,
    handleCopyTask,
    handleDeleteList,
    handleUpdateList,
    handleToggleListFavorite,
    handleSaveListFilters,
    handleLeaveList,

    // Image picker handlers
    handleListImageClick,
    handleImagePickerSelect,
    handleImagePickerCancel,

    // Keyboard shortcut handlers
    handleSelectNextTask,
    handleSelectPreviousTask,
    handleToggleTaskPanel,
    handleCycleListFilters,
    handleJumpToDate,
    handleNewTask,
    handleCompleteTask,
    handlePostponeTask,
    handleRemoveDueDate,
    handleSetPriority,
    handleMakeDueDateEarlier,
    handleMakeDueDateLater,
    handleEditTaskLists,
    handleEditTaskTitle,
    handleEditTaskDescription,
    handleAddTaskComment,
    handleAssignToNoOne,
    handleShowHotkeyMenu,
    handleTaskDragHover: dragDropState.handleTaskDragHover,
    handleTaskDragLeaveTask: dragDropState.handleTaskDragLeaveTask,
    handleTaskDragHoverEnd: dragDropState.handleTaskDragHoverEnd,
    handleTaskDragStart: dragDropState.handleTaskDragStart,
    handleTaskDragEnd: dragDropState.handleTaskDragEnd,
    handleListDragEnter: dragDropState.handleListDragEnter,
    handleListDragLeave: dragDropState.handleListDragLeave,
    handleListDragOver: dragDropState.handleListDragOver,
    handleTaskDropOnList: dragDropState.handleTaskDropOnList,

    // Hotkey menu state
    showHotkeyMenu,
    setShowHotkeyMenu,

    // Public list handlers
    handleListCopied,
  }
}
