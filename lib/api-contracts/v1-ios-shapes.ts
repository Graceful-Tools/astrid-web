/**
 * Canonical iOS-facing response shapes for /api/v1/* endpoints.
 *
 * Why: iOS consumes /api/v1/* directly. Shape drift = silent breakage in
 * production. These interfaces are the contract. Routes should `satisfies`
 * them at the response site so tsc enforces conformance at build time.
 *
 * Scope: only routes the iOS app actively calls. Tasks + comments live in
 * `lib/agent-protocol.ts` (AgentTask / AgentComment) — those predate this
 * file. Everything else lives here.
 *
 * Tests in `tests/api/v1-contract.test.ts` pin the key sets via
 * `as const satisfies ReadonlyArray<keyof T>`. Removing or renaming a key
 * fails the test loudly. Adding a key is fine — but it must also be added
 * to the test's expected-key array, which is the deliberate gate that
 * prevents accidental shape sprawl.
 *
 * Touching any of these shapes implies a coordinated iOS release. Don't
 * silence the tests; bump the iOS minimum version and ship the change in
 * lockstep.
 */

// ── Shared meta block ─────────────────────────────────────────────────

/**
 * The `meta` block every v1 response carries. iOS uses these for
 * incremental-sync coordination and deprecation telemetry.
 */
export interface V1ResponseMeta {
  apiVersion: 'v1'
  authSource: string
}

export interface V1ListResponseMeta extends V1ResponseMeta {
  total: number
  timestamp: string
  isIncremental: boolean
}

export interface V1ScopedMeta extends V1ResponseMeta {
  total?: number
  taskId?: string
  count?: number
  sortBy?: string
}

// ── Lists ─────────────────────────────────────────────────────────────

/**
 * A single list as returned by /api/v1/lists/[id] and as an element of
 * the array returned by /api/v1/lists. iOS persists this shape locally;
 * a key removal here cascades into a UI/data-layer migration on iOS.
 */
export interface V1List {
  id: string
  ownerId: string
  name: string
  description: string
  color: string
  imageUrl: string | null
  privacy: string
  isFavorite: boolean
  favoriteOrder: number | null
  owner: V1UserSummary | null
  listMembers: V1ListMembership[]
  invitations: V1ListInvitation[]
  taskCount: number
  isVirtual: boolean
  virtualListType: string | null
  sortBy: string | null
  manualSortOrder: unknown
  filterPriority: unknown
  filterAssignee: unknown
  filterDueDate: unknown
  filterCompletion: unknown
  filterRepeating: unknown
  filterAssignedBy: unknown
  filterInLists: unknown
  defaultPriority: number | null
  defaultRepeating: string | null
  defaultAssigneeId: string | null
  /**
   * The resolved user, not just the id. Legacy /api/lists enriches its raw
   * rows the same way; without it a client holds an id it has no user for and
   * every assignee name and avatar renders blank. (Task dc143ab2)
   */
  defaultAssignee: V1UserSummary | null
  /** Agent config: legacy array, or { enabledTypes, defaultAgentId }. */
  aiAgentsEnabled: unknown
  publicListType: string | null
  defaultIsPrivate: boolean | null
  defaultDueDate: string | null
  // Only the PUT /lists/:id response currently emits this; optional so the
  // GET/collection responses (which omit it) still satisfy the shape.
  defaultDueTime?: string | null
  githubRepositoryId: string | null
  preferredAiProvider: string | null
  // Project status board fields. `null` for lists that don't belong to a
  // project (the common case for legacy lists). When `projectId` is set,
  // iOS treats the list as a project-domain list (listType "regular") or
  // a status-board column (listType "status").
  projectId: string | null
  listType: 'regular' | 'status'
  statusRole: 'inbox' | 'ready' | 'doing' | 'waiting' | 'done' | 'custom' | null
  statusOrder: number | null
  statusDescription: string | null
  statusCompleted: boolean
  // Per-list "Recently completed" window config. null = legacy 24h default.
  // Shape mirrors lib/recently-completed-window.ts → RecentlyCompletedWindow.
  recentlyCompletedWindow: unknown
  createdAt: string | Date
  updatedAt: string | Date
}

export interface V1UserSummary {
  id: string
  name: string | null
  email: string
  image: string | null
  isAIAgent: boolean
  aiAgentType: string | null
}

export interface V1ListMembership {
  listId?: string
  userId?: string
  role: string
  user: V1UserSummary
}

export interface V1ListInvitation {
  id: string
  listId: string
  email: string
  role: string
  token?: string
  createdAt: string | Date
  createdBy: string | null
}

export interface V1ListsResponse {
  lists: V1List[]
  meta: V1ListResponseMeta
}

export interface V1ListResponse {
  list: V1List
  meta: V1ResponseMeta
}

// ── Projects (status boards) ──────────────────────────────────────────

/**
 * A single project as returned by /api/v1/projects (collection) and
 * /api/v1/projects/[id] (single). iOS uses this to render the board.
 *
 * `lists` is the project's domain lists (listType "regular") plus the
 * user's per-user global status columns (listType "status",
 * `projectId: null`, shared across every project board). The same V1List
 * shape is used for both so iOS doesn't need a second decoder. Sort by
 * `listType` then `statusOrder` for board column ordering.
 */
export interface V1Project {
  id: string
  name: string
  description: string | null
  color: string
  imageUrl: string | null
  ownerId: string
  owner: V1UserSummary | null
  members: V1ProjectMember[]
  lists: V1List[]
  createdAt: string | Date
  updatedAt: string | Date
}

export interface V1ProjectMember {
  projectId?: string
  userId?: string
  role: string
  user: V1UserSummary
}

export interface V1ProjectsResponse {
  projects: V1Project[]
  meta: V1ResponseMeta
}

export interface V1ProjectResponse {
  project: V1Project
  meta: V1ResponseMeta
}

// ── List members ──────────────────────────────────────────────────────

/**
 * Member shape used by /api/v1/lists/[id]/members. Distinct from the
 * V1ListMembership embedded in V1List — this is the dedicated GET shape
 * with role flags pre-derived for iOS.
 */
export interface V1ListMember {
  id: string
  name: string | null
  email: string
  image: string | null
  role: string
  isOwner: boolean
  isAdmin: boolean
  type?: string
}

export interface V1MembersResponse {
  members: V1ListMember[]
  meta: V1ResponseMeta
}

export interface V1MemberMutationResponse {
  message: string
  member: V1ListMember
  meta: V1ResponseMeta
}

// ── Comments ──────────────────────────────────────────────────────────

/**
 * Comment shape returned by both /api/v1/comments/[id] and
 * /api/v1/tasks/[id]/comments. iOS uses the same decoder for both.
 */
export interface V1Comment {
  id: string
  content: string
  type?: string | null
  authorId: string
  author: V1UserSummary | null
  secureFiles?: V1SecureFileSummary[]
  createdAt: string | Date
  updatedAt: string | Date
}

export interface V1SecureFileSummary {
  id: string
  filename: string
  contentType: string | null
  size: number | null
  url?: string
}

export interface V1CommentResponse {
  comment: V1Comment
  meta: V1ResponseMeta
}

export interface V1CommentsResponse {
  comments: V1Comment[]
  meta: V1ScopedMeta
}

// ── Users me settings ─────────────────────────────────────────────────

/**
 * Reminder settings as returned by GET/PUT /api/v1/users/me/settings.
 * iOS's reminder configuration UI binds directly to this shape.
 */
export interface V1ReminderSettings {
  enablePushReminders: boolean
  enableEmailReminders: boolean
  defaultReminderTime: number
  enableDailyDigest: boolean
  dailyDigestTime: string
  dailyDigestTimezone: string
  quietHoursStart: string | null
  quietHoursEnd: string | null
}

export interface V1MeSettingsResponse {
  settings: {
    reminderSettings: V1ReminderSettings
  }
  meta: V1ResponseMeta
}

// ── Public lists ──────────────────────────────────────────────────────

/**
 * Public-list shape returned by /api/v1/public/lists for the discovery
 * feed. Distinct from V1List — strips fields not safe to expose
 * unauthenticated, adds memberCount.
 */
export interface V1PublicList {
  id: string
  name: string
  description: string
  color: string
  privacy: string
  publicListType: string | null
  imageUrl: string | null
  createdAt: string | Date
  updatedAt: string | Date
  owner: V1UserSummary | null
  admins: V1UserSummary[]
  taskCount: number
  memberCount: number
}

export interface V1PublicListsResponse {
  lists: V1PublicList[]
  meta: V1ScopedMeta
}

// ── Shortcodes ────────────────────────────────────────────────────────

/**
 * Shortcode shape returned by /api/v1/shortcodes. iOS uses this for
 * share-sheet generation.
 */
export interface V1Shortcode {
  code: string
  targetType: string
  targetId: string
  url: string
}

export interface V1ShortcodeResponse {
  shortcode: V1Shortcode
  meta: V1ResponseMeta
}

export interface V1ShortcodesResponse {
  shortcodes: V1Shortcode[]
  meta: V1ScopedMeta
}

// ── Users ─────────────────────────────────────────────────────────────

/**
 * Search-result user shape returned by /api/v1/users/search. Differs
 * from V1UserSummary by including the iOS-derived flags
 * `isListMember` and `isCodingAgent` used to drive the quick-pick UI.
 */
export interface V1UserSearchResult {
  id: string
  name: string | null
  email: string
  image: string | null
  isAIAgent?: boolean
  aiAgentType?: string | null
  isListMember?: boolean
  isCodingAgent?: boolean
}

export interface V1UsersSearchResponse {
  users: V1UserSearchResult[]
  listMemberCount: number
  meta: V1ResponseMeta
}

/**
 * Response for /api/v1/users/[userId]/profile — public-profile view
 * with derived stats and recent shared-task list.
 */
export interface V1UserProfileResponse {
  user: {
    id: string
    name: string | null
    email: string
    image: string | null
    createdAt: string | Date
    isAIAgent: boolean
    aiAgentType: string | null
  }
  stats: {
    completed: number
    inspired: number
    supported: number
  }
  sharedTasks: unknown[]
  isOwnProfile: boolean
  meta: V1ResponseMeta
}

// ── Reminders ─────────────────────────────────────────────────────────

/**
 * Embedded task summary in a v1 reminder. Mirrors the legacy
 * LegacyReminderTask shape so iOS's task-summary decoder can be reused.
 */
export interface V1ReminderTask {
  id: string
  title: string
  description: string | null
  dueDateTime: string | Date | null
  priority: number | null
  completed: boolean
  listNames: string[]
}

/**
 * v1 Reminder shape returned by /api/v1/reminders. Same body keys as
 * LegacyReminder; the v1 envelope adds `meta` for consistency with the
 * rest of the v1 surface.
 */
export interface V1Reminder {
  id: string
  type: string
  scheduledFor: string | Date
  retryCount: number
  snoozeCount: number
  task: V1ReminderTask | null
}

export interface V1RemindersResponse {
  reminders: V1Reminder[]
  summary: Record<string, number>
  total: number
  meta: V1ResponseMeta
}

export interface V1ReminderDismissResponse {
  success: true
  dismissedCount: number
  meta: V1ResponseMeta
}

export interface V1ReminderSnoozeResponse {
  success: true
  scheduledFor: string | Date
  snoozeCount: number
  meta: V1ResponseMeta
}

// ── Generic message/delete responses ──────────────────────────────────

export interface V1MessageResponse {
  message: string
  meta: V1ResponseMeta
}

export interface V1DeleteResponse {
  success: true
  message: string
  meta: V1ResponseMeta
}

// ── Auth ──────────────────────────────────────────────────────────────

/**
 * Common user payload returned by Apple/Google sign-in and mobile-session.
 * Mirrors the `user` object from legacy /api/auth/{apple,google,mobile-session}.
 */
export interface V1AuthUser {
  id: string
  email: string | null
  name: string | null
  image: string | null
}

export interface V1AuthSignInResponse {
  user: V1AuthUser
  meta: V1ResponseMeta
}

export interface V1AuthSessionResponse {
  user: V1AuthUser
  meta: V1ResponseMeta
}

export interface V1MobileMcpTokenResponse {
  token: string
  userId: string
  meta: V1ResponseMeta
}

export interface V1MobileMcpTokenRevokeResponse {
  success: true
  meta: V1ResponseMeta
}
