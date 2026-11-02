/**
 * The task a `task_updated` / `task_completed` event carries, in the web's shape.
 *
 * Task events carry the agent protocol's `task` (no statusRole, no lists) and,
 * from the routes that can afford a re-read, the web's own `v1Task`. Merging
 * the agent shape left a card the server had moved in its old column until a
 * refresh (AWTD-1039), so the v1 shape wins whenever it is there. Comments are
 * dropped: the board keeps those from its own fetch.
 */
import type { Task } from "@/types/task"

type TaskUpdate = Partial<Task> & { id: string }

export function taskFromUpdateEvent(data: unknown): TaskUpdate | null {
  if (!data || typeof data !== 'object') return null
  const event = data as { v1Task?: Partial<Task>; task?: Partial<Task> }
  const task = event.v1Task ?? event.task ?? (data as Partial<Task>)
  if (!task?.id) return null
  const { comments: _comments, ...rest } = task
  return rest as TaskUpdate
}

/**
 * The created task from a `task_created` event, in the shape the board renders
 * (AWTD-1497): `v1Task` first, as for updates. The agent-shaped `task` lacks
 * the web's list fields, so a task stored from it was filtered out of the list
 * it was created in.
 */
export function taskFromCreatedEvent(data: unknown): Task | null {
  if (!data || typeof data !== 'object') return null
  const event = data as { v1Task?: Task; task?: Task }
  const task = event.v1Task ?? event.task ?? (data as Task)
  return task?.id ? task : null
}
