"use client"

/**
 * The one add-task control (task f699462a).
 *
 * It used to be the mobile-only bar. 2- and 3-column rendered a different
 * control for the same job — a single-line input with its own "Add Task" button
 * and its own `#list` autocomplete (enhanced-task-creation.tsx) — so the two
 * designs drifted and a control added to one was missing from the other.
 *
 * Now there is one control in two placements:
 *
 *   placement="fixed-bottom"  pinned over the list, 1-column (the original)
 *   placement="inline"        in the flow above the list, 2- and 3-column
 *
 * The only rendering difference the placements earn is the create button: in a
 * column wide enough for the words it grows a label, because there the space
 * exists. Everything else — the expanding textarea, the priority/assignee
 * picker, the hashtag autocomplete — is deliberately identical. The rules that
 * decide the differences are pure functions in lib/quick-add.ts.
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Plus, Hash } from "lucide-react"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { PriorityAssigneePicker } from "./priority-assignee-picker"
import type { User, TaskList } from '@/types/task'
import { useTranslations } from "@/lib/i18n/client"
import { getPriorityColor } from "@/lib/task-leading-control"
import { DEFAULT_LIST_COLOR } from '@/lib/brand/colors'
import {
  applyHashtagSelection,
  filterListsForHashtag,
  findHashtagQuery,
  quickAddPlaceholder,
  shouldShowAddTaskLabel,
  type LayoutType,
  type QuickAddPlacement,
} from '@/lib/quick-add'

interface QuickAddProps {
  selectedListId: string
  availableLists: TaskList[]
  availableUsers: User[]
  currentUser?: User
  quickTaskInput: string
  setQuickTaskInput: (value: string) => void
  onCreateTask: (title: string, options?: { priority?: number; assigneeId?: string | null; navigateToDetail?: boolean }) => Promise<string | null>
  onKeyDown: (e: React.KeyboardEvent) => void
  isSessionReady: boolean
  className?: string
  /** Defaults to the original 1-column bar so existing mounts are unchanged. */
  placement?: QuickAddPlacement
  /** Inline only — picks the contextual placeholder. */
  layoutType?: LayoutType
}

export function QuickAdd({
  selectedListId,
  availableLists,
  availableUsers,
  currentUser,
  quickTaskInput,
  setQuickTaskInput,
  onCreateTask,
  onKeyDown,
  isSessionReady,
  className = "",
  placement = "fixed-bottom",
  layoutType,
}: QuickAddProps) {
  const { t } = useTranslations()
  const [isCreating, setIsCreating] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [selectedPriority, setSelectedPriority] = useState<number>(0)
  const [selectedAssignee, setSelectedAssignee] = useState<User | null>(null)
  const [activeHashtagIndex, setActiveHashtagIndex] = useState(0)
  const [containerWidth, setContainerWidth] = useState<number | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  // Get contextual defaults from selected list
  const selectedList = availableLists.find(l => l.id === selectedListId)

  // Initialize defaults from list when list changes
  useEffect(() => {
    // For "My Tasks", default assignee to current user
    if (selectedListId === 'my-tasks') {
      setSelectedPriority(0)
      setSelectedAssignee(currentUser || null)
      return
    }

    if (selectedList) {
      setSelectedPriority(selectedList.defaultPriority || 0)

      // Find default assignee from various sources
      let defaultAssignee: User | null = null

      if (selectedList.defaultAssignee) {
        // Direct assignee object from list
        defaultAssignee = selectedList.defaultAssignee
      } else if (selectedList.defaultAssigneeId) {
        // Check if it's the current user
        if (currentUser && selectedList.defaultAssigneeId === currentUser.id) {
          defaultAssignee = currentUser
        } else if (availableUsers.length > 0) {
          // Look up in available users
          defaultAssignee = availableUsers.find(u => u.id === selectedList.defaultAssigneeId) || null
        }

        // Also check list members if not found
        if (!defaultAssignee && selectedList.members) {
          defaultAssignee = selectedList.members.find(u => u.id === selectedList.defaultAssigneeId) || null
        }
        if (!defaultAssignee && selectedList.admins) {
          defaultAssignee = selectedList.admins.find(u => u.id === selectedList.defaultAssigneeId) || null
        }
        if (!defaultAssignee && selectedList.owner?.id === selectedList.defaultAssigneeId) {
          defaultAssignee = selectedList.owner
        }
      }

      setSelectedAssignee(defaultAssignee)
    }
  }, [selectedListId, selectedList, availableUsers, currentUser])

  // Auto-resize textarea
  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      const newHeight = Math.min(Math.max(textarea.scrollHeight, 36), 120) // 36px min, 120px max (4-5 lines)
      textarea.style.height = `${newHeight}px`
    }
  }, [])

  useEffect(() => {
    adjustTextareaHeight()
  }, [quickTaskInput, adjustTextareaHeight])

  // The create button's label depends on how much room this column actually
  // has, not on which layout we are in: a 3-column column on a wide monitor can
  // be roomier than a 2-column one on a laptop. Measure the card itself.
  useEffect(() => {
    const card = cardRef.current
    if (placement !== 'inline' || !card) return
    if (typeof ResizeObserver === 'undefined') {
      setContainerWidth(card.getBoundingClientRect().width)
      return
    }
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width
      if (typeof width === 'number') setContainerWidth(width)
    })
    observer.observe(card)
    return () => observer.disconnect()
  }, [placement])

  const showAddTaskLabel = shouldShowAddTaskLabel(placement, containerWidth)

  // Hashtag autocomplete is derived from the input rather than mirrored into
  // state — the value is owned by the caller, so a second copy could disagree
  // with what is on screen (a list switch clears the input, for one).
  const hashtag = useMemo(() => findHashtagQuery(quickTaskInput), [quickTaskInput])
  const hashtagSuggestions = useMemo(
    () => (hashtag ? filterListsForHashtag(availableLists, hashtag.query) : []),
    [hashtag, availableLists],
  )
  const showHashtagSuggestions = hashtagSuggestions.length > 0

  useEffect(() => {
    setActiveHashtagIndex(0)
  }, [hashtag?.query])

  const selectHashtagSuggestion = useCallback((list: TaskList) => {
    setQuickTaskInput(applyHashtagSelection(quickTaskInput, list.name))
    textareaRef.current?.focus()
  }, [quickTaskInput, setQuickTaskInput])

  // Handle task creation
  const handleCreateTask = useCallback(async (navigateToDetail: boolean = false) => {
    if (!quickTaskInput.trim() || !isSessionReady || isCreating) return

    setIsCreating(true)
    try {
      await onCreateTask(quickTaskInput.trim(), {
        priority: selectedPriority,
        assigneeId: selectedAssignee?.id || null,
        navigateToDetail
      })
      setQuickTaskInput("")
      // Reset to list defaults after creation
      if (selectedList) {
        setSelectedPriority(selectedList.defaultPriority || 0)
      }
    } catch (error) {
      console.error('Quick-add task creation failed:', error)
    } finally {
      setIsCreating(false)
    }
  }, [quickTaskInput, isSessionReady, isCreating, onCreateTask, setQuickTaskInput, selectedPriority, selectedAssignee, selectedList])

  // Handle keyboard
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // While the dropdown is open the same keys mean "pick a list", so they must
    // be claimed before Enter would otherwise create the task.
    if (showHashtagSuggestions) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveHashtagIndex(prev => (prev + 1) % hashtagSuggestions.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveHashtagIndex(prev => (prev - 1 + hashtagSuggestions.length) % hashtagSuggestions.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        const choice = hashtagSuggestions[activeHashtagIndex]
        if (choice) selectHashtagSuggestion(choice)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setQuickTaskInput(quickTaskInput.replace(/#[^\s]*$/, ''))
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleCreateTask(false)
      return
    }
    onKeyDown(e)
  }, [
    handleCreateTask,
    onKeyDown,
    showHashtagSuggestions,
    hashtagSuggestions,
    activeHashtagIndex,
    selectHashtagSuggestion,
    quickTaskInput,
    setQuickTaskInput,
  ])

  // Handle priority/assignee selection
  const handlePickerSelect = useCallback((priority: number, assignee: User | null) => {
    setSelectedPriority(priority)
    setSelectedAssignee(assignee)
    setShowPicker(false)
    // Focus the input after selection
    textareaRef.current?.focus()
  }, [])

  // Get initials for avatar fallback
  const getInitials = (name?: string | null, email?: string) => {
    if (name) {
      return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    }
    return email?.charAt(0).toUpperCase() || '?'
  }

  const priorityColor = getPriorityColor(selectedPriority)

  // Get checkbox icon path (same as TaskCheckbox component)
  const getCheckboxIconPath = () => {
    const safePriority = selectedPriority >= 0 && selectedPriority <= 3 ? selectedPriority : 0
    return `/icons/check_box_${safePriority}.png`
  }

  const isFixedBottom = placement === 'fixed-bottom'
  const placeholder = quickAddPlaceholder({
    placement,
    layoutType,
    listName: selectedList?.name,
  })

  return (
    <>
      {/* fixed-bottom floats over the 1-column list (margins match the task list
          container's px-2); inline sits in the flow above the list, so it takes
          its width from the column and needs no positioning of its own. */}
      <div
        className={isFixedBottom ? `fixed z-30 ${className}` : className}
        style={isFixedBottom ? {
          left: 'max(0.5rem, env(safe-area-inset-left, 0.5rem))',
          right: 'max(0.5rem, env(safe-area-inset-right, 0.5rem))',
          bottom: 'max(0.75rem, env(safe-area-inset-bottom, 0.75rem))',
        } : undefined}
      >
        <div
          ref={cardRef}
          className={`quick-add bg-white dark:bg-gray-800 rounded-xl px-4 py-3 ${
            isFixedBottom ? 'shadow-[0_2px_12px_rgba(0,0,0,0.15)]' : ''
          }`}
        >
          <div className="flex items-center gap-3">
            {/* Priority/Assignee Button - uses same checkbox icons as task rows */}
            <button
              type="button"
              onClick={() => setShowPicker(true)}
              className="flex-shrink-0 flex items-center justify-center transition-all duration-200 active:scale-95"
              aria-label="Select priority or assignee"
            >
              {selectedAssignee === null ? (
                // Unassigned: Rounded rectangle with "U" (matches task checkbox style)
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center border-2"
                  style={{ borderColor: priorityColor }}
                >
                  <span
                    className="text-sm font-medium"
                    style={{ color: priorityColor }}
                  >
                    {t('tasks.unassignedMark')}
                  </span>
                </div>
              ) : selectedAssignee?.id === currentUser?.id ? (
                // Current user: Show checkbox (same as task rows)
                <Image
                  src={getCheckboxIconPath()}
                  alt={`Priority ${selectedPriority} checkbox`}
                  width={32}
                  height={32}
                  className="w-8 h-8"
                />
              ) : (
                // Other user: Show avatar with priority border
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ border: `2px solid ${priorityColor}` }}
                >
                  <Avatar className="w-6 h-6">
                    <AvatarImage src={selectedAssignee.image || undefined} alt={selectedAssignee.name || 'Assignee'} />
                    <AvatarFallback className="text-xs bg-gray-200 dark:bg-gray-600">
                      {getInitials(selectedAssignee.name, selectedAssignee.email)}
                    </AvatarFallback>
                  </Avatar>
                </div>
              )}
            </button>

            {/* Expandable Text Input */}
            <div className="flex-1 relative flex items-center">
              <textarea
                ref={textareaRef}
                placeholder={t(placeholder.key, placeholder.params)}
                value={quickTaskInput}
                onChange={(e) => setQuickTaskInput(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full px-3 py-2 text-base rounded-lg resize-none overflow-hidden
                  bg-gray-100 dark:bg-gray-700
                  text-gray-900 dark:text-white
                  placeholder-gray-500 dark:placeholder-gray-400
                  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white dark:focus:bg-gray-600
                  transition-all duration-200 min-h-9"
                style={{
                  maxHeight: '120px',
                  lineHeight: '1.4',
                }}
                disabled={!isSessionReady || isCreating}
                autoComplete="off"
                autoCapitalize="sentences"
                autoCorrect="on"
                spellCheck={true}
                rows={1}
              />
              {isCreating && (
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                </div>
              )}

              {/* #list autocomplete. It opens away from the list it would
                  otherwise cover: downward from the bottom bar, upward from a
                  control sitting above the list. */}
              {showHashtagSuggestions && (
                <div
                  className={`absolute z-50 w-full theme-bg-primary theme-border border rounded-lg shadow-lg max-h-60 overflow-y-auto ${
                    isFixedBottom ? 'bottom-full mb-1' : 'top-full mt-1'
                  }`}
                >
                  {hashtagSuggestions.map((list, index) => {
                    const isPublicOrShared = list.privacy === 'PUBLIC' ||
                      (list.listMembers && list.listMembers.length > 1) ||
                      (list.members && list.members.length > 0) ||
                      (list.admins && list.admins.length > 0)

                    return (
                      <button
                        key={list.id}
                        type="button"
                        onClick={() => selectHashtagSuggestion(list)}
                        className={`w-full px-3 py-2 text-left hover:bg-blue-50 dark:hover:bg-blue-900/30 flex items-center gap-2 transition-colors ${
                          index === activeHashtagIndex ? 'bg-blue-100 dark:bg-blue-900/50' : ''
                        }`}
                      >
                        {isPublicOrShared ? (
                          <span className="text-blue-600 dark:text-blue-400 font-mono text-sm flex-shrink-0">#</span>
                        ) : (
                          <Hash className="w-3 h-3 flex-shrink-0" style={{ color: list.color || DEFAULT_LIST_COLOR }} />
                        )}
                        <span className="theme-text-primary flex-1 truncate">{list.name}</span>
                        <span className="text-xs theme-text-muted flex-shrink-0">
                          #{list.name.toLowerCase().replace(/\s+/g, '-')}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Creates the task AND opens its details. The label is the one
                thing a wide column earns; the icon-only square is the default. */}
            <Button
              onClick={() => handleCreateTask(true)}
              disabled={!isSessionReady || !quickTaskInput.trim() || isCreating}
              className={`flex-shrink-0 h-9 rounded-lg bg-blue-600 hover:bg-blue-700
                text-white disabled:opacity-50 disabled:cursor-not-allowed
                transition-all duration-200 active:scale-95 ${
                  showAddTaskLabel ? 'px-4 gap-1 whitespace-nowrap' : 'w-9 p-0'
                }`}
              aria-label={t('tasks.addTask')}
            >
              <Plus className="w-5 h-5" />
              {showAddTaskLabel && t('tasks.addTask')}
            </Button>
          </div>
        </div>
      </div>

      {/* Priority/Assignee Picker Sheet */}
      <PriorityAssigneePicker
        isOpen={showPicker}
        onClose={() => setShowPicker(false)}
        onSelect={handlePickerSelect}
        selectedPriority={selectedPriority}
        selectedAssignee={selectedAssignee}
        availableUsers={availableUsers}
        currentUser={currentUser}
        listIds={selectedListId && selectedListId !== 'my-tasks' ? [selectedListId] : undefined}
      />
    </>
  )
}

export default QuickAdd
