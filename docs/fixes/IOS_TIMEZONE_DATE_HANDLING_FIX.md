# iOS Timezone Date Handling Fix

**Date**: November 2024
**Platforms**: iOS, Web
**Issue**: Tasks created/edited at certain times (e.g., 9pm PT) showed incorrect dates due to timezone handling bugs

---

## The Problem

### User Report (Nov 22, 2024 @ 9pm PT)
1. **All-day task set to "Today"** → Displayed as "Yesterday" (Nov 21)
2. **Adding time to all-day task** → Date shifted to yesterday
3. **Toggling times repeatedly** → Date drifted forward
4. **Web worked perfectly** → iOS-specific bugs

### Root Causes

1. **Inline `DateComponents()` initialization bug** in Swift
   - Creating `DateComponents(year: x, month: y, ...)` caused misinterpretation
   - Swift's type inference failed with inline initialization

2. **Missing `isAllDay` state updates**
   - `task.isAllDay` is immutable (from original task object)
   - After adding first time, `task.isAllDay` still `true` → wrong extraction method
   - Caused subsequent time changes to use UTC extraction on local dates

3. **Calendar.current with device settings**
   - `Calendar.current` retains device-specific settings
   - Need `Calendar(identifier: .gregorian)` for clean UTC calendar

---

## The Solution

### Critical Pattern #1: Explicit DateComponents

**❌ WRONG** (causes bugs):
```swift
let utcComponents = DateComponents(
    year: year,
    month: month,
    day: day,
    hour: 0,
    minute: 0,
    second: 0
)
```

**✅ CORRECT**:
```swift
var utcComponents = DateComponents()
utcComponents.year = year
utcComponents.month = month
utcComponents.day = day
utcComponents.hour = 0
utcComponents.minute = 0
utcComponents.second = 0
```

**Why**: Inline initialization causes Swift to misinterpret values. Explicit property assignment is unambiguous.

**Locations**:
- `InlineDatePicker.setQuickDate()` - Line 188-194
- `InlineDatePicker` DatePicker setter - Line 132-138
- `InlineDatePicker.formatDate()` - Line 219-225

### Critical Pattern #2: Fresh Gregorian UTC Calendar

**❌ WRONG**:
```swift
var utcCalendar = Calendar.current  // Retains device settings!
utcCalendar.timeZone = TimeZone(identifier: "UTC")!
```

**✅ CORRECT**:
```swift
var utcCalendar = Calendar(identifier: .gregorian)  // Clean calendar
utcCalendar.timeZone = TimeZone(identifier: "UTC")!
```

**Why**: `Calendar.current` retains device settings that interfere with UTC operations.

**Locations**:
- All UTC calendar creation in `InlineDatePicker.swift`
- All UTC calendar creation in `TaskDetailViewNew.swift`

### Critical Pattern #3: Track `isAllDay` State

**Problem**: `task.isAllDay` never updates (immutable task object)

**Solution**: Maintain separate `@State var isAllDay: Bool`

```swift
@State private var isAllDay: Bool  // Tracks CURRENT state

init(task: Task, isReadOnly: Bool = false) {
    _isAllDay = State(initialValue: task.isAllDay)  // Initialize from task
}

// Update when adding time
private func saveDueTime() async {
    await MainActor.run {
        editedDueDate = combinedDate
        isAllDay = false  // ← CRITICAL: Update state
    }
}

// Update when setting date without time
private func saveDueDate() {
    if editedDueTime == nil {
        await MainActor.run {
            isAllDay = true  // ← CRITICAL: Update state
        }
    }
}
```

**Why**: Determines whether to extract UTC or LOCAL components
- `isAllDay = true` → Extract UTC components (all-day → timed)
- `isAllDay = false` → Extract LOCAL components (timed → timed)

**Locations**:
- `TaskDetailViewNew.swift` - Lines 26, 54, 487, 534, 561, 572

### Critical Pattern #4: All-Day Date Creation Flow

**Correct flow** for creating all-day dates:

```swift
// 1. Get LOCAL calendar day
let localCalendar = Calendar.current
let now = Date()
let components = localCalendar.dateComponents([.year, .month, .day], from: now)

// 2. Create UTC midnight with LOCAL calendar day
var utcCalendar = Calendar(identifier: .gregorian)
utcCalendar.timeZone = TimeZone(identifier: "UTC")!

var utcComponents = DateComponents()  // ← Explicit!
utcComponents.year = components.year
utcComponents.month = components.month
utcComponents.day = components.day
utcComponents.hour = 0
utcComponents.minute = 0
utcComponents.second = 0

let utcMidnight = utcCalendar.date(from: utcComponents)
// → Nov 22 00:00 UTC (when local day is Nov 22)
```

**Never**:
- ❌ Use `Date()` directly and convert to UTC (gives wrong day in PT)
- ❌ Use `Calendar.current` for UTC operations
- ❌ Use inline `DateComponents()` initialization

### Critical Pattern #5: Adding Time to All-Day Task

**Correct flow** for all-day → timed:

```swift
private func saveDueTime() async {
    let dateComponents: DateComponents

    if isAllDay {  // ← Check CURRENT state
        // All-day → timed: Extract UTC components
        var utcCalendar = Calendar(identifier: .gregorian)
        utcCalendar.timeZone = TimeZone(identifier: "UTC")!
        dateComponents = utcCalendar.dateComponents([.year, .month, .day], from: editedDueDate)
    } else {
        // Timed → timed: Extract LOCAL components (preserves date!)
        let localCalendar = Calendar.current
        dateComponents = localCalendar.dateComponents([.year, .month, .day], from: editedDueDate)
    }

    // Combine with selected time...
    // Update state: isAllDay = false ← CRITICAL
}
```

**Why this works**:
1. First time add: `isAllDay = true` → Extract UTC components from UTC midnight → Nov 22
2. Second time change: `isAllDay = false` → Extract LOCAL components from local datetime → Nov 22 (preserved!)
3. No date drift!

---

## Test Scenarios

### All scenarios tested at 9pm PT on Nov 22, 2024:

✅ **Create all-day task for "Today"**
- Should create Nov 22 00:00 UTC
- Should display as "Today" on both iOS and web

✅ **Add 9pm to all-day task**
- Should create Nov 22 at 9pm PT
- Should NOT shift to Nov 21
- Date should stay "Nov 22"

✅ **Change time 9pm → 9am → 9pm**
- Date should stay Nov 22
- Should NOT drift forward
- Should work after multiple changes

✅ **Clear time (timed → all-day)**
- Should convert to Nov 22 00:00 UTC
- Should display as "Today"

✅ **Web tasks sync to iOS**
- All-day tasks created on web show correct day on iOS
- Timed tasks created on web show correct day/time on iOS

---

## Files Modified

### iOS App
- `ios-app/Astrid App/Views/Components/InlineDatePicker.swift`
  - `setQuickDate()` - Lines 185-201
  - DatePicker setter - Lines 116-148
  - `formatDate()` - Lines 203-231

- `ios-app/Astrid App/Views/Tasks/TaskDetailViewNew.swift`
  - Added `@State var isAllDay` - Line 26
  - `saveDueDate()` - Lines 464-503
  - `saveDueTime()` - Lines 505-583
  - `formatDateReadOnly()` - Lines 606-617

### Web Tests (Validation)
- `tests/components/task-detail/due-date-edits-across-zones.test.tsx` - All tests pass (replaced `tests/lib/timezone-task-creation.test.ts`, which tested an in-file copy; AWTD-1422)
- `tests/api/date-sync-ios-web.test.ts` - All tests pass
- `tests/lib/date-timezone-handling.test.ts` - All tests pass

---

## Prevention Guidelines

### DO ✅

1. **Always use explicit DateComponents**:
   ```swift
   var components = DateComponents()
   components.year = year
   // ... etc
   ```

2. **Always use fresh Gregorian calendar for UTC**:
   ```swift
   var utcCalendar = Calendar(identifier: .gregorian)
   utcCalendar.timeZone = TimeZone(identifier: "UTC")!
   ```

3. **Always track `isAllDay` state**:
   ```swift
   @State private var isAllDay: Bool
   // Update when adding/removing time
   ```

4. **Always extract LOCAL calendar day first, then convert to UTC midnight**:
   ```swift
   let local = localCalendar.dateComponents([.year, .month, .day], from: Date())
   // Then create UTC midnight with these components
   ```

### DON'T ❌

1. **Never use inline DateComponents initialization**:
   ```swift
   DateComponents(year: x, month: y, ...)  // ❌ BUG!
   ```

2. **Never use `Calendar.current` for UTC operations**:
   ```swift
   var utcCal = Calendar.current  // ❌ Retains device settings
   ```

3. **Never rely on `task.isAllDay` after first edit**:
   ```swift
   if task.isAllDay { }  // ❌ Never updates!
   ```

4. **Never use UTC day directly as local day**:
   ```swift
   Date().getUTCDate()  // ❌ Wrong day in PT timezone
   ```

---

## Related Issues

- Original bug report: Nov 22, 2024 @ 9pm PT
- Similar web fix: `TaskFieldEditors.tsx` uses `setUTCHours(0,0,0,0)`
- Google Calendar spec: All-day events stored at midnight UTC

---

## References

- [Google Calendar API - All-Day Events](https://developers.google.com/calendar/api/v3/reference/events)
- Swift DateComponents: Must use explicit assignment for reliability
- Timezone handling: Always LOCAL → UTC for user-facing dates

---

## Quick Reference

**When user selects "Today" at 9pm PT on Nov 22:**

```
User's local time: Nov 22, 9pm PT
Local calendar day: Nov 22
Expected storage:   Nov 22, 00:00 UTC ✅
Expected display:   "Today" ✅

WRONG approaches that create Nov 21:
- Using Date() directly in UTC context
- Using Calendar.current for UTC operations
- Using inline DateComponents initialization
```
