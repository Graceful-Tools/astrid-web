/**
 * The columns that are `String` in Prisma but have a closed set of values
 * (task e16e9b94).
 *
 * TypeScript unions plus validation at the API boundary, NOT a Postgres enum.
 * The audit that decided it, over the v1 API — 13 lists, 34 memberships, 373
 * tasks, one account rather than a census:
 *
 *   - `ListMember.role` comes back as `owner`, and no row holds that.
 *     `app/api/v1/lists/[id]/members/route.ts` synthesises it from
 *     `list.ownerId`. The wire vocabulary and the column vocabulary are
 *     different sets, so an enum could constrain only one of them and the
 *     response type would stay a TS union regardless.
 *   - Uppercase `'MEMBER'` rows already exist, written by app/api/v1/lists
 *     before it was fixed (task e2803305). `ALTER COLUMN … USING` fails on
 *     those, so the schema change is really a data migration plus lock-taking
 *     DDL against live rows — for a column whose readers already agree.
 *
 * The shape follows `lib/closed-reason.ts`, which already does this well: a
 * const tuple, an `is` guard, and a `parse` that returns an ERROR rather than a
 * silent null. That distinction is the whole point — as that file puts it, a
 * typo'd value must not quietly become something else.
 *
 * NOT here, deliberately:
 *
 *   - `Task.statusRole` is a board COLUMN ID, not an enum. `ready` and `doing`
 *     look like one because they are the default column names, but
 *     `lib/project-status.ts` writes `column.id` for user-defined columns.
 *     Enumerating it would break custom board columns.
 *   - the `TaskList.filter*` columns are a filter DSL — `filterAssignee` holds
 *     a user id.
 *   - `costEstimateSource` and `reminderType` are null in every row the audit
 *     could see. With no evidence of the intended set, inventing one would be
 *     a guess enforced on real data.
 */

/** Result shape shared with parseClosedReason, so callers read the same way. */
type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

function fail<T>(field: string, allowed: readonly string[]): ParseResult<T> {
  return { ok: false, error: `${field} must be one of: ${allowed.join(', ')}` }
}

// ─── Task.repeating ───────────────────────────────────────────────────────

/**
 * How a task repeats. `custom` defers to `Task.repeatingData`.
 *
 * The column where a bad value does real damage: it drives the roll-forward
 * calculator, so a value outside this set is how a repeating series silently
 * stops repeating.
 */
export const REPEATING_VALUES = ['never', 'daily', 'weekly', 'monthly', 'yearly', 'custom'] as const

export type Repeating = (typeof REPEATING_VALUES)[number]

export function isRepeating(value: unknown): value is Repeating {
  return typeof value === 'string' && (REPEATING_VALUES as readonly string[]).includes(value)
}

/**
 * Normalise a `repeating` from an API body.
 *
 * `undefined` means the client did not mention the field — leave it alone.
 * `null` or `''` means the client cleared it, which for a NOT NULL column with
 * a default means "not repeating".
 */
export function parseRepeating(input: unknown): ParseResult<Repeating | undefined> {
  if (input === undefined) return { ok: true, value: undefined }
  if (input === null || input === '') return { ok: true, value: 'never' }
  if (!isRepeating(input)) return fail('repeating', REPEATING_VALUES)
  return { ok: true, value: input }
}

// ─── Task.completedSource ─────────────────────────────────────────────────

/**
 * Where a completion happened. An audit field, so a value nothing wrote is
 * worse than no value at all.
 */
export const COMPLETED_SOURCES = ['astrid', 'google', 'github', 'apple'] as const

export type CompletedSource = (typeof COMPLETED_SOURCES)[number]

export function isCompletedSource(value: unknown): value is CompletedSource {
  return typeof value === 'string' && (COMPLETED_SOURCES as readonly string[]).includes(value)
}

/** Null is legitimate: every row completed before provenance existed holds it. */
export function parseCompletedSource(input: unknown): ParseResult<CompletedSource | null> {
  if (input === undefined || input === null || input === '') return { ok: true, value: null }
  if (!isCompletedSource(input)) return fail('completedSource', COMPLETED_SOURCES)
  return { ok: true, value: input }
}

// ─── TaskList.listType / publicListType ───────────────────────────────────

/** `status` marks a board column; everything else is a domain list. */
export const LIST_TYPES = ['regular', 'status'] as const
export type ListType = (typeof LIST_TYPES)[number]

export function isListType(value: unknown): value is ListType {
  return typeof value === 'string' && (LIST_TYPES as readonly string[]).includes(value)
}

/**
 * What a PUBLIC list allows. Absent means `copy_only` — `canUserEditTasks`
 * treats a null the same as copy-only, so the default is the restrictive one.
 */
export const PUBLIC_LIST_TYPES = ['copy_only', 'collaborative'] as const
export type PublicListType = (typeof PUBLIC_LIST_TYPES)[number]

export function isPublicListType(value: unknown): value is PublicListType {
  return typeof value === 'string' && (PUBLIC_LIST_TYPES as readonly string[]).includes(value)
}

// ─── ListMember.role ──────────────────────────────────────────────────────

/**
 * The roles a ListMember ROW may hold.
 *
 * `owner` is deliberately absent: it is synthesised into the members response
 * from `list.ownerId` and no row carries it. Including it here would make this
 * validator accept a value that cannot be stored.
 */
export const LIST_MEMBER_ROLES = ['admin', 'member'] as const
export type ListMemberRole = (typeof LIST_MEMBER_ROLES)[number]

/**
 * Case-insensitive on purpose.
 *
 * Uppercase `'MEMBER'` rows exist in the database already, and
 * `getUserRoleInList` lowercases on read for exactly that reason (task
 * e2803305). A case-sensitive validator would 400 on real data — which is the
 * failure mode a stricter-looking rule produces here.
 */
export function isListMemberRole(value: unknown): value is ListMemberRole {
  return (
    typeof value === 'string' &&
    (LIST_MEMBER_ROLES as readonly string[]).includes(value.toLowerCase())
  )
}
