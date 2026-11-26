import type { TaskList, User } from "@/types/task"
import { createLogger } from '@/lib/logger'
import { LIST_TYPE_LABEL } from '@/lib/list-flavors'

const log = createLogger('list-permissions')


/**
 * Minimal user interface for permission checks.
 * Accepts both full User objects and session user objects.
 */
interface UserLike {
  id: string
  email?: string | null
  name?: string | null
}

/**
 * Minimal list interface for permission checks.
 * Accepts both TaskList and Prisma query results.
 */
interface ListLike {
  // Needed to recognise built-in virtual lists (see isSystemListId).
  id?: string
  ownerId: string
  privacy?: string
  publicListType?: string | null
  listMembers?: Array<{
    userId: string
    role: string
    user?: { id: string; name?: string | null; email: string } | null
  }> | null
  owner?: { id: string; name?: string | null; email: string } | null
  // Legacy denormalized admins array. Some payloads carry only this (not
  // listMembers); ~8 inline call sites read it. astrid-core's listAccess unions it so
  // those sites can converge on this single source of truth (task e2803305).
  admins?: Array<{ id: string }> | null
  // Legacy denormalized members array, the sibling of `admins` above. Call
  // sites in task-detail read it directly; union it here so they can converge
  // on getUserRoleInList without losing access for those payloads.
  members?: Array<{ id: string }> | null
  // Project the list belongs to, when it has one. Project membership cascades
  // to every list in the project (task 6c20d125) — including its status lists,
  // which is what lets two people on one board agree about status.
  //
  // Absent `project` is NOT "no project access": it means the caller did not
  // load it. Call sites that need project-derived access must include the
  // relation (see PROJECT_ACCESS_INCLUDE), or they silently under-grant.
  projectId?: string | null
  // Distinguishes a status list (a board column) from a domain list. Only
  // status lists inherit access from sibling lists (astrid-core listAccess).
  listType?: string | null
  // A saved filter, whose contents are derived from filters rather than from
  // membership. Read only by isSavedFilterList / canUserBeAddedAsMember, which
  // treat absence as "a real list" — the permissive direction for reads, and
  // the one every caller that did not select the column lands on.
  isVirtual?: boolean | null
  // The list's agent config, as the Json column holds it. Read only by
  // listAllowsMemberAgentAssignment, which treats absence as "not opted in", so
  // a caller that did not select the column under-grants rather than over-grants.
  aiAgentsEnabled?: unknown
  project?: {
    id?: string
    ownerId?: string
    members?: Array<{ userId: string; role: string }> | null
    // The project's other lists, with their members. Used only to decide
    // access to *status* lists (task 142e4dd9).
    lists?: Array<{ id?: string; listMembers?: Array<{ userId: string }> | null }> | null
  } | null
}

/**
 * The decisions astrid-core's `listAccess` rule answers, by the name it gives them.
 *
 * astrid-core is the ONLY rule (ADEV-304, step B of
 * docs/architecture/CORE_RULES_FALLBACK_RETIREMENT.md): there is no TypeScript copy to fall back
 * to. Each public predicate below puts its question to the installed core (see
 * {@link setListPermissionsCore}) and returns its answer; a question the core cannot answer is a
 * refusal: no role, every predicate false.
 */
export type ListDecision =
  | "role"
  | "canEditTasks"
  | "canEditTask"
  | "hasExplicitRole"
  | "canManage"
  | "canManageMembers"
  | "canDelete"

type ListRoleAnswer = "owner" | "admin" | "member" | "viewer" | null

export interface ListDecisionQuestion {
  decision: ListDecision
  user: UserLike
  list: ListLike
  /** For `canEditTask` only: the task's creator. */
  taskCreatorId?: string | null
}

/**
 * Answers a question, or returns `undefined` when it cannot (which is then a refusal).
 */
export type ListPermissionsCore = (question: ListDecisionQuestion) => string | boolean | null | undefined

// On globalThis rather than in a module variable: Next compiles this module into several layers
// (route handlers, server components, instrumentation), each with its own copy of module state,
// and a core installed from instrumentation.ts has to reach all of them.
const CORE_KEY = Symbol.for("astrid.listPermissions.core")
type CoreHost = { [CORE_KEY]?: ListPermissionsCore | null }

/**
 * Install (or, with `null`, remove) astrid-core as the decider for every permission decision below.
 *
 * Where it is installed (ADEV-304):
 * - the Node server: lib/core-rules/list-permissions-core.ts from instrumentation.ts, which fails
 *   the boot if the core does not load (a server that refused everything would look up but be
 *   unusable);
 * - the browser: lib/core-rules/browser-list-permissions.ts once the browser door has loaded.
 *   Until then the app shell waits (components/core-rules-gate.tsx), so no affordance is drawn
 *   from a refusal that is only "not loaded yet";
 * - the token-based stdio MCP server (mcp/mcp-server-v2.ts), which refuses to start without it;
 * - tests, through tests/helpers/list-permissions-core.ts.
 *
 * The edge middleware asks no permission question (tests/middleware/middleware-edge-safety.test.ts
 * holds it to that), and nothing else keeps a TypeScript copy of the rule.
 *
 * A hook rather than an import because this module is pulled into client bundles, neither of which
 * may load WebAssembly from disk.
 */
export function setListPermissionsCore(core: ListPermissionsCore | null): void {
  ;(globalThis as CoreHost)[CORE_KEY] = core
}

/** Whether a decider is installed in this realm. False means every check below is refused. */
export function listPermissionsCoreInstalled(): boolean {
  return !!(globalThis as CoreHost)[CORE_KEY]
}

const ROLE_ANSWERS: ReadonlySet<unknown> = new Set(["owner", "admin", "member", "viewer", null])

function isValidAnswer(decision: ListDecision, answer: unknown): boolean {
  return decision === "role" ? ROLE_ANSWERS.has(answer) : typeof answer === "boolean"
}

/** The refusal: what a question the core cannot answer gets. Never a guess. */
function refusal(decision: ListDecision): null | false {
  return decision === "role" ? null : false
}

// Logged once per realm: a refusal because nothing is installed is either a page that has not
// loaded the browser door yet (the gate should have prevented that) or a server that lost its core.
let refusalLogged = false

function decided<T extends string | boolean | null>(
  decision: ListDecision,
  user: UserLike,
  list: ListLike,
  taskCreatorId?: string | null,
): T {
  const core = (globalThis as CoreHost)[CORE_KEY]
  if (!core) {
    if (!refusalLogged) {
      refusalLogged = true
      try {
        log.error({ decision }, "list permissions: astrid-core is not installed here; the check is refused")
      } catch {
        // Logging must not change the answer.
      }
    }
    return refusal(decision) as T
  }
  let answer: ReturnType<ListPermissionsCore>
  try {
    answer = core({ decision, user, list, taskCreatorId })
  } catch {
    // A core that throws must never allow or crash: the check is refused. The decider in
    // lib/core-rules/list-permissions-decider.ts logs and counts its own failures.
    return refusal(decision) as T
  }
  return answer === undefined || !isValidAnswer(decision, answer) ? (refusal(decision) as T) : (answer as T)
}

/**
 * Prisma `include` fragment for loading the project membership that
 * {@link getUserRoleInList} needs.
 *
 * Nested inside the existing list query on purpose: a separate round trip per
 * list would turn every list read into an N+1.
 */
export const PROJECT_ACCESS_INCLUDE = {
  project: {
    select: {
      id: true,
      ownerId: true,
      members: { select: { userId: true, role: true } },
      // Sibling lists' members, so a board's status lists can inherit access
      // from the domain lists people are actually shared on (task 142e4dd9).
      // Small: a project has one domain list today.
      lists: { select: { id: true, listMembers: { select: { userId: true } } } },
    },
  },
} as const

/**
 * The `where` clause for "lists this user can see" (task 6c20d125).
 *
 * Role resolution and *visibility* have to agree. `getUserRoleInList` granting a
 * project member access is useless if the query that fetches lists never
 * returns the row — the member would resolve a role for a list they can't load.
 * Both sides therefore derive from this one definition.
 *
 * Plain object literal, no Prisma import: this module is pulled into client
 * bundles.
 */
export function listVisibilityWhere(
  userId: string,
  options: {
    includePublic: boolean
    /**
     * The derived GitHub-label branch (AWTD-1193). Default on. Turn it off
     * where the result reaches every TASK on the list rather than the list
     * itself: a label is shared across boards, so seeing it does not mean
     * seeing each task carrying it (AWTD-1519; see listTasksByIdWhere).
     */
    includeDerivedLabels?: boolean
    /**
     * WRITE checks: a `viewer` ListMember row is a read-only seat
     * (AWTD-1318), so it must not count as the direct-membership route. A
     * viewer who also has a project role still matches through the project
     * branches, as `getUserRoleInList` raises them (AWTD-1644).
     */
    excludeViewers?: boolean
  }
) {
  // The ways a list is DIRECTLY the viewer's: owned, shared with them, or in a
  // project they own or belong to. Named because the label clause below reaches
  // a label list through one of these rather than repeating them.
  const direct: Array<Record<string, unknown>> = [
    { ownerId: userId },
    {
      listMembers: {
        some: options.excludeViewers
          ? // Case-insensitive: uppercase role rows exist (task e2803305).
            { userId, NOT: { role: { equals: "viewer", mode: "insensitive" } } }
          : { userId },
      },
    },
    // Project membership cascades to every list in the project, including its
    // status lists.
    { project: { ownerId: userId } },
    { project: { members: { some: { userId } } } },
  ]

  const clauses: Array<Record<string, unknown>> = [
    ...direct,
    // A board's status lists are visible to anyone shared on one of its domain
    // lists — that is how boards are actually shared (task 142e4dd9). Mirrors
    // the status-list branch of astrid-core's listAccess; the two must agree.
    {
      listType: "status",
      project: { lists: { some: { listMembers: { some: { userId } } } } },
    },
    // A GitHub label's list is visible to anyone who can see a task carrying
    // that label (AWTD-1193). It is owned by whoever's board met the label
    // first, sits in no project and has no members, so without this a board
    // member saw the label chip on a row and could not open the list behind it.
    //
    // DERIVED, not materialised as ListMember rows: a repo can feed several
    // boards, so access is the union over them, and detaching one board must
    // not revoke access another still grants. A stored row would have to get
    // that right on every detach; a derived clause cannot get it wrong.
    //
    // `remoteNodeId` keeps this to lists that MIRROR a GitHub label. A label
    // list someone converted from their own regular list (canConvertListFlavor)
    // has none, and must not be shared out to everyone who can see a task on it.
  ]
  if (options.includeDerivedLabels !== false) {
    clauses.push({
      listType: LIST_TYPE_LABEL,
      remoteNodeId: { not: null },
      tasks: { some: { lists: { some: { OR: direct } } } },
    })
  }

  // `includePublic` is explicit at every call site rather than defaulted: the
  // web list route has always returned PUBLIC lists and the v1 route never has,
  // and quietly changing either would alter what iOS syncs.
  if (options.includePublic) clauses.push({ privacy: "PUBLIC" as const })

  return { OR: clauses }
}

/**
 * The `where` for `GET /api/v1/lists/:id`: every list the index shows the
 * caller, plus any PUBLIC list.
 *
 * Built from {@link listVisibilityWhere} so opening one list agrees with the
 * list index (AWTD-1519). It used to be owner, member or PUBLIC only, so a
 * project member saw a project's list in `GET /api/v1/lists` and got 404 when
 * opening it. The batch existence check (AWTD-1515) reads this same clause, so
 * it calls a list missing exactly when this GET answers 404.
 *
 * PUBLIC stays, as legacy has always allowed it (`hasListAccess(...) ||
 * privacy === 'PUBLIC'`). Without it a signed-in non-member opening a public
 * list gets 404, which the list page renders as "List not found", to exactly
 * the audience a public list exists for. READ only: PUT and DELETE keep their
 * owner/admin gates. Same shape as the task-level fix in 92e582c6.
 */
export function listReadByIdWhere(userId: string) {
  return listVisibilityWhere(userId, { includePublic: true })
}

/**
 * The lists `GET /api/v1/tasks?listId=` may return EVERY task from: what
 * {@link listReadByIdWhere} opens, minus the derived GitHub-label branch.
 *
 * Seeing a mirrored label list only means seeing SOME task that carries the
 * label. The label is shared across boards, so all its tasks would include
 * tasks on private boards the caller has no part in (AWTD-1519 review). A
 * label list reached that way therefore lists no tasks here, as before; one
 * the caller owns or is a member of still does.
 */
export function listTasksByIdWhere(userId: string) {
  return listVisibilityWhere(userId, { includePublic: true, includeDerivedLabels: false })
}

/**
 * Convert Prisma TaskList result to TaskList interface
 * Handles null -> undefined conversions for optional fields
 */
export function prismaToTaskList(prismaList: Record<string, unknown>): TaskList {
  return {
    ...prismaList,
    color: (prismaList.color as string) || undefined,
    description: (prismaList.description as string) || undefined,
    defaultAssigneeId: (prismaList.defaultAssigneeId as string) || undefined,
    defaultAssignee: (prismaList.defaultAssignee as User) || undefined,
    defaultPriority: (prismaList.defaultPriority as TaskList['defaultPriority']) || undefined,
    defaultRepeating: (prismaList.defaultRepeating as TaskList['defaultRepeating']) || undefined,
    defaultIsPrivate: (prismaList.defaultIsPrivate as boolean) ?? undefined,
    defaultDueDate: (prismaList.defaultDueDate as TaskList['defaultDueDate']) || undefined,
    tasks: (prismaList.tasks as TaskList['tasks']) || undefined,
  } as TaskList
}

/**
 * List Permission Management
 *
 * Roles:
 * - Owner: Full control over the list (original creator)
 * - Admin: Can manage list settings and add/remove members (like managers)
 * - Member: Can add, edit, and manage tasks on the list
 * - Viewer: Can view tasks but not edit (for public lists)
 *
 * The rule itself is astrid-core's `listAccess` (crates/astrid-rules/src/permissions), canonical
 * there and locked by the core-generated permissions fixture (ADEV-304). These functions only put
 * the question; a behaviour change starts in astrid-core and reaches web by re-vendoring
 * packages/astrid-rules (scripts/build-astrid-rules.sh). Callers must load what the core reads:
 * `listMembers`, the owner, privacy and public type, and for project-derived access the project
 * ({@link PROJECT_ACCESS_INCLUDE}) — an absent project is "not loaded", which under-grants.
 */

export function getUserRoleInList(user: UserLike, list: ListLike): ListRoleAnswer {
  return decided<ListRoleAnswer>("role", user, list)
}

export function canUserEditTasks(user: UserLike, list: ListLike): boolean {
  return decided("canEditTasks", user, list)
}

/**
 * Task-like interface for permission checks.
 */
interface TaskLike {
  id?: string
  title?: string
  creatorId: string | null
}

/**
 * Check if a user can edit a specific task
 * For collaborative lists: only task creator, list admin, or list owner can edit
 * For copy-only lists: only list admin or owner can edit
 */
export function canUserEditTask(user: UserLike, task: TaskLike, list: ListLike): boolean {
  return decided("canEditTask", user, list, task?.creatorId)
}

/**
 * Does the user hold an explicit role on this list (owner, admin or member)?
 *
 * Distinct from canUserEditTasks, which additionally grants viewers on public
 * collaborative lists. Several call sites need the narrower question — e.g.
 * "should we apply an optimistic update?", where a collaborative-list viewer
 * must be excluded or the write 403s (task e2803305).
 */
export function hasExplicitListRole(user: UserLike, list: ListLike): boolean {
  return decided("hasExplicitRole", user, list)
}

export function canUserManageList(user: UserLike, list: ListLike): boolean {
  return decided("canManage", user, list)
}

export function canUserManageMembers(user: UserLike, list: ListLike): boolean {
  return decided("canManageMembers", user, list)
}

export function canUserDeleteList(user: UserLike, list: ListLike): boolean {
  return decided("canDelete", user, list)
}

export function getListPermissionDescription(role: "owner" | "admin" | "member" | "viewer" | null): string {
  switch (role) {
    case "owner":
      return "Full control over the list"
    case "admin":
      return "Can manage list settings and members"
    case "member":
      return "Can add, edit, and manage tasks"
    case "viewer":
      return "Can view tasks but not edit"
    default:
      return "No access"
  }
}

export function getAvailableRolesToAssign(currentUserRole: "owner" | "admin" | "member" | "viewer" | null): ("owner" | "admin" | "member" | "viewer")[] {
  switch (currentUserRole) {
    case "owner":
      return ["admin", "member", "viewer"]
    case "admin":
      return ["member", "viewer"]
    default:
      return []
  }
}

/**
 * Check if a user can assign a specific role to another user
 */
export function canAssignRole(
  currentUser: UserLike,
  list: ListLike,
  targetRole: "owner" | "admin" | "member" | "viewer"
): boolean {
  const currentUserRole = getUserRoleInList(currentUser, list)
  const availableRoles = getAvailableRolesToAssign(currentUserRole)
  return availableRoles.includes(targetRole)
}

/**
 * Get all users who have access to a list with their roles
 */
export function getListMembers(list: ListLike): Array<{ user: UserLike; role: "owner" | "admin" | "member" | "viewer" }> {
  const members: Array<{ user: UserLike; role: "owner" | "admin" | "member" | "viewer" }> = []

  // Add owner
  if (list.owner) {
    members.push({ user: list.owner, role: "owner" })
  }

  // Add users from listMembers table
  list.listMembers?.forEach((lm) => {
    if (lm.user) {
      members.push({
        user: lm.user,
        role: lm.role as "owner" | "admin" | "member" | "viewer"
      })
    }
  })

  return members
}

/**
 * Check if the list has shared access (has admins or members)
 */
export function isListShared(list: ListLike): boolean {
  return !!(list.listMembers && list.listMembers.length > 0)
}

/**
 * Get the appropriate privacy setting for a new task based on list permissions
 */
export function getTaskPrivacyForList(list: ListLike): boolean {
  // If list is shared with others, tasks should default to not private
  // If list is private to owner only, tasks should default to private
  return list.privacy === "PRIVATE" && !isListShared(list)
}
/**
 * Built-in virtual lists. These are views Astrid provides, not lists anyone
 * owns, so their settings are never editable.
 *
 * Previously spelled out in three places — task-manager-utils.isVirtualListId,
 * MainContent's popover guards, and ListSettingsHost — which is how the set
 * drifts (task e2803305).
 */
export const SYSTEM_LIST_IDS = ["my-tasks", "today", "not-in-list", "public", "assigned"] as const

export function isSystemListId(listId: string): boolean {
  return (SYSTEM_LIST_IDS as readonly string[]).includes(listId)
}

/**
 * May this user change a list's settings?
 *
 * Canonical home for what task-manager-utils.canEditListSettings used to do
 * independently. It layered its own owner fallback on top of
 * list-member-utils.isListAdminOrOwner, which disagreed with getUserRoleInList
 * for lists carrying `ownerId` without a matching member row — the owner was
 * denied. Built on the single role lookup, that whole class of disagreement
 * disappears.
 */
export function canEditListSettings(list: ListLike | null | undefined, userId?: string | null): boolean {
  if (!list || !userId) return false
  if (isSystemListId(String(list.id))) return false
  return canUserManageList({ id: userId }, list)
}

/** Minimal project shape for the project-level questions below. */
interface ProjectLike {
  ownerId: string
  members?: Array<{ userId: string; role: string }> | null
}

/**
 * This user's role on the project itself (AWTD-1693), or null. Unlike {@link getUserRoleInList}'s
 * project cascade (owner reads as list admin), its owner is its owner. Membership casing never
 * decides access (task e2803305).
 */
export function getUserRoleInProject(user: UserLike, project: ProjectLike | null | undefined): "owner" | "admin" | "member" | null {
  if (!user?.id || !project) return null
  if (project.ownerId === user.id) return "owner"
  const membership = project.members?.find((member) => member.userId === user.id)
  if (!membership) return null
  return membership.role?.toLowerCase() === "admin" ? "admin" : "member"
}

/** May this user change a project's own settings, e.g. its orchestration policy (AWTD-1693)? Owners and admins. */
export function canUserManageProject(user: UserLike, project: ProjectLike | null | undefined): boolean {
  const role = getUserRoleInProject(user, project)
  return role === "owner" || role === "admin"
}

/**
 * May this user point an AI agent at this task?
 *
 * A stricter question than "may they edit it", and deliberately so (task
 * 0672b69b). Assigning an agent spends the list's configured user's API key and,
 * when that user runs Claude Code Remote, executes code on their machine. Task
 * editing is open to every list member, so inheriting these rights from
 * canUserEditTask is what let a member point an agent at a task they did not
 * create and have someone else pay for the run.
 *
 * The rule, decided by Jon on 2026-09-08:
 *
 *  - the task's own creator may always assign, on a list they hold a role on;
 *  - owners and admins may assign on anyone's task;
 *  - a plain member may assign on someone else's task only where the list has
 *    opted in (`aiAgentsEnabled.allowMemberAssignment`);
 *  - viewers never may, opt-in or not.
 *
 * A task on NO list has no list to consent for it, and nobody but its creator
 * can see it — so there it is the creator's own business.
 */
export function canUserAssignAgentToTask(
  user: UserLike,
  task: TaskLike,
  list: ListLike | null | undefined,
): boolean {
  const isCreator = !!task.creatorId && task.creatorId === user.id

  if (!list) return isCreator

  const role = getUserRoleInList(user, list)
  if (role === "owner" || role === "admin") return true
  if (role !== "member") return false

  if (isCreator) return true

  return listAllowsMemberAgentAssignment(list)
}

/**
 * Has this list opted its plain members into assigning agents on tasks they did
 * not create?
 *
 * Stored as a key on the existing `aiAgentsEnabled` Json column rather than a
 * new schema column: that column is already an object read through one
 * normaliser, so the opt-in needs no Prisma migration running against
 * production for a flag that nothing yet toggles. Absent means NOT opted in —
 * the safe direction, and the one every existing row lands on.
 */
export function listAllowsMemberAgentAssignment(list: ListLike | null | undefined): boolean {
  const stored = list?.aiAgentsEnabled
  if (!stored) return false

  const value = typeof stored === "string" ? safeJsonParse(stored) : stored
  if (!value || typeof value !== "object" || Array.isArray(value)) return false

  return (value as Record<string, unknown>).allowMemberAssignment === true
}

/**
 * Is this list a SAVED FILTER (a "virtual" list) rather than a real list of
 * tasks people were added to?
 *
 * A saved filter has no membership of its own — its contents are derived by
 * applying its filters to everything the viewer can already see
 * (lib/virtual-list-utils.ts).
 */
export function isSavedFilterList(list: { isVirtual?: boolean | null } | null | undefined): boolean {
  return list?.isVirtual === true
}

/**
 * May this principal be added as a member of this list?
 *
 * **A saved filter accepts AI agents only** (Jon, 2026-09-13, task aa4e7eb0:
 * "disable adding non-AI members to saved filters").
 *
 * The reason is what per-user filters did to the meaning of sharing one. A
 * saved filter's contents come from the VIEWER's own filters applied to the
 * tasks the viewer can see, so adding a person to one promises something it
 * cannot deliver: they would not see the list you see, and nothing about
 * their membership would make them. Adding them is therefore not a
 * restriction worth explaining — it is an operation with no coherent result.
 *
 * AI agents stay eligible because agent membership is not about seeing a
 * shared view: it is how an agent is granted access to act on a list at all,
 * which is exactly the `ai-agent-*` principal the queue and the MCP server
 * depend on.
 *
 * Says nothing about members a saved filter already has — this gates ADDING.
 */
export function canUserBeAddedAsMember(
  candidate: { isAIAgent?: boolean | null } | null | undefined,
  list: { isVirtual?: boolean | null } | null | undefined
): boolean {
  if (!isSavedFilterList(list)) return true
  return candidate?.isAIAgent === true
}

/** One phrasing of the refusal, so the three call sites cannot drift. */
export const SAVED_FILTER_MEMBER_ERROR =
  'A saved filter shows each person the results of their own filters, so people cannot be added to one. Only AI agents can be added to a saved filter.'

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}
