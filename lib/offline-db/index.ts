/**
 * Offline-first database (Dexie / IndexedDB) barrel.
 *
 * Stage 11a split: the former single-file lib/offline-db.ts is now a directory
 * of per-entity operation classes. This barrel preserves the original public
 * import surface (`@/lib/offline-db`) so existing imports keep working.
 */

// Shared types
export type {
  OfflineUser,
  MutationOperation,
  OfflineListMember,
  OfflineAttachment,
  SyncCursor,
  IdMapping,
} from './types'

// Database singleton
export { offlineDB } from './database'

// Per-entity operations
export { OfflineTaskOperations } from './tasks'
export { OfflineListOperations } from './lists'
export { OfflineUserOperations } from './users'
export { OfflinePublicTaskOperations } from './public-tasks'
export { OfflineCommentOperations } from './comments'
export { OfflineIdMappingOperations } from './id-mappings'
export { OfflineListMemberOperations } from './members'
export { OfflineAttachmentOperations } from './attachments'
export { OfflineSyncCursorOperations } from './sync-cursors'
