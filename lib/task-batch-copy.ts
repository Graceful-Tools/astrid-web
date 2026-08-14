/**
 * Copying one task into several lists at once — the batch-copy form.
 *
 * Shared by `POST /api/tasks/copy` and `POST /api/v1/tasks/copy`, which were
 * line-for-line the same four steps: check read access to the source task,
 * check write access to every target list, resolve the assignee from the first
 * target list's default, create the copy.
 *
 * Verified equivalent before extraction (task e0613ae5). Each route keeps its
 * own auth and response shape — legacy returns the bare task, v1 wraps it in
 * `{ task, meta }` — so only the flow moves.
 *
 * Distinct from lib/task-copy-flow.ts, which is the single-target form: that
 * one copies via copy-utils (carrying comments and attachments) and broadcasts
 * over SSE; this one builds the row directly and does not notify.
 */

import { prisma } from '@/lib/prisma'
import { hasExplicitListRole } from '@/lib/list-permissions'

export type BatchCopyResult =
  | { ok: true; task: Record<string, unknown> }
  | { ok: false; status: 400 | 403 | 404; error: string }

export async function batchCopyTask(args: {
  userId: string
  taskId?: string
  targetListIds?: string[]
  assigneeId?: string | null
  assigneeProvided: boolean
}): Promise<BatchCopyResult> {
  const { userId, taskId, targetListIds, assigneeId, assigneeProvided } = args

  if (!taskId || !targetListIds?.length) {
    return { ok: false, status: 400, error: 'Task ID and target list IDs are required' }
  }

  // listMembers is not optional detail here: hasExplicitListRole below resolves
  // membership from this relation, and `lists: true` returns bare TaskList rows
  // without it. With the relation missing, only `ownerId` could ever match, so
  // a member of the list was told they had no access to a task they could see
  // in the UI. (Task 73733c3d.)
  const originalTask = await prisma.task.findUnique({
    where: { id: taskId },
    include: { lists: { include: { listMembers: true } } },
  })

  if (!originalTask) {
    return { ok: false, status: 404, error: 'Task not found' }
  }

  // A task on a public list is copyable by anyone, unless the task itself is
  // marked private.
  const isPublic =
    originalTask.lists.some(list => list.privacy === 'PUBLIC') && !originalTask.isPrivate

  if (!isPublic) {
    const hasAccess =
      originalTask.assigneeId === userId ||
      originalTask.creatorId === userId ||
      originalTask.lists.some(list => hasExplicitListRole({ id: userId }, list))

    if (!hasAccess) {
      return { ok: false, status: 403, error: 'Forbidden' }
    }
  }

  // Every target must be one the caller can write to. Unlike the single-target
  // copy, a collaborative public list does NOT qualify here — this form has
  // always required owner-or-member.
  const targetLists = await prisma.taskList.findMany({
    where: {
      id: { in: targetListIds },
      OR: [{ ownerId: userId }, { listMembers: { some: { userId } } }],
    },
    select: { id: true, name: true, ownerId: true, defaultAssigneeId: true },
  })

  if (targetLists.length !== targetListIds.length) {
    return { ok: false, status: 403, error: 'Access denied to one or more target lists' }
  }

  const finalAssigneeId = resolveAssignee({
    userId,
    assigneeId,
    assigneeProvided,
    firstList: targetLists[0],
  })

  const copiedTask = await prisma.task.create({
    data: {
      title: originalTask.title,
      description: originalTask.description,
      priority: originalTask.priority,
      repeating: originalTask.repeating,
      isPrivate: originalTask.isPrivate,
      dueDateTime: originalTask.dueDateTime,
      isAllDay: originalTask.isAllDay,
      assigneeId: finalAssigneeId,
      creatorId: userId,
      originalTaskId: originalTask.id,
      sourceListId: originalTask.lists[0]?.id,
      lists: { connect: targetListIds.map(id => ({ id })) },
    },
    include: {
      assignee: true,
      creator: true,
      lists: { include: { owner: true } },
      comments: { include: { author: true } },
    },
  })

  return { ok: true, task: copiedTask as unknown as Record<string, unknown> }
}

/**
 * The list's `defaultAssigneeId` is a three-way setting, not a plain user id:
 * `null` means "whoever created the task", the literal `"unassigned"` means
 * nobody, and anything else is a user id. An explicit assigneeId in the request
 * overrides all of it — including an explicit `null`, which is why the caller
 * passes `assigneeProvided` rather than letting us test for null here.
 */
function resolveAssignee(args: {
  userId: string
  assigneeId?: string | null
  assigneeProvided: boolean
  firstList?: { defaultAssigneeId: string | null }
}): string | null {
  const { userId, assigneeId, assigneeProvided, firstList } = args

  if (assigneeProvided) return assigneeId ?? null
  if (!firstList) return userId

  if (firstList.defaultAssigneeId === undefined) return null
  if (firstList.defaultAssigneeId === null) return userId
  if (firstList.defaultAssigneeId === 'unassigned') return null
  return firstList.defaultAssigneeId
}
