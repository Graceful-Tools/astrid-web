import { useEffect, useRef } from "react"
import type { Task } from "@/types/task"

export interface UseOpenTaskFromUrlProps {
  /** `?task=` from the page's search params. */
  urlTaskId?: string
  loading: boolean
  tasks: Task[]
  selectedTaskId: string
  setSelectedTaskId: (id: string) => void
  isMobile: boolean
  setMobileView?: (view: 'list' | 'task' | 'chat') => void
}

/**
 * Opens the task named in the URL (`?task=`) once the tasks have loaded —
 * ONCE per id the URL arrives with.
 *
 * The app writes the URL with `history.replaceState`, which reaches
 * `useSearchParams` a render after the state change that caused it. This used
 * to re-open whatever `?task=` named whenever it differed from the selection,
 * so in that gap it re-selected the stale id: switching lists reopened the
 * previous task on top of the new list (on a phone, the task pane slid in),
 * and every tap flipped the selection new → old → new (AWTD-1076). A URL id
 * that has already been honoured is not a request to open it again.
 */
export function useOpenTaskFromUrl({
  urlTaskId,
  loading,
  tasks,
  selectedTaskId,
  setSelectedTaskId,
  isMobile,
  setMobileView,
}: UseOpenTaskFromUrlProps) {
  const honouredUrlTaskId = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!urlTaskId) {
      // The URL dropped its task, so a later link to the same one is new.
      honouredUrlTaskId.current = undefined
      return
    }
    if (honouredUrlTaskId.current === urlTaskId || loading || tasks.length === 0) return
    if (!tasks.some(t => t.id === urlTaskId)) return

    honouredUrlTaskId.current = urlTaskId
    if (selectedTaskId === urlTaskId) return

    setSelectedTaskId(urlTaskId)
    if (isMobile && setMobileView) {
      requestAnimationFrame(() => {
        setMobileView('task')
      })
    }
  }, [urlTaskId, loading, tasks, selectedTaskId, setSelectedTaskId, isMobile, setMobileView])
}
