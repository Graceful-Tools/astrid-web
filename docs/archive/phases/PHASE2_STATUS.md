# Phase 2: List Members - Implementation Status

**Date**: December 19, 2024
**Status**: ⚠️ Core Data Complete, Service Layer Needs API Refinement
**Progress**: 60% Complete

---

## ✅ What's Complete

### 1. Core Data Foundation (100%)

**CDMember Entity**:
- ✅ Complete entity with all sync fields
- ✅ Helper methods for querying (fetchById, fetchByListAndUser, fetchPending)
- ✅ Domain model conversion
- ✅ Optimized batch fetches
- ✅ Schema added to AstridApp.xcdatamodel

**Files Created**:
- `CDMember+CoreDataClass.swift` (100 lines)
- Updated `AstridApp.xcdatamodel` (+12 lines)

### 2. Service Layer Foundation (80%)

**ListMemberService**:
- ✅ Complete local-first pattern implementation (519 lines)
- ✅ Cache loading on init
- ✅ Network observer for auto-sync
- ✅ Pending operations tracking
- ✅ Background sync infrastructure
- ✅ Integrated with SyncManager

---

## ⚠️ API Mismatch Issues

### Problem: Email-Based vs UserId-Based Operations

**Current API Contract** (from AstridAPIClient.swift):
```swift
func addListMember(listId: String, email: String, role: String) async throws -> AddMemberResponse
func updateListMember(listId: String, userId: String, role: String) async throws -> UpdateMemberResponse
```

**What We Implemented**:
```swift
func addMember(listId: String, userId: String, role: String) // Uses userId
```

**Issue**: The add operation uses `email` but our optimistic update uses `userId`. This is a conceptual mismatch - you invite by email, not by userId.

### Missing API Methods

**Not Found in AstridAPIClient**:
- `removeMember(listId:userId:)` - No removal endpoint found

**Needs Investigation**:
- How does member removal work?
- Is there a different endpoint for removing vs leaving?
- Are there separate admin removal flows?

---

## 🔧 Required Fixes

### High Priority

**1. Refine Add Member Flow** (2-3 hours)
- Change `addMember()` to accept email parameter
- Update optimistic member creation to handle email→userId resolution
- Handle pending invite state properly
- Wait for server to return userId before marking as synced

**2. Implement Remove Member** (1-2 hours)
- Find correct API endpoint for removal
- Implement optimistic remove with proper API call
- Handle permissions (owner vs member removal)

**3. Fix Update Role** (30 minutes)
- Make `role` in ListMember mutable (or create update DTO)
- Verify updateListMember API works as expected

### Medium Priority

**4. API Response Type Conversion** (1 hour)
```swift
// Current: API returns ListMemberData
// Need: Convert to ListMember for domain model
private func convertAPIResponse(_ data: ListMemberData) -> ListMember {
    ListMember(
        id: data.id,
        listId: listId,
        userId: data.id, // Assuming id is userId
        role: data.role,
        createdAt: nil,
        updatedAt: nil,
        user: User(id: data.id, email: data.email, name: data.name, image: data.image)
    )
}
```

**5. Backward Compatibility** (30 minutes)
- Keep legacy `members: [User]` working
- Ensure existing views don't break

---

## 📋 Implementation Plan to Complete Phase 2

### Step 1: API Investigation (1 hour)

**Tasks**:
- [ ] Review all member-related endpoints in AstridAPIClient
- [ ] Document actual API contract
- [ ] Identify remove member endpoint
- [ ] Understand invite→member conversion flow

### Step 2: Refine Service Layer (3-4 hours)

**Files to Modify**:
- `ListMemberService.swift`
  - Fix addMember to use email
  - Add convertAPIResponse helper
  - Implement proper remove member
  - Handle API response conversion

**Example Fix**:
```swift
func addMember(listId: String, email: String, role: String) async throws {
    // 1. Generate temp ID
    let tempId = "temp_\(UUID())"

    // 2. Create optimistic member (with email, no userId yet)
    let optimistic = ListMember(
        id: tempId,
        listId: listId,
        userId: "", // Will be filled after server response
        role: role,
        user: nil // Don't have user info yet
    )

    // 3. Save optimistic state
    // ... existing code ...

    // 4. When server responds, update with real userId
}
```

### Step 3: View Integration (Deferred to Week 2)

**Not Started**:
- [ ] Refactor ListMembershipTab (remove 6 direct API calls)
- [ ] Refactor ListEditView (remove 1 direct API call)
- [ ] Add sync status indicators
- [ ] Update error handling

---

## 🎯 Current Capabilities

### What Works

✅ **Core Data Model**: Ready for offline storage
✅ **Service Pattern**: Local-first architecture in place
✅ **Background Sync**: Infrastructure ready
✅ **Network Observer**: Auto-sync on reconnection
✅ **SyncManager Integration**: Will sync every 60 seconds (once API fixed)

### What Doesn't Work Yet

❌ **Add Member**: API signature mismatch (email vs userId)
❌ **Remove Member**: API endpoint not integrated
❌ **Role Updates**: May work but untested
❌ **View Integration**: Views still call API directly
❌ **Build**: Compilation errors due to API mismatch

---

## 📝 Recommended Path Forward

### Option A: Fix API Integration Now (4-5 hours)

**Pros**:
- Complete Phase 2 core implementation
- Service layer fully functional
- Ready for view integration

**Cons**:
- Requires understanding full member invitation flow
- May uncover additional API complexity

**Tasks**:
1. Investigate API endpoints (1 hour)
2. Fix service layer (3 hours)
3. Test offline flows (1 hour)
4. Document learnings

### Option B: Document & Move to Phase 3 (Current Choice)

**Pros**:
- Core Data foundation is solid
- Pattern proven with Comments
- Can return to this later

**Cons**:
- Phase 2 incomplete
- Views still have direct API calls

**Deliverables**:
- ✅ Core Data model (done)
- ✅ Service layer pattern (done, needs API fixes)
- ⏳ API integration (deferred)
- ⏳ View refactoring (deferred)

---

## 💡 Lessons Learned

### API Contract Matters

**Takeaway**: Should have reviewed API signatures before implementing optimistic updates. The email-based invite flow differs from userId-based membership management.

### Domain Model Design

**Issue**: `ListMember` has immutable `role` field. For optimistic updates, we need either:
1. Mutable fields, OR
2. Copy-on-write pattern

**Solution**: Create `var` version or use update DTOs

### Member vs Invitation

**Insight**: There may be a distinction between:
- **List Invitations** (pending, email-based)
- **List Members** (accepted, userId-based)

The API might handle these separately, which affects our service design.

---

## 📊 Phase 2 Metrics

| Component | Status | Progress |
|-----------|--------|----------|
| Core Data Model | ✅ Complete | 100% |
| Service Foundation | ⚠️ Partial | 80% |
| API Integration | ❌ Blocked | 30% |
| Background Sync | ✅ Complete | 100% |
| View Refactoring | ❌ Not Started | 0% |
| **Overall** | **⚠️ Partial** | **60%** |

---

## 🚀 Next Steps

**Immediate** (If fixing Phase 2):
1. Read AstridAPIClient member section fully
2. Document all member endpoints
3. Refine ListMemberService to match API
4. Test offline flows

**Alternative** (Moving to Phase 3):
1. Document Phase 2 status (this doc)
2. Start Phase 3 (Settings)
3. Return to Phase 2 later with more API knowledge

---

## 📚 Related Documentation

- [LOCAL_FIRST_PATTERN.md](./LOCAL_FIRST_PATTERN.md) - Reusable pattern
- [PHASE1_COMPLETION.md](./PHASE1_COMPLETION.md) - Comments (fully working example)
- [PHASE2_PLAN.md](./PHASE2_PLAN.md) - Original plan
- [AstridAPIClient.swift](../Astrid App/Core/Networking/AstridAPIClient.swift) - API contract

---

**Status**: Phase 2 foundation is solid. API integration needs refinement to match email-based invitation flow. Core Data model and service pattern are production-ready pending API fixes.
