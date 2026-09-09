/**
 * Task service — slice 1 of the service layer.
 *
 * Task 017a569a. Jon: "We should. It ha[s] routes talk to prisma directly.
 * Build this one slice at a time." This is that first slice, and it is
 * deliberately one function rather than a full CRUD surface.
 *
 * WHY THIS FUNCTION FIRST. The point of a service layer is not to wrap Prisma
 * — a pass-through adds indirection and buys nothing. It is to stop a RULE
 * from being re-implemented per route. `getTaskForUser` is the rule that was
 * most repeated and has already caused bugs twice:
 *
 *   - lib/task-batch-copy.ts records one: the access check resolves membership
 *     from `lists.listMembers`, and a caller that fetched with `lists: true`
 *     silently had only `ownerId` able to match. A member of the list was told
 *     they had no access to a task they could see in the UI (task 73733c3d).
 *
 *   - app/api/coding-workflow/start-tools-workflow had NO check at all. Any
 *     signed-in user could POST another user's taskId and start an AI coding
 *     workflow against it, spending the list owner's configured API keys.
 *     Found while writing this slice, and fixed by adopting it.
 *
 * Both failures share a cause: the INCLUDE SHAPE and the CHECK were separate
 * things a route had to remember to pair. Here they cannot come apart — the
 * include is not exported for use without the check.
 *
 * SCOPE, so this does not sprawl. `services/` is for rules that span routes.
 * Query shapes with no rule attached stay in `lib/` (lib/task-query-utils.ts
 * and the twenty-odd lib/task-*.ts modules), which is a working pattern and is
 * not being migrated. A service that does nothing but forward to Prisma should
 * not be written.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  PROJECT_ACCESS_INCLUDE,
  canUserAssignAgentToTask,
  hasExplicitListRole,
} from '@/lib/list-permissions'
import { getListMemberIds, hasListAccess } from '@/lib/list-member-utils'
import { assigneeCanBeAssigned } from '@/lib/task-assignee'
import { audienceForTask, recordDeletion } from '@/lib/deletion-log'
import { cancelActiveCodingWorkflow } from '@/lib/tasks/cancel-active-coding-workflow'
import { syncManualSortMemberships } from '@/lib/tasks/sync-manual-sort-memberships'
import { broadcastToUsers } from '@/lib/sse-utils'
import { RedisCache, isRedisAvailable } from '@/lib/redis'
import { allocateTaskIdentifier } from '@/lib/task-identifier'
import { normalizeProjectStatusListIds } from '@/lib/project-status'
import {
  recordTaskCreationComment,
  recordStateChangeComment,
  resolveRepeatingTaskCompletion,
} from '@/lib/task-update-handler'
import { applyRepeatingTaskRollForward } from '@/lib/repeating-task-handler'
import { parseClosedReason } from '@/lib/closed-reason'
import { parseCompletedSource, parseRepeating } from '@/lib/task-enums'
import { statusListIdsToDetachOnCompletion } from '@/lib/project-status'
import { TASK_FULL_INCLUDE } from '@/lib/task-query-utils'
import { diffTaskEvents, recordTaskEvents } from '@/lib/task-events'
import { notifyTaskUpdate } from '@/lib/notification-store'
import { invalidateUserStats } from '@/lib/user-stats'
import { rescheduleRemindersForUpdate } from '@/lib/reminder-scheduling'
import { enrichTaskForAgent } from '@/lib/agent-protocol'
import { aiAgentWebhookService } from '@/lib/ai-agent-webhook-service'
import {
  computeAutomaticReminders,
  scheduleReminders,
  type ReminderScheduleEntry,
} from '@/lib/reminder-scheduling'
import {
  trackAnalyticsEvent,
  AnalyticsEventType,
  AnalyticsPlatform,
  type AnalyticsPlatformValue,
} from '@/lib/analytics-events'
import { createLogger } from '@/lib/logger'

const log = createLogger('services.task')

/**
 * The relations the access rule reads. NOT exported: fetching with this shape
 * and then hand-rolling the check is exactly the mistake this module exists to
 * prevent, so the only way to get the shape is to get the check with it.
 */
const TASK_ACCESS_INCLUDE = {
  creator: true,
  assignee: true,
  lists: {
    include: {
      owner: true,
      listMembers: { include: { user: true } },
    },
  },
} as const

export type TaskAccessResult =
  | { ok: true; task: NonNullable<Awaited<ReturnType<typeof findTask>>> }
  | { ok: false; status: 404 | 403; error: string }

function findTask(taskId: string) {
  return prisma.task.findUnique({
    where: { id: taskId },
    include: TASK_ACCESS_INCLUDE,
  })
}

/**
 * Fetch a task only if `userId` may act on it.
 *
 * Access is creator, assignee, or an explicit role on any list the task is on.
 * Deliberately NOT public-list access: a PUBLIC list makes a task readable, and
 * every caller of this so far is doing something to the task rather than
 * reading it. A read path that should honour public lists needs its own
 * function rather than a boolean on this one — a flag here would let a caller
 * widen a write to public readers by passing the wrong argument.
 *
 * Returns 404 for a missing task and 403 for a forbidden one, matching what the
 * routes already returned, so adopting it does not change any response.
 */
export async function getTaskForUser(taskId: string, userId: string): Promise<TaskAccessResult> {
  const task = await findTask(taskId)

  if (!task) {
    return { ok: false, status: 404, error: 'Task not found' }
  }

  if (!userCanAccessTask(task, userId)) {
    return { ok: false, status: 403, error: 'Access denied' }
  }

  return { ok: true, task }
}

/** The minimum a task must carry for the access rule to be answerable. */
export interface TaskWithAccessRelations {
  creatorId?: string | null
  assigneeId?: string | null
  lists?: Array<{ ownerId?: string; listMembers?: unknown }> | null
}

/**
 * The access rule itself, for callers that ALREADY hold the task.
 *
 * Slice 2 (task 017a569a). Some routes reach a task as a relation of something
 * else — coding-workflow/status loads it through CodingTaskWorkflow — so
 * getTaskForUser would mean a second query for a row already in memory. They
 * were each re-spelling the three-way check instead.
 *
 * Exporting a predicate reopens the risk slice 1 closed by keeping the include
 * private: a caller can now pass a task fetched WITHOUT `lists.listMembers`,
 * and `hasExplicitListRole` would find no membership and deny a legitimate
 * member. That is the exact bug of task 73733c3d, and it is nasty because it
 * fails CLOSED — a denied member reads as a permissions quirk, not a missing
 * relation.
 *
 * So the shape is checked rather than trusted. A task whose lists were loaded
 * without their members THROWS here, loudly, at the call site that got it
 * wrong — instead of silently returning false in production. That makes the
 * predicate safer to export than the hand-rolled check it replaces, which had
 * no such guard.
 */
export function userCanAccessTask(task: TaskWithAccessRelations, userId: string): boolean {
  const lists = task.lists ?? []

  for (const list of lists) {
    if (list.listMembers === undefined) {
      throw new Error(
        'userCanAccessTask: task.lists was loaded without listMembers, so membership ' +
          'cannot be decided. Include lists: { include: { listMembers: true } }, or use ' +
          'getTaskForUser() which owns the shape.'
      )
    }
  }

  return (
    task.creatorId === userId ||
    task.assigneeId === userId ||
    lists.some(list => hasExplicitListRole({ id: userId }, list as never))
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Slice 2: the DELETE verb (epic 9dedd8aa)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Delete a task, with every side effect the delete implies.
 *
 * Four surfaces deleted tasks and only two of them recorded a tombstone:
 *
 *   app/api/tasks/[id]                        ✅
 *   app/api/v1/tasks/[id]                     ✅
 *   app/api/mcp/operations/…/task-operations  ❌ hard-deleted, no tombstone
 *   mcp/handlers/tasks.ts                     ❌ hard-deleted, no tombstone
 *
 * That is not a cosmetic divergence. lib/deletion-log.ts exists so that
 * `updatedSince` is safe to act on; without a tombstone, a task deleted over
 * MCP is invisible to every delta-syncing client FOREVER — iOS and Mac keep
 * showing it until a full refetch. The sync guarantee was simply false for two
 * of the four ways to delete something.
 *
 * The ORDER here is the part that is easy to get wrong and impossible to
 * notice: the audience has to be read BEFORE the row goes, because the
 * relations go with it. Reading afterwards yields nobody, and a tombstone with
 * no audience reaches no one — which looks exactly like working code.
 *
 * Every side effect is best-effort. The user asked for the row to go and it
 * has; a failed tombstone is a sync inconvenience, not a reason to report
 * failure for something that already happened.
 *
 * Permission is NOT checked here. Each surface authenticates differently (web
 * session, OAuth scope, MCP token) and has already decided; a second, weaker
 * check here would either duplicate that or quietly disagree with it. Call this
 * only after your surface has authorised the delete.
 */
export async function deleteTaskWithSideEffects(args: {
  taskId: string
  /** Who is deleting — excluded from the SSE fan-out, since they already know. */
  actorId: string
  /** Shown in the SSE payload; surfaces that have it can pass it. */
  actorName?: string
}): Promise<{ deleted: boolean; audience: string[] }> {
  const { taskId, actorId, actorName } = args

  // Read the audience while the relations still exist.
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      lists: {
        select: {
          id: true,
          name: true,
          ownerId: true,
          listMembers: { select: { userId: true } },
        },
      },
    },
  })

  if (!task) {
    return { deleted: false, audience: [] }
  }

  const audience = audienceForTask(task as never)
  const previousListIds = (task.lists ?? []).map(list => list.id)
  const listNames = (task.lists ?? []).map(list => list.name)

  // Stop the agent before removing the thing it is working on.
  await cancelActiveCodingWorkflow({ taskId, reason: 'Task deleted' })

  await prisma.task.delete({ where: { id: taskId } })

  // Everything below is best-effort: the row is already gone. try/await rather
  // than .catch() so a caller that stubs these with a plain function — as a
  // test reasonably might — does not turn a swallowed failure into a thrown
  // TypeError on `undefined.catch`.
  try {
    await recordDeletion('task', taskId, audience)
  } catch {
    // A missing tombstone costs a delta-syncing client a stale row until its
    // next full refetch. It must not cost the user their delete.
  }

  try {
    await syncManualSortMemberships({
      taskId,
      previousListIds,
      requestedListIds: [],
    })
  } catch {
    // A stale entry in a manual sort order is dropped on the next read.
  }

  // Cached task lists go stale the moment the row goes.
  try {
    if (await isRedisAvailable()) {
      await Promise.all(
        audience.map(userId => RedisCache.del(RedisCache.keys.userTasks(userId)))
      )
    }
  } catch {
    // A stale cache entry expires on its own; the delete is already done.
  }

  try {
    const recipients = audience.filter(id => id !== actorId)
    if (recipients.length > 0) {
      broadcastToUsers(recipients, {
        type: 'task_deleted',
        timestamp: new Date().toISOString(),
        data: {
          taskId,
          taskTitle: task.title,
          deleterName: actorName ?? null,
          userId: actorId,
          listNames,
        },
      })
    }
  } catch {
    // A missed SSE nudge costs a refresh, not correctness — the tombstone above
    // is what makes the deletion durable for delta sync.
  }

  return { deleted: true, audience }
}

// ─────────────────────────────────────────────────────────────────────────────
// Slice 3: the CREATE verb (epic 9dedd8aa)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The relations every side effect below needs, and the richest shape any
 * surface returns. Kept private for the same reason TASK_ACCESS_INCLUDE is:
 * the SSE fan-out reads `lists.listMembers`, and a caller that created with a
 * thinner include would silently broadcast to nobody.
 *
 * Surfaces narrow this for the wire themselves. They must: legacy's shape
 * carries `list.owner` and `listMembers.user` — whole user records, emails
 * included — and handing that to v1 or MCP verbatim would newly publish list
 * members' email addresses to API consumers that have never received them.
 * Same DB state everywhere, unchanged wire contracts.
 */
const TASK_CREATE_INCLUDE = {
  assignee: true,
  creator: true,
  lists: {
    include: {
      owner: true,
      listMembers: { include: { user: true } },
    },
  },
  comments: { include: { author: true } },
  attachments: true,
} as const

export type CreatedTask = Prisma.TaskGetPayload<{ include: typeof TASK_CREATE_INCLUDE }>

export interface CreateTaskInput {
  title: string
  description?: string | null
  priority?: number
  listIds?: string[]
  /** `undefined` means "decide from the list default"; `null` means "unassigned". */
  assigneeId?: string | null
  dueDateTime?: string | Date | null
  /** Legacy date field. Superseded by dueDateTime, still sent by older clients. */
  when?: string | Date | null
  isAllDay?: boolean
  isPrivate?: boolean
  repeating?: string | null
  customRepeatingData?: unknown
  /**
   * DUE_DATE or COMPLETION_DATE. Omitted, the column default (COMPLETION_DATE)
   * stands — writing that value explicitly would be the same result by luck
   * rather than by contract.
   */
  repeatFrom?: string | null
  reminderTime?: string | Date | null
  reminderType?: string | null
  completed?: boolean
  clientRequestId?: string | null
  parentTaskId?: string | null
  statusRole?: string | null
}

export type CreateTaskResult =
  | { ok: true; task: CreatedTask; idempotent: boolean }
  | { ok: false; status: 400 | 403 | 409; error: string }

/**
 * Create a task, with every side effect the create implies.
 *
 * Four surfaces created tasks and no two of them did the same work:
 *
 *   legacy app/api/tasks              identifier, comment, reminders, manual sort, SSE, agent, cache
 *   v1     app/api/v1/tasks           identifier, comment, SSE, agent, cache — no reminders, no manual sort
 *   MCP    operations/task-operations task_created SSE only
 *   MCP    mcp/handlers/tasks.ts      nothing at all, not even idempotency
 *
 * Two of those gaps are broken guarantees rather than cosmetic drift, in the
 * same way the missing DELETE tombstone was. A task an agent creates in a
 * project gets no `AST-nnn` identifier — the key that project's entire
 * workflow is addressed by, absent for the creator that uses it most (task
 * 5bcd426b fixed this for v1's idempotent path only). And an agent-created
 * task never enters a manually-sorted list's order, so it sorts nowhere until
 * something unrelated rewrites that order.
 *
 * ORDER matters in one place that is easy to get wrong: idempotency is
 * resolved BEFORE an identifier is minted. v1 hoisted minting above the
 * idempotency branch to fix 5bcd426b, which works but burns a project sequence
 * number on every retry — a client retrying a create walks the project's
 * numbering forward without creating anything. Returning early first gives
 * every real create an identifier without spending one on a duplicate.
 *
 * Every side effect after the row exists is best-effort. The caller was told
 * the task was created and it was; a missed reminder is an inconvenience, not
 * a reason to report failure for something that already happened.
 *
 * AUTHENTICATION is NOT done here — each surface has its own (web session,
 * OAuth scope, MCP token) and has already decided. LIST AUTHORISATION is,
 * which is where this departs from `deleteTaskWithSideEffects`: for a create
 * the list check is not a separate gate but the thing that decides which lists
 * the task lands on and whether its assignee survives, so splitting it from
 * the create is what let the four surfaces disagree in the first place.
 */
export async function createTaskWithSideEffects(args: {
  input: CreateTaskInput
  /** Who is creating — the creator, and excluded from the SSE fan-out. */
  actorId: string
  /** Shown in the creation comment and SSE payloads. */
  actorName?: string
  /** Recorded on the analytics event; MCP surfaces pass 'API-other'. */
  platform?: AnalyticsPlatformValue
  /**
   * Require the assignee to hold a role on one of the task's lists (v1's rule).
   *
   * Stays a flag rather than becoming universal because legacy's assign-by-
   * email path creates a placeholder user for someone who has not accepted an
   * invitation yet — by definition not a member of anything. Enforcing v1's
   * rule everywhere would delete that feature rather than unify a behaviour.
   */
  requireAssigneeListMembership?: boolean
}): Promise<CreateTaskResult> {
  const { input, actorId, actorName, platform, requireAssigneeListMembership } = args

  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (!title) {
    return { ok: false, status: 400, error: 'Title is required' }
  }

  // ── Lists: existence, permission, virtual filtering, status normalisation ──
  let connectListIds: string[] = []
  let lists: Array<Record<string, any>> = []
  let hasCopyOnlyPublicList = false
  let completed = input.completed === true
  /** Set once the assignee is known to be a real user, to skip the lookup. */
  let assigneeExists = false

  const requestedListIds = input.listIds ?? []
  if (requestedListIds.length > 0) {
    // A bounded SELECT, not an include. Validating N lists used to drag every
    // member's whole user record — name, email, image — into memory on every
    // create, and the payload grew with the list's membership (task 96127607).
    // The role lookup needs `ownerId` and each member's `userId`/`role`; it has
    // never needed the user rows behind them.
    lists = await prisma.taskList.findMany({
      where: { id: { in: requestedListIds } },
      select: {
        id: true,
        name: true,
        ownerId: true,
        privacy: true,
        publicListType: true,
        isVirtual: true,
        projectId: true,
        listType: true,
        defaultAssigneeId: true,
        listMembers: { select: { userId: true, role: true } },
      },
    })

    const found = new Set(lists.map(list => list.id))
    const missing = requestedListIds.filter(id => !found.has(id))
    if (missing.length > 0) {
      return { ok: false, status: 400, error: `Invalid list IDs: ${missing.join(', ')}` }
    }

    for (const list of lists) {
      // A collaborative public list is one anyone may add to, which is exactly
      // what makes it collaborative — so no role is required there.
      const isCollaborativePublic =
        list.privacy === 'PUBLIC' && list.publicListType === 'collaborative'
      if (!hasListAccess(list as never, actorId) && !isCollaborativePublic) {
        return {
          ok: false,
          status: 403,
          error: `You don't have permission to create tasks in this list`,
        }
      }
    }

    if (requireAssigneeListMembership && input.assigneeId && input.assigneeId !== actorId) {
      const assigneeId = input.assigneeId
      if (!lists.some(list => hasListAccess(list as never, assigneeId))) {
        return { ok: false, status: 400, error: 'Assignee must be a member of one of the task lists' }
      }
      // Holding a role on a list is proof the user row exists, so the
      // existence lookup below is redundant on this path.
      assigneeExists = true
    }

    // One copy-only public list in the set is enough: the task becomes
    // publicly visible through it whatever the other lists are.
    hasCopyOnlyPublicList = lists.some(
      list => list.privacy === 'PUBLIC' && list.publicListType !== 'collaborative'
    )

    // Virtual lists are saved-filter views, not containers.
    connectListIds = lists.filter(list => !list.isVirtual).map(list => list.id)

    // Project-status board invariants: at most one status list per project,
    // and `completed = true` implies no status memberships at all. The real
    // completed flag has to go in — hardcoding false let a task be created
    // completed AND sitting on a status column (task db7c6670).
    const projectIds = Array.from(
      new Set(lists.map(list => list.projectId).filter((id): id is string => Boolean(id)))
    )
    if (projectIds.length > 0) {
      const projectStatusLists = await prisma.taskList.findMany({
        where: { projectId: { in: projectIds }, listType: 'status' },
      })
      const normalized = normalizeProjectStatusListIds(
        connectListIds,
        [...lists, ...projectStatusLists] as never,
        { completed }
      )
      connectListIds = normalized.listIds
      if (normalized.completedFromStatus !== undefined) {
        completed = normalized.completedFromStatus
      }
    }
  }

  // ── Assignee ──────────────────────────────────────────────────────────────
  const finalAssigneeId = resolveAssignee({
    requested: input.assigneeId,
    actorId,
    lists,
    connectListIds,
    hasCopyOnlyPublicList,
  })

  // A bad assignee id is the caller's mistake, so it gets a 400 rather than
  // the foreign-key 500 Prisma would raise. Skipped when the actor is assigning
  // to themselves, or when a list role has already proved the user exists —
  // otherwise this would add a round-trip to the hottest create path there is.
  if (finalAssigneeId && finalAssigneeId !== actorId && !assigneeExists) {
    const assignee = await prisma.user.findUnique({
      where: { id: finalAssigneeId },
      select: { id: true },
    })
    if (!assignee) {
      return { ok: false, status: 400, error: `Invalid assignee ID: ${finalAssigneeId}` }
    }
  }

  // ── Dates ─────────────────────────────────────────────────────────────────
  const parsedDue = parseTaskDate(input.dueDateTime)
  if (parsedDue.invalid) {
    return { ok: false, status: 400, error: `Invalid dueDateTime format: ${String(input.dueDateTime)}` }
  }
  const parsedWhen = parseTaskDate(input.when === 'none' ? null : input.when)
  if (parsedWhen.invalid) {
    return { ok: false, status: 400, error: `Invalid date format: ${String(input.when)}` }
  }
  const parsedReminder = parseTaskDate(input.reminderTime)
  if (parsedReminder.invalid) {
    return { ok: false, status: 400, error: `Invalid reminderTime format: ${String(input.reminderTime)}` }
  }

  let dueDateTime = parsedDue.value ?? parsedWhen.value
  // `when` has always meant an all-day date; an explicit isAllDay wins over it.
  const isAllDay = input.isAllDay ?? (parsedWhen.value !== null && parsedDue.value === null)
  if (isAllDay && dueDateTime) {
    // v1's normalisation, applied everywhere. An "all day" task carrying a
    // stray time component renders on different days for two clients in
    // different zones, which is the one thing all-day is supposed to prevent.
    dueDateTime = new Date(dueDateTime)
    dueDateTime.setUTCHours(0, 0, 0, 0)
  }

  // `repeatingData` is only meaningful for a custom schedule, and arrives from
  // some clients as a JSON string.
  let repeatingData: unknown = input.customRepeatingData ?? null
  if (input.repeating !== 'custom') {
    repeatingData = null
  } else if (typeof repeatingData === 'string') {
    try {
      repeatingData = JSON.parse(repeatingData)
    } catch {
      repeatingData = null
    }
  }

  // ── Idempotency ───────────────────────────────────────────────────────────
  const clientRequestId =
    typeof input.clientRequestId === 'string' ? input.clientRequestId.trim() : null

  if (clientRequestId !== null) {
    if (clientRequestId.length < 8 || clientRequestId.length > 128) {
      return { ok: false, status: 400, error: 'clientRequestId must be between 8 and 128 characters' }
    }
    const existing = await prisma.task.findUnique({
      where: { clientRequestId },
      include: TASK_CREATE_INCLUDE,
    })
    if (existing) {
      return { ok: true, task: existing as CreatedTask, idempotent: true }
    }
  } else {
    // Time-based dedup, for clients that send no idempotency key.
    const recentDuplicate = await prisma.task.findFirst({
      where: {
        title,
        creatorId: actorId,
        createdAt: { gte: new Date(Date.now() - 60_000) },
        ...(connectListIds.length > 0
          ? { lists: { some: { id: { in: connectListIds } } } }
          : {}),
      },
      include: TASK_CREATE_INCLUDE,
    })
    if (recentDuplicate) {
      return { ok: true, task: recentDuplicate as CreatedTask, idempotent: true }
    }
  }

  // ── Identifier ────────────────────────────────────────────────────────────
  // Minted below the idempotency check so a retry does not burn a project
  // sequence number, and above the create so every real create gets one —
  // including the clientRequestId path, which is what task 5bcd426b was about.
  // Best-effort: no identifier is worse than a failed create is worse still.
  let minted: { identifier: string; sequence: number } | null = null
  try {
    minted = await allocateTaskIdentifier(connectListIds)
  } catch (err) {
    log.error({ err }, 'Failed to allocate task identifier')
  }

  // Same validation as the update path, for the same reason (task e16e9b94).
  const parsedRepeating = parseRepeating(input.repeating)
  if (!parsedRepeating.ok) {
    return { ok: false, status: 400, error: parsedRepeating.error }
  }
  const validatedRepeating = parsedRepeating.value ?? 'never'

  // ── Create ────────────────────────────────────────────────────────────────
  const data: Record<string, unknown> = {
    title,
    description: input.description || '',
    priority: input.priority ?? 0,
    repeating: validatedRepeating,
    repeatingData: repeatingData as Prisma.InputJsonValue,
    // Only when asked for. The create path had no repeatFrom at all, so every
    // task created through an API took COMPLETION_DATE whatever the caller
    // wanted — and a weekly job whose run lands late then slips a day per run
    // (task ee44bc35). Update has honoured it since it shipped.
    ...(input.repeatFrom ? { repeatFrom: input.repeatFrom } : {}),
    isPrivate: input.isPrivate ?? true,
    dueDateTime,
    isAllDay,
    reminderTime: parsedReminder.value,
    reminderType: input.reminderType || null,
    reminderSent: false,
    completed,
    creatorId: actorId,
    assigneeId: finalAssigneeId,
    identifier: minted?.identifier ?? null,
    sequence: minted?.sequence ?? null,
    clientRequestId,
    parentTaskId: input.parentTaskId ?? null,
    statusRole: input.statusRole ?? null,
    lists: { connect: connectListIds.map(id => ({ id })) },
  }

  let task: CreatedTask
  try {
    task = (await prisma.task.create({
      data: data as never,
      include: TASK_CREATE_INCLUDE,
    })) as CreatedTask
  } catch (err) {
    // P2002 = another request won the race on the clientRequestId constraint.
    if (
      clientRequestId &&
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      const winner = await prisma.task.findUnique({
        where: { clientRequestId },
        include: TASK_CREATE_INCLUDE,
      })
      if (winner && winner.creatorId === actorId) {
        return { ok: true, task: winner as CreatedTask, idempotent: true }
      }
      return { ok: false, status: 409, error: 'clientRequestId already used by another request' }
    }
    throw err
  }

  await runCreateSideEffects({ task, actorId, actorName, platform, connectListIds })

  return { ok: true, task, idempotent: false }
}

/**
 * Which user, if anyone, the new task belongs to.
 *
 * The list default is the subtle part, and its three-way encoding is load-
 * bearing: `undefined` (never configured) leaves the task unassigned, `null`
 * means "whoever created it", and the string `'unassigned'` is an explicit
 * choice that must not be read as a user id.
 */
function resolveAssignee(args: {
  requested: string | null | undefined
  actorId: string
  lists: Array<Record<string, any>>
  connectListIds: string[]
  hasCopyOnlyPublicList: boolean
}): string | null {
  const { requested, actorId, lists, connectListIds, hasCopyOnlyPublicList } = args

  // A copy-only public list is a template anyone can read and copy. An
  // assignee on one publishes a real person's identity on a public artifact
  // and means nothing to whoever copies it. Collaborative public lists keep
  // their assignees — only members can add tasks there.
  if (hasCopyOnlyPublicList) return null

  if (requested !== undefined) return requested

  if (connectListIds.length === 0) return null

  const firstList = lists.find(list => list.id === connectListIds[0])
  const listDefault = firstList?.defaultAssigneeId
  if (listDefault === undefined) return null
  if (listDefault === null) return actorId
  if (listDefault === 'unassigned') return null
  return listDefault
}

/** Parse a date field that may arrive as a string, a Date, or nothing. */
function parseTaskDate(value: string | Date | null | undefined): {
  value: Date | null
  invalid: boolean
} {
  if (!value) return { value: null, invalid: false }
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? { value: null, invalid: true } : { value, invalid: false }
  }
  const parsed = new Date(value)
  return isNaN(parsed.getTime()) ? { value: null, invalid: true } : { value: parsed, invalid: false }
}

/**
 * Everything that happens after the row exists.
 *
 * All of it is best-effort and individually guarded: the task is created, and
 * no single downstream failure may turn that into an error for the caller.
 * try/await rather than `.catch()` so a test that stubs one of these with a
 * plain function does not turn a swallowed failure into `undefined.catch`.
 */
async function runCreateSideEffects(args: {
  task: CreatedTask
  actorId: string
  actorName?: string
  platform?: AnalyticsPlatformValue
  connectListIds: string[]
}): Promise<void> {
  const { task, actorId, actorName, platform, connectListIds } = args
  const anyTask = task as unknown as Record<string, any>
  const creatorName =
    actorName || anyTask.creator?.name || anyTask.creator?.email || 'Someone'

  // System comment (authorId: null), behind the task-detail "Show system"
  // toggle. Only genuine creations reach here — every idempotent branch above
  // returns before this, so a retry never double-posts.
  try {
    await recordTaskCreationComment({ taskId: task.id, creatorName })
  } catch (err) {
    log.error({ err }, 'Failed to record task creation comment')
  }

  try {
    await syncManualSortMemberships({
      taskId: task.id,
      previousListIds: [],
      requestedListIds: connectListIds,
    })
  } catch (err) {
    log.error({ err }, 'Failed to append new task to manual sort orders')
  }

  // An explicit reminder if one was set, otherwise the standard automatic
  // schedule for the due date.
  try {
    const reminders: ReminderScheduleEntry[] = []
    if (task.reminderTime) {
      reminders.push({
        scheduledFor: task.reminderTime,
        type: 'due_reminder',
        source: 'explicit',
      })
    } else if (task.dueDateTime) {
      reminders.push(...computeAutomaticReminders(new Date(task.dueDateTime), 'automatic'))
    }
    if (reminders.length > 0) {
      await scheduleReminders({
        taskId: task.id,
        taskTitle: task.title,
        userId: task.assigneeId || actorId,
        reminders,
        checkDuplicates: true,
        reminderTypeLabel: task.reminderType ?? undefined,
      })
    }
  } catch (err) {
    log.error({ err }, 'Failed to schedule reminders for new task')
  }

  const listNames = (anyTask.lists ?? []).map((list: any) => list.name)

  if (task.assigneeId && task.assigneeId !== actorId) {
    try {
      broadcastToUsers([task.assigneeId], {
        type: 'task_assigned',
        timestamp: new Date().toISOString(),
        data: {
          taskId: task.id,
          task: enrichTaskForAgent(task as never),
          title: task.title,
          description: task.description,
          priority: task.priority,
          dueDateTime: task.dueDateTime,
          listId: anyTask.lists?.[0]?.id,
          listName: anyTask.lists?.[0]?.name,
          githubRepositoryId: anyTask.lists?.[0]?.githubRepositoryId,
          assignerName: creatorName,
          assignerId: anyTask.creator?.id ?? actorId,
          // Legacy field names, still read by older clients.
          taskTitle: task.title,
          taskPriority: task.priority,
          taskDueDateTime: task.dueDateTime,
          userId: actorId,
          listNames,
          comments: (anyTask.comments ?? []).map((c: any) => ({
            id: c.id,
            content: c.content,
            authorName: c.author?.name,
            createdAt: c.createdAt,
          })),
        },
      })
    } catch (err) {
      log.error({ err }, 'Failed to send task_assigned SSE notification')
    }
  }

  // Everyone else who can see the list: not the creator (they are looking at
  // it) and not the assignee (they got task_assigned above).
  const memberIds = new Set<string>()
  for (const list of anyTask.lists ?? []) {
    getListMemberIds(list as never).forEach(id => memberIds.add(id))
  }
  try {
    const recipients = Array.from(memberIds).filter(
      id => id !== actorId && id !== task.assigneeId
    )
    if (recipients.length > 0) {
      broadcastToUsers(recipients, {
        type: 'task_created',
        timestamp: new Date().toISOString(),
        data: {
          taskId: task.id,
          task: enrichTaskForAgent(task as never),
          taskTitle: task.title,
          taskPriority: task.priority,
          taskDueDateTime: task.dueDateTime,
          creatorName,
          userId: actorId,
          listNames,
        },
      })
    }
  } catch (err) {
    log.error({ err }, 'Failed to send task_created SSE notifications')
  }

  // An AI agent has to be told, or the one feature agent assignment exists for
  // never starts. Prefer the assignee already loaded; fall back to a lookup
  // when a caller handed us a task without it.
  try {
    if (task.assigneeId) {
      const assignee =
        anyTask.assignee ??
        (await prisma.user.findUnique({
          where: { id: task.assigneeId },
          select: { id: true, isAIAgent: true, aiAgentType: true, name: true },
        }))
      if (assignee?.isAIAgent) {
        await aiAgentWebhookService.notifyTaskAssignment(task.id, task.assigneeId)
      }
    } else if (anyTask.aiAgentId) {
      await aiAgentWebhookService.notifyTaskAssignmentViaAIAgentId(task.id, anyTask.aiAgentId)
    }
  } catch (err) {
    log.error({ err }, 'Failed to notify AI agent about task assignment')
  }

  try {
    if (await isRedisAvailable()) {
      const affected = new Set<string>([actorId, ...memberIds])
      if (task.assigneeId) affected.add(task.assigneeId)
      await Promise.all(
        Array.from(affected).map(userId =>
          RedisCache.invalidate.userTasks(userId, connectListIds)
        )
      )
    }
  } catch (err) {
    log.error({ err }, 'Failed to invalidate task cache after creation')
  }

  // Analytics lives here rather than at the surface so the MCP creators are
  // counted too — they were invisible in TASK_CREATED before.
  try {
    await trackAnalyticsEvent(
      actorId,
      AnalyticsEventType.TASK_CREATED,
      platform ?? AnalyticsPlatform.API_OTHER,
      { taskId: task.id }
    )
  } catch (err) {
    log.error({ err }, 'Failed to track task creation analytics')
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Slice 4: the UPDATE verb (epic 9dedd8aa)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A surface's parsed intent for an update.
 *
 * Deliberately NOT a Prisma `data` object. Completion carries rules — the stamp,
 * the status clearing, the closed-reason guard on a repeating series — and a
 * surface that hands over a finished `data` has already made those decisions,
 * which is how five surfaces came to make them five different ways. Each
 * surface parses its own body (they validate differently, and legitimately);
 * what they hand over is what the caller ASKED FOR.
 *
 * A key that is absent means "not provided" and is left untouched. A key
 * present with `null` means "clear it" — the distinction matters for
 * assigneeId, parentTaskId, statusRole, closedReason and dueDateTime, so those
 * are read with `in` rather than an undefined check.
 */
export interface UpdateTaskIntent {
  title?: string
  description?: string | null
  priority?: number
  completed?: boolean
  completedAt?: string | Date | null
  completedSource?: string | null
  closedReason?: string | null
  /** YYYY-MM-DD from the client; all-day repeating tasks in COMPLETION_DATE mode. */
  localCompletionDate?: string | null
  statusRole?: string | null
  dueDateTime?: string | Date | null
  isAllDay?: boolean
  isPrivate?: boolean
  repeating?: string | null
  repeatingData?: unknown
  repeatFrom?: string | null
  assigneeId?: string | null
  timerDuration?: number | null
  lastTimerValue?: number | null
  parentTaskId?: string | null
  listIds?: string[]
}

/**
 * Refuse an agent assignment the actor is not entitled to make.
 *
 * Returns a 403 result to propagate, or null when the assignment is allowed —
 * including when the new assignee is not an AI agent at all, which is the
 * common case and costs exactly one indexed lookup.
 *
 * Every list the task will sit on has to allow it: a task on the actor's own
 * list AND a victim's shared list would otherwise be assignable on the strength
 * of the list the actor owns, while the run bills the other one.
 */
async function denyAgentAssignmentIfUnauthorised(args: {
  assigneeId: string
  actorId: string
  existingTask: { id: string; creatorId: string | null }
  targetListIds: string[]
}): Promise<{ ok: false; status: 403; error: string } | null> {
  const { assigneeId, actorId, existingTask, targetListIds } = args

  const assignee = await prisma.user.findUnique({
    where: { id: assigneeId },
    select: { isAIAgent: true },
  })
  if (!assignee?.isAIAgent) return null

  const task = { id: existingTask.id, creatorId: existingTask.creatorId }
  const refusal = {
    ok: false as const,
    status: 403 as const,
    error: 'Only the task creator, or a list owner or admin, can assign an AI agent to this task',
  }

  if (targetListIds.length === 0) {
    return canUserAssignAgentToTask({ id: actorId }, task, null) ? null : refusal
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

  const allowed = lists.every(list => canUserAssignAgentToTask({ id: actorId }, task, list as never))
  return allowed ? null : refusal
}

export type UpdateTaskResult =
  | { ok: true; task: any; rolledForward: boolean; stateChangeComment?: any }
  | { ok: false; status: 400 | 403 | 404 | 412; error: string; code?: string; conflict?: any }

/** The pre-update columns the event diff and the change rules read. */
const TASK_UPDATE_EXISTING_INCLUDE = {
  lists: {
    select: {
      id: true,
      name: true,
      listType: true,
      privacy: true,
      publicListType: true,
      ownerId: true,
      listMembers: { select: { userId: true, role: true } },
    },
  },
} as const

/**
 * Update a task, with every side effect the update implies.
 *
 * FIVE surfaces updated tasks. Task fb94f2ee brought three of them level and
 * left tests/api/task-write-path-parity.test.ts asserting they stay that way;
 * the two MCP handlers were never in that test and were still raw
 * `prisma.task.update` calls, with none of the semantics:
 *
 *   legacy app/api/tasks/[id]                  ✅ (the reference implementation)
 *   v1     app/api/v1/tasks/[id]               ✅ (brought level by fb94f2ee)
 *   agent  app/api/v1/agent/tasks/[id]         ✅ (brought level by fb94f2ee)
 *   MCP    operations/task-operations          ❌ raw update
 *   MCP    mcp/handlers/tasks.ts               ❌ raw update
 *
 * What that cost, for anything completed over MCP: no `completedAt` /
 * `completedSource` stamp; `statusRole` left set on a done task, which violates
 * the schema invariant the board depends on (task db7c6670); no repeating
 * roll-forward, so completing one occurrence of a repeating task KILLED THE
 * SERIES outright — the exact bug fb94f2ee fixed for the agent PATCH; no
 * reminder rescheduling, so a completed task kept notifying; no coding-workflow
 * cancellation; no events, no notification, no state-change comment, and no
 * cache invalidation, so the change stayed invisible to every other client
 * until the cache expired.
 *
 * ORDER matters in three places:
 *   - list validation runs BEFORE the completion decision, because toggling a
 *     project status column is itself a completion (`completedFromStatus`);
 *   - the repeating roll-forward is resolved BEFORE the update is built, and
 *     short-circuits it — the helpers write the row themselves;
 *   - the pre-update task is read BEFORE the write, since every event, comment
 *     and reminder decision is a diff against it.
 *
 * Everything after the row is written is best-effort and individually guarded.
 *
 * AUTHENTICATION is not done here — each surface has its own and has already
 * decided. LIST authorisation is, for the same reason it is on the create: the
 * check decides which lists the task ends up on, not merely whether to proceed.
 */
export async function updateTaskWithSideEffects(args: {
  taskId: string
  actorId: string
  actorName?: string
  /** Distinguishes agent traffic in the activity history. */
  actorType?: 'user' | 'agent'
  platform?: AnalyticsPlatformValue
  intent: UpdateTaskIntent
  /**
   * Include for the RETURNED task. Defaults to legacy's TASK_FULL_INCLUDE.
   * Surfaces pass their own so their wire shapes are unchanged — v1's capped,
   * newest-first comments would be lost to a one-size include, and that cap is
   * load-bearing (task a86b5bed).
   *
   * Must carry `lists` (with `listMembers`) and `comments`: the SSE fan-out and
   * the notification audience are read off the updated row.
   */
  include?: Record<string, unknown>
  /** Already-fetched pre-update task, for surfaces that needed one to authorise. */
  existingTask?: any
  /** v1's rule; see the note on createTaskWithSideEffects. */
  requireAssigneeListMembership?: boolean
  /** Opt-in optimistic concurrency (If-Unmodified-Since). */
  ifUnmodifiedSince?: Date | null
  /** Shown on the cancelled coding workflow. */
  cancelWorkflowReason?: string
  /**
   * Add the web route's flat duplicate fields to the SSE payload.
   *
   * Only /api/tasks/[id] sets this. Its long-lived web clients read
   * `taskTitle`, `listNames` and friends off the event, while v1 and the agent
   * PATCH send only `{ taskId, task }` — a deliberately lean payload that
   * tests/api/sse-event-delivery pins.
   */
  legacySsePayload?: boolean
}): Promise<UpdateTaskResult> {
  const {
    taskId,
    actorId,
    actorName,
    actorType = 'user',
    platform,
    intent,
    include,
    requireAssigneeListMembership,
    ifUnmodifiedSince,
    cancelWorkflowReason = 'Task marked as completed',
    legacySsePayload = false,
  } = args

  const has = (key: keyof UpdateTaskIntent) => Object.hasOwn(intent, key)

  const existingTask =
    args.existingTask ??
    (await prisma.task.findUnique({ where: { id: taskId }, include: TASK_UPDATE_EXISTING_INCLUDE }))

  if (!existingTask) {
    return { ok: false, status: 404, error: 'Task not found' }
  }

  // Optimistic concurrency, before anything is decided on stale input.
  if (ifUnmodifiedSince && existingTask.updatedAt > ifUnmodifiedSince) {
    return {
      ok: false,
      status: 412,
      error: 'Task has been modified since your last read',
      code: 'STALE_UPDATE',
      conflict: { id: existingTask.id, updatedAt: existingTask.updatedAt },
    }
  }

  const data: Record<string, unknown> = {}

  // ── Lists ─────────────────────────────────────────────────────────────────
  // Runs first: moving a task onto a project's status column can itself decide
  // completion, and the completion rules below need that answer.
  let validatedListIds: string[] | undefined
  let completedFromStatus: boolean | undefined

  if (has('listIds') && Array.isArray(intent.listIds)) {
    if (intent.listIds.length === 0) {
      validatedListIds = []
    } else {
      const lists = await prisma.taskList.findMany({
        where: { id: { in: intent.listIds } },
        select: {
          id: true,
          name: true,
          ownerId: true,
          privacy: true,
          publicListType: true,
          isVirtual: true,
          projectId: true,
          listType: true,
          listMembers: { select: { userId: true, role: true } },
        },
      })

      const found = new Set(lists.map(list => list.id))
      const missing = intent.listIds.filter(id => !found.has(id))
      if (missing.length > 0) {
        return { ok: false, status: 400, error: `Invalid list IDs: ${missing.join(', ')}` }
      }

      for (const list of lists) {
        const isCollaborativePublic =
          list.privacy === 'PUBLIC' && list.publicListType === 'collaborative'
        if (!hasListAccess(list as never, actorId) && !isCollaborativePublic) {
          return {
            ok: false,
            status: 403,
            error: `You don't have permission to add tasks to list: ${list.name}`,
          }
        }
      }

      validatedListIds = lists.filter(list => !list.isVirtual).map(list => list.id)

      const projectIds = Array.from(
        new Set(lists.map(list => list.projectId).filter((id): id is string => Boolean(id)))
      )
      if (projectIds.length > 0) {
        const projectStatusLists = await prisma.taskList.findMany({
          where: { projectId: { in: projectIds }, listType: 'status' },
        })
        const requestedCompletedFlag =
          typeof intent.completed === 'boolean' ? intent.completed : existingTask.completed
        const normalized = normalizeProjectStatusListIds(
          validatedListIds,
          [...lists, ...projectStatusLists] as never,
          { completed: requestedCompletedFlag }
        )
        validatedListIds = normalized.listIds
        completedFromStatus = normalized.completedFromStatus
      }
    }
  }

  const requestedCompleted = completedFromStatus ?? intent.completed

  // ── Assignee ──────────────────────────────────────────────────────────────
  if (has('assigneeId')) {
    const assigneeId = intent.assigneeId || null
    if (requireAssigneeListMembership && assigneeId && assigneeId !== actorId) {
      // lib/task-assignee.ts already answers exactly this, as a COUNT rather
      // than a fetch-and-filter. It is the check v1 used before the extraction;
      // re-deriving it here would be a third copy of the rule that exists to
      // stop unsolicited task planting.
      const currentListIds = (existingTask.lists ?? []).map((list: any) => list.id)
      const targetListIds = validatedListIds ?? currentListIds
      if (!(await assigneeCanBeAssigned(assigneeId, targetListIds))) {
        return { ok: false, status: 400, error: 'Assignee must be a member of one of the task lists' }
      }
    }

    // Pointing an AI agent at a task is a bigger privilege than editing one:
    // the run spends the list's configured user's API key and, for a user on
    // Claude Code Remote, executes code on their machine. Task edit rights are
    // open to every list member, so inheriting from them let a member rewrite a
    // victim's task into an attacker-chosen prompt and bill the victim
    // (task 0672b69b).
    //
    // Only reached when the actor is assigning to SOMEONE ELSE'S task, which is
    // the whole exposure — assigning an agent to your own task is what the rule
    // permits — so the hot path pays for no extra query.
    if (assigneeId && assigneeId !== existingTask.creatorId && existingTask.creatorId !== actorId) {
      const denial = await denyAgentAssignmentIfUnauthorised({
        assigneeId,
        actorId,
        existingTask,
        targetListIds: validatedListIds ?? (existingTask.lists ?? []).map((list: any) => list.id),
      })
      if (denial) return denial
    }

    data.assigneeId = assigneeId
  }

  // ── Closed reason ─────────────────────────────────────────────────────────
  // Rejected rather than silently nulled when unrecognised: a typo must not
  // quietly become "completed normally" (task 11042ae3).
  const parsedClosedReason = parseClosedReason(intent.closedReason)
  if (!parsedClosedReason.ok) {
    return { ok: false, status: 400, error: parsedClosedReason.error }
  }

  // ── Repeating series ──────────────────────────────────────────────────────
  // Resolved before the update is built: the helper writes the row itself, so
  // this branch returns the rolled-forward task instead of updating.
  const repeatingResult = await resolveRepeatingTaskCompletion({
    taskId,
    existingCompleted: existingTask.completed,
    dataCompleted: requestedCompleted,
    localCompletionDate: intent.localCompletionDate ?? undefined,
    closedReason: parsedClosedReason.value,
  })

  if (repeatingResult) {
    await applyRepeatingTaskRollForward(taskId, repeatingResult)

    const rolled = await prisma.task.findUnique({
      where: { id: taskId },
      include: (include ?? TASK_FULL_INCLUDE) as never,
    })
    if (!rolled) {
      return { ok: false, status: 404, error: 'Task not found after update' }
    }

    const rolledComment = await runUpdateSideEffects({
      existingTask,
      task: rolled,
      actorId,
      actorName,
      actorType,
      platform,
      intent,
      requestedCompleted,
      validatedListIds,
      rolledForward: true,
      cancelWorkflowReason,
      legacySsePayload,
    })

    return { ok: true, task: rolled, rolledForward: true, stateChangeComment: rolledComment }
  }

  // ── Columns ───────────────────────────────────────────────────────────────
  if (has('title')) data.title = intent.title
  if (has('description')) data.description = intent.description
  if (has('priority')) data.priority = intent.priority
  if (has('isPrivate')) data.isPrivate = intent.isPrivate
  // Validated, not passed through. `repeating` drives the roll-forward
  // calculator, so a value outside the set is how a repeating series silently
  // stops repeating — and this is the choke point all five write surfaces
  // delegate through, so validating here covers every one of them
  // (task e16e9b94).
  if (has('repeating')) {
    const parsed = parseRepeating(intent.repeating)
    if (!parsed.ok) return { ok: false, status: 400, error: parsed.error }
    if (parsed.value !== undefined) data.repeating = parsed.value
  }
  if (has('repeatFrom')) data.repeatFrom = intent.repeatFrom
  if (has('timerDuration')) data.timerDuration = intent.timerDuration
  if (has('lastTimerValue')) data.lastTimerValue = intent.lastTimerValue
  if (has('parentTaskId')) data.parentTaskId = intent.parentTaskId
  if (has('dueDateTime')) data.dueDateTime = parseTaskDate(intent.dueDateTime).value
  if (has('isAllDay')) data.isAllDay = intent.isAllDay

  // `repeatingData` is only meaningful for a custom schedule.
  if (has('repeatingData') || has('repeating')) {
    let repeatingData: unknown = intent.repeatingData ?? null
    if (intent.repeating !== 'custom') {
      repeatingData = null
    } else if (typeof repeatingData === 'string') {
      try {
        repeatingData = JSON.parse(repeatingData)
      } catch {
        repeatingData = null
      }
    }
    if (has('repeatingData') || repeatingData === null) {
      data.repeatingData = repeatingData
    }
  }

  if (requestedCompleted !== undefined) {
    data.completed = requestedCompleted
  }

  // Completion stamp and provenance. Sync may backdate completedAt to the
  // provider's real completion time; completedSource records where it happened
  // (astrid | google | github | apple).
  if (requestedCompleted === true) {
    data.completedAt = intent.completedAt ? new Date(intent.completedAt) : new Date()
    const parsedSource = parseCompletedSource(intent.completedSource)
    if (!parsedSource.ok) return { ok: false, status: 400, error: parsedSource.error }
    // An audit field: a provenance nothing wrote is worse than none, so an
    // unrecognised value is rejected rather than defaulted away (task e16e9b94).
    data.completedSource = parsedSource.value ?? 'astrid'
    // Done carries no board status (AWTD-562).
    data.statusRole = null
  } else if (requestedCompleted === false) {
    data.completedAt = null
    data.completedSource = null
    // A reopened task is not a canceled one (task 11042ae3).
    data.closedReason = null
  }

  if (has('closedReason') && requestedCompleted !== false) {
    data.closedReason = parsedClosedReason.value
  }

  if (has('statusRole') && requestedCompleted !== true) {
    data.statusRole = intent.statusRole || null
  }

  // Invariant: completed = true => no status memberships (task db7c6670). The
  // listIds branch enforces it through the normalizer, but only when the
  // request carries listIds. A completion-only update — PUT { completed: true },
  // which is what the checkbox sends — skipped it and left the task in Ready.
  if (validatedListIds !== undefined) {
    data.lists = { set: validatedListIds.map(id => ({ id })) }
  } else if (requestedCompleted === true) {
    const detach = statusListIdsToDetachOnCompletion(existingTask.lists)
    if (detach.length > 0) {
      data.lists = { disconnect: detach.map(id => ({ id })) }
    }
  }

  const task = await prisma.task.update({
    where: { id: taskId },
    data: data as never,
    include: (include ?? TASK_FULL_INCLUDE) as never,
  })

  const stateChangeComment = await runUpdateSideEffects({
    existingTask,
    task,
    actorId,
    actorName,
    actorType,
    platform,
    intent,
    requestedCompleted,
    validatedListIds,
    rolledForward: false,
    cancelWorkflowReason,
    legacySsePayload,
  })

  return { ok: true, task, rolledForward: false, stateChangeComment }
}

/**
 * Everything that happens after the row is written.
 *
 * Individually guarded: the update is committed and the caller was told so, and
 * no single downstream failure may turn that into an error. The one exception
 * is ordering — the state-change comment is prepended to the returned task's
 * comments, so it runs before the response is handed back rather than after.
 */
async function runUpdateSideEffects(args: {
  existingTask: any
  task: any
  actorId: string
  actorName?: string
  actorType: 'user' | 'agent'
  platform?: AnalyticsPlatformValue
  intent: UpdateTaskIntent
  requestedCompleted: boolean | undefined
  validatedListIds: string[] | undefined
  rolledForward: boolean
  cancelWorkflowReason: string
  legacySsePayload: boolean
}): Promise<unknown> {
  const {
    existingTask,
    task,
    actorId,
    actorName,
    actorType,
    platform,
    intent,
    requestedCompleted,
    validatedListIds,
    rolledForward,
    cancelWorkflowReason,
    legacySsePayload,
  } = args

  const justCompleted = requestedCompleted === true && !existingTask.completed

  // Stop the agent working on something that is now done.
  if (justCompleted) {
    try {
      await cancelActiveCodingWorkflow({ taskId: task.id, reason: cancelWorkflowReason })
    } catch (err) {
      log.error({ err }, 'Failed to cancel coding workflow after task update')
    }
  }

  // Reminders must follow the task, or a completed one keeps notifying.
  try {
    const dueDateChanged =
      existingTask.dueDateTime?.getTime() !== task.dueDateTime?.getTime()
    const completedChanged = existingTask.completed !== task.completed
    const assigneeChanged = existingTask.assigneeId !== task.assigneeId

    if (dueDateChanged || completedChanged || assigneeChanged) {
      await rescheduleRemindersForUpdate({
        taskId: task.id,
        taskTitle: task.title,
        userId: task.assigneeId || task.creatorId || actorId,
        dueDateTime: task.dueDateTime ?? null,
        completed: !!task.completed,
      })
    }
  } catch (err) {
    log.error({ err }, 'Failed to reschedule reminders after task update')
  }

  try {
    if (validatedListIds !== undefined) {
      await syncManualSortMemberships({
        taskId: task.id,
        previousListIds: (existingTask.lists ?? []).map((list: any) => list.id),
        requestedListIds: (task.lists ?? []).map((list: any) => list.id),
      })
    }
  } catch (err) {
    log.error({ err }, 'Failed to synchronise manual sort after task update')
  }

  // Structured activity history (task 51a4b8ff) alongside the prose comment
  // below. Both derive from the same before/after pair; the comment is what a
  // human reads, the events are what can be queried and fanned out. actorType
  // is the point of the distinction: an agent silently reassigning or
  // completing work must leave the same trace a human would.
  const events = diffTaskEvents(
    {
      title: existingTask.title,
      completed: existingTask.completed,
      closedReason: existingTask.closedReason,
      priority: existingTask.priority,
      assigneeId: existingTask.assigneeId,
      dueDateTime: existingTask.dueDateTime,
      listIds: (existingTask.lists ?? []).map((list: any) => list.id),
    },
    {
      title: task.title,
      completed: task.completed,
      closedReason: task.closedReason,
      priority: task.priority,
      assigneeId: task.assigneeId,
      dueDateTime: task.dueDateTime,
      listIds: (task.lists ?? []).map((list: any) => list.id),
    }
  )

  try {
    await recordTaskEvents({ taskId: task.id, actorId, actorType, events })
  } catch (err) {
    log.error({ err }, 'Failed to record task events')
  }

  try {
    const commenterIds = Array.from(
      new Set(
        (task.comments ?? [])
          .map((comment: any) => comment?.authorId)
          .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
      )
    ) as string[]

    // One persist for the whole update — per-event persists defeat the
    // row-level dedupe and wrote duplicate rows (task ceaff1c5).
    await notifyTaskUpdate({
      taskId: task.id,
      actorId,
      events,
      audience: {
        assigneeId: task.assigneeId,
        creatorId: task.creatorId,
        commenterIds,
      },
    })
  } catch (err) {
    log.error({ err }, 'Failed to notify about task update')
  }

  // System comment for state changes. Uses legacy's helper rather than a copy:
  // a hand-rolled version in v1 dropped `systemEventType`, the typed
  // discriminator lib/completion-streak.ts folds on, so its comments stopped
  // folding the moment the sentence was localised (task efecc4b8).
  //
  // RETURNED rather than spliced into task.comments. Where it belongs is a
  // wire-shape decision and the surfaces genuinely differ: legacy's comments
  // arrive oldest-first, v1's arrive newest-first under a cap and are reversed
  // on the way out (task a86b5bed). A prepend inside here lands at the top of
  // one list and, after that reverse, at the bottom of the other — so each
  // surface places it, the same way each surface owns its include.
  let stateChangeComment: unknown = null
  try {
    stateChangeComment = await recordStateChangeComment({
      existingTask,
      updatedTask: task,
      updaterName: actorName || 'Someone',
    })
  } catch (err) {
    log.error({ err }, 'Failed to create state change comment')
  }

  // Everyone whose view of this task just changed, computed once and used for
  // both the broadcast and the cache invalidation — those had drifted into
  // answering the same question two different ways.
  const audience = new Set<string>()
  try {
    if (task.assigneeId) audience.add(task.assigneeId)
    if (task.creatorId) audience.add(task.creatorId)
    if (existingTask.assigneeId) audience.add(existingTask.assigneeId)
    for (const list of task.lists ?? []) {
      for (const memberId of getListMemberIds(list as never) ?? []) {
        audience.add(memberId)
      }
    }
  } catch (err) {
    // Guarded like everything else past the write. An update that is already
    // committed must not be reported as a failure because working out who to
    // tell about it went wrong.
    log.error({ err }, 'Failed to resolve the audience for a task update')
  }

  try {
    const completionChanged = existingTask.completed !== task.completed
    const assignmentChanged = existingTask.assigneeId !== task.assigneeId

    if (completionChanged || assignmentChanged) {
      const statsUserIds = new Set<string>()
      if (task.assigneeId && completionChanged) statsUserIds.add(task.assigneeId)
      if (existingTask.assigneeId && assignmentChanged && existingTask.assigneeId !== task.assigneeId) {
        statsUserIds.add(existingTask.assigneeId)
      }
      if (task.creatorId && completionChanged) statsUserIds.add(task.creatorId)

      if (statsUserIds.size > 0) {
        await invalidateUserStats(Array.from(statsUserIds))
      }
    }
  } catch (err) {
    log.error({ err }, 'Failed to invalidate user stats')
  }

  // Cached task lists go stale the moment the row changes. Invalidated BEFORE
  // the broadcast, so a client that refetches on the nudge cannot be served the
  // pre-update rows.
  try {
    if (await isRedisAvailable()) {
      const listIds = (task.lists ?? []).map((list: any) => list.id)
      await Promise.all(
        Array.from(audience).map(userId => RedisCache.invalidate.userTasks(userId, listIds))
      )
    }
  } catch (err) {
    log.error({ err }, 'Failed to invalidate task cache after update')
  }

  try {
    const recipients = Array.from(audience).filter(id => id !== actorId)
    if (recipients.length > 0) {
      // A new assignee gets task_assigned rather than task_updated — being
      // given work is a different event from work changing under you.
      const assigneeChanged =
        Object.hasOwn(intent, 'assigneeId') && task.assigneeId !== existingTask.assigneeId

      let updateRecipients = recipients
      if (assigneeChanged && task.assigneeId && task.assigneeId !== actorId) {
        broadcastToUsers([task.assigneeId], {
          type: 'task_assigned',
          timestamp: new Date().toISOString(),
          data: { taskId: task.id, task: enrichTaskForAgent(task as never) },
        })
        updateRecipients = recipients.filter(id => id !== task.assigneeId)
      }

      if (updateRecipients.length > 0) {
        broadcastToUsers(updateRecipients, {
          type: justCompleted ? 'task_completed' : 'task_updated',
          timestamp: new Date().toISOString(),
          data: {
            taskId: task.id,
            task: enrichTaskForAgent(task as never),
            // The flat duplicates below are the WEB route's payload and only
            // its own: every field here is already inside `task`, and v1 and
            // the agent PATCH deliberately send the lean pair, which
            // tests/api/sse-event-delivery asserts. Adding them everywhere
            // would grow every agent's event payload to carry data it has and
            // does not read.
            ...(legacySsePayload
              ? {
                  taskTitle: task.title,
                  taskPriority: task.priority,
                  taskDueDateTime: task.dueDateTime,
                  taskIsAllDay: task.isAllDay,
                  taskCompleted: task.completed,
                  updaterName: actorName || 'Someone',
                  userId: actorId,
                  listNames: (task.lists ?? []).map((list: any) => list.name),
                }
              : {}),
          },
        })
      }
    }
  } catch (err) {
    log.error({ err }, 'Failed to broadcast task update SSE')
  }

  // Analytics lives here so the MCP surfaces are counted too — they were
  // invisible in TASK_EDITED and TASK_COMPLETED before.
  try {
    const resolvedPlatform = platform ?? AnalyticsPlatform.API_OTHER
    if (rolledForward || (requestedCompleted === true && !existingTask.completed)) {
      await trackAnalyticsEvent(actorId, AnalyticsEventType.TASK_COMPLETED, resolvedPlatform, {
        taskId: task.id,
      })
    }
    await trackAnalyticsEvent(actorId, AnalyticsEventType.TASK_EDITED, resolvedPlatform, {
      taskId: task.id,
    })
  } catch (err) {
    log.error({ err }, 'Failed to track task update analytics')
  }

  return stateChangeComment
}
