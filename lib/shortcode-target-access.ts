/**
 * May this user create or list share links for this target?
 *
 * The rule existed in THREE places: once in `/api/v1/shortcodes` (already
 * factored into a helper) and twice inside `/api/shortcodes`, copy-pasted
 * between its POST and GET handlers. Making a share link is the act of turning
 * something private into something anyone with the URL can reach, so the check
 * that guards it should not have been written out three times. (Task e0613ae5.)
 *
 * The result carries both an `error` label and a `message` because the two
 * routes render them differently — legacy returns `{ error: <message> }`, v1
 * returns `{ error: <label>, message }` — and preserving each shape exactly
 * matters more than tidying the difference away.
 */

import { prisma } from '@/lib/prisma'

export type ShortcodeTargetType = 'task' | 'list'

export type ShortcodeTargetAccess =
  | { ok: true; targetType: ShortcodeTargetType }
  | { ok: false; status: 400 | 403 | 404; error: string; message: string }

export async function checkShortcodeTargetAccess(
  targetType: unknown,
  targetId: unknown,
  userId: string,
): Promise<ShortcodeTargetAccess> {
  if (!targetType || !targetId) {
    return {
      ok: false,
      status: 400,
      error: 'Validation error',
      message: 'targetType and targetId are required',
    }
  }

  if (targetType !== 'task' && targetType !== 'list') {
    return {
      ok: false,
      status: 400,
      error: 'Validation error',
      message: 'targetType must be "task" or "list"',
    }
  }

  if (targetType === 'task') {
    const task = await prisma.task.findUnique({
      where: { id: targetId as string },
      include: { lists: true },
    })

    if (!task) {
      return { ok: false, status: 404, error: 'Not found', message: 'Task not found' }
    }

    // The creator can always share their own task, even if it sits on no list.
    if (task.creatorId === userId) {
      return { ok: true, targetType }
    }

    // Otherwise access comes from owning or belonging to ANY list the task is
    // on — one qualifying list is enough.
    const listIds = task.lists.map(list => list.id)
    const hasAccess = await prisma.taskList.findFirst({
      where: {
        id: { in: listIds },
        OR: [{ ownerId: userId }, { listMembers: { some: { userId } } }],
      },
    })

    if (!hasAccess) {
      return {
        ok: false,
        status: 403,
        error: 'Forbidden',
        message: "You don't have access to this task",
      }
    }

    return { ok: true, targetType }
  }

  // Lists: owner or member. A PUBLIC list does NOT qualify — being able to read
  // something is not the same as being able to mint a share link for it.
  const list = await prisma.taskList.findFirst({
    where: {
      id: targetId as string,
      OR: [{ ownerId: userId }, { listMembers: { some: { userId } } }],
    },
  })

  if (!list) {
    // 404 rather than 403, deliberately: a non-member should not be able to
    // tell an inaccessible list from one that does not exist.
    return {
      ok: false,
      status: 404,
      error: 'Not found',
      message: 'List not found or access denied',
    }
  }

  return { ok: true, targetType }
}
