/**
 * Indent and outdent — changing how deeply a task is nested, without dragging it.
 *
 * Astrid tasks nest through `Task.parentTaskId`. Dragging can already change that
 * (`lib/subtask-promotion.ts` covers the drag out to top level); this is the keyboard's
 * way in, and the two directions an outliner has.
 *
 * The decision lives here rather than in the key handler because it is answerable
 * without a DOM, and because it is a CROSS-PLATFORM contract: astrid-ios ports these
 * exact rules as `DragNesting` (Astrid App/Core/Filters/DragNesting.swift), tested
 * against the same cases. If the two drift, the same keystroke does different things on
 * different platforms.
 */

/** Bracket convention. The arrows are already due-date-earlier/later. */
export const OUTDENT_KEY = "["
export const INDENT_KEY = "]"

type TaskLike = { id: string; parentTaskId?: string | null }

export interface NestingChange {
  taskId: string
  /** null clears the parent — the task becomes top level. */
  parentTaskId: string | null
}

/** An empty parent id is NOT a parent, matching the truthiness check used elsewhere. */
function parentOf(task: TaskLike): string | null {
  return task.parentTaskId ? task.parentTaskId : null
}

/** Whether `parentId` can adopt `childId` without closing a loop. */
function canParent(childId: string, parentId: string, rows: TaskLike[]): boolean {
  if (childId === parentId) return false
  const byId = new Map(rows.map((t) => [t.id, t]))
  let cursor: string | null = parentId
  let steps = 0
  while (cursor && steps < 100) {
    if (cursor === childId) return false
    cursor = byId.get(cursor) ? parentOf(byId.get(cursor)!) : null
    steps += 1
  }
  return true
}

/**
 * One level out: a direct subtask reaches top level, a deeper one lands under its
 * grandparent. Repeated presses walk it the rest of the way out — jumping several levels
 * from a single keystroke is a surprise that is awkward to undo.
 *
 * Returns null when there is nothing to do, so a no-op never becomes a write.
 */
export function outdentTask(
  task: TaskLike | null | undefined,
  rows: TaskLike[]
): NestingChange | null {
  if (!task) return null
  const parentId = parentOf(task)
  if (!parentId) return null
  const parent = rows.find((t) => t.id === parentId)
  return { taskId: task.id, parentTaskId: parent ? parentOf(parent) : null }
}

/**
 * The other direction: nest a task under its PREVIOUS SIBLING.
 *
 * The row directly above is not the right target — it may be a deep descendant of
 * something else, and nesting under it would jump the task several levels in. The
 * previous sibling is what an outliner indents into, and it is what keeps indent and
 * outdent inverses of each other.
 */
export function indentTask(
  task: TaskLike | null | undefined,
  rows: TaskLike[]
): NestingChange | null {
  if (!task) return null
  const index = rows.findIndex((t) => t.id === task.id)
  if (index <= 0) return null
  const parentId = parentOf(task)
  for (let i = index - 1; i >= 0; i--) {
    const row = rows[i]
    if (parentOf(row) !== parentId) continue
    if (!canParent(task.id, row.id, rows)) return null
    return { taskId: task.id, parentTaskId: row.id }
  }
  return null
}
