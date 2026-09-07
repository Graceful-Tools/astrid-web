/**
 * Tasks API v1
 *
 * RESTful endpoint for task operations
 * GET /api/v1/tasks - List tasks
 * POST /api/v1/tasks - Create task
 */

import { type NextRequest, NextResponse } from 'next/server'
import type { V1TaskCreateRequest } from '@/lib/api-contracts/v1-request-shapes'
import { getDeprecationWarning } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { validateParentTask } from '@/lib/subtasks'
import { detectPlatform } from '@/lib/analytics-events'
import { withAuth } from '@/lib/api-auth-wrapper'
import { createTaskWithSideEffects, type CreatedTask } from '@/services/task.service'
import { createLogger } from '@/lib/logger'
import { getDeletionsSince } from '@/lib/deletion-log'

const log = createLogger('v1.tasks')

/**
 * GET /api/v1/tasks
 * List tasks with optional filters
 *
 * Query parameters:
 * - listId: Filter by list ID
 * - completed: true/false
 * - priority: 0-2
 * - assigneeId: Filter by assignee
 * - statusRole: Filter by board status (ready | doing | waiting | a project's
 *   custom role). `none` selects Inbox — the tasks carrying no status at all.
 * - limit: Max results (default: 100)
 * - offset: Pagination offset (default: 0)
 * - includeComments: true/false (default: false)
 * - updatedSince: ISO timestamp; return only tasks updated after it (delta sync)
 */
export const GET = withAuth(
  { scopes: ['tasks:read'], tag: 'v1.tasks' },
  async (req, auth) => {
    const url = new URL(req.url)
    const listId = url.searchParams.get('listId')
    // Only apply completed filter if explicitly provided
    const completedParam = url.searchParams.get('completed')
    const completed = completedParam !== null ? completedParam === 'true' : undefined
    const priority = url.searchParams.get('priority')
    const assigneeId = url.searchParams.get('assigneeId')
    // Board status as a state on the task (AWTD-562). Filtering here rather than
    // in the caller is what keeps a status query to ONE request: the old shape —
    // fetch the board, filter client-side — silently truncates against `limit`,
    // so a busy board can hide a ready task behind 100 unrelated ones.
    const statusRole = url.searchParams.get('statusRole')
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 1000)
    const offset = parseInt(url.searchParams.get('offset') || '0')
    const includeComments = url.searchParams.get('includeComments') === 'true'
    // Lean mode: omit per-task embedded listMembers (clients resolve membership
    // from the lists endpoint). Big payload win — the same members were
    // duplicated across every task sharing a list. Backward-compatible: absent
    // param → full members as before.
    const leanListMembers = url.searchParams.get('leanListMembers') === '1'
    // Delta sync: return only tasks touched since this instant. Optional and
    // purely additive — omitting it leaves the query exactly as it was, which
    // is what keeps this from being a breaking change for existing clients.
    const updatedSinceParam = url.searchParams.get('updatedSince')
    const updatedSince = updatedSinceParam ? new Date(updatedSinceParam) : null
    const hasValidUpdatedSince = !!updatedSince && !Number.isNaN(updatedSince.getTime())

    const where: any = {}

    if (listId) {
      // Filtering by a specific list returns ONLY that list's tasks; caller
      // must have access to the list (owner, member, or public).
      where.lists = {
        some: {
          id: listId,
          OR: [
            { ownerId: auth.userId },
            { listMembers: { some: { userId: auth.userId } } },
            { privacy: 'PUBLIC' },
          ],
        },
      }
    } else {
      // No listId: surface every task the caller can see
      where.OR = [
        { creatorId: auth.userId },
        { assigneeId: auth.userId },
        {
          lists: {
            some: {
              OR: [
                { ownerId: auth.userId },
                { listMembers: { some: { userId: auth.userId } } },
                { privacy: 'PUBLIC' },
              ],
            },
          },
        },
      ]
    }

    // Narrows an already-built visibility clause; never widens it. An
    // unparseable cursor is ignored rather than applied, so a bad value cannot
    // silently empty the caller's task list.
    if (hasValidUpdatedSince) {
      where.updatedAt = { gt: updatedSince }
    }

    if (completed !== undefined) {
      where.completed = completed
    }
    if (priority) {
      where.priority = parseInt(priority)
    }
    if (assigneeId) {
      where.assigneeId = assigneeId
    }
    // Inbox is the ABSENCE of a status, so it is a null column rather than a
    // value — same distinction /api/v1/search draws for `status:none`.
    if (statusRole) {
      where.statusRole = statusRole === 'none' ? null : statusRole
    }

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        select: {
          id: true,
          title: true,
          description: true,
          assigneeId: true,
          creatorId: true,
          dueDateTime: true,
          isAllDay: true,
          reminderTime: true,
          reminderSent: true,
          reminderType: true,
          repeating: true,
          repeatingData: true,
          repeatFrom: true,
          occurrenceCount: true,
          priority: true,
          isPrivate: true,
          completed: true,
          completedAt: true,
          completedSource: true,
          // Terminal state other than done (task 11042ae3). Without this a
          // client cannot tell "done" from "won't do" in a list view — the
          // whole point of the field.
          closedReason: true,
          // Human-readable identifier (task 12f54df4). Minted on create and
          // resolvable by GET, but omitting it here meant no client could ever
          // *display* one, which is where its value actually is.
          identifier: true,
          sequence: true,
          // Board status as a state (AWTD-562) — without this no client can
          // render a board from the field.
          statusRole: true,
          createdAt: true,
          updatedAt: true,
          originalTaskId: true,
          sourceListId: true,
          clientRequestId: true,
          parentTaskId: true,
          lists: {
            select: {
              // Required for permission checks: getUserRoleInList resolves
              // OWNER from this. Without it an owner who is not also a
              // listMembers row resolves to NO role, and the task renders
              // read-only — which is what happened to every task carrying a
              // status, since lists[0] is the status list. (Task 5208e723.)
              ownerId: true,
              id: true,
              name: true,
              color: true,
              githubRepositoryId: true,
              ...(leanListMembers ? {} : {
                listMembers: {
                  select: {
                    id: true,
                    listId: true,
                    userId: true,
                    role: true,
                  }
                },
              }),
            },
          },
          assignee: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
              isAIAgent: true,
            },
          },
          creator: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
              isAIAgent: true,
            },
          },
          ...(includeComments && {
            comments: {
              select: {
                id: true,
                content: true,
                createdAt: true,
                author: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    image: true,
                    isAIAgent: true,
                  },
                },
              },
              orderBy: { createdAt: 'desc' },
              // Bound the fetch — previously unbounded, so a task with hundreds
              // of comments bloated the collection payload × every task.
              take: 20,
            },
          }),
        },
        orderBy: [
          { completed: 'asc' },
          { priority: 'desc' },
          { createdAt: 'desc' },
        ],
        take: limit,
        skip: offset,
      }),
      prisma.task.count({ where }),
    ])

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    // iOS expects a flat listIds array alongside the relation
    const tasksWithListIds = tasks.map(task => ({
      ...task,
      listIds: task.lists?.map(list => list.id) || []
    }))

    // Delta responses also carry what disappeared. Tasks are hard-deleted, so
    // without this a client syncing incrementally keeps showing tasks that are
    // already gone. Only present for delta requests, so a full fetch returns
    // exactly the response shape it always did.
    const deletedIds = hasValidUpdatedSince
      ? await getDeletionsSince('task', auth.userId, updatedSince!)
      : undefined

    return NextResponse.json(
      {
        tasks: tasksWithListIds,
        ...(deletedIds ? { deletedIds } : {}),
        meta: {
          total,
          limit,
          offset,
          apiVersion: 'v1',
          authSource: auth.source,
        },
      },
      { headers }
    )
  }
)

/**
 * POST /api/v1/tasks
 * Create a new task
 *
 * Body:
 * {
 *   title: string (required)
 *   description?: string
 *   listIds?: string[]
 *   priority?: number (0-2)
 *   assigneeId?: string
 *   dueDateTime?: ISO datetime string
 *   isAllDay?: boolean
 *   isPrivate?: boolean
 *   repeating?: string
 *   repeatingData?: object (custom pattern; only read when repeating is "custom")
 *   repeatFrom?: 'DUE_DATE' | 'COMPLETION_DATE'
 *   clientRequestId?: string (8-128 chars; idempotency key)
 * }
 */
export const POST = withAuth(
  { scopes: ['tasks:write'], tag: 'v1.tasks' },
  async (req, auth) => {
    // Typed rather than `any`, so a misspelled field is a build error instead
    // of one that silently never applies. Not validation — a cast cannot make a
    // client honest. See lib/api-contracts/v1-request-shapes.ts. (Task 87e19910.)
    const body = (await req.json()) as V1TaskCreateRequest

    if (!body.title || typeof body.title !== 'string') {
      return NextResponse.json(
        { error: 'title is required and must be a string' },
        { status: 400 }
      )
    }

    // ── Subtasks: validate parentTaskId if provided ────────────────────
    // Stays here: subtasks are a v1 concept and no other create surface
    // accepts a parent.
    const rawParentTaskId =
      typeof body.parentTaskId === 'string' && body.parentTaskId ? body.parentTaskId : null
    if (rawParentTaskId) {
      const parentError = await validateParentTask(rawParentTaskId)
      if (parentError) {
        return NextResponse.json({ error: parentError }, { status: 400 })
      }
    }

    // Board status at creation (task eb7fce2f). A ROLE, matching the update
    // route: the board's add-task form sends the target column here so a task
    // created on "Ready" lands on Ready — the column id must never travel
    // inside listIds, where it reads as a nonexistent list and 400s the write.
    const rawStatusRole =
      typeof body.statusRole === 'string' && body.statusRole.trim()
        ? body.statusRole.trim()
        : null

    const result = await createTaskWithSideEffects({
      input: {
        title: body.title,
        description: body.description,
        priority: body.priority,
        listIds: body.listIds,
        assigneeId: body.assigneeId,
        dueDateTime: body.dueDateTime,
        when: body.when,
        isAllDay: body.isAllDay,
        isPrivate: body.isPrivate,
        repeating: body.repeating,
        // The update route has accepted both since it shipped; create ignored
        // them, which made a repeating task impossible to file in one call —
        // and docs/FIXALL_WORKFLOW.md names exactly that as the alternative to
        // a cron (task ee44bc35). `customRepeatingData` is the service's name
        // for the same field; the wire name here matches the column and PUT.
        customRepeatingData: body.repeatingData,
        repeatFrom: body.repeatFrom,
        clientRequestId: body.clientRequestId,
        parentTaskId: rawParentTaskId,
        statusRole: rawStatusRole,
      },
      actorId: auth.userId,
      platform: detectPlatform(req),
      // v1's own rule: an assignee must already hold a role on one of the
      // task's lists, or arbitrary users could be assigned work. Legacy cannot
      // adopt it — its assign-by-email path mints a placeholder user who has
      // not accepted an invitation and is a member of nothing.
      requireAssigneeListMembership: true,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    return NextResponse.json(
      {
        task: narrowCreatedTaskForV1(result.task),
        meta: {
          apiVersion: 'v1',
          authSource: auth.source,
          ...(result.idempotent ? { idempotent: true } : {}),
        },
      },
      { status: result.idempotent ? 200 : 201, headers }
    )
  }
)

/**
 * The v1 wire shape for a created task.
 *
 * The service creates with one canonical include so that every surface writes
 * identical DB state, and that include is legacy's — the richest of the four.
 * It carries `list.owner` and `listMembers.user`, whole user records with
 * email addresses on them. Returning it here verbatim would newly publish
 * every list member's email to v1 API consumers, so this narrows back to the
 * exact shape v1 has always returned. Same row, unchanged contract.
 */
function narrowCreatedTaskForV1(task: CreatedTask) {
  const { lists, assignee, creator, comments, ...scalars } = task as unknown as Record<string, any>

  return {
    ...scalars,
    lists: (lists ?? []).map((list: any) => ({
      id: list.id,
      name: list.name,
      color: list.color,
      ownerId: list.ownerId,
      description: list.description,
      listMembers: (list.listMembers ?? []).map((member: any) => ({
        id: member.id,
        listId: member.listId,
        userId: member.userId,
        role: member.role,
      })),
    })),
    assignee: assignee
      ? {
          id: assignee.id,
          name: assignee.name,
          email: assignee.email,
          image: assignee.image,
          isAIAgent: assignee.isAIAgent,
          aiAgentType: assignee.aiAgentType,
        }
      : null,
    creator: creator
      ? {
          id: creator.id,
          name: creator.name,
          email: creator.email,
          image: creator.image,
          isAIAgent: creator.isAIAgent,
        }
      : null,
    // v1 has always returned bare comments; the canonical include hydrates
    // their authors for the SSE payload, which is not part of this contract.
    comments: (comments ?? []).map(({ author: _author, ...comment }: any) => comment),
  }
}
