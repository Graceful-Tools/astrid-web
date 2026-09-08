import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { useToast } from "@/hooks/use-toast"
import { useTaskSSEEvents, useSSESubscription } from "@/hooks/use-sse-subscription"
import { SSEManager } from "@/lib/sse-manager"
import { createRefreshScheduler, type RefreshScheduler } from "@/lib/refresh-scheduler"
import { apiGet } from "@/lib/api"
import { seedFromCache } from "./load-from-cache"
import { fetchSyncPayload } from "./sync-fetch"
import { mergeTasks, mergeLists } from "./merge-tasks"
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

/**
 * How long simultaneous "the data might be stale" signals collapse for. Also
 * the old standalone SSE-reconnect debounce, kept at its original value.
 */
const REFRESH_DEBOUNCE_MS = 2000

/** A tab regaining focus is worth at most one reload a minute. */
const TAB_REFRESH_MIN_INTERVAL_MS = 60000

/**
 * A reconnect is a catch-up on events missed while the stream was down, so it
 * is not held for the tab window — only for the coalescing debounce.
 */
const RECONNECT_REFRESH_MIN_INTERVAL_MS = 2000

/**
 * Who a membership event is actually about.
 *
 * The two routes that broadcast these send different shapes for the same event
 * type: legacy `/api/lists/[id]/members` sends `newMemberId` (and `memberId` for
 * a role change), while `/api/v1/lists/[id]/members` sends `member: { id }`.
 * Reading only one of them is how a v1-originated add reached the client with
 * nothing it could recognise (task ed1d85ba).
 */
function affectedMemberId(data: any): string | null {
  return (
    data?.newMemberId ??
    data?.removedMemberId ??
    data?.memberId ??
    data?.member?.id ??
    null
  )
}

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

  // One scheduler for the whole hook, built on first use and kept for the life
  // of the mount. It reaches loadData through the ref, so it never has to be
  // rebuilt when loadData is (task ed1d85ba).
  const refreshSchedulerRef = useRef<RefreshScheduler | null>(null)
  const getRefreshScheduler = useCallback((): RefreshScheduler => {
    if (!refreshSchedulerRef.current) {
      refreshSchedulerRef.current = createRefreshScheduler(
        () => loadDataRef.current?.() ?? Promise.resolve(),
        { debounceMs: REFRESH_DEBOUNCE_MS },
      )
    }
    return refreshSchedulerRef.current
  }, [])

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

      // Reconcile against the server. With a cursor on file this is a delta —
      // the API now reports `deletedIds`, so a patch can be merged safely; it
      // was a full ~1.9 MB fetch until that existed. Without a cursor (cold
      // start) these are the same full URLs as before.
      // Tasks and lists come from v1 through fetchSyncPayload, which pages —
      // v1 caps /api/v1/tasks at 100 rows and a plain swap would silently hand
      // every user their first 100 tasks. The public endpoints have no v1
      // successor yet, so they stay as they are. (641a7615 step 3)
      //
      // apiGet is threaded in rather than bypassed: it carries the offline
      // handling and cache invalidation that a bare fetch would drop.
      const [syncPayload, publicTasksResponse, publicListsResponse] = await Promise.all([
        fetchSyncPayload({ fetchImpl: ((url: string) => apiGet(String(url))) as unknown as typeof fetch }),
        apiGet("/api/v1/public/tasks"),
        apiGet("/api/v1/public/lists?limit=10"),
      ])

      const [publicTasksData, publicListsData] = await Promise.all([
        publicTasksResponse.json(),
        publicListsResponse.json(),
      ])

      const tasksArray = syncPayload.tasks as Task[]
      const listsArray = syncPayload.lists as TaskList[]
      const publicTasksArray = Array.isArray(publicTasksData) ? publicTasksData : (publicTasksData?.tasks || [])

      // A full response IS the truth; a delta is a patch. Conflating them would
      // wipe every task the delta did not mention (see merge-tasks.ts).
      const tasksIsDelta = syncPayload.tasksIsDelta
      const listsIsDelta = syncPayload.listsIsDelta
      const deletedTaskIds: string[] = syncPayload.deletedTaskIds
      const deletedListIds: string[] = syncPayload.deletedListIds

      setTasks(prev => mergeTasks(prev, tasksArray, {
        isDelta: tasksIsDelta,
        deletedIds: deletedTaskIds,
      }))

      setLists(prev => mergeLists(prev, listsArray, {
        isDelta: listsIsDelta,
        deletedIds: deletedListIds,
      }))

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
      // Mount and manual refresh call loadData directly. Measuring the minimum
      // intervals from every load, not only the scheduled ones, is what stops
      // an alt-tab seconds after the page loads from paying for a second one.
      refreshSchedulerRef.current?.notifyRan()
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

  // Load data when session is ready.
  //
  // Keyed on currentUserId, NOT on effectiveSession?.user: next-auth hands back
  // a fresh object on every session refresh, so an unchanged identity produced a
  // new reference, re-ran this effect and cost a full reload — four network
  // round trips (task ed1d85ba).
  useEffect(() => {
    if (currentUserId) {
      loadData()
    }
  }, [currentUserId, loadData])

  // Every "the data might be stale" signal goes through ONE scheduler.
  //
  // These used to be two independent effects: a visibilitychange + focus pair
  // sharing a 60s `lastFetchTime` throttle, and an SSE-reconnect handler on its
  // own 2s debounce with no throttle. Neither knew about the other, so the most
  // ordinary sequence in the app was the expensive one — a tab sits in the
  // background long enough for the browser to kill the EventSource, the user
  // comes back, visibilitychange runs a full loadData, and ~2s later the
  // reconnected stream runs a second one. loadData is four round trips, so
  // returning to a tab cost eight (task ed1d85ba).
  //
  // The scheduler coalesces them, keeps each reason's own minimum interval, and
  // will not overlap two runs. Requests inside a minimum interval are now
  // deferred to the end of it rather than dropped.
  useEffect(() => {
    if (!currentUserId) return

    const scheduler = getRefreshScheduler()

    const handleVisibilityChange = () => {
      // visibilitychange fires on hide as well; only a return is a reason.
      if (document.hidden) return
      scheduler.request('visibility', { minIntervalMs: TAB_REFRESH_MIN_INTERVAL_MS })
    }

    const handleFocus = () => {
      scheduler.request('focus', { minIntervalMs: TAB_REFRESH_MIN_INTERVAL_MS })
    }

    const unsubscribe = SSEManager.onReconnection(() => {
      scheduler.request('sse-reconnect', { minIntervalMs: RECONNECT_REFRESH_MIN_INTERVAL_MS })
    })

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleFocus)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleFocus)
      unsubscribe()
      scheduler.cancel()
    }
    // loadData is reached through loadDataRef, so rebuilding it no longer tears
    // down and re-arms these listeners.
  }, [currentUserId, getRefreshScheduler])

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

        // Broadcast to EVERY member, but only the affected member's own
        // permissions changed — for anyone else this is a full four-request
        // re-sync that alters nothing they can see.
        if (affectedMemberId(event.data) === currentUserId && loadDataRef.current) {
          loadDataRef.current()
        }

        if (toastRef.current && affectedMemberId(event.data) === currentUserId) {
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

        // Also broadcast to every member, so adding five people used to cost
        // five full reloads for everyone already in the list. Only the person
        // added gains a list they could not see before.
        if (affectedMemberId(event.data) === currentUserId) {
          if (loadDataRef.current) {
            loadDataRef.current()
          }

          // Gated for the same reason the reload is: unconditional, this told
          // every existing member that THEY had just been added.
          if (toastRef.current && event.data.listName) {
            toastRef.current({
              title: "Added to List",
              description: `${event.data.inviterName} added you to "${event.data.listName}"`
            })
          }
        }
        break

      case 'list_member_removed':
        if (process.env.NODE_ENV === 'development') {
          console.log('[useTaskListState] SSE: Removed from list', event.data)
        }

        // Gated for the same reason list_member_added above is: this event goes
        // to EVERY member so their rosters update, but only one person was
        // removed. Ungated, removing anyone dropped the list out of every
        // member's sidebar and told them all "You were removed" — and through
        // v1, which sent no listName, told them so about "undefined".
        // (Epic 9dedd8aa.)
        if (affectedMemberId(event.data) === currentUserId) {
          setLists(prev => prev.filter(list => list.id !== event.data.listId))

          if (selectedListIdRef.current === event.data.listId) {
            setSelectedListIdRef.current("my-tasks")
          }

          if (toastRef.current && event.data.listName) {
            toastRef.current({
              title: "Removed from List",
              description: `You were removed from "${event.data.listName}"`
            })
          }
        }
        break
    }
  }, [currentUserId])

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
