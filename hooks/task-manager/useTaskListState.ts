import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { useToast } from "@/hooks/use-toast"
import { useTaskSSEEvents, useSSESubscription } from "@/hooks/use-sse-subscription"
import { apiGet } from "@/lib/api"
import { seedFromCache } from "./load-from-cache"
import { preloadUserAvatars } from "@/lib/image-cache"
import type { Task, TaskList } from "@/types/task"

// Stable event type arrays to prevent re-subscriptions
const LIST_EVENT_TYPES = [
  'list_created',
  'list_updated',
  'list_deleted',
  'list_member_added',
  'list_member_removed',
  'list_admin_role_granted',
  'list_member_role_changed'
] as const

export interface UseTaskListStateProps {
  effectiveSession: any
  selectedListId: string
  setSelectedListId: (id: string, fromFeatured?: boolean) => void
  setSelectedTaskId: (id: string) => void
  selectedTaskId: string
}

export interface UseTaskListStateReturn {
  // State
  tasks: Task[]
  lists: TaskList[]
  publicTasks: Task[]
  publicLists: TaskList[]
  collaborativePublicLists: TaskList[]
  suggestedPublicLists: TaskList[]
  loading: boolean

  // State setters
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>
  setLists: React.Dispatch<React.SetStateAction<TaskList[]>>
  setPublicTasks: React.Dispatch<React.SetStateAction<Task[]>>
  setLoading: React.Dispatch<React.SetStateAction<boolean>>

  // Methods
  loadData: () => Promise<void>
  handleManualRefresh: () => Promise<void>

  // Derived state
  finalTasks: Task[]
  currentUserId: string | null
}

export function useTaskListState({
  effectiveSession,
  selectedListId,
  setSelectedListId,
  setSelectedTaskId,
  selectedTaskId
}: UseTaskListStateProps): UseTaskListStateReturn {
  const { toast } = useToast()

  // Core state
  const [tasks, setTasks] = useState<Task[]>([])
  const [lists, setLists] = useState<TaskList[]>([])
  const [publicTasks, setPublicTasks] = useState<Task[]>([])
  const [publicLists, setPublicLists] = useState<TaskList[]>([])
  const [loading, setLoading] = useState(true)

  // Current user ID
  const currentUserId = useMemo(() => effectiveSession?.user?.id || null, [effectiveSession?.user?.id])

  // Split public lists by type
  const collaborativePublicLists = useMemo(() =>
    publicLists.filter(list => list.publicListType === 'collaborative'),
    [publicLists]
  )
  const suggestedPublicLists = useMemo(() =>
    publicLists.filter(list => list.publicListType === 'copy_only' || !list.publicListType),
    [publicLists]
  )

  // Derived state
  const finalTasks = useMemo(() => {
    return [...tasks]
  }, [tasks])

  // Refs for stable access in SSE callbacks
  const selectedListIdRef = useRef(selectedListId)
  const setSelectedListIdRef = useRef(setSelectedListId)
  const loadDataRef = useRef<(() => Promise<void>) | undefined>(undefined)
  const toastRef = useRef(toast)

  // Load data function
  const loadData = useCallback(async () => {
    try {
      // Paint from IndexedDB first. The offline layer and DataSyncManager
      // already keep this populated; the render path simply never read it, so
      // every visit waited on a full download (~1.9 MB of tasks in production).
      const seeded = await seedFromCache()
      if (seeded.hasData) {
        setTasks(prev => (prev.length > 0 ? prev : seeded.tasks))
        setLists(prev => (prev.length > 0 ? prev : seeded.lists))
        setLoading(false)
      } else {
        setLoading(true)
        // Only announce loading when there is genuinely nothing to show.
        toast({
          title: "Loading your data...",
          description: "Getting your tasks and lists ready",
          duration: 2000,
        })
      }

      // Reconcile against the server. Deliberately a FULL fetch, not a delta:
      // neither /api/tasks nor DataSyncManager reports deletions on the
      // incremental path (deletedIds is always []), so merging a delta into
      // state would leave deleted tasks on screen until the next full sync.
      // Wrong data is worse than slow data — and the cached paint above is
      // what actually fixes the wait. See buildTaskSyncUrl for the delta helper
      // this should use once the API reports deletions.
      const [tasksResponse, listsResponse, publicTasksResponse, publicListsResponse] = await Promise.all([
        apiGet("/api/tasks"),
        apiGet("/api/lists"),
        apiGet("/api/public-tasks"),
        apiGet("/api/lists/public?limit=10"),
      ])

      const [tasksData, listsData, publicTasksData, publicListsData] = await Promise.all([
        tasksResponse.json(),
        listsResponse.json(),
        publicTasksResponse.json(),
        publicListsResponse.json(),
      ])

      // Ensure we have arrays (handle API response structure)
      const tasksArray = Array.isArray(tasksData) ? tasksData : (tasksData?.tasks || [])
      const listsArray = Array.isArray(listsData) ? listsData : (listsData?.lists || [])
      const publicTasksArray = Array.isArray(publicTasksData) ? publicTasksData : (publicTasksData?.tasks || [])

      // Smart merge: preserve optimistically added tasks and comments
      setTasks(prev => {
        const serverTaskIds = new Set(tasksArray.map((t: Task) => t.id))
        const optimisticTasks = prev.filter((t: Task) => !serverTaskIds.has(t.id) && t.id.startsWith('temp-'))
        const prevTaskMap = new Map(prev.map((t: Task) => [t.id, t]))

        // Merge server tasks with preserved comments from existing state
        const mergedTasks = tasksArray.map((serverTask: Task) => {
          const existingTask = prevTaskMap.get(serverTask.id)
          if (existingTask?.comments && existingTask.comments.length > 0 && !serverTask.comments) {
            return { ...serverTask, comments: existingTask.comments }
          }
          return serverTask
        })

        if (optimisticTasks.length > 0) {
          console.log(`[useTaskListState] Preserving ${optimisticTasks.length} optimistic tasks during loadData`)
          return [...mergedTasks, ...optimisticTasks]
        }

        return mergedTasks
      })

      // Smart merge: preserve optimistically added lists
      setLists(prev => {
        const serverListIds = new Set(listsArray.map((l: TaskList) => l.id))
        const optimisticLists = prev.filter((l: TaskList) => !serverListIds.has(l.id) && l.id.startsWith('temp-'))

        if (optimisticLists.length > 0) {
          console.log(`[useTaskListState] Preserving ${optimisticLists.length} optimistic lists during loadData`)
          return [...listsArray, ...optimisticLists]
        }

        return listsArray
      })

      setPublicTasks(publicTasksArray)
      setPublicLists(publicListsData.lists || [])

      // Preload user avatars for fast rendering
      const allUsers: Array<{ image?: string | null }> = []
      listsArray.forEach((list: TaskList) => {
        if (list.owner) allUsers.push(list.owner)
        list.listMembers?.forEach(lm => {
          if (lm.user) allUsers.push(lm.user)
        })
      })
      tasksArray.forEach((task: Task) => {
        if (task.assignee) allUsers.push(task.assignee)
        if (task.creator) allUsers.push(task.creator)
      })
      preloadUserAvatars(allUsers)

    } catch (error) {
      console.error("[useTaskListState] Error loading data:", error)
      toast({
        title: "Error",
        description: "Failed to load data. Please refresh the page.",
        variant: "destructive",
        duration: 1500,
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  // Update loadDataRef when loadData changes
  useEffect(() => {
    loadDataRef.current = loadData
  }, [loadData])

  // Manual refresh method with user feedback
  const handleManualRefresh = useCallback(async () => {
    if (loading) return // Don't allow concurrent refreshes

    try {
      if (process.env.NODE_ENV === 'development') {
        console.log('[useTaskListState] Manual refresh triggered by user')
      }

      await loadData()

      toast({
        title: "Refreshed",
        description: "Your data has been updated",
        duration: 2000,
      })
    } catch (error) {
      console.error("[useTaskListState] Manual refresh error:", error)
      toast({
        title: "Refresh failed",
        description: "Could not refresh data. Please try again.",
        variant: "destructive",
        duration: 3000,
      })
    }
  }, [loading, loadData, toast])

  // Update refs when values change
  useEffect(() => {
    selectedListIdRef.current = selectedListId
    setSelectedListIdRef.current = setSelectedListId
    toastRef.current = toast
  }, [selectedListId, setSelectedListId, toast])

  // Load data when session is ready
  useEffect(() => {
    if (effectiveSession?.user) {
      loadData()
    }
  }, [effectiveSession?.user, loadData])

  // Browser lifecycle cache invalidation - refresh data on tab focus/visibility
  useEffect(() => {
    if (!effectiveSession?.user) return

    let lastFetchTime = Date.now()
    const REFETCH_THRESHOLD = 60000 // 1 minute

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        const timeSinceLastFetch = Date.now() - lastFetchTime
        if (timeSinceLastFetch > REFETCH_THRESHOLD) {
          if (process.env.NODE_ENV === 'development') {
            console.log('[useTaskListState] Tab visible after', Math.round(timeSinceLastFetch / 1000), 'seconds - refreshing data')
          }
          loadData()
          lastFetchTime = Date.now()
        }
      }
    }

    const handleFocus = () => {
      const timeSinceLastFetch = Date.now() - lastFetchTime
      if (timeSinceLastFetch > REFETCH_THRESHOLD) {
        if (process.env.NODE_ENV === 'development') {
          console.log('[useTaskListState] Window focused after', Math.round(timeSinceLastFetch / 1000), 'seconds - refreshing data')
        }
        loadData()
        lastFetchTime = Date.now()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleFocus)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleFocus)
    }
  }, [effectiveSession?.user, loadData])

  // SSE reconnection data sync
  useEffect(() => {
    if (!effectiveSession?.user) return

    const { SSEManager } = require('@/lib/sse-manager')

    let debounceTimeout: NodeJS.Timeout | null = null
    const DEBOUNCE_DELAY = 2000

    const unsubscribe = SSEManager.onReconnection(() => {
      if (debounceTimeout) {
        clearTimeout(debounceTimeout)
      }

      debounceTimeout = setTimeout(() => {
        if (process.env.NODE_ENV === 'development') {
          console.log('[useTaskListState] SSE reconnected - refreshing all data to sync missed events')
        }
        loadData()
        debounceTimeout = null
      }, DEBOUNCE_DELAY)
    })

    return () => {
      if (debounceTimeout) {
        clearTimeout(debounceTimeout)
      }
      unsubscribe()
    }
  }, [effectiveSession?.user, loadData])

  // Memoized SSE event handlers
  const handleTaskCreated = useCallback((event: any) => {
    if (process.env.NODE_ENV === 'development') {
      console.log('[useTaskListState] SSE: Task created', event)
    }
    const task = event.task || event
    setTasks(prev => {
      if (prev.some(t => t.id === task.id)) {
        return prev
      }
      return [task, ...prev]
    })
  }, [])

  // Dedup ref for rapid-fire task_updated events
  const lastTaskUpdateRef = useRef<Map<string, number>>(new Map())

  const handleTaskUpdated = useCallback((event: any) => {
    const taskData = event.task || event
    if (!taskData?.id) return

    // Dedup: skip if we processed this task update within 500ms
    const now = Date.now()
    const lastUpdate = lastTaskUpdateRef.current.get(taskData.id)
    if (lastUpdate && now - lastUpdate < 500) {
      return
    }
    lastTaskUpdateRef.current.set(taskData.id, now)

    if (process.env.NODE_ENV === 'development') {
      console.log('[useTaskListState] SSE: Task updated', event)
    }
    const { comments: _ignoredComments, ...taskDataWithoutComments } = taskData

    setTasks(prev => prev.map(task =>
      task.id === taskData.id ? { ...task, ...taskDataWithoutComments } : task
    ))
  }, [])

  const handleTaskDeleted = useCallback((event: any) => {
    if (process.env.NODE_ENV === 'development') {
      console.log('[useTaskListState] SSE: Task deleted', event)
    }
    const taskId = event.id || event.taskId
    setTasks(prev => prev.filter(task => task.id !== taskId))
    if (selectedTaskId === taskId) {
      setSelectedTaskId("")
    }
  }, [selectedTaskId, setSelectedTaskId])

  const handleCommentCreated = useCallback((data: any) => {
    const eventData = data?.data || data
    if (!eventData) {
      console.error('[useTaskListState] Comment created event missing data:', data)
      return
    }

    const { taskId, comment } = eventData
    if (!taskId || !comment) {
      console.error('[useTaskListState] Comment created event missing taskId or comment:', eventData)
      return
    }

    if (process.env.NODE_ENV === 'development') {
      console.log('[useTaskListState] SSE: Comment created on task', taskId, comment)
    }
    setTasks(prev => prev.map(task => {
      if (task.id === taskId) {
        const existingComments = task.comments || []
        const commentExists = existingComments.some(c => c.id === comment.id)
        if (!commentExists) {
          return {
            ...task,
            comments: [...existingComments, comment]
          }
        }
      }
      return task
    }))
  }, [])

  // SSE subscriptions for real-time updates
  useTaskSSEEvents({
    onTaskCreated: handleTaskCreated,
    onTaskUpdated: handleTaskUpdated,
    onTaskDeleted: handleTaskDeleted,
    onCommentCreated: handleCommentCreated,
  }, {
    enabled: !!effectiveSession?.user,
    componentName: 'useTaskListState'
  })

  // Memoized list event handler
  const handleListEvents = useCallback((event: any) => {
    switch (event.type) {
      case 'list_created':
        if (process.env.NODE_ENV === 'development') {
          console.log('[useTaskListState] SSE: List created', event.data)
        }
        setLists(prev => {
          if (prev.some(list => list.id === event.data.id)) {
            return prev
          }
          return [...prev, event.data]
        })
        break

      case 'list_updated':
        if (process.env.NODE_ENV === 'development') {
          console.log('[useTaskListState] SSE: List updated', event.data)
        }
        setLists(prev => prev.map(list => {
          if (list.id !== event.data.id) return list
          // Preserve per-user favorite state — SSE broadcasts shared list
          // properties only; isFavorite/favoriteOrder are per-user
          const { isFavorite, favoriteOrder, ...sharedData } = event.data
          return { ...list, ...sharedData }
        }))
        break

      case 'list_deleted':
        if (process.env.NODE_ENV === 'development') {
          console.log('[useTaskListState] SSE: List deleted', event.data)
        }
        setLists(prev => prev.filter(list => list.id !== event.data.id))
        if (selectedListIdRef.current === event.data.id) {
          setSelectedListIdRef.current("my-tasks")
        }
        break

      case 'list_admin_role_granted':
      case 'list_member_role_changed':
        if (process.env.NODE_ENV === 'development') {
          console.log('[useTaskListState] SSE: Member role changed', event)
        }

        if (loadDataRef.current) {
          loadDataRef.current()
        }

        if (toastRef.current && event.data.memberId === effectiveSession?.user?.id) {
          const isPromotion = event.data.newRole === 'admin'
          toastRef.current({
            title: isPromotion ? "Admin Access Granted" : "Role Changed",
            description: isPromotion
              ? `You now have admin access to "${event.data.listName}". Your permissions have been updated.`
              : `Your role in "${event.data.listName}" has been changed to ${event.data.newRole}.`
          })
        }
        break

      case 'list_member_added':
        if (process.env.NODE_ENV === 'development') {
          console.log('[useTaskListState] SSE: Member added to list', event.data)
        }

        if (loadDataRef.current) {
          loadDataRef.current()
        }

        if (toastRef.current) {
          toastRef.current({
            title: "Added to List",
            description: `${event.data.inviterName} added you to "${event.data.listName}"`
          })
        }
        break

      case 'list_member_removed':
        if (process.env.NODE_ENV === 'development') {
          console.log('[useTaskListState] SSE: Removed from list', event.data)
        }

        setLists(prev => prev.filter(list => list.id !== event.data.listId))

        if (selectedListIdRef.current === event.data.listId) {
          setSelectedListIdRef.current("my-tasks")
        }

        if (toastRef.current) {
          toastRef.current({
            title: "Removed from List",
            description: `You were removed from "${event.data.listName}"`
          })
        }
        break
    }
  }, [effectiveSession?.user?.id])

  // Additional SSE subscriptions for list events
  useSSESubscription(LIST_EVENT_TYPES, handleListEvents, {
    enabled: !!effectiveSession?.user,
    componentName: 'useTaskListState-Lists'
  })

  return {
    // State
    tasks,
    lists,
    publicTasks,
    publicLists,
    collaborativePublicLists,
    suggestedPublicLists,
    loading,

    // State setters
    setTasks,
    setLists,
    setPublicTasks,
    setLoading,

    // Methods
    loadData,
    handleManualRefresh,

    // Derived state
    finalTasks,
    currentUserId
  }
}
