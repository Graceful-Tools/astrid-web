/**
 * The agent-assignment rule has to run on CREATE too (AWTD-891).
 *
 * `canUserAssignAgentToTask` (task 0672b69b) is the rule for pointing an AI
 * agent at a task: only the task's creator, or a list owner/admin, may do it,
 * unless the list has opted its members in. Assigning an agent spends the
 * list's configured user's API key and, on Claude Code Remote, executes code on
 * their machine.
 *
 * AWTD-887 routed `updateTaskWithSideEffects` through it, via
 * `authorizeAssigneeChange`. `createTaskWithSideEffects` never called it at
 * all: it applied only the people-rule about unsolicited task planting, and
 * then a plain existence lookup. Create is the EASIER version of the exposure
 * 0672b69b closed — no existing task to rewrite, just a POST naming a list you
 * can add to and an `assigneeId` naming an agent.
 *
 * What kept it mostly unreachable was a coincidence, not a control: the
 * people-rule refused any agent that held no role on the target lists. That is
 * the AWTD-887 bug wearing a different hat — it refused legitimate assignments
 * for the wrong reason while waving through every agent that DID hold a role,
 * with no agent rule applied to it at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const taskCreate = vi.hoisted(() => vi.fn())
const taskFindUnique = vi.hoisted(() => vi.fn())
const taskFindFirst = vi.hoisted(() => vi.fn())
const taskListFindMany = vi.hoisted(() => vi.fn())
const taskListCount = vi.hoisted(() => vi.fn())
const userFindUnique = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: { create: taskCreate, findUnique: taskFindUnique, findFirst: taskFindFirst },
    taskList: { findMany: taskListFindMany, count: taskListCount },
    user: { findUnique: userFindUnique },
  },
}))
vi.mock('@/lib/task-update-handler', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  recordTaskCreationComment: vi.fn(),
}))
vi.mock('@/lib/task-identifier', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  allocateTaskIdentifier: vi.fn(async () => null),
}))
vi.mock('@/lib/tasks/sync-manual-sort-memberships', () => ({ syncManualSortMemberships: vi.fn() }))
vi.mock('@/lib/reminder-scheduling', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  scheduleReminders: vi.fn(),
}))
vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers: vi.fn(), sendEventToUser: vi.fn() }))
vi.mock('@/lib/redis', () => ({
  RedisCache: {
    del: vi.fn(),
    keys: { userTasks: (id: string) => `tasks:${id}` },
    invalidate: { userTasks: vi.fn(), userListsAllVersions: vi.fn() },
  },
  isRedisAvailable: vi.fn(async () => false),
}))
vi.mock('@/lib/analytics-events', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  trackAnalyticsEvent: vi.fn(),
}))
vi.mock('@/lib/ai-agent-webhook-service', () => ({
  aiAgentWebhookService: { notifyTaskAssignment: vi.fn(), notifyTaskAssignmentViaAIAgentId: vi.fn() },
}))

const OWNER = 'owner-user'
const STRANGER = 'stranger-user'
const AGENT = 'ai-agent-claude'
const HUMAN = 'human-user'
const LIST_ID = 'list-1'

/**
 * A list anyone may add tasks to. That bypass at the top of the create path is
 * deliberate — it is what "collaborative" means — but it means the actor can
 * hold NO role here, which is exactly the case the agent rule refuses.
 */
const collaborativePublicList = (extra: Record<string, unknown> = {}) => ({
  id: LIST_ID,
  name: 'Open board',
  ownerId: OWNER,
  privacy: 'PUBLIC',
  publicListType: 'collaborative',
  isVirtual: false,
  projectId: null,
  listType: null,
  aiAgentsEnabled: null,
  defaultAssigneeId: undefined,
  listMembers: [] as Array<{ userId: string; role: string }>,
  ...extra,
})

const privateList = (extra: Record<string, unknown> = {}) => ({
  ...collaborativePublicList(),
  privacy: 'PRIVATE',
  publicListType: null,
  ...extra,
})

/** The assignee is an AI agent. */
function assigneeIsAnAgent() {
  userFindUnique.mockResolvedValue({ id: AGENT, isAIAgent: true })
}

beforeEach(() => {
  vi.clearAllMocks()
  taskFindUnique.mockResolvedValue(null)
  taskFindFirst.mockResolvedValue(null)
  taskListCount.mockResolvedValue(0)
  userFindUnique.mockResolvedValue({ id: HUMAN, isAIAgent: false })
  taskCreate.mockImplementation(async ({ data }: any) => ({
    id: 'task-1',
    title: data.title,
    creatorId: data.creatorId ?? null,
    assigneeId: data.assigneeId ?? null,
    completed: false,
    isPrivate: data.isPrivate,
    createdAt: new Date(),
    updatedAt: new Date(),
    lists: [],
    comments: [],
    attachments: [],
  }))
})

async function create(args: Record<string, unknown>) {
  const { createTaskWithSideEffects } = await import('@/services/task.service')
  return await createTaskWithSideEffects(args as never)
}

describe('createTaskWithSideEffects applies the agent rule (AWTD-891)', () => {
  it('refuses a stranger pointing an agent at a task on a collaborative public list', async () => {
    // The reachable version of the exposure: the agent holds a role on the
    // list, so the people-rule is satisfied and today nothing else looks.
    // The run would bill the list's configured user.
    taskListFindMany.mockResolvedValue([
      collaborativePublicList({ listMembers: [{ userId: AGENT, role: 'member' }] }),
    ])
    assigneeIsAnAgent()

    const result = await create({
      input: { title: 'Run this', listIds: [LIST_ID], assigneeId: AGENT },
      actorId: STRANGER,
      requireAssigneeListMembership: true,
    })

    expect(result).toMatchObject({ ok: false, status: 403 })
    expect(taskCreate).not.toHaveBeenCalled()
  })

  it('refuses it on the surfaces that do not ask for the people-rule either', async () => {
    // Legacy and MCP pass no `requireAssigneeListMembership`, so create applied
    // NO assignee rule at all there — not even the coincidental one.
    taskListFindMany.mockResolvedValue([collaborativePublicList()])
    assigneeIsAnAgent()

    const result = await create({
      input: { title: 'Run this', listIds: [LIST_ID], assigneeId: AGENT },
      actorId: STRANGER,
    })

    expect(result).toMatchObject({ ok: false, status: 403 })
    expect(taskCreate).not.toHaveBeenCalled()
  })

  it('lets the list owner assign an agent that holds no role on the list', async () => {
    // AWTD-887's fix has to reach create too: the people-rule was refusing
    // exactly this with 400 "Assignee must be a member of one of the task
    // lists", which is the picker promising what the write path refuses.
    taskListFindMany.mockResolvedValue([privateList()])
    assigneeIsAnAgent()

    const result = await create({
      input: { title: 'Run this', listIds: [LIST_ID], assigneeId: AGENT },
      actorId: OWNER,
      requireAssigneeListMembership: true,
    })

    expect(result).toMatchObject({ ok: true })
    expect(taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assigneeId: AGENT }) })
    )
  })

  it('lets the creator assign an agent to a task on no list at all', async () => {
    assigneeIsAnAgent()

    const result = await create({
      input: { title: 'Run this', assigneeId: AGENT },
      actorId: STRANGER,
      requireAssigneeListMembership: true,
    })

    expect(result).toMatchObject({ ok: true })
  })

  it('requires every target list to allow it, not just the one the actor owns', async () => {
    // Same reasoning as the update path: a task on the actor's own list AND a
    // victim's list must not be assignable on the strength of the former,
    // while the run bills the latter.
    taskListFindMany.mockResolvedValue([
      privateList({ id: 'mine', ownerId: STRANGER }),
      collaborativePublicList({ id: 'theirs' }),
    ])
    assigneeIsAnAgent()

    const result = await create({
      input: { title: 'Run this', listIds: ['mine', 'theirs'], assigneeId: AGENT },
      actorId: STRANGER,
      requireAssigneeListMembership: true,
    })

    expect(result).toMatchObject({ ok: false, status: 403 })
  })
})

describe("a list's own defaultAssigneeId is not the caller's choice (AWTD-891)", () => {
  it('assigns a default agent without putting it through the agent rule', async () => {
    // Decided, not inherited by accident. `defaultAssigneeId` is configured by
    // the list OWNER, so an agent sitting there is that owner's consent to
    // spend their own key — the very person the rule exists to protect. Only an
    // assignee the CALLER asked for is authorised.
    taskListFindMany.mockResolvedValue([
      collaborativePublicList({ defaultAssigneeId: AGENT }),
    ])
    assigneeIsAnAgent()

    const result = await create({
      input: { title: 'Filed by a passer-by', listIds: [LIST_ID] },
      actorId: STRANGER,
      requireAssigneeListMembership: true,
    })

    expect(result).toMatchObject({ ok: true })
    expect(taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assigneeId: AGENT }) })
    )
  })
})

describe('create and update refuse the same human assignments (AWTD-891)', () => {
  it('refuses a human who holds no role on any of the task lists', async () => {
    taskListFindMany.mockResolvedValue([privateList()])

    const result = await create({
      input: { title: 'A task', listIds: [LIST_ID], assigneeId: HUMAN },
      actorId: OWNER,
      requireAssigneeListMembership: true,
    })

    expect(result).toMatchObject({ ok: false, status: 400 })
  })

  it('refuses a human assignee on a task with no lists, the way update already does', async () => {
    // `assigneeCanBeAssigned(id, [])` is false by definition, and the update
    // path has always honoured that. Create skipped its people-rule entirely
    // when no lists were requested, so the same planting the rule exists to
    // stop went through the create door.
    const result = await create({
      input: { title: 'A task', assigneeId: HUMAN },
      actorId: OWNER,
      requireAssigneeListMembership: true,
    })

    expect(result).toMatchObject({ ok: false, status: 400 })
  })

  it('still allows a human who does hold a role', async () => {
    taskListFindMany.mockResolvedValue([
      privateList({ listMembers: [{ userId: HUMAN, role: 'member' }] }),
    ])
    taskListCount.mockResolvedValue(1)

    const result = await create({
      input: { title: 'A task', listIds: [LIST_ID], assigneeId: HUMAN },
      actorId: OWNER,
      requireAssigneeListMembership: true,
    })

    expect(result).toMatchObject({ ok: true })
  })
})
