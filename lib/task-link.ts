/**
 * Where `/t/AWTD-1007` goes (AWTD-1016, docs/specs/TASK_IDENTIFIERS.md §5–6).
 *
 * Autolinked identifiers render as `/t/KEY-N` so that drawing a comment costs
 * no lookup. This route pays that lookup once, on click: resolve the id, check
 * the reader may see the task, and send them to it.
 *
 * **No existence oracle.** A task the reader cannot see answers exactly like
 * one that does not exist, so a guessed `AWTD-1` teaches nothing — the same
 * rule GitHub applies to a private repo's issue.
 */
import { prisma } from '@/lib/prisma'
import { requireTaskReadAccess } from '@/lib/api-auth-middleware'
import { parseIdentifier, resolveTaskIdOrIdentifier } from '@/lib/task-identifier'

export type TaskLinkTarget =
  | { kind: 'redirect'; href: string }
  | { kind: 'signin'; href: string }
  | { kind: 'not-found' }

export async function resolveTaskLink(
  rawIdentifier: string,
  userId: string | null | undefined
): Promise<TaskLinkTarget> {
  const value = decodeURIComponent(rawIdentifier || '')
  // Only identifiers: `/t/<uuid>` would make this a second task URL to keep.
  if (!parseIdentifier(value)) return { kind: 'not-found' }

  if (!userId) {
    return { kind: 'signin', href: `/auth/signin?callbackUrl=${encodeURIComponent(`/t/${value}`)}` }
  }

  const taskId = await resolveTaskIdOrIdentifier(value)
  if (!taskId) return { kind: 'not-found' }

  try {
    await requireTaskReadAccess(userId, taskId)
  } catch {
    return { kind: 'not-found' }
  }

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { lists: { select: { id: true, projectId: true }, orderBy: { createdAt: 'asc' } } },
  })
  const lists = task?.lists ?? []
  // The board the id belongs to reads best; any list beats none.
  const list = lists.find(candidate => candidate.projectId) ?? lists[0]

  return {
    kind: 'redirect',
    href: list ? `/lists/${list.id}?task=${taskId}` : `/?task=${taskId}`,
  }
}
