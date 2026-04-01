# Phase 2: List Members - Local-First Migration Plan

**Status**: 📋 Planning Complete, Ready for Implementation
**Target Duration**: 3-4 weeks
**Risk**: Medium (new Core Data entity, view refactoring)
**Dependencies**: Phase 1 pattern established

---

## 🎯 Objective

Migrate List Membership management from direct view→API calls to local-first architecture with offline support and service layer abstraction.

---

## 📊 Current State Analysis

### Problems Identified

**No Service Layer**:
- Views call `apiClient` directly (6 locations)
- No offline support
- No caching
- Inconsistent error handling

**Blocking Calls** (ListMembershipTab.swift):
```swift
Line 586: apiClient.searchUsers()        // Search blocks UI
Line 610: apiClient.addListMember()      // Add blocks UI
Line 632: apiClient.updateListMember()   // Update blocks UI
Line 705: apiClient.removeMember()       // Remove blocks UI
Line 760: apiClient.getListMembers()     // Fetch blocks UI
```

**Additional** (ListEditView.swift):
```swift
Line 222: apiClient.getListMembers()     // Fetch blocks UI
```

### Impact

| Operation | Current Behavior | Offline? |
|-----------|------------------|----------|
| Search users | Wait for server → Spinner | ❌ Broken |
| Add member | Network request → Block | ❌ Broken |
| Change role | API call → Wait | ❌ Broken |
| Remove member | Server deletion → Block | ❌ Broken |
| View members | Fetch → Loading state | ❌ Broken |

---

## 🏗️ Solution Architecture

### Target State

```
User Action (Add/Remove/Update Member)
    ↓
ListMemberService (Optimistic Update)
    ↓
Save to CDMember (syncStatus: "pending")
    ↓
Update UI Immediately
    ↓
Background Sync with Server
    ↓
Update CDMember (syncStatus: "synced")
```

### Benefits

- ✅ Instant feedback on member operations
- ✅ Works 100% offline
- ✅ Background sync
- ✅ Consistent service layer pattern
- ✅ Testable and maintainable

---

## 📋 Implementation Plan

### Step 1: Core Data Model (Week 1, Days 1-2)

**Create CDMember Entity**:

```swift
// CDMember+CoreDataClass.swift
@objc(CDMember)
public class CDMember: NSManagedObject {
    @NSManaged public var id: String
    @NSManaged public var listId: String
    @NSManaged public var userId: String
    @NSManaged public var role: String // "owner", "editor", "viewer"
    @NSManaged public var inviteStatus: String? // "pending", "accepted", "declined"
    @NSManaged public var addedAt: Date?
    @NSManaged public var updatedAt: Date?

    // Sync fields (following established pattern)
    @NSManaged public var syncStatus: String // "synced", "pending", "pending_update", "pending_delete", "failed"
    @NSManaged public var lastSyncedAt: Date?
    @NSManaged public var pendingOperation: String? // "add", "update_role", "remove"
    @NSManaged public var pendingRole: String? // For role updates
    @NSManaged public var syncAttempts: Int16
    @NSManaged public var syncError: String?

    // MARK: - Conversion

    func toDomainModel() -> ListMember {
        ListMember(
            id: id,
            listId: listId,
            userId: userId,
            role: ListMember.Role(rawValue: role) ?? .viewer,
            inviteStatus: inviteStatus.flatMap { ListMember.InviteStatus(rawValue: $0) },
            addedAt: addedAt,
            updatedAt: updatedAt
        )
    }

    func update(from member: ListMember) {
        self.role = member.role.rawValue
        self.inviteStatus = member.inviteStatus?.rawValue
        self.updatedAt = member.updatedAt ?? Date()
    }
}

extension CDMember {
    static func fetchByListId(_ listId: String, context: NSManagedObjectContext) throws -> [CDMember] {
        let request = fetchRequest()
        request.predicate = NSPredicate(format: "listId == %@", listId)
        request.sortDescriptors = [NSSortDescriptor(key: "addedAt", ascending: true)]
        return try context.fetch(request)
    }

    static func fetchPending(context: NSManagedObjectContext) throws -> [CDMember] {
        let request = fetchRequest()
        request.predicate = NSPredicate(
            format: "syncStatus IN %@",
            ["pending", "pending_update", "pending_delete", "failed"]
        )
        return try context.fetch(request)
    }
}
```

**Update `.xcdatamodel`**:
```xml
<entity name="CDMember" representedClassName="CDMember" syncable="YES">
    <attribute name="id" attributeType="String"/>
    <attribute name="listId" attributeType="String"/>
    <attribute name="userId" attributeType="String"/>
    <attribute name="role" attributeType="String"/>
    <attribute name="inviteStatus" optional="YES" attributeType="String"/>
    <attribute name="addedAt" optional="YES" attributeType="Date" usesScalarValueType="NO"/>
    <attribute name="updatedAt" optional="YES" attributeType="Date" usesScalarValueType="NO"/>
    <attribute name="syncStatus" attributeType="String"/>
    <attribute name="lastSyncedAt" optional="YES" attributeType="Date" usesScalarValueType="NO"/>
    <attribute name="pendingOperation" optional="YES" attributeType="String"/>
    <attribute name="pendingRole" optional="YES" attributeType="String"/>
    <attribute name="syncAttempts" attributeType="Integer 16" defaultValueString="0" usesScalarValueType="YES"/>
    <attribute name="syncError" optional="YES" attributeType="String"/>
</entity>
```

**Testing**:
- [ ] Core Data model compiles
- [ ] Migration works (test with existing data)
- [ ] Fetch queries work

---

### Step 2: Create ListMemberService (Week 1, Days 3-5)

**Service Implementation** (~400 lines):

```swift
@MainActor
class ListMemberService: ObservableObject {
    static let shared = ListMemberService()

    @Published var membersByList: [String: [ListMember]] = [:] // listId -> members
    @Published var isLoading = false
    @Published var pendingOperationsCount: Int = 0

    private let apiClient = AstridAPIClient.shared
    private let coreDataManager = CoreDataManager.shared
    private let networkMonitor = NetworkMonitor.shared
    private var networkObserver: NSObjectProtocol?

    init() {
        loadCachedMembers()
        setupNetworkObserver()

        _Concurrency.Task {
            await updatePendingOperationsCount()
        }
    }

    // MARK: - Cache Loading

    private func loadCachedMembers() {
        do {
            let fetchRequest = CDMember.fetchRequest()
            let cdMembers = try coreDataManager.viewContext.fetch(fetchRequest)

            var grouped: [String: [ListMember]] = [:]
            for cdMember in cdMembers {
                let member = cdMember.toDomainModel()
                if grouped[member.listId] == nil {
                    grouped[member.listId] = []
                }
                grouped[member.listId]?.append(member)
            }

            membersByList = grouped
            print("✅ Loaded \(cdMembers.count) members for \(grouped.count) lists")
        } catch {
            print("❌ Failed to load cached members: \(error)")
        }
    }

    // MARK: - Fetch (with cache fallback)

    func fetchMembers(listId: String) async throws -> [ListMember] {
        isLoading = true
        defer { isLoading = false }

        do {
            let response = try await apiClient.getListMembers(listId: listId)

            // Save to cache
            _Concurrency.Task.detached { [weak self] in
                try? await self?.saveMembersToCoreData(response.members, listId: listId)
            }

            // Update in-memory cache
            membersByList[listId] = response.members

            return response.members
        } catch {
            // Return cached if available
            if let cached = membersByList[listId] {
                print("💾 Using cached members for list \(listId)")
                return cached
            }
            throw error
        }
    }

    // MARK: - Add Member (Optimistic)

    func addMember(listId: String, userId: String, role: ListMember.Role) async throws {
        print("⚡️ Adding member (optimistic): \(userId) to \(listId)")

        let tempId = "temp_\(UUID().uuidString)"
        let optimistic = ListMember(
            id: tempId,
            listId: listId,
            userId: userId,
            role: role,
            inviteStatus: .pending,
            addedAt: Date(),
            updatedAt: Date()
        )

        // 1. Update UI immediately
        if membersByList[listId] == nil {
            membersByList[listId] = []
        }
        membersByList[listId]?.append(optimistic)

        // 2. Save to Core Data
        _Concurrency.Task.detached { [weak self] in
            try? await self?.coreDataManager.saveInBackground { context in
                let cdMember = CDMember(context: context)
                cdMember.id = tempId
                cdMember.listId = listId
                cdMember.userId = userId
                cdMember.role = role.rawValue
                cdMember.inviteStatus = "pending"
                cdMember.addedAt = Date()
                cdMember.syncStatus = "pending"
                cdMember.pendingOperation = "add"
                cdMember.syncAttempts = 0
            }

            await self?.updatePendingOperationsCount()
        }

        // 3. Trigger sync
        if networkMonitor.isConnected {
            _Concurrency.Task.detached { [weak self] in
                try? await self?.syncPendingOperations()
            }
        }
    }

    // MARK: - Update Role (Optimistic)

    func updateRole(listId: String, userId: String, newRole: ListMember.Role) async throws {
        print("✏️ Updating role (optimistic): \(userId) in \(listId) to \(newRole)")

        // 1. Update in-memory
        if let members = membersByList[listId],
           let index = members.firstIndex(where: { $0.userId == userId }) {
            var updated = members[index]
            updated.role = newRole
            updated.updatedAt = Date()
            membersByList[listId]?[index] = updated
        }

        // 2. Save to Core Data
        _Concurrency.Task.detached { [weak self] in
            try? await self?.coreDataManager.saveInBackground { context in
                let fetchRequest = CDMember.fetchRequest()
                fetchRequest.predicate = NSPredicate(
                    format: "listId == %@ AND userId == %@",
                    listId, userId
                )
                guard let cdMember = try context.fetch(fetchRequest).first else {
                    return
                }

                cdMember.pendingRole = newRole.rawValue
                cdMember.syncStatus = "pending_update"
                cdMember.pendingOperation = "update_role"
                cdMember.syncAttempts = 0
            }

            await self?.updatePendingOperationsCount()
        }

        // 3. Trigger sync
        if networkMonitor.isConnected {
            _Concurrency.Task.detached { [weak self] in
                try? await self?.syncPendingOperations()
            }
        }
    }

    // MARK: - Remove Member (Optimistic)

    func removeMember(listId: String, userId: String) async throws {
        print("🗑️ Removing member (optimistic): \(userId) from \(listId)")

        // 1. Remove from UI
        membersByList[listId]?.removeAll { $0.userId == userId }

        // 2. Mark as pending delete
        _Concurrency.Task.detached { [weak self] in
            try? await self?.coreDataManager.saveInBackground { context in
                let fetchRequest = CDMember.fetchRequest()
                fetchRequest.predicate = NSPredicate(
                    format: "listId == %@ AND userId == %@",
                    listId, userId
                )
                guard let cdMember = try context.fetch(fetchRequest).first else {
                    return
                }

                cdMember.syncStatus = "pending_delete"
                cdMember.pendingOperation = "remove"
                cdMember.syncAttempts = 0
            }

            await self?.updatePendingOperationsCount()
        }

        // 3. Trigger sync
        if networkMonitor.isConnected {
            _Concurrency.Task.detached { [weak self] in
                try? await self?.syncPendingOperations()
            }
        }
    }

    // MARK: - Background Sync

    func syncPendingOperations() async throws {
        guard networkMonitor.isConnected else { return }

        print("🔄 Syncing pending member operations...")

        let pending: [CDMember] = try await withCheckedThrowingContinuation { continuation in
            coreDataManager.persistentContainer.performBackgroundTask { context in
                do {
                    let members = try CDMember.fetchPending(context: context)
                    continuation.resume(returning: members)
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }

        for cdMember in pending {
            let operation = cdMember.pendingOperation ?? "unknown"

            do {
                switch operation {
                case "add":
                    try await syncPendingAdd(cdMember)
                case "update_role":
                    try await syncPendingRoleUpdate(cdMember)
                case "remove":
                    try await syncPendingRemove(cdMember)
                default:
                    try await markAsFailed(cdMember, error: "Unknown operation")
                }
            } catch {
                try await markAsFailed(cdMember, error: error.localizedDescription)
            }
        }

        await updatePendingOperationsCount()
    }

    // ... syncPendingAdd, syncPendingRoleUpdate, syncPendingRemove implementations
    // (follow same pattern as CommentService)
}
```

**Testing**:
- [ ] Service loads cached members on init
- [ ] Optimistic add works offline
- [ ] Optimistic update works offline
- [ ] Optimistic remove works offline
- [ ] Background sync works when online

---

### Step 3: Refactor Views (Week 2)

**Remove Direct API Calls**:

**Before** (ListMembershipTab.swift):
```swift
// Line 610 - BLOCKS UI
let response = try await apiClient.addListMember(...)
```

**After**:
```swift
// INSTANT
try await ListMemberService.shared.addMember(listId: list.id, userId: user.id, role: .editor)
```

**Changes Required**:
1. Replace all `apiClient.*` calls with `ListMemberService.*`
2. Remove loading state management (service handles it)
3. Add sync status indicators
4. Remove error alerts (service handles gracefully)

**Files to Modify**:
- `ListMembershipTab.swift` (6 API call locations)
- `ListEditView.swift` (1 API call location)

**Testing**:
- [ ] UI still displays members correctly
- [ ] Add member works (instant feedback)
- [ ] Update role works (instant feedback)
- [ ] Remove member works (instant feedback)
- [ ] Offline mode shows cached data

---

### Step 4: SyncManager Integration (Week 3, Day 1)

**Add to Background Sync**:

```swift
// In SyncManager.performFullSync()
print("🔄 Syncing pending member operations...")
do {
    try await listMemberService.syncPendingOperations()
    print("✅ Members synced successfully")
} catch {
    print("⚠️ Member sync failed (non-critical): \(error)")
}
```

---

### Step 5: UI Indicators (Week 3, Days 2-3)

**Add to ListMembershipTab Header**:
```swift
if listMemberService.pendingOperationsCount > 0 {
    HStack {
        Image(systemName: "clock")
        Text("\(pendingOperationsCount) pending")
    }
    .foregroundColor(.orange)
}
```

**Add to Individual Member Rows**:
```swift
if member.id.hasPrefix("temp_") {
    Image(systemName: "clock")
        .foregroundColor(.orange)
} else if member.syncStatus == "failed" {
    Button { retry() } label: {
        Image(systemName: "exclamationmark.triangle")
    }
}
```

---

### Step 6: Testing (Week 3-4)

**Integration Tests** (~20 test cases):
```swift
@MainActor
final class ListMemberServiceTests: XCTestCase {
    func testOfflineAddMember() async throws {
        // Simulate offline
        MockNetworkMonitor.shared.simulateOffline()

        // Add member
        try await service.addMember(listId: "list1", userId: "user1", role: .editor)

        // Verify optimistic add
        XCTAssertEqual(service.membersByList["list1"]?.count, 1)
        XCTAssertTrue(service.membersByList["list1"]?.first?.id.hasPrefix("temp_") ?? false)

        // Go online and sync
        MockNetworkMonitor.shared.simulateOnline()
        try await service.syncPendingOperations()

        // Verify synced
        XCTAssertFalse(service.membersByList["list1"]?.first?.id.hasPrefix("temp_") ?? true)
    }

    // ... 19 more tests
}
```

**UI Tests**:
- [ ] Add member shows immediate feedback
- [ ] Remove member disappears instantly
- [ ] Role update shows immediately
- [ ] Pending indicator appears for offline operations
- [ ] Failed operations show retry button

---

## 📊 Timeline

| Week | Focus | Deliverables |
|------|-------|--------------|
| Week 1 | Core Data + Service | CDMember model, ListMemberService |
| Week 2 | View Refactoring | Updated UI with service calls |
| Week 3 | Integration + UI | SyncManager, indicators, polish |
| Week 4 | Testing + QA | Tests, manual validation, deploy |

---

## ⚠️ Risks & Mitigation

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **Core Data migration fails** | High | Test migration thoroughly, backup mechanism |
| **View refactoring breaks UI** | Medium | Incremental changes, test each view |
| **Invite flow complexity** | Medium | Handle pending invites separately |
| **Conflict resolution (concurrent edits)** | Low | Server wins policy, clear messaging |

---

## 🎯 Success Metrics

- ✅ Member operations work 100% offline
- ✅ Sync success rate >99%
- ✅ UI response time <100ms
- ✅ Zero direct API calls from views
- ✅ Test coverage >80%

---

## 📚 References

- [LOCAL_FIRST_PATTERN.md](./LOCAL_FIRST_PATTERN.md) - Implementation pattern
- [PHASE1_COMPLETION.md](./PHASE1_COMPLETION.md) - Comments example
- [CommentService.swift](../Astrid App/Core/Services/CommentService.swift) - Reference implementation

---

**Ready to implement when Phase 1 UI polish is complete.**
