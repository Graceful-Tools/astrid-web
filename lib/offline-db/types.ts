/**
 * Shared types for the offline-first database and its per-entity operations.
 */

/**
 * User interface for offline storage
 */
export interface OfflineUser {
  id: string
  name?: string
  email: string
  image?: string
}

/**
 * Mutation operation for offline sync queue
 */
export interface MutationOperation {
  id: string // Unique ID for the operation
  type: 'create' | 'update' | 'delete'
  entity: 'task' | 'list' | 'comment' | 'member' | 'attachment'
  entityId: string // ID of the entity being modified
  data: any // Data for create/update operations
  endpoint: string // API endpoint to call
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  timestamp: number
  retryCount: number
  lastError?: string
  status: 'pending' | 'failed' | 'completed'
  parentId?: string // For tracking relationships (e.g., comment's taskId)
  tempId?: string // Original temp ID before mapping to real ID
}

/**
 * List member for offline storage
 */
export interface OfflineListMember {
  id: string              // Composite: `${listId}_${userId}`
  listId: string
  userId: string
  role: 'owner' | 'admin' | 'member'
  joinedAt: string
  user?: OfflineUser      // Denormalized user data
  syncStatus: 'synced' | 'pending' | 'failed'
}

/**
 * Attachment for offline storage with blob support
 */
export interface OfflineAttachment {
  id: string
  taskId?: string
  commentId?: string
  name: string
  mimeType: string
  size: number
  url: string             // Original URL for re-download
  blob?: Blob             // Cached file data
  cachedAt: number
  accessedAt: number
  syncStatus: 'synced' | 'pending' | 'failed'
}

/**
 * Sync cursor for incremental sync
 */
export interface SyncCursor {
  entity: 'task' | 'list' | 'comment' | 'member'
  cursor: string          // ISO timestamp or opaque token
  lastSync: number
}

/**
 * ID mapping for temporary to real ID conversion
 */
export interface IdMapping {
  tempId: string
  realId: string
  entity: 'task' | 'list' | 'comment' | 'member' | 'attachment'
  timestamp: number
}
