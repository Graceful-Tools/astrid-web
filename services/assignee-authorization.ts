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
  /**
   * `assigneeExists` reports what the lookup below already had to learn:
   * whether a user row exists for this id. Create needs that answer too, to
   * turn a bad id into a 400 rather than the foreign-key 500 Prisma would
   * raise, and asking for it twice would put a second round-trip on the create
   * path for nothing (AWTD-891).
   */
  | { ok: true; assigneeExists: boolean }
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
 * Both task WRITES reach this — `updateTaskWithSideEffects` and, since
 * AWTD-891, `createTaskWithSideEffects`. Create had its own inline copy of the
 * people-rule and no agent rule at all, which made creating a task the easy
 * version of the exposure 0672b69b closed: no existing task to rewrite, just a
 * POST naming a list you may add to and an `assigneeId` naming an agent. On
 * create the actor IS the creator, so the agent branch collapses to *"you hold
 * a role on every list you are putting this on"* — which is exactly what the
 * collaborative-public bypass in the create path skips.
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

  const assigneeExists = !!assignee

  // A person — or an id that matches no user at all, which must fall to the
  // people-rule's 400 rather than being waved through the agent path.
  if (!assignee?.isAIAgent) {
    if (!requireListMembership) return { ok: true, assigneeExists }
    // lib/task-assignee.ts already answers exactly this, as a COUNT rather than
    // a fetch-and-filter. Re-deriving it here would be a third copy of the rule
    // that exists to stop unsolicited task planting.
    if (!(await assigneeCanBeAssigned(assigneeId, targetListIds))) {
      return { ok: false, status: 400, error: 'Assignee must be a member of one of the task lists' }
    }
    return { ok: true, assigneeExists }
  }

  const refusal = {
    ok: false as const,
    status: 403 as const,
    error: 'Only the task creator, or a list owner or admin, can assign an AI agent to this task',
  }

  // No list to consent for the task, and nobody but its creator can see it.
  if (targetListIds.length === 0) {
    return canUserAssignAgentToTask({ id: actorId }, task, null)
      ? { ok: true, assigneeExists }
      : refusal
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
  return allowed ? { ok: true, assigneeExists } : refusal
}

/**
 * The CREATE path's whole assignee gate (AWTD-891).
 *
 * Lives here rather than in `createTaskWithSideEffects` for the same reason
 * `authorizeAssigneeChange` does: it is a self-contained decision about who may
 * be put on a task, and task.service.ts is budgeted by
 * tests/rules/oversized-files-ratchet.test.ts.
 *
 * Create asks a slightly different question than update, in two ways:
 *
 * - **The task does not exist yet, so the actor IS its creator.** That is not
 *   a loophole. The agent rule's creator branch still requires a role on every
 *   target list, which is precisely the control that the create path's
 *   collaborative-public bypass skips: anyone may add a task to such a list,
 *   and before this they could point it at an agent and bill the list's
 *   configured user.
 *
 * - **Only an assignee the CALLER asked for is authorised.** `resolveAssignee`
 *   may also settle on the list's own `defaultAssigneeId`, and that is a
 *   deliberate exemption rather than an oversight: a default is configured by
 *   the list OWNER, so an agent sitting there is that owner's own consent to
 *   spend their own key — the very person the rule protects. Authorising it
 *   against the actor would instead break the lists that exist for other people
 *   to file into.
 *
 * Self-assignment needs no permission either way: the actor can already see the
 * task, and nobody is being handed anything they did not ask for.
 */
export async function authorizeNewTaskAssignee(args: {
  /** What the caller asked for. A list's own default is NOT this. */
  requested: string | null | undefined
  /** What `resolveAssignee` settled on, with defaults and public-list stripping applied. */
  resolved: string | null
  actorId: string
  targetListIds: string[]
  requireListMembership: boolean
}): Promise<{ ok: true } | { ok: false; status: 400 | 403; error: string }> {
  const { requested, resolved, actorId, targetListIds, requireListMembership } = args

  if (!resolved || resolved === actorId) return { ok: true }

  let assigneeExists = false
  if (requested && requested === resolved) {
    const authorized = await authorizeAssigneeChange({
      assigneeId: requested,
      actorId,
      task: { id: '', creatorId: actorId },
      targetListIds,
      requireListMembership,
    })
    if (!authorized.ok) return authorized
    assigneeExists = authorized.assigneeExists
  }

  // A bad assignee id is the caller's mistake, so it gets a 400 rather than the
  // foreign-key 500 Prisma would raise. Skipped when the authorisation above
  // already looked the user up — otherwise this would put a second round-trip
  // on the hottest create path there is.
  if (!assigneeExists) {
    const assignee = await prisma.user.findUnique({
      where: { id: resolved },
      select: { id: true },
    })
    if (!assignee) {
      return { ok: false, status: 400, error: `Invalid assignee ID: ${resolved}` }
    }
  }

  return { ok: true }
}
