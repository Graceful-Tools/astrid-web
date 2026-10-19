/**
 * When TaskDetail may skip a re-render.
 *
 * The pane is memoised with this hand-written list of what it draws from, so a
 * field missing here is a field the pane never updates for. `statusRole` was
 * missing, and the Ready / Doing / Waiting chips looked dead (AWTD-1275). Add
 * the field here whenever the pane starts showing a new one.
 */
import type { Task, User } from "@/types/task"

interface ComparedProps {
  task: Task
  currentUser: User
  readOnly?: boolean
  displayMode?: string | null
  inline?: boolean
}

export function taskDetailPropsEqual(prevProps: ComparedProps, nextProps: ComparedProps): boolean {
  // Check if comments have actually changed (not just length)
  const prevComments = prevProps.task.comments || []
  const nextComments = nextProps.task.comments || []
  
  const commentsChanged = prevComments.length !== nextComments.length ||
    prevComments.some((comment, index) => {
      const nextComment = nextComments[index]
      return !nextComment || comment.id !== nextComment.id || comment.content !== nextComment.content
    })
  
  // Check if lists have changed
  const prevLists = prevProps.task.lists || []
  const nextLists = nextProps.task.lists || []
  const listsChanged = prevLists.length !== nextLists.length ||
    prevLists.some((list, index) => {
      const nextList = nextLists[index]
      return !nextList || list.id !== nextList.id || list.name !== nextList.name
    })

  // Only re-render if task ID changes, critical props change, lists changed, or comments changed
  return (
    prevProps.task.id === nextProps.task.id &&
    prevProps.task.title === nextProps.task.title &&
    prevProps.task.description === nextProps.task.description &&
    prevProps.task.completed === nextProps.task.completed &&
    prevProps.task.priority === nextProps.task.priority &&
    prevProps.task.repeating === nextProps.task.repeating &&
    prevProps.task.dueDateTime === nextProps.task.dueDateTime &&
    prevProps.task.isAllDay === nextProps.task.isAllDay &&
    prevProps.task.assigneeId === nextProps.task.assigneeId &&
    // The board-state chips draw from statusRole; without it a move saved
    // fine and the pane went on showing the old column (AWTD-1275).
    prevProps.task.statusRole === nextProps.task.statusRole &&
    prevProps.readOnly === nextProps.readOnly &&
    prevProps.displayMode === nextProps.displayMode &&
    prevProps.inline === nextProps.inline &&
    !listsChanged &&
    !commentsChanged &&
    prevProps.currentUser?.id === nextProps.currentUser?.id
  )
}
