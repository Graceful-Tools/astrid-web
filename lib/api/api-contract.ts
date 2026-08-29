/**
 * API Contract Definitions
 *
 * This file defines the API contract for each version.
 * Breaking changes should:
 * 1. Increment the version number
 * 2. Keep the old contract for backward compatibility
 * 3. Add transformation functions to convert between versions
 *
 * Breaking changes include:
 * - Removing a field
 * - Changing a field's type
 * - Renaming a field
 * - Making an optional field required
 * - Changing enum values
 *
 * Non-breaking changes (safe to add without versioning):
 * - Adding new optional fields
 * - Adding new endpoints
 * - Deprecating (but not removing) fields
 */

// Current API version
export const CURRENT_API_VERSION = 1;

// Minimum supported API version
export const MIN_SUPPORTED_VERSION = 1;

// API Version header name
export const API_VERSION_HEADER = 'X-API-Version';

/**
 * V1 API Contract - Task fields
 *
 * IMPORTANT: Do NOT remove fields from this list.
 * If a field is deprecated, keep it here but add to DEPRECATED_FIELDS.
 */
export const V1_TASK_FIELDS = {
  // Core fields (required)
  id: { type: 'string', required: true },
  title: { type: 'string', required: true },
  description: { type: 'string', required: true },
  completed: { type: 'boolean', required: true },
  isPrivate: { type: 'boolean', required: true },
  repeating: { type: 'enum', values: ['never', 'daily', 'weekly', 'monthly', 'yearly', 'custom'], required: true },
  repeatFrom: { type: 'enum', values: ['DUE_DATE', 'COMPLETION_DATE'], required: true },
  occurrenceCount: { type: 'number', required: true },
  priority: { type: 'enum', values: [0, 1, 2, 3], required: true },
  createdAt: { type: 'date', required: true },
  updatedAt: { type: 'date', required: true },

  // Relation fields (required but can be null)
  creatorId: { type: 'string', required: true },
  creator: { type: 'object', required: false },

  // Optional fields
  assignee: { type: 'object', required: false },
  assigneeId: { type: 'string', required: false },
  dueDateTime: { type: 'date', required: false },
  isAllDay: { type: 'boolean', required: false },
  reminderTime: { type: 'date', required: false },
  reminderSent: { type: 'boolean', required: false },
  reminderType: { type: 'enum', values: ['push', 'email', 'both', null], required: false },
  repeatingData: { type: 'object', required: false },
  timerDuration: { type: 'number', required: false },
  lastTimerValue: { type: 'string', required: false },
  lists: { type: 'array', required: false },
  attachments: { type: 'array', required: false },
  comments: { type: 'array', required: false },
  secureFiles: { type: 'array', required: false },
  originalTaskId: { type: 'string', required: false },
  sourceListId: { type: 'string', required: false },

  // Added 2026-08-29 (task 1985804a) — fields the API had been sending
  // untracked since the day-one snapshot. All optional: adding them is
  // non-breaking, and clients that ignore them keep working.
  completedAt: { type: 'date', required: false },
  closedReason: { type: 'string', required: false },
  statusRole: { type: 'string', required: false },
  parentTaskId: { type: 'string', required: false },

  // Legacy fields (kept for backward compatibility)
  when: { type: 'date', required: false, deprecated: true },
  dueDate: { type: 'date', required: false, deprecated: true },
} as const;

/**
 * V1 API Contract - TaskList fields
 */
export const V1_TASKLIST_FIELDS = {
  // Core fields (required)
  id: { type: 'string', required: true },
  name: { type: 'string', required: true },
  privacy: { type: 'enum', values: ['PRIVATE', 'SHARED', 'PUBLIC'], required: true },
  ownerId: { type: 'string', required: true },
  createdAt: { type: 'date', required: true },
  updatedAt: { type: 'date', required: true },

  // Optional fields
  color: { type: 'string', required: false },
  imageUrl: { type: 'string', required: false },
  coverImageUrl: { type: 'string', required: false },
  description: { type: 'string', required: false },
  publicListType: { type: 'string', required: false },
  owner: { type: 'object', required: false },
  admins: { type: 'array', required: false },
  members: { type: 'array', required: false },
  listMembers: { type: 'array', required: false },
  defaultAssignee: { type: 'object', required: false },
  defaultAssigneeId: { type: 'string', required: false },
  defaultPriority: { type: 'enum', values: [0, 1, 2, 3], required: false },
  defaultRepeating: { type: 'enum', values: ['never', 'daily', 'weekly', 'monthly', 'yearly', 'custom'], required: false },
  defaultIsPrivate: { type: 'boolean', required: false },
  defaultDueDate: { type: 'string', required: false },
  defaultDueTime: { type: 'string', required: false },
  mcpEnabled: { type: 'boolean', required: false },
  mcpAccessLevel: { type: 'string', required: false },
  tasks: { type: 'array', required: false },
  isFavorite: { type: 'boolean', required: false },
  favoriteOrder: { type: 'number', required: false },
  filterCompletion: { type: 'string', required: false },
  filterDueDate: { type: 'string', required: false },
  filterAssignee: { type: 'string', required: false },
  filterAssignedBy: { type: 'string', required: false },
  filterRepeating: { type: 'string', required: false },
  filterPriority: { type: 'string', required: false },
  filterInLists: { type: 'string', required: false },
  isVirtual: { type: 'boolean', required: false },
  virtualListType: { type: 'string', required: false },
  sortBy: { type: 'string', required: false },
  manualSortOrder: { type: 'array', required: false },
  preferredAiProvider: { type: 'string', required: false },
  fallbackAiProvider: { type: 'string', required: false },
  githubRepositoryId: { type: 'string', required: false },
  aiAgentsEnabled: { type: 'array', required: false },

  // Added 2026-08-29 (task 1985804a) — project-board and subtask-era fields
  // the API had been sending untracked. All optional (non-breaking to add;
  // a select that omits one is not a contract violation).
  projectId: { type: 'string', required: false },
  listType: { type: 'enum', values: ['regular', 'status'], required: false },
  statusRole: { type: 'string', required: false },
  statusOrder: { type: 'number', required: false },
  statusDescription: { type: 'string', required: false },
  statusCompleted: { type: 'boolean', required: false },
  recentlyCompletedWindow: { type: 'object', required: false },
  showSubtasks: { type: 'boolean', required: false },
} as const;

/**
 * V1 API Contract - User fields
 */
export const V1_USER_FIELDS = {
  id: { type: 'string', required: true },
  email: { type: 'string', required: true },
  name: { type: 'string', required: false },
  image: { type: 'string', required: false },
  createdAt: { type: 'date', required: false },
  defaultDueTime: { type: 'string', required: false },
  isPending: { type: 'boolean', required: false },
  isAIAgent: { type: 'boolean', required: false },
  aiAgentType: { type: 'string', required: false },
} as const;

/**
 * V1 API Contract - Comment fields
 */
export const V1_COMMENT_FIELDS = {
  id: { type: 'string', required: true },
  content: { type: 'string', required: true },
  type: { type: 'enum', values: ['TEXT', 'MARKDOWN', 'ATTACHMENT'], required: true },
  taskId: { type: 'string', required: true },
  createdAt: { type: 'date', required: true },
  updatedAt: { type: 'date', required: true },
  author: { type: 'object', required: false },
  authorId: { type: 'string', required: false },
  attachmentUrl: { type: 'string', required: false },
  attachmentName: { type: 'string', required: false },
  attachmentType: { type: 'string', required: false },
  attachmentSize: { type: 'number', required: false },
  parentCommentId: { type: 'string', required: false },
  replies: { type: 'array', required: false },
  secureFiles: { type: 'array', required: false },
} as const;

// Export all contracts
export const API_CONTRACTS = {
  1: {
    Task: V1_TASK_FIELDS,
    TaskList: V1_TASKLIST_FIELDS,
    User: V1_USER_FIELDS,
    Comment: V1_COMMENT_FIELDS,
  },
} as const;

// Type helpers
export type FieldDefinition = {
  type: string;
  required: boolean;
  values?: readonly (string | number | null)[];
  deprecated?: boolean;
};

export type ContractFields = Record<string, FieldDefinition>;

/**
 * Get the API version from request headers
 */
export function getApiVersion(headers: Headers): number {
  const versionHeader = headers.get(API_VERSION_HEADER);
  if (!versionHeader) return CURRENT_API_VERSION;

  const version = parseInt(versionHeader, 10);
  if (isNaN(version)) return CURRENT_API_VERSION;

  // Clamp to supported range
  if (version < MIN_SUPPORTED_VERSION) return MIN_SUPPORTED_VERSION;
  if (version > CURRENT_API_VERSION) return CURRENT_API_VERSION;

  return version;
}

/**
 * Transform response for a specific API version
 * This is where we handle backward compatibility
 */
export function transformForVersion<T extends object>(
  data: T,
  _entityType: keyof typeof API_CONTRACTS[1],
  _targetVersion: number
): T {
  // Currently we only have v1, so no transformation needed
  // When we add v2, we'll transform v2 responses to v1 format here
  return data;
}
