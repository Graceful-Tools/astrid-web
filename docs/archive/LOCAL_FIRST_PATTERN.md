# Local-First Architecture Pattern

**Last Updated**: December 19, 2024
**Status**: Production-Ready Pattern

This document describes the proven local-first architecture pattern implemented in the Astrid iOS app, enabling 100% offline functionality with background synchronization.

---

## Overview

The local-first pattern ensures the app works instantly even when offline, with all changes automatically syncing to the server when a connection is available.

### Core Principles

1. **Write Local, Sync Background** - All mutations save to Core Data immediately
2. **Read from Cache First** - UI always reads Core Data, never waits for network
3. **Optimistic Updates** - Show changes instantly with temp IDs
4. **Eventual Consistency** - Background sync reconciles with server
5. **Conflict Resolution** - Server wins, local changes retry on failure

---

## Architecture Layers

```
┌─────────────────────────────────────────┐
│         SwiftUI Views (UI Layer)        │
│  - Display data only                    │
│  - No direct API calls                  │
└────────────────┬────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│    Service Layer (Business Logic)       │
│  - CommentService, TaskService, etc     │
│  - Optimistic updates                   │
│  - Queue pending operations             │
└────────────────┬────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│     Core Data Layer (Persistence)       │
│  - CDComment, CDTask, etc               │
│  - syncStatus tracking                  │
│  - Batch operations                     │
└────────────────┬────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│      Background Sync (Reconciliation)   │
│  - 60-second timer (SyncManager)        │
│  - Network restoration triggers         │
│  - Retry failed operations              │
└─────────────────────────────────────────┘
```

---

## Implementation Steps

### Step 1: Extend Core Data Model

Add pending operation fields to your entity:

```swift
// In CDYourEntity+CoreDataClass.swift
@NSManaged public var syncStatus: String // "synced", "pending", "pending_update", "pending_delete", "failed"
@NSManaged public var lastSyncedAt: Date?
@NSManaged public var pendingOperation: String? // "create", "update", "delete"
@NSManaged public var pendingContent: String? // Content waiting to sync (for updates)
@NSManaged public var syncAttempts: Int16 // Number of retry attempts
@NSManaged public var syncError: String? // Last error message
```

Update `.xcdatamodel` XML:

```xml
<entity name="CDYourEntity" representedClassName="CDYourEntity" syncable="YES">
    <!-- ... existing attributes ... -->
    <attribute name="syncStatus" attributeType="String"/>
    <attribute name="lastSyncedAt" optional="YES" attributeType="Date" usesScalarValueType="NO"/>
    <attribute name="pendingOperation" optional="YES" attributeType="String"/>
    <attribute name="pendingContent" optional="YES" attributeType="String"/>
    <attribute name="syncAttempts" attributeType="Integer 16" defaultValueString="0" usesScalarValueType="YES"/>
    <attribute name="syncError" optional="YES" attributeType="String"/>
</entity>
```

Add helper queries:

```swift
extension CDYourEntity {
    /// Fetch all pending operations
    static func fetchPending(context: NSManagedObjectContext) throws -> [CDYourEntity] {
        let request = fetchRequest()
        request.predicate = NSPredicate(
            format: "syncStatus IN %@",
            ["pending", "pending_update", "pending_delete", "failed"]
        )
        request.sortDescriptors = [NSSortDescriptor(key: "createdAt", ascending: true)]
        return try context.fetch(request)
    }
}
```

---

### Step 2: Create/Refactor Service

```swift
@MainActor
class YourEntityService: ObservableObject {
    static let shared = YourEntityService()

    @Published var items: [YourEntity] = []
    @Published var isLoading = false
    @Published var pendingOperationsCount: Int = 0

    private let apiClient = AstridAPIClient.shared
    private let coreDataManager = CoreDataManager.shared
    private let networkMonitor = NetworkMonitor.shared
    private var networkObserver: NSObjectProtocol?

    init() {
        loadCachedItems()
        setupNetworkObserver()

        _Concurrency.Task {
            await updatePendingOperationsCount()
        }
    }

    deinit {
        if let observer = networkObserver {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    // MARK: - Network Observer

    private func setupNetworkObserver() {
        networkObserver = NotificationCenter.default.addObserver(
            forName: .networkDidBecomeAvailable,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            _Concurrency.Task { @MainActor in
                try? await self?.syncPendingOperations()
            }
        }
    }

    // MARK: - Cache Loading

    private func loadCachedItems() {
        // Load synchronously on main thread for instant UI
        do {
            let fetchRequest = CDYourEntity.fetchRequest()
            let cdItems = try coreDataManager.viewContext.fetch(fetchRequest)
            items = cdItems.map { $0.toDomainModel() }
            print("✅ Loaded \(items.count) items from cache")
        } catch {
            print("❌ Failed to load cache: \(error)")
        }
    }

    private func updatePendingOperationsCount() async {
        do {
            let pending: [CDYourEntity] = try await withCheckedThrowingContinuation { continuation in
                coreDataManager.persistentContainer.performBackgroundTask { context in
                    do {
                        let items = try CDYourEntity.fetchPending(context: context)
                        continuation.resume(returning: items)
                    } catch {
                        continuation.resume(throwing: error)
                    }
                }
            }
            pendingOperationsCount = pending.count
        } catch {
            print("❌ Failed to count pending operations: \(error)")
        }
    }
}
```

---

### Step 3: Implement Optimistic CRUD

#### Create (Optimistic)

```swift
func create(_ item: YourEntity) async throws -> YourEntity {
    print("⚡️ Creating item (optimistic)")

    // 1. Generate temp ID
    let tempId = "temp_\(UUID().uuidString)"
    var optimistic = item
    optimistic.id = tempId

    // 2. Update UI immediately
    items.append(optimistic)

    // 3. Save to Core Data as "pending"
    _Concurrency.Task.detached { [weak self] in
        do {
            try await self?.coreDataManager.saveInBackground { context in
                let cdItem = CDYourEntity(context: context)
                cdItem.id = tempId
                // ... set other fields ...
                cdItem.syncStatus = "pending"
                cdItem.pendingOperation = "create"
                cdItem.syncAttempts = 0
            }

            await self?.updatePendingOperationsCount()
        } catch {
            print("⚠️ Failed to save pending item: \(error)")
        }
    }

    // 4. Trigger background sync
    if networkMonitor.isConnected {
        _Concurrency.Task.detached { [weak self] in
            try? await self?.syncPendingOperations()
        }
    }

    // 5. Return immediately
    return optimistic
}
```

#### Update (Optimistic)

```swift
func update(_ item: YourEntity) async throws -> YourEntity {
    print("✏️ Updating item (optimistic): \(item.id)")

    // 1. Update in-memory immediately
    if let index = items.firstIndex(where: { $0.id == item.id }) {
        items[index] = item
    }

    // 2. Save pending update to Core Data
    _Concurrency.Task.detached { [weak self] in
        do {
            try await self?.coreDataManager.saveInBackground { context in
                guard let cdItem = try CDYourEntity.fetchById(item.id, context: context) else {
                    return
                }

                cdItem.pendingContent = item.serializedContent
                cdItem.syncStatus = "pending_update"
                cdItem.pendingOperation = "update"
                cdItem.syncAttempts = 0
            }

            await self?.updatePendingOperationsCount()
        } catch {
            print("⚠️ Failed to save pending update: \(error)")
        }
    }

    // 3. Trigger background sync
    if networkMonitor.isConnected {
        _Concurrency.Task.detached { [weak self] in
            try? await self?.syncPendingOperations()
        }
    }

    return item
}
```

#### Delete (Optimistic)

```swift
func delete(id: String) async throws {
    print("🗑️ Deleting item (optimistic): \(id)")

    // 1. Remove from UI immediately
    items.removeAll { $0.id == id }

    // 2. Mark as pending delete in Core Data
    _Concurrency.Task.detached { [weak self] in
        do {
            try await self?.coreDataManager.saveInBackground { context in
                guard let cdItem = try CDYourEntity.fetchById(id, context: context) else {
                    return
                }

                cdItem.syncStatus = "pending_delete"
                cdItem.pendingOperation = "delete"
                cdItem.syncAttempts = 0
            }

            await self?.updatePendingOperationsCount()
        } catch {
            print("⚠️ Failed to mark for deletion: \(error)")
        }
    }

    // 3. Trigger background sync
    if networkMonitor.isConnected {
        _Concurrency.Task.detached { [weak self] in
            try? await self?.syncPendingOperations()
        }
    }
}
```

---

### Step 4: Implement Background Sync

```swift
func syncPendingOperations() async throws {
    guard networkMonitor.isConnected else {
        print("📵 Cannot sync - no network")
        return
    }

    print("🔄 Starting pending operations sync...")

    // Fetch pending from Core Data
    let pending: [CDYourEntity] = try await withCheckedThrowingContinuation { continuation in
        coreDataManager.persistentContainer.performBackgroundTask { context in
            do {
                let items = try CDYourEntity.fetchPending(context: context)
                continuation.resume(returning: items)
            } catch {
                continuation.resume(throwing: error)
            }
        }
    }

    print("📊 Found \(pending.count) pending operations")

    // Process each pending operation
    for cdItem in pending {
        let operation = cdItem.pendingOperation ?? "unknown"

        do {
            switch operation {
            case "create":
                try await syncPendingCreate(cdItem)
            case "update":
                try await syncPendingUpdate(cdItem)
            case "delete":
                try await syncPendingDelete(cdItem)
            default:
                try await markAsFailed(cdItem, error: "Unknown operation")
            }
        } catch {
            print("❌ Failed to sync \(operation): \(error)")
            try await markAsFailed(cdItem, error: error.localizedDescription)
        }
    }

    await updatePendingOperationsCount()
    print("✅ Sync completed")
}

private func syncPendingCreate(_ cdItem: CDYourEntity) async throws {
    print("⚡️ Syncing pending create: \(cdItem.id)")

    // Call API
    let response = try await apiClient.create(/* ... */)

    // Update Core Data with server ID
    try await coreDataManager.saveInBackground { context in
        guard let item = try CDYourEntity.fetchById(cdItem.id, context: context) else {
            return
        }

        item.id = response.id // Replace temp ID
        item.syncStatus = "synced"
        item.lastSyncedAt = Date()
        item.pendingOperation = nil
        item.syncAttempts = 0
        item.syncError = nil
    }

    print("✅ Marked as synced: \(response.id)")
}

private func syncPendingUpdate(_ cdItem: CDYourEntity) async throws {
    print("⚡️ Syncing pending update: \(cdItem.id)")

    guard let pendingContent = cdItem.pendingContent else {
        return
    }

    // Call API
    let response = try await apiClient.update(/* ... */)

    // Mark as synced
    try await coreDataManager.saveInBackground { context in
        guard let item = try CDYourEntity.fetchById(cdItem.id, context: context) else {
            return
        }

        item.syncStatus = "synced"
        item.lastSyncedAt = Date()
        item.pendingOperation = nil
        item.pendingContent = nil
        item.syncAttempts = 0
        item.syncError = nil
    }
}

private func syncPendingDelete(_ cdItem: CDYourEntity) async throws {
    print("⚡️ Syncing pending delete: \(cdItem.id)")

    // Call API
    try await apiClient.delete(id: cdItem.id)

    // Remove from Core Data
    try await coreDataManager.saveInBackground { context in
        guard let item = try CDYourEntity.fetchById(cdItem.id, context: context) else {
            return
        }

        context.delete(item)
    }
}

private func markAsFailed(_ cdItem: CDYourEntity, error: String) async throws {
    try await coreDataManager.saveInBackground { context in
        guard let item = try CDYourEntity.fetchById(cdItem.id, context: context) else {
            return
        }

        item.syncStatus = "failed"
        item.syncAttempts += 1
        item.syncError = error

        // Give up after 3 attempts
        if item.syncAttempts >= 3 {
            print("🛑 Giving up after 3 attempts: \(cdItem.id)")
        }
    }
}
```

---

### Step 5: Integrate with SyncManager

```swift
// In SyncManager.swift

private let yourEntityService = YourEntityService.shared

func performFullSync() async throws {
    // ... existing sync code ...

    // Add entity sync
    print("🔄 Syncing pending YourEntity operations...")
    do {
        try await yourEntityService.syncPendingOperations()
        print("✅ YourEntity synced successfully")
    } catch {
        print("⚠️ YourEntity sync failed (non-critical): \(error)")
        // Don't throw - entity sync failure shouldn't block overall sync
    }

    // ... rest of sync ...
}
```

---

### Step 6: Add UI Indicators

```swift
struct YourEntityRow: View {
    let item: YourEntity

    var body: some View {
        HStack {
            // ... entity content ...

            Spacer()

            // Sync status indicator
            if item.id.hasPrefix("temp_") {
                Image(systemName: "clock")
                    .foregroundColor(.orange)
                    .font(.caption)
            } else if item.syncStatus == "failed" {
                Button {
                    // Retry sync
                    Task {
                        try? await YourEntityService.shared.syncPendingOperations()
                    }
                } label: {
                    Image(systemName: "exclamationmark.triangle")
                        .foregroundColor(.red)
                }
            }
        }
    }
}
```

---

## Testing Strategy

### Unit Tests

```swift
@MainActor
final class YourEntityServiceTests: XCTestCase {
    func testOptimisticCreate() async throws {
        let service = YourEntityService.shared

        // Create item
        let item = YourEntity(/* ... */)
        let created = try await service.create(item)

        // Verify optimistic ID
        XCTAssertTrue(created.id.hasPrefix("temp_"))

        // Verify in memory
        XCTAssertTrue(service.items.contains(where: { $0.id == created.id }))
    }

    func testOfflineSync() async throws {
        // Create items offline
        MockNetworkMonitor.shared.simulateOffline()

        let item = try await service.create(YourEntity(/* ... */))

        // Verify pending
        XCTAssertEqual(service.pendingOperationsCount, 1)

        // Go online and sync
        MockNetworkMonitor.shared.simulateOnline()
        try await service.syncPendingOperations()

        // Verify synced
        XCTAssertEqual(service.pendingOperationsCount, 0)
    }
}
```

---

## Success Metrics

Track these metrics for each phase:

- **Offline functionality**: % of operations that work offline (target: 100%)
- **Sync success rate**: % of pending operations that sync successfully (target: >99%)
- **User-perceived latency**: Time from action → UI update (target: <100ms)
- **Conflict frequency**: How often server state differs from local (monitor)
- **Error recovery**: % of failed syncs that eventually succeed (target: >95%)

---

## Common Pitfalls

1. **Forgetting to update pending count** - Always call `updatePendingOperationsCount()` after Core Data changes
2. **Not handling temp ID replacement** - When server returns real ID, update all references
3. **Blocking main thread** - Always use background contexts for Core Data saves
4. **No retry limit** - Cap retries at 3 attempts to avoid infinite loops
5. **Missing conflict resolution** - Define clear rules (usually: server wins)

---

## Performance Considerations

- **Batch operations**: Fetch all pending items in one query
- **Background contexts**: Never block main thread with Core Data
- **Indexes**: Add Core Data indexes for `syncStatus` and `id` fields
- **Sync frequency**: 60-second timer is optimal (SyncManager default)
- **Network detection**: Use `NetworkMonitor` to avoid unnecessary sync attempts

---

## See Also

- [PHASE1_COMPLETION.md](./PHASE1_COMPLETION.md) - Comments implementation example
- [PHASE2_PLAN.md](./PHASE2_PLAN.md) - List Members migration plan
- [ARCHITECTURE.md](./ARCHITECTURE.md) - Overall system architecture
