# Offline Mode & Background Sync

**Last Updated:** 2024-12-21

Astrid Task Manager now supports comprehensive offline functionality, allowing users to continue working seamlessly when internet connectivity is lost and automatically syncing changes when reconnected.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                         UI Layer                             │
│  - OfflineBadge: Visual offline status indicator            │
│  - SyncStatus: Pending mutations & sync controls            │
│  - PWAStatus: Toast notifications for connection changes    │
└───────────────────────────────┬─────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────┐
│                   Cache Manager Layer                        │
│  - CacheManager (lib/cache-manager.ts)                      │
│  - Three-tier: Memory → IndexedDB → Network                 │
│  - Auto-fallback with graceful degradation                  │
│  - Cross-tab sync via BroadcastChannel                      │
└───────────────────────────────┬─────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
┌───────▼────────┐   ┌─────────▼──────────┐  ┌────────▼────────┐
│  Memory Cache  │   │  IndexedDB         │  │  Service Worker │
│  (memory-cache)│   │  (offline-db)      │  │  (sw.js)        │
│  - O(1) access │   │  - Tasks           │  │  - Cache mgmt   │
│  - LRU eviction│   │  - Lists           │  │  - Background   │
│  - Configurable│   │  - Attachments     │  │    sync API     │
│    TTL         │   │  - Mutations       │  │  - Push notifs  │
└────────────────┘   └────────────────────┘  └─────────────────┘
        │                       │                       │
        │            ┌──────────┴──────────┐            │
        │            │                     │            │
        │   ┌────────▼────────┐   ┌───────▼────────┐   │
        │   │  Cross-Tab Sync │   │  Data Sync     │   │
        │   │  (cross-tab-sync│   │  (data-sync)   │   │
        │   │  - Broadcast    │   │  - Full sync   │   │
        │   │    Channel      │   │  - Incremental │   │
        │   │  - Cache events │   │  - Cursors     │   │
        │   └─────────────────┘   └────────────────┘   │
        │                                               │
        └───────────────────────────────────────────────┘
```

## Core Components

### 1. IndexedDB Layer (`lib/offline-db.ts`)

**Purpose:** Persistent offline data storage using Dexie.js wrapper for IndexedDB.

**Database Schema:**
```typescript
{
  tasks: 'id, listId, assignedToId, dueDate, completed, updatedAt',
  lists: 'id, ownerId, privacy, updatedAt, isFavorite',
  users: 'id, email',
  publicTasks: 'id, listId, updatedAt',
  comments: 'id, taskId, createdAt',
  attachments: 'id, taskId, commentId, cachedAt, accessedAt',
  mutations: 'id, type, entity, entityId, timestamp, status',
  idMappings: 'tempId, realId, entity',
  syncCursors: 'entity, cursor, lastSync'
}
```

**Key Operations:**
- `OfflineTaskOperations`: CRUD operations for tasks
- `OfflineListOperations`: CRUD operations for lists
- `OfflineUserOperations`: User data management
- `OfflineCommentOperations`: Comment storage and retrieval
- `OfflineAttachmentOperations`: Attachment blob storage with LRU eviction
- `OfflineIdMappingOperations`: Temp-to-real ID mapping
- `OfflineSyncCursorOperations`: Sync cursor management
- `offlineDB.clearAll()`: Clear all offline data (useful for logout)

**Example Usage:**
```typescript
import { OfflineTaskOperations } from '@/lib/offline-db'

// Save task to offline storage
await OfflineTaskOperations.saveTask(task)

// Get all tasks
const tasks = await OfflineTaskOperations.getTasks()

// Get tasks by list
const listTasks = await OfflineTaskOperations.getTasksByList('list-id')
```

### 2. Unified Cache Manager (`lib/cache-manager.ts`)

**Purpose:** Three-tier caching with Memory → IndexedDB → Network fallback.

**Features:**
- O(1) memory access for hot data
- IndexedDB persistence for offline support
- Automatic cache invalidation via SSE and cross-tab sync
- Stale-while-revalidate pattern
- Graceful degradation when IndexedDB fails

**Example Usage:**
```typescript
import { CacheManager } from '@/lib/cache-manager'

// Get task (checks memory, then IndexedDB)
const cached = await CacheManager.getTask(taskId)
if (cached) {
  console.log(cached.source) // 'memory' | 'indexeddb' | 'network'
}

// Set task (updates memory + IndexedDB)
await CacheManager.setTask(task)

// Subscribe to updates
const unsubscribe = CacheManager.subscribe('tasks', () => {
  console.log('Tasks updated!')
})
```

### 3. Memory Cache (`lib/memory-cache.ts`)

**Purpose:** Fast in-memory LRU cache with configurable TTL.

**Features:**
- O(1) get/set operations
- Configurable max size and TTL per cache
- LRU eviction when capacity is reached
- Invalidation support (marks stale vs deleting)
- Collection cache for query results

**Cache Sizes:**
- Tasks: 1000 items, 5min TTL
- Lists: 100 items, 10min TTL
- Comments: 500 items, 5min TTL
- Users: 200 items, 30min TTL

### 4. Cross-Tab Synchronization (`lib/cross-tab-sync.ts`)

**Purpose:** Keep caches synchronized across browser tabs using BroadcastChannel API.

**Events:**
- `mutation_queued`: New offline mutation added
- `mutation_synced`: Mutation completed with ID mapping
- `cache_updated`: IndexedDB data changed
- `cache_invalidated`: Cache should be refreshed
- `entity_deleted`: Entity removed
- `sync_started/completed`: Sync status changes

**Example Usage:**
```typescript
import { CrossTabSync } from '@/lib/cross-tab-sync'

// Subscribe to all events
CrossTabSync.subscribe((event) => {
  if (event.type === 'cache_updated' && event.entity === 'task') {
    // Refresh task from IndexedDB
  }
})

// Broadcast cache update to other tabs
CrossTabSync.broadcastCacheUpdated('task', taskId)
```

### 5. Data Sync Orchestrator (`lib/data-sync.ts`)

**Purpose:** Handles initial and incremental sync using cursors.

**Features:**
- Cursor-based incremental sync
- Automatic sync on reconnection
- Periodic background sync (every 5 minutes)
- Fetch timeout protection (30 seconds)
- Graceful error handling with fallback to cache

**Sync Flow:**
1. On app load: Check last sync time, perform incremental or full sync
2. On reconnection: Perform incremental sync to catch up
3. Periodic sync: Every 5 minutes if app is active

### 6. Attachment Cache (`lib/attachment-cache.ts`)

**Purpose:** Download and cache attachments for offline viewing.

**Features:**
- 100MB cache limit with LRU eviction
- Quota exceeded error handling
- Background prefetching for favorite lists
- Blob storage in IndexedDB

### 7. Mutation Queue & Sync (`lib/offline-sync.ts`)

**Purpose:** Queue offline operations and sync them when online.

**Mutation Operation Structure:**
```typescript
interface MutationOperation {
  id: string                           // Unique operation ID
  type: 'create' | 'update' | 'delete' // Operation type
  entity: 'task' | 'list' | 'comment'  // Entity type
  entityId: string                     // ID of entity
  data: any                            // Data for create/update
  endpoint: string                     // API endpoint
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  timestamp: number                    // Queued timestamp
  retryCount: number                   // Number of retry attempts
  lastError?: string                   // Last error message
  status: 'pending' | 'failed' | 'completed'
}
```

**Key Features:**
- **Automatic queueing** when offline
- **Retry logic** with exponential backoff (max 3 retries)
- **Conflict detection** for concurrent edits
- **Clean API integration** using existing `apiCall` helpers
- **Auto-sync** on reconnection

**Example Usage:**
```typescript
import { OfflineSyncManager } from '@/lib/offline-sync'

// Queue a mutation
await OfflineSyncManager.queueMutation(
  'create',
  'task',
  'task-123',
  '/api/tasks',
  'POST',
  { title: 'New Task', listId: 'list-1' }
)

// Manually trigger sync
const result = await OfflineSyncManager.syncPendingMutations()
console.log(`Synced: ${result.success}, Failed: ${result.failed}`)

// Get sync stats
const stats = await OfflineSyncManager.getMutationStats()
console.log(`Pending: ${stats.pending}, Failed: ${stats.failed}`)

// Retry failed mutations
await OfflineSyncManager.retryFailedMutations()
```

### 3. Service Worker (`public/sw.js`)

**Purpose:** Handle offline caching, background sync, and push notifications.

**Cache Strategy:**
- **Static assets**: Cache-first (icons, CSS, JS bundles)
- **API routes**: Network-first with cache fallback
- **App pages**: Network-first with cache fallback

**Background Sync Integration:**
```javascript
// Service worker listens for 'background-sync' event
self.addEventListener('sync', (event) => {
  if (event.tag === 'background-sync') {
    event.waitUntil(doBackgroundSync());
  }
});

// Syncs pending mutations from IndexedDB
async function doBackgroundSync() {
  const mutations = await db.mutations
    .where('status')
    .equals('pending')
    .sortBy('timestamp');

  for (const mutation of mutations) {
    await syncAction(mutation);
    await db.mutations.delete(mutation.id);
  }
}
```

**Cache Versioning:**
- Static cache: `astrid-static-v1.0.2`
- Dynamic cache: `astrid-dynamic-v1.0.2`
- Auto-cleanup of old cache versions

### 4. Enhanced Data Manager (`hooks/useDataManager.ts`)

**Purpose:** Offline-first data loading with automatic fallback to IndexedDB.

**Offline-First Flow:**
```typescript
// 1. Check if offline
if (isOfflineMode()) {
  // Load from IndexedDB
  const offlineTasks = await OfflineTaskOperations.getTasks()
  setTasks(offlineTasks)
  return
}

// 2. Online - fetch from API
const tasks = await apiGet("/api/tasks")
setTasks(tasks)

// 3. Cache to IndexedDB for offline use
await OfflineTaskOperations.saveTasks(tasks)
```

**Error Handling with Fallback:**
```typescript
try {
  // Try API first
  const data = await apiGet("/api/tasks")
  await OfflineTaskOperations.saveTasks(data)
} catch (error) {
  // Fallback to IndexedDB on error
  const cachedData = await OfflineTaskOperations.getTasks()
  if (cachedData.length > 0) {
    setTasks(cachedData)
    toast("Using cached data")
  }
}
```

**Optimistic Updates:**
```typescript
// Update UI immediately and persist to IndexedDB
const updateTaskOptimistic = async (updatedTask: Task) => {
  setTasks(prev => prev.map(task =>
    task.id === updatedTask.id ? updatedTask : task
  ))
  await OfflineTaskOperations.saveTask(updatedTask)
}
```

### 5. UI Components

#### OfflineBadge (`components/offline-badge.tsx`)
Simple inline or floating badge showing online/offline status.

```tsx
<OfflineBadge />  {/* Shows only when offline */}
<OfflineBadge showWhenOnline />  {/* Always visible */}
<OfflineBadge variant="floating" />  {/* Fixed position */}
```

#### SyncStatus (`components/sync-status.tsx`)
Interactive sync status button with pending count and manual sync trigger.

```tsx
<SyncStatus />  {/* Full details */}
<SyncStatusCompact />  {/* Minimal version */}
```

**Features:**
- Shows sync state (idle, syncing, success, error)
- Displays pending and failed mutation counts
- Manual sync trigger button
- Auto-syncs on reconnection
- Visual indicator (spinning icon, notification badge)

#### PWAStatus (`components/pwa-status.tsx`)
Toast notification for online/offline transitions with sync status.

```tsx
<PWAStatus />
```

**Features:**
- Shows when going offline/online
- Displays pending changes count when offline
- Auto-syncs on reconnection
- Dismissible notification

## Usage Patterns

### 1. Creating Tasks Offline

```typescript
import { useTaskOperations } from '@/hooks/useTaskOperations'
import { OfflineSyncManager } from '@/lib/offline-sync'

const { createTask } = useTaskOperations()

// Create task - works online or offline
const newTask = await createTask({
  title: 'Buy groceries',
  listId: 'shopping-list'
})

// If offline, mutation is automatically queued
// Task shows in UI immediately (optimistic update)
// Syncs automatically when connection restored
```

### 2. Editing Tasks Offline

```typescript
// Update task - queued if offline
await updateTask(taskId, {
  title: 'Updated title',
  completed: true
})

// UI updates immediately
// Changes persist to IndexedDB
// Syncs to server when online
```

### 3. Detecting Offline Status

```typescript
import { isOfflineMode } from '@/lib/offline-sync'

if (isOfflineMode()) {
  toast('You are offline. Changes will sync when online.')
}
```

### 4. Waiting for Online Connection

```typescript
import { waitForOnline } from '@/lib/offline-sync'

// Wait until connection is restored
await waitForOnline()
console.log('Connection restored!')
```

### 5. Manual Sync Trigger

```typescript
import { OfflineSyncManager } from '@/lib/offline-sync'

// Trigger manual sync
const result = await OfflineSyncManager.syncPendingMutations()

if (result.failed > 0) {
  toast(`Failed to sync ${result.failed} changes`)
} else {
  toast('All changes synced successfully')
}
```

## Conflict Resolution

### Current Strategy: Server Wins

When syncing offline changes, the system detects conflicts through HTTP status codes:

- **409 Conflict**: Server has newer version → Log conflict, retry with backoff
- **404 Not Found**: Resource deleted on server → Mark mutation as failed
- **403 Forbidden**: Permission denied → Mark mutation as failed

### Future Enhancements

Potential conflict resolution strategies:

1. **Last-Write-Wins**: Always use most recent timestamp
2. **Manual Resolution**: Show conflict UI to user
3. **Field-Level Merge**: Merge non-conflicting field changes
4. **Version Vectors**: Track causality of edits

### Implementing Custom Conflict Resolution

```typescript
// In lib/offline-sync.ts, processMutation method
if (response.status === 409) {
  // Fetch latest version
  const latest = await apiGet(`/api/tasks/${entityId}`)

  // Show conflict resolution UI
  const resolution = await showConflictDialog({
    local: data,
    remote: latest.task
  })

  // Apply resolution
  if (resolution === 'use-remote') {
    await OfflineTaskOperations.saveTask(latest.task)
  } else if (resolution === 'use-local') {
    // Retry with force flag
  }
}
```

## Testing

### Unit Tests

Comprehensive Vitest tests covering:
- `tests/lib/cache-manager.test.ts`: Cache manager operations
- `tests/lib/memory-cache.test.ts`: LRU cache behavior
- `tests/lib/cross-tab-sync.test.ts`: Cross-tab communication
- `tests/lib/data-sync.test.ts`: Sync orchestration
- `tests/lib/offline-sync.test.ts`: Mutation queue and sync
- `tests/lib/attachment-cache.test.ts`: Attachment caching

**Run tests:**
```bash
npm test tests/lib/cache-manager.test.ts
npm test tests/lib/offline-sync.test.ts
npm test tests/lib/data-sync.test.ts
```

### E2E Tests (`e2e/offline.spec.ts`)

Playwright tests for user-facing offline functionality:
- Offline indicator visibility
- Cached data loading
- Mutation queueing
- Auto-sync on reconnection
- Service worker caching

**Run E2E tests:**
```bash
npm run test:e2e e2e/offline.spec.ts
```

## Performance Considerations

### IndexedDB Size Limits

- **Chrome**: ~60% of available disk space
- **Firefox**: ~50% of available disk space
- **Safari**: ~1GB

**Monitor storage usage:**
```typescript
const info = await offlineDB.getStorageInfo()
console.log('Total items:', info.total)
console.log('Tasks:', info.tasks)
console.log('Pending mutations:', info.mutations)
```

### Cleanup Strategies

**Auto-cleanup of completed mutations:**
```typescript
// Automatically runs every hour
OfflineSyncManager.clearOldCompletedMutations(24 * 60 * 60 * 1000) // 24 hours
```

**Manual cleanup:**
```typescript
// Clear all offline data (e.g., on logout)
await offlineDB.clearAll()

// Clear specific tables
await OfflineTaskOperations.clearTasks()
await OfflineSyncManager.clearAllMutations()
```

### Sync Throttling

The sync manager prevents concurrent sync operations and adds small delays between mutations to avoid rate limiting:

```typescript
// 100ms delay between mutations
await new Promise(resolve => setTimeout(resolve, 100))
```

## Troubleshooting

### Mutations Not Syncing

1. **Check online status**: `navigator.onLine`
2. **Check pending mutations**: `await OfflineSyncManager.getPendingMutations()`
3. **Check failed mutations**: `await OfflineSyncManager.getMutationStats()`
4. **Retry failed**: `await OfflineSyncManager.retryFailedMutations()`

### IndexedDB Not Persisting

1. **Check browser support**: `'indexedDB' in window`
2. **Check storage quota**: Navigate to DevTools → Application → Storage
3. **Clear corrupted data**: `await offlineDB.clearAll()`

### Service Worker Not Registering

1. **Check HTTPS**: Service workers require HTTPS (or localhost)
2. **Check registration**: Navigate to DevTools → Application → Service Workers
3. **Force update**: Click "Update" in DevTools
4. **Clear cache**: Application → Clear storage

### Debug Logging

Enable debug logging in development:

```typescript
// Set in .env.local
NODE_ENV=development

// Logs will show:
// 📝 Queued offline mutation: {...}
// 🔄 Syncing 3 pending mutations...
// ✅ Synced mutation abc123: create task
// 📴 Offline mode - loading from IndexedDB
```

## Browser Compatibility

| Feature | Chrome | Firefox | Safari | Edge |
|---------|--------|---------|--------|------|
| IndexedDB | ✅ | ✅ | ✅ | ✅ |
| Service Workers | ✅ | ✅ | ✅ | ✅ |
| Background Sync | ✅ | ❌ | ❌ | ✅ |
| Push Notifications | ✅ | ✅ | ✅ | ✅ |
| Cache API | ✅ | ✅ | ✅ | ✅ |

**Note:** Background Sync API is not universally supported. Astrid falls back to manual sync on reconnection for unsupported browsers.

## Security Considerations

### Data Encryption

- IndexedDB data is **not encrypted by default**
- Sensitive data should be encrypted before storage
- Consider implementing client-side encryption for:
  - Private tasks
  - User credentials
  - API tokens

### Cache Invalidation

- Cached API responses expire after 30 seconds
- Service worker cache versions auto-increment on updates
- Manual cache clearing on logout: `await offlineDB.clearAll()`

### XSS Protection

- All user input is sanitized before display
- IndexedDB uses strict schema validation
- Service worker runs in isolated context

## Future Enhancements

### Planned Features

1. **Conflict Resolution UI**
   - Side-by-side diff view
   - Field-level merge options
   - Undo/redo conflict resolution

2. **Selective Sync**
   - Choose which lists to sync offline
   - Sync only starred/pinned tasks
   - Bandwidth-aware sync (images, attachments)

3. **Advanced Caching**
   - Predictive pre-caching
   - Intelligent cache prioritization
   - Background task fetching

4. **Offline Analytics**
   - Track offline usage patterns
   - Sync success/failure rates
   - Conflict frequency metrics

5. **Collaborative Offline Editing**
   - Operational transformation for concurrent edits
   - Real-time merge of offline changes
   - Multi-device sync coordination

## Related Documentation

- [Architecture Overview](./ARCHITECTURE.md)
- [Service worker implementation](../public/sw.js)
- [Testing Strategy](./context/testing.md)
- [API Contract](./API_CONTRACT.md)

---

**Questions or Issues?**

- File a bug: [GitHub Issues](https://github.com/your-repo/issues)
- Join discussion: [Discord Community](#)
- Read code: [`lib/offline-db`](../lib/offline-db/index.ts), [`lib/offline-sync.ts`](../lib/offline-sync.ts)
