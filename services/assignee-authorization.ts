/**
 * Who may be put on a task as its assignee.
 *
 * Extracted from services/task.service.ts rather than added to it (AWTD-887):
 * the file is budgeted by tests/rules/oversized-files-ratchet.test.ts, and this
 * rule is a self-contained decision with its own tests
 * (tests/services/assignee-authorization.test.ts).
 */

import { prisma } from '@/lib/prisma'
import { assigneeCanBeAssigned } from '@/lib/task-assignee'
import { canUserAssignAgentToTask, PROJECT_ACCESS_INCLUDE } from '@/lib/list-permissions'

export type AssigneeAuthorization =
  | { ok: true }
  | { ok: false; status: 400 | 403; error: string }

/**
 * May this actor put this assignee on this task?
 *
 * TWO RULES, AND ONLY ONE OF THEM APPLIES TO A GIVEN ASSIGNEE (AWTD-887).
 *
 * `assigneeCanBeAssigned` is about **people**: handing someone an arbitrary
 * task grants them access to it and sends them notifications, so an assignee
 * has to hold a role on one of the task's lists. That rule says nothing useful
 * about an agent — an agent identity cannot be spammed — and applying it to one
 * was the bug: it refused every agent that held no role on the task's lists,
 * and it refused ALL of them on a task with no lists, because
 * `assigneeCanBeAssigned(id, [])` is false by definition. The assignee picker
 * offers agents on exactly that basis (`getOfferableAgentEmails` is "what can
 * WORK", task 9dbe0b17), so the picker promised what the write path refused and
 * the assignment silently rolled back to its previous value.
 *
 * `canUserAssignAgentToTask` is the rule for agents (task 0672b69b) and it is
 * the stricter one, because pointing an agent at a task spends the list's
 * configured user's API key and may execute code on their machine.
 *
 * It now runs for EVERY agent assignment, where it previously ran only when the
 * actor was not the task's creator. That is deliberate and is what makes
 * dropping the people-rule safe: without it, creating a task on a collaborative
 * public list you hold no role on and pointing your own agent at it would bill
 * that list's configured user — the exposure 0672b69b closed, reopened from the
 * other side.
 */
export async function authorizeAssigneeChange(args: {
  assigneeId: string
  actorId: string
  task: { id: string; creatorId: string | null }
  targetListIds: string[]
  /** v1's rule. Legacy's assign-by-email path creates placeholder users who are members of nothing. */
  requireListMembership: boolean
}): Promise<AssigneeAuthorization> {
  const { assigneeId, actorId, task, targetListIds, requireListMembership } = args

  const assignee = await prisma.user.findUnique({
    where: { id: assigneeId },
    select: { isAIAgent: true },
  })

  // A person — or an id that matches no user at all, which must fall to the
  // people-rule's 400 rather than being waved through the agent path.
  if (!assignee?.isAIAgent) {
    if (!requireListMembership) return { ok: true }
    // lib/task-assignee.ts already answers exactly this, as a COUNT rather than
    // a fetch-and-filter. Re-deriving it here would be a third copy of the rule
    // that exists to stop unsolicited task planting.
    if (!(await assigneeCanBeAssigned(assigneeId, targetListIds))) {
      return { ok: false, status: 400, error: 'Assignee must be a member of one of the task lists' }
    }
    return { ok: true }
  }

  const refusal = {
    ok: false as const,
    status: 403 as const,
    error: 'Only the task creator, or a list owner or admin, can assign an AI agent to this task',
  }

  // No list to consent for the task, and nobody but its creator can see it.
  if (targetListIds.length === 0) {
    return canUserAssignAgentToTask({ id: actorId }, task, null) ? { ok: true } : refusal
  }

  const lists = await prisma.taskList.findMany({
    where: { id: { in: targetListIds } },
    select: {
      id: true,
      ownerId: true,
      privacy: true,
      publicListType: true,
      listType: true,
      projectId: true,
      aiAgentsEnabled: true,
      listMembers: { select: { userId: true, role: true } },
      ...PROJECT_ACCESS_INCLUDE,
    },
  })

  // EVERY list has to allow it: a task on the actor's own list AND a victim's
  // shared list would otherwise be assignable on the strength of the one the
  // actor owns, while the run bills the other.
  const allowed = lists.every(list => canUserAssignAgentToTask({ id: actorId }, task, list as never))
  return allowed ? { ok: true } : refusal
}
