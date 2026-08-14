/**
 * Canonical iOS-facing REQUEST shapes for /api/v1/* write endpoints.
 *
 * The mirror of `v1-ios-shapes.ts`, which does this for responses. That file's
 * reasoning applies in both directions: iOS talks to /api/v1/* directly, and
 * shape drift is silent breakage in production. Responses got the treatment
 * first; requests are the side that has been running untyped. (Task 87e19910.)
 *
 * The concrete bug this prevents
 * ------------------------------
 * `app/api/v1/tasks/[id]/route.ts` PUT is sixty lines of
 *
 *     if (body.x !== undefined) data.x = body.x
 *
 * against an untyped `body` and a `const data: any = {}`. A typo in either name
 * is not a compile error — it is a field that silently never updates, and the
 * request still returns 200. Typing `body` makes the left-hand typo a build
 * failure; typing the Prisma update payload makes the right-hand one fail too.
 *
 * How to use these
 * ----------------
 * At the top of a handler:
 *
 *     const body = (await req.json()) as V1TaskUpdateRequest
 *
 * That is a claim, not a validation — see the note below. It buys compile-time
 * checking of every subsequent `body.field` reference, which is the class of
 * error this task is about.
 *
 * These are NOT validation
 * -----------------------
 * A cast cannot make a client honest. `title` typed as `string` will still be a
 * number at runtime if a caller sends one. These types catch OUR mistakes —
 * misspelled fields, fields that no longer exist, fields we forgot to handle —
 * not theirs. Where a value must be checked at runtime (ids, enums, numeric
 * bounds), the handler still has to check it, and several already do.
 *
 * Optionality means "may be omitted", and omission means "leave unchanged"
 * across every one of these PATCH-style bodies. That is why every field is
 * optional and why `null` is spelled out wherever it is a meaningful value
 * rather than an absence — `assigneeId: string | null` genuinely means "set an
 * assignee, or unassign", and collapsing that to `string | undefined` would
 * lose the ability to clear it.
 */

// ── Tasks ─────────────────────────────────────────────────────────────

/**
 * PUT /api/v1/tasks/:id
 *
 * Every field is optional: absent means "do not touch". The nulls are load
 * bearing and each means something different from absence.
 */
export interface V1TaskUpdateRequest {
  title?: string
  description?: string
  priority?: number
  completed?: boolean

  /**
   * ISO 8601, or `null`/`''` to clear the due date — clearing also forces
   * `isAllDay` back to false, since an all-day flag on no date is meaningless.
   */
  dueDateTime?: string | null
  /**
   * Sent alongside `dueDateTime` it decides whether the time is truncated to
   * UTC midnight; sent alone it just flips the flag.
   */
  isAllDay?: boolean

  isPrivate?: boolean
  repeating?: string | null
  repeatingData?: Record<string, unknown> | null
  repeatFrom?: string | null

  /** `null` unassigns. Membership is validated server-side against the task's lists. */
  assigneeId?: string | null

  timerDuration?: number | null
  lastTimerValue?: number | null

  /** `null` or `''` promotes a subtask to top level. Cycles are rejected server-side. */
  parentTaskId?: string | null

  /** Full replacement, not a delta. Access to every id is validated before connecting. */
  listIds?: string[]

  /** Board-column semantics; see the status handling in the route. */
  statusRole?: string | null
  closedReason?: string | null
}

/**
 * POST /api/v1/tasks
 *
 * Field set read off the handler, and it is NARROWER than the update shape in
 * two ways worth stating rather than leaving to be discovered:
 *
 * - `completed`, `repeatingData` and `repeatFrom` are accepted on PUT but
 *   IGNORED here. Create hardcodes `completed: false`. Declaring them would
 *   invite a client to send them and expect them to stick.
 * - `when` exists only here — a legacy alias older clients still send, treated
 *   as an all-day date at UTC midnight.
 */
export interface V1TaskCreateRequest {
  title: string
  description?: string
  priority?: number
  dueDateTime?: string | null
  /**
   * Legacy alias for `dueDateTime`, still sent by older clients. Always
   * interpreted as all-day and truncated to UTC midnight, and only consulted
   * when `dueDateTime` is absent.
   */
  when?: string | null
  isAllDay?: boolean
  isPrivate?: boolean
  repeating?: string | null
  assigneeId?: string | null
  parentTaskId?: string | null
  listIds?: string[]
  /** Offline-retry idempotency key, 8–128 chars. See lib/comment-idempotency.ts. */
  clientRequestId?: string
}

// ── Comments ──────────────────────────────────────────────────────────

/**
 * Mirrors the `CommentType` enum in schema.prisma.
 *
 * A union rather than `string`, for the same reason as V1ListPrivacy: the
 * value reaches a Postgres enum column directly, so a loose type turns a bad
 * request into a Prisma driver error — a 500 where the caller deserved a 400.
 * types/api.ts has carried this union for the legacy route all along; the v1
 * shape file said `string`, and typing the route is what surfaced the gap.
 * (Task 87e19910.)
 */
export type V1CommentType = 'TEXT' | 'MARKDOWN' | 'ATTACHMENT'

export const V1_COMMENT_TYPE_VALUES: readonly V1CommentType[] = ['TEXT', 'MARKDOWN', 'ATTACHMENT']

export function isV1CommentType(value: unknown): value is V1CommentType {
  return typeof value === 'string' && (V1_COMMENT_TYPE_VALUES as readonly string[]).includes(value)
}

/** POST /api/v1/tasks/:id/comments */
export interface V1CommentCreateRequest {
  /**
   * REQUIRED on this route, and present-as-a-string at that — unlike its two
   * siblings. Legacy POST /api/tasks/:id/comments and the v1 chat message
   * route both accept an attachment-only body with `content` absent; this one
   * rejects it with 400 "content must be a string" before the fileId branch is
   * ever reached. Typed accordingly rather than aspirationally: an optional
   * `content` here would describe a request the route does not accept.
   */
  content: string
  type?: V1CommentType
  /** SecureFile id to attach. Only files uploaded by the caller may be linked. */
  fileId?: string
  parentCommentId?: string | null
  aiAgentId?: string
  /** Offline-retry idempotency key, 8–128 chars. */
  clientRequestId?: string
  /** Backdating, used when replaying queued offline writes. */
  createdAt?: string
}

/** PUT /api/v1/comments/:id — author only, and whitespace-only content is rejected. */
export interface V1CommentUpdateRequest {
  content: string
}

// ── Lists ─────────────────────────────────────────────────────────────

/**
 * Mirrors the `TaskListPrivacy` enum in schema.prisma.
 *
 * Spelled out as a union rather than typed `string`, because these values reach
 * a Postgres enum column directly. Typing it loosely is how POST /api/v1/lists
 * came to accept any string for `privacy` and hand it to Prisma, which rejects
 * it as a driver error — a 500 where the caller deserved a 400. (Task 87e19910.)
 */
export type V1ListPrivacy = 'PRIVATE' | 'SHARED' | 'PUBLIC'

export const V1_LIST_PRIVACY_VALUES: readonly V1ListPrivacy[] = ['PRIVATE', 'SHARED', 'PUBLIC']

export function isV1ListPrivacy(value: unknown): value is V1ListPrivacy {
  return typeof value === 'string' && (V1_LIST_PRIVACY_VALUES as readonly string[]).includes(value)
}

/** PUT /api/v1/lists/:id */
export interface V1ListUpdateRequest {
  name?: string
  description?: string
  color?: string
  imageUrl?: string | null
  privacy?: V1ListPrivacy
  publicListType?: string | null
  sortBy?: string | null
  manualSortOrder?: string[] | null
  showSubtasks?: boolean
  /**
   * Three-way, not a plain user id: `null` means "whoever creates the task"
   * and the literal `'unassigned'` means nobody. See lib/task-batch-copy.ts,
   * where collapsing those two cost a bug.
   */
  defaultAssigneeId?: string | null
  defaultPriority?: number | null
  defaultRepeating?: string | null
  defaultIsPrivate?: boolean | null
  defaultDueDate?: string | null
  defaultDueTime?: string | null
  isFavorite?: boolean
}

/**
 * POST /api/v1/lists
 *
 * Field set read off the handler rather than assumed — the first draft of this
 * interface listed five fields and the route accepts fourteen, which is the
 * same class of mistake this whole file exists to catch.
 */
export interface V1ListCreateRequest {
  name: string
  description?: string
  color?: string
  imageUrl?: string | null
  privacy?: V1ListPrivacy
  publicListType?: string | null

  /** Same three-way meaning as on update: null = task creator, 'unassigned' = nobody. */
  defaultAssigneeId?: string | null
  defaultPriority?: number | null
  defaultRepeating?: string | null
  defaultIsPrivate?: boolean | null
  defaultDueDate?: string | null

  githubRepositoryId?: string | null
  preferredAiProvider?: string | null

  /** Members to seed the list with, added alongside the owner at creation. */
  memberIds?: string[]
}

/** POST /api/v1/lists/:id/invite */
export interface V1ListInviteRequest {
  email: string
  /** Only these two are grantable by invitation — see lib/list-invite.ts. */
  role: 'admin' | 'member'
  message?: string
}

/** POST /api/v1/lists/:id/copy */
export interface V1ListCopyRequest {
  includeTasks?: boolean
  newName?: string
  /** Keep the original assignees rather than reassigning to the copier. */
  preserveTaskAssignees?: boolean
  /** Default true. `false` brings the tasks across unassigned. */
  assignToUser?: boolean
}

// ── Copy ──────────────────────────────────────────────────────────────

/** POST /api/v1/tasks/:id/copy — single target. */
export interface V1TaskCopyRequest {
  targetListId?: string
  preserveDueDate?: boolean
  preserveAssignee?: boolean
  includeComments?: boolean
}

/** POST /api/v1/tasks/copy — one task into several lists. */
export interface V1TaskBatchCopyRequest {
  taskId: string
  targetListIds: string[]
  /**
   * Explicitly provided assigneeId wins over the target list's default,
   * INCLUDING an explicit `null`. Distinguishing "sent null" from "omitted" is
   * the whole reason lib/task-batch-copy.ts takes a separate `assigneeProvided`
   * flag rather than testing this for null.
   */
  assigneeId?: string | null
}
