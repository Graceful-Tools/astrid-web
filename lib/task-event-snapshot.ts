/**
 * The pure pieces of the task-update event path (AWTD-1329), apart from
 * lib/task-events.ts, which writes to the database and is mocked wholesale in
 * many route tests.
 */

import type { TaskEventInput, TaskEventSnapshot } from '@/lib/task-events'

/** The fields `diffTaskEvents` compares, read off a task row (with its `lists`). */
export function taskEventSnapshot(task: {
  title?: string | null
  completed?: boolean | null
  closedReason?: string | null
  priority?: number | null
  assigneeId?: string | null
  dueDateTime?: Date | string | null
  lists?: Array<{ id: string }> | null
  statusRole?: string | null
}): TaskEventSnapshot {
  return {
    title: task.title,
    completed: task.completed,
    closedReason: task.closedReason,
    priority: task.priority,
    assigneeId: task.assigneeId,
    dueDateTime: task.dueDateTime,
    listIds: (task.lists ?? []).map(list => list.id),
    statusRole: task.statusRole ?? null,
  }
}

/**
 * The events from a task update that are news (AWTD-1329). A hand-made board
 * move is recorded — list insights times each lane from it — but notifying on
 * it would ping a task's creator every time anyone, or any agent, drags or
 * claims the card. Automatic moves (task-dependency.service.ts) still notify;
 * nobody dragged those.
 */
export function notifiableUpdateEvents(events: TaskEventInput[]): TaskEventInput[] {
  return events.filter(event => event.kind !== 'status_changed')
}
