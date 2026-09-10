/**
 * Who may be put on a task as its assignee (AWTD-887).
 *
 * Jon: *"cannot assign a task to an agent from web — it reverts back to the
 * last user assigned."*
 *
 * Two rules were being applied to agent assignment, and one of them was written
 * for people:
 *
 * - `assigneeCanBeAssigned` (lib/task-assignee.ts) exists to stop **unsolicited
 *   task planting** — handing an arbitrary user a task, and with it access and
 *   notifications. It requires the assignee to hold a role on one of the task's
 *   lists, and it returns FALSE for a task on no lists at all.
 * - `canUserAssignAgentToTask` (lib/list-permissions.ts, task 0672b69b) is the
 *   rule for agents, and it is the stricter and more relevant one: pointing an
 *   agent at a task spends someone's API key and may execute code on their
 *   machine.
 *
 * An agent is not a person who can be spammed, so the planting rule says
 * nothing useful about it — but it was the one that fired. Assigning an agent
 * failed with 400 *"Assignee must be a member of one of the task lists"*
 * whenever the agent held no role on the task's lists, and **always** for a
 * task on no list, because `assigneeCanBeAssigned(id, [])` is false by
 * definition. The picker offers those agents regardless: `getOfferableAgentEmails`
 * is deliberately "what can WORK" (task 9dbe0b17), with no membership
 * condition. So the picker promised something the write path refused, the
 * client's optimistic update was rolled back, and the assignee snapped to its
 * previous value.
 *
 * So: for an agent, the agent rule decides — and it decides for EVERY agent
 * assignment, not only the ones where the actor is not the creator. Dropping
 * the planting rule without that would have opened the exposure 0672b69b
 * closed: create a task on a collaborative public list you hold no role on,
 * assign your agent, and the run bills that list's configured user.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const userFindUnique = vi.hoisted(() => vi.fn())
const taskListFindMany = vi.hoisted(() => vi.fn())
const taskListCount = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: userFindUnique },
    taskList: { findMany: taskListFindMany, count: taskListCount },
  },
}))

import { authorizeAssigneeChange } from '@/services/assignee-authorization'

const OWNER = 'owner-user'
const MEMBER = 'member-user'
const STRANGER = 'stranger-user'
const AGENT = 'ai-agent-claude'
const HUMAN = 'human-user'

const LIST_ID = 'list-1'

/** The list shape the agent rule reads. */
const list = (extra: Record<string, unknown> = {}) => ({
  id: LIST_ID,
  ownerId: OWNER,
  privacy: 'PRIVATE',
  publicListType: null,
  listType: 'regular',
  projectId: null,
  aiAgentsEnabled: null,
  listMembers: [{ userId: MEMBER, role: 'member' }],
  ...extra,
})

const ownersTask = { id: 'task-1', creatorId: OWNER }
const membersTask = { id: 'task-2', creatorId: MEMBER }
const someoneElsesTask = { id: 'task-3', creatorId: 'victim-user' }

/** Nobody is a member of anything — the case the planting rule refused. */
function agentIsNotAListMember() {
  userFindUnique.mockResolvedValue({ isAIAgent: true })
  taskListCount.mockResolvedValue(0)
  taskListFindMany.mockResolvedValue([list()])
}

beforeEach(() => {
  vi.clearAllMocks()
  taskListFindMany.mockResolvedValue([list()])
})

describe('authorizeAssigneeChange — AI agents (AWTD-887)', () => {
  it('lets the list owner assign an agent that holds no role on the list', async () => {
    // The reported bug. The picker offers this agent, the owner picks it, and
    // the write refused it because the AGENT was not a list member — a rule
    // about not planting tasks on people.
    agentIsNotAListMember()

    const result = await authorizeAssigneeChange({
      assigneeId: AGENT,
      actorId: OWNER,
      task: ownersTask,
      targetListIds: [LIST_ID],
      requireListMembership: true,
    })

    expect(result).toEqual({ ok: true, assigneeExists: true })
  })

  it('lets the creator assign an agent to a task on no list at all', async () => {
    // `assigneeCanBeAssigned(id, [])` is false by definition, so this failed
    // 100% of the time — which is the My Tasks flow the offerable-agent set
    // was built for.
    userFindUnique.mockResolvedValue({ isAIAgent: true })
    taskListCount.mockResolvedValue(0)

    const result = await authorizeAssigneeChange({
      assigneeId: AGENT,
      actorId: OWNER,
      task: ownersTask,
      targetListIds: [],
      requireListMembership: true,
    })

    expect(result).toEqual({ ok: true, assigneeExists: true })
    // No list to consult, so no list query either.
    expect(taskListFindMany).not.toHaveBeenCalled()
  })

  it("still refuses a plain member pointing an agent at someone else's task", async () => {
    // Task 0672b69b's rule, untouched: this is the case that let a member
    // rewrite a victim's task into an attacker-chosen prompt and bill them.
    agentIsNotAListMember()

    const result = await authorizeAssigneeChange({
      assigneeId: AGENT,
      actorId: MEMBER,
      task: someoneElsesTask,
      targetListIds: [LIST_ID],
      requireListMembership: true,
    })

    expect(result).toMatchObject({ ok: false, status: 403 })
  })

  it("lets a plain member assign an agent to a task they created themselves", async () => {
    agentIsNotAListMember()

    const result = await authorizeAssigneeChange({
      assigneeId: AGENT,
      actorId: MEMBER,
      task: membersTask,
      targetListIds: [LIST_ID],
      requireListMembership: true,
    })

    expect(result).toEqual({ ok: true, assigneeExists: true })
  })

  it('refuses someone with no role on the list, even on a task they created', async () => {
    // The hole that dropping the planting rule would otherwise open: a task on
    // a collaborative public list the actor holds no role on, pointed at their
    // own agent, billed to the list's configured user.
    agentIsNotAListMember()

    const result = await authorizeAssigneeChange({
      assigneeId: AGENT,
      actorId: STRANGER,
      task: { id: 'task-4', creatorId: STRANGER },
      targetListIds: [LIST_ID],
      requireListMembership: true,
    })

    expect(result).toMatchObject({ ok: false, status: 403 })
  })

  it('requires every target list to allow it, not just one', async () => {
    // A task on the actor's own list AND a victim's shared list must not be
    // assignable on the strength of the one the actor owns.
    userFindUnique.mockResolvedValue({ isAIAgent: true })
    taskListCount.mockResolvedValue(0)
    taskListFindMany.mockResolvedValue([
      list({ id: 'mine', ownerId: MEMBER, listMembers: [] }),
      list({ id: 'theirs', ownerId: 'victim-user', listMembers: [{ userId: MEMBER, role: 'member' }] }),
    ])

    const result = await authorizeAssigneeChange({
      assigneeId: AGENT,
      actorId: MEMBER,
      task: someoneElsesTask,
      targetListIds: ['mine', 'theirs'],
      requireListMembership: true,
    })

    expect(result).toMatchObject({ ok: false, status: 403 })
  })
})

describe('authorizeAssigneeChange — people (AWTD-887)', () => {
  it('still refuses a human who holds no role on any of the task lists', async () => {
    // The planting rule is untouched for the case it was written for.
    userFindUnique.mockResolvedValue({ isAIAgent: false })
    taskListCount.mockResolvedValue(0)

    const result = await authorizeAssigneeChange({
      assigneeId: HUMAN,
      actorId: OWNER,
      task: ownersTask,
      targetListIds: [LIST_ID],
      requireListMembership: true,
    })

    expect(result).toMatchObject({ ok: false, status: 400 })
  })

  it('allows a human who does hold a role', async () => {
    userFindUnique.mockResolvedValue({ isAIAgent: false })
    taskListCount.mockResolvedValue(1)

    const result = await authorizeAssigneeChange({
      assigneeId: HUMAN,
      actorId: OWNER,
      task: ownersTask,
      targetListIds: [LIST_ID],
      requireListMembership: true,
    })

    expect(result).toEqual({ ok: true, assigneeExists: true })
  })

  it('skips the membership rule entirely when the caller does not ask for it', async () => {
    // Legacy's assign-by-email path creates a placeholder user for someone who
    // has not accepted an invitation yet — a member of nothing, by definition.
    userFindUnique.mockResolvedValue({ isAIAgent: false })

    const result = await authorizeAssigneeChange({
      assigneeId: HUMAN,
      actorId: OWNER,
      task: ownersTask,
      targetListIds: [LIST_ID],
      requireListMembership: false,
    })

    expect(result).toEqual({ ok: true, assigneeExists: true })
    expect(taskListCount).not.toHaveBeenCalled()
  })

  it('does not treat a missing user row as an agent', async () => {
    // A bad id must fall to the planting rule's 400, not to the agent path.
    userFindUnique.mockResolvedValue(null)
    taskListCount.mockResolvedValue(0)

    const result = await authorizeAssigneeChange({
      assigneeId: 'no-such-user',
      actorId: OWNER,
      task: ownersTask,
      targetListIds: [LIST_ID],
      requireListMembership: true,
    })

    expect(result).toMatchObject({ ok: false, status: 400 })
  })
})
