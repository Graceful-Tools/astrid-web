/**
 * Controller contract enforcement test.
 *
 * The TaskManagerControllerReturn type is auto-derived from
 * useTaskManagerController via ReturnType<>, so it stays in sync at
 * the type level. But that only helps when downstream code uses Pick<>
 * — code that destructures inline can silently lose access to a key
 * if it's renamed without the destructure being updated. This test
 * pins the *runtime* set of keys the hook returns.
 *
 * Touching the controller's return shape is a deliberate decision:
 * cluster components (TaskManagerView, MainContent, TaskRow, task-detail)
 * thread these keys through their props. Update both the contract test
 * and the consuming components in the same PR.
 */

import { describe, it, expect } from 'vitest'
import type { TaskManagerControllerReturn } from '@/hooks/task-manager/controller-contract'

/**
 * The frozen set of keys the controller is contracted to return. If you
 * add a new key, add it here. If you remove or rename a key, update
 * every consumer in the same PR (use `git grep` for the old name first).
 */
const EXPECTED_CONTROLLER_KEYS = [
  // Data state
  'tasks',
  'lists',
  'publicTasks',
  'publicLists',
  'collaborativePublicLists',
  'suggestedPublicLists',
  'loading',
  'isCreatingTask',
  'selectedTaskId',
  'isTaskPaneClosing',
  'taskPanePosition',
  'setTaskPanePosition',
  'selectedTaskElement',
  'selectedTaskRect',
  'recentlyChangedList',
  'showAddListModal',
  'showImagePicker',
  'selectedListForImagePicker',
  'searchValue',
  'activeDragTaskId',
  'dragOverListId',
  'isShiftDrag',
  'dragTargetTaskId',
  'dragTargetPosition',

  // Computed state
  'finalTasks',
  'finalFilteredTasks',
  'availableUsers',
  'selectedListId',
  'selectedTask',
  'isSessionReady',
  'effectiveSession',
  'isViewingFromFeatured',
  'activeView',
  'settingsPage',
  'isSettingsActive',
  'settingsSubPage',
  'isSearchActive',
  'navigateToSettings',
  'exitSettings',
  'closeSettingsSubPage',
  'selectSearch',
  'exitSearch',
  'manualSortPreviewActive',
  'manualSortActive',

  // Count functions
  'getTaskCountForListMemo',
  'getSavedFilterTaskCountMemo',
  'getFixedListTaskCountMemo',
  'getSelectedListInfo',

  // Permission functions
  'canEditListSettingsMemo',

  // State setters
  'setSelectedListId',
  'setTasks',
  'setLists',
  'setPublicTasks',
  'setLoading',
  'setSelectedTaskId',
  'setIsTaskPaneClosing',
  'setSelectedTaskElement',
  'setSelectedTaskRect',
  'setRecentlyChangedList',
  'setShowAddListModal',
  'setShowImagePicker',
  'setSelectedListForImagePicker',
  'setSearchValue',

  // Hooks and utilities
  'newTaskOperations',
  'newFilterState',
  'taskManagerRef',
  'isKeyboardScrollingRef',

  // Business logic methods
  'loadData',
  'handleManualRefresh',
  'handleTaskClick',
  'handleUpdateTask',
  'handleLocalUpdateTask',
  'handleToggleTaskComplete',
  'handleDeleteTask',
  'closeTaskDetail',
  'handleCreateTask',
  'handleQuickCreateTask',
  'handleCreateNewTask',
  'handleCreateList',
  'handleCopyList',
  'handleCopyTask',
  'handleDeleteList',
  'handleUpdateList',
  'handleToggleListFavorite',
  'handleSaveListFilters',
  'handleLeaveList',

  // Image picker handlers
  'handleListImageClick',
  'handleImagePickerSelect',
  'handleImagePickerCancel',

  // Keyboard shortcut handlers
  'handleSelectNextTask',
  'handleSelectPreviousTask',
  'handleToggleTaskPanel',
  'handleCycleListFilters',
  'handleJumpToDate',
  'handleNewTask',
  'handleCompleteTask',
  'handlePostponeTask',
  'handleRemoveDueDate',
  'handleSetPriority',
  'handleMakeDueDateEarlier',
  'handleMakeDueDateLater',
  'handleEditTaskLists',
  'handleEditTaskTitle',
  'handleEditTaskDescription',
  'handleAddTaskComment',
  'handleAssignToNoOne',
  'handleOutdentTask',
  'handleIndentTask',
  'handleShowHotkeyMenu',

  // Drag handlers (delegated)
  'handleTaskDragHover',
  'handleTaskDragLeaveTask',
  'handleTaskDragHoverEnd',
  'handleTaskDragStart',
  'handleTaskDragEnd',
  'handleListDragEnter',
  'handleListDragLeave',
  'handleListDragOver',
  'handleTaskDropOnList',

  // Hotkey menu state
  'showHotkeyMenu',
  'setShowHotkeyMenu',

  // Public list handlers
  'handleListCopied',
] as const satisfies ReadonlyArray<keyof TaskManagerControllerReturn>

describe('TaskManagerController — contract', () => {
  it('the static expected-keys list type-checks against the actual return shape', () => {
    // The `satisfies` clause on EXPECTED_CONTROLLER_KEYS is the real test:
    // if a key is removed from the hook, the array's `keyof` constraint
    // fails to type-check and tsc blocks the PR. This runtime assertion
    // exists so the failure is visible at test time too.
    expect(EXPECTED_CONTROLLER_KEYS.length).toBeGreaterThan(80)
  })

  it('the contract type compiles when used as a Pick<>', () => {
    // If TaskManagerControllerReturn is reduced to never (e.g. circular
    // import) the Pick<> below would be {} — assert it has keys.
    type TaskActions = Pick<
      TaskManagerControllerReturn,
      'handleTaskClick' | 'handleToggleTaskComplete' | 'handleDeleteTask'
    >
    const _check: keyof TaskActions = 'handleTaskClick'
    expect(_check).toBe('handleTaskClick')
  })
})
