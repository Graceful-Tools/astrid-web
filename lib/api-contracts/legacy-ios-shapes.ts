/**
 * Canonical iOS-facing response shapes for legacy /api/* endpoints.
 *
 * Why: Phase 1 of the v1 migration extracts shared handlers between
 * legacy and v1 routes. Without these contracts, an extraction can
 * silently change the legacy response shape and break iOS clients that
 * haven't migrated yet.
 *
 * These contracts will be DELETED at the end of Phase 4 (legacy removal)
 * along with the routes themselves. Until then, they're load-bearing.
 *
 * Pattern matches `lib/api-contracts/v1-ios-shapes.ts` — interfaces here,
 * key-set enforcement in `tests/api/legacy-contract.test.ts`.
 *
 * Notes:
 * - Many legacy endpoints return RAW models (Task, User, Comment) without
 *   an envelope. We reference the canonical types in `types/task.ts`.
 * - Wrapped envelopes (e.g. `{ tasks, timestamp, isIncremental, count }`)
 *   get explicit interfaces here.
 * - Fields like `Date | string` reflect the wire reality: Prisma Dates
 *   serialize to ISO strings via JSON.stringify; the iOS decoder accepts
 *   both. Don't tighten without coordination.
 */

import type { User, Task, TaskList } from '@/types/task'

// ── Tasks ─────────────────────────────────────────────────────────────

/**
 * GET /api/tasks — paginated/incremental list response.
 * iOS uses `timestamp` for incremental-sync coordination.
 */
export interface LegacyTasksListResponse {
  tasks: Task[]
  timestamp: string
  isIncremental: boolean
  count: number
}

/**
 * POST /api/tasks/[id]/copy — single-task copy with success envelope.
 */
export interface LegacyTaskCopyResponse {
  success: true
  task: Task
  message: string
}

// POST /api/tasks (single create) and GET/PUT /api/tasks/[id] return
// raw Task. POST /api/tasks/copy returns raw Task (not array). No
// envelope contract to pin beyond the Task type itself.

// ── Lists ─────────────────────────────────────────────────────────────

/**
 * GET /api/lists — same envelope shape as /api/tasks.
 */
export interface LegacyListsListResponse {
  lists: TaskList[]
  timestamp: string
  isIncremental: boolean
  count: number
}

/**
 * POST /api/lists/[id]/invite — single-invitation result.
 */
export interface LegacyListInviteResponse {
  message: string
  invitation: {
    id: string
    email: string
    role: string
    type: string
    createdAt: string | Date
  }
}

/**
 * DELETE /api/lists/[id]/leave — bare success message.
 */
export interface LegacyListLeaveResponse {
  message: string
}

/**
 * PUT /api/lists/[id]/favorite — toggle-style envelope where iOS reads
 * `isFavorite` directly to update local state.
 */
export interface LegacyListFavoriteResponse {
  success: boolean
  isFavorite: boolean
  listId: string
  list: TaskList
}

// GET /api/lists/[id] returns raw TaskList. GET /api/lists/public
// returns TaskList[] (no envelope).

// ── Comments ──────────────────────────────────────────────────────────

// GET/PUT /api/comments/[id] return raw Comment object (from
// types/task.ts) — no envelope to pin.

// ── Reminders ─────────────────────────────────────────────────────────

/**
 * Embedded task summary inside a Reminder. iOS uses this to render the
 * reminder list without a second round-trip per item.
 */
export interface LegacyReminderTask {
  id: string
  title: string
  description: string | null
  dueDateTime: string | Date | null
  priority: number | null
  completed: boolean
  listNames: string[]
}

/**
 * Reminder shape returned in the `reminders` array.
 *
 * NOTE: the prior version of this interface used names from a stale
 * inventory (taskId/taskTitle/status/reminderType/isOverdue). The actual
 * server returns the keys below — `type` (matches Prisma column),
 * `retryCount`, `snoozeCount`, and an embedded `task` object. iOS
 * decoders track the actual server keys.
 */
export interface LegacyReminder {
  id: string
  type: string
  scheduledFor: string | Date
  retryCount: number
  snoozeCount: number
  task: LegacyReminderTask | null
}

export interface LegacyRemindersStatusResponse {
  reminders: LegacyReminder[]
  summary: Record<string, number>
  total: number
}

export interface LegacyReminderDismissResponse {
  success: true
  dismissedCount: number
}

export interface LegacyReminderSnoozeResponse {
  success: true
  scheduledFor: string | Date
  snoozeCount: number
}

// ── Account ───────────────────────────────────────────────────────────

/**
 * GET /api/account — user record extended with verification status iOS
 * uses to drive the email-verification UI.
 */
export interface LegacyAccountResponse {
  user: User & {
    verified?: boolean
    verifiedViaOAuth?: boolean
    hasPendingChange?: boolean
    pendingEmail?: string | null
    createdAt?: string | Date
    updatedAt?: string | Date
  }
}

// PUT /api/account returns raw User.

export interface LegacyAccountDeleteResponse {
  success: true
  message: string
}

/**
 * POST /api/account/verify-email — multi-action endpoint (send/resend/
 * cancel/verify-token). Response varies but always carries `success`.
 */
export interface LegacyVerifyEmailResponse {
  success: boolean
  error?: string
  message?: string
}

// GET /api/account/export returns a file download (JSON or CSV blob,
// not a JSON envelope) — not a contract we can pin via interface.

// ── Files ─────────────────────────────────────────────────────────────

/**
 * POST /api/upload — direct upload, returns Vercel Blob URL.
 */
export interface LegacyUploadResponse {
  url: string
  name: string
  size: number
  type: string
}

/**
 * GET /api/secure-files/[id]?info=true — info-only response (without
 * `?info=true` it 302-redirects to the signed URL).
 */
export interface LegacySecureFileInfoResponse {
  url: string
  fileName: string
  mimeType: string
  fileSize: number
  expiresIn: number
}

/**
 * POST /api/secure-upload/request-upload — small-file inline upload init.
 */
export interface LegacySecureUploadRequestResponse {
  fileId: string
  fileName: string
  fileSize: number
  mimeType: string
  success: true
}

/**
 * POST /api/secure-upload/get-upload-url — Vercel Blob direct-upload
 * coordinates. iOS streams the file body to `uploadToken` + `pathname`.
 */
export interface LegacySecureUploadGetUrlResponse {
  uploadToken: string
  pathname: string
  fileId: string
}

export interface LegacySecureFileUploadUrlResponse {
  uploadUrl: string
  pathname: string
  headers: Record<string, string>
  method: 'PUT'
}

export interface LegacySecureFileConfirmUploadResponse {
  id: string
  originalName: string
  mimeType: string
  fileSize: number
  updatedAt: string | Date
  success: true
}

// ── Users ─────────────────────────────────────────────────────────────

/**
 * GET /api/users/[id]/profile — public-profile view with derived stats
 * and shared-task list iOS uses for the user-profile screen.
 */
export interface LegacyUserProfileResponse {
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
  sharedTasks: Task[]
  isOwnProfile: boolean
}

/**
 * GET /api/users/search — type-ahead user search.
 * iOS uses `listMemberCount` to badge "X already in this list."
 */
export interface LegacyUsersSearchResponse {
  users: User[]
  listMemberCount: number
}

// ── User settings (mixed-version /api/user/*) ─────────────────────────

// GET/PATCH /api/user/settings return the full User row (raw).

export interface LegacyMyTasksPreferencesResponse {
  sortBy: string
  manualSortOrder: string[]
}

export interface LegacyAiApiKeysResponse {
  keys: Array<{
    provider: string
    keyId: string
    name: string
    lastUsed: string | Date | null
  }>
}

export interface LegacySuccessOnlyResponse {
  success: true
}

export interface LegacyAiKeyTestResponse {
  success: boolean
  error?: string
}

export interface LegacyAvailableAgentsResponse {
  agents: Array<{
    id: string
    email: string
    name: string | null
    image: string | null
    isAIAgent: true
    aiAgentType: string | null
  }>
}

export interface LegacyAiAssistantSettingsResponse {
  preferredService: string | null
  defaultAgentId: string | null
}

export interface LegacyAiAvailableModelsResponse {
  models: string[]
  source: 'static' | 'api'
}

// ── Chat ──────────────────────────────────────────────────────────────

/**
 * POST /api/chat/channels — channel resolution by listId or virtualKey.
 */
export interface LegacyChatChannelResponse {
  channel: {
    id: string
    listId: string | null
    virtualKey: string | null
    name: string
  }
}

/**
 * Message wire shape used by both list and create endpoints. iOS
 * decodes both via the same model.
 */
export interface LegacyChatMessage {
  id: string
  channelId: string
  authorId: string
  content: string
  createdAt: string | Date
  updatedAt: string | Date
  author?: {
    id: string
    name: string | null
    email: string
    image: string | null
    isAIAgent: boolean
  } | null
}

export interface LegacyChatMessagesListResponse {
  messages: LegacyChatMessage[]
  hasMore: boolean
  nextCursor: string | null
}

export interface LegacyChatMessageMutationResponse {
  message: LegacyChatMessage
}

// ── Misc ──────────────────────────────────────────────────────────────

/**
 * POST /api/invitations — invite-by-email. `userExists: false` means
 * we sent an email; `true` means we attached to an existing user.
 */
export interface LegacyInvitationResponse {
  success: true
  userExists: boolean
  invitation: {
    id: string
    email: string
    type: string
    expiresAt: string | Date
  }
  message: string
}

export interface LegacyShortcodeMutationResponse {
  shortcode: {
    code: string
    targetType: string
    targetId: string
  }
  url: string
}

export interface LegacyShortcodeResolveResponse {
  code: string
  targetType: string
  targetId: string
}

export interface LegacyPushSubscribeResponse {
  success: true
  message: string
  subscriptionId: string
}
