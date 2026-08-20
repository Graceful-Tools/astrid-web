"use client"

import React, { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check } from "lucide-react"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import type { User } from '@/types/task'
import { isCodingAgent } from "@/lib/ai-agent-utils"
import { useTranslations } from "@/lib/i18n/client"

interface PriorityAssigneePickerProps {
  isOpen: boolean
  onClose: () => void
  onSelect: (priority: number, assignee: User | null) => void
  selectedPriority: number
  selectedAssignee: User | null
  availableUsers: User[]
  currentUser?: User
  taskId?: string
  listIds?: string[]
  /**
   * Board-state columns to offer, from `boardColumnsFor(project)` — inbox, the
   * user's states, any project custom states, and done (task ffa5bbb5).
   *
   * OPTIONAL, and absent means no state section. mobile-quick-add opens this
   * picker for a task that does not exist yet: no id, no board, nothing to
   * move. Offering the move there would be a lie.
   *
   * Never build this list locally. Status is a state on the task with
   * per-project custom states (AWTD-562), so a hardcoded ready/doing/waiting
   * would be wrong on exactly the boards that have custom ones.
   *
   * Typed structurally rather than as BoardColumn because the project board
   * builds richer columns of its own (ProjectBoardColumn, carrying the backing
   * status list) and the only thing this sheet needs from either is an id and a
   * name. A cast at that call site would have hidden a real difference.
   */
  statusColumns?: readonly { id: string; name: string }[]
  /** The task's current column, from `taskColumnId(task)`. */
  selectedColumnId?: string
  /** Receives a column id suitable for `resolveColumnMove`. */
  onStatusSelect?: (columnId: string) => void
  /** Present with onToggleComplete to offer completion. */
  completed?: boolean
  /**
   * Complete or reopen. In project mode this is the ONLY route to completion —
   * the leading control opens this sheet instead of completing — so it has to
   * work in both directions.
   */
  onToggleComplete?: () => void
}

const PRIORITY_OPTIONS = [
  { value: 0, label: '○', color: 'rgb(107, 114, 128)', bgColor: 'bg-gray-500', borderColor: 'border-gray-500', textColor: 'text-gray-500' },
  { value: 1, label: '!', color: 'rgb(59, 130, 246)', bgColor: 'bg-blue-500', borderColor: 'border-blue-500', textColor: 'text-blue-500' },
  { value: 2, label: '!!', color: 'rgb(251, 191, 36)', bgColor: 'bg-yellow-500', borderColor: 'border-yellow-500', textColor: 'text-yellow-500' },
  { value: 3, label: '!!!', color: 'rgb(239, 68, 68)', bgColor: 'bg-red-500', borderColor: 'border-red-500', textColor: 'text-red-500' },
] as const

export function PriorityAssigneePicker({
  isOpen,
  onClose,
  onSelect,
  selectedPriority,
  selectedAssignee,
  availableUsers,
  currentUser,
  taskId,
  listIds,
  statusColumns,
  selectedColumnId,
  onStatusSelect,
  completed,
  onToggleComplete,
}: PriorityAssigneePickerProps) {
  const { t } = useTranslations()
  const [tempPriority, setTempPriority] = useState(selectedPriority)
  const [tempAssignee, setTempAssignee] = useState<User | null>(selectedAssignee)
  const [isClosing, setIsClosing] = useState(false)
  const [fetchedUsers, setFetchedUsers] = useState<(User & { isAIAgent?: boolean })[]>([])
  const [isLoadingUsers, setIsLoadingUsers] = useState(false)
  const [hasFetched, setHasFetched] = useState(false)

  // Fetch list members and AI agents when picker opens
  useEffect(() => {
    if (isOpen && !hasFetched && !isLoadingUsers) {
      setIsLoadingUsers(true)
      const params = new URLSearchParams({ q: '', includeAIAgents: 'true' })
      if (taskId) params.append('taskId', taskId)
      if (listIds && listIds.length > 0) params.append('listIds', listIds.join(','))

      fetch(`/api/v1/users/search?${params.toString()}`)
        .then(res => res.json())
        .then(data => {
          setFetchedUsers(data.users || [])
          setHasFetched(true)
        })
        .catch(err => console.error('Failed to fetch users:', err))
        .finally(() => setIsLoadingUsers(false))
    }
  }, [isOpen, taskId, listIds, hasFetched, isLoadingUsers])

  // Reset fetch state when picker closes
  useEffect(() => {
    if (!isOpen) {
      setHasFetched(false)
    }
  }, [isOpen])

  // Sync temp state when picker opens
  useEffect(() => {
    if (isOpen) {
      setTempPriority(selectedPriority)
      setTempAssignee(selectedAssignee)
      setIsClosing(false)
    }
  }, [isOpen, selectedPriority, selectedAssignee])

  // Handle close with animation
  const handleClose = useCallback(() => {
    setIsClosing(true)
    setTimeout(() => {
      onClose()
      setIsClosing(false)
    }, 200)
  }, [onClose])

  // Handle backdrop click
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleClose()
    }
  }, [handleClose])

  // Handle priority selection - immediately apply and close
  const handlePrioritySelect = useCallback((priority: number) => {
    setTempPriority(priority)
    onSelect(priority, tempAssignee)
  }, [onSelect, tempAssignee])

  // Handle assignee selection - immediately apply and close
  const handleAssigneeSelect = useCallback((user: User | null) => {
    setTempAssignee(user)
    onSelect(tempPriority, user)
  }, [onSelect, tempPriority])

  // Get initials for avatar fallback
  const getInitials = (name?: string | null, email?: string) => {
    if (name) {
      return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    }
    return email?.charAt(0).toUpperCase() || '?'
  }

  // Use fetched users (list members + AI agents) if available, fallback to availableUsers
  const allUsers = React.useMemo(() => {
    // If we have fetched users from API, use those (they're list-specific)
    if (hasFetched && fetchedUsers.length > 0) {
      return fetchedUsers
    }
    // Fallback to prop-based users (for backwards compatibility)
    return availableUsers
  }, [hasFetched, fetchedUsers, availableUsers])

  // Sort users: AI agents first, then current user, then alphabetically
  const sortedUsers = [...allUsers].sort((a, b) => {
    // AI agents first
    const aIsAI = (a as User & { isAIAgent?: boolean }).isAIAgent
    const bIsAI = (b as User & { isAIAgent?: boolean }).isAIAgent
    if (aIsAI && !bIsAI) return -1
    if (!aIsAI && bIsAI) return 1

    // Current user next
    if (a.id === currentUser?.id) return -1
    if (b.id === currentUser?.id) return 1
    return (a.name || a.email).localeCompare(b.name || b.email)
  })

  if (!isOpen && !isClosing) return null

  /*
   * PORTALLED TO document.body, and it has to be (Jon, 2026-08-18: the sheet
   * "appears from wherever the list row is").
   *
   * `position: fixed` is resolved against the nearest ancestor that
   * establishes a containing block, and on mobile this sheet is always inside
   * one: `.task-card` carries `will-change: transform` (styles/components.css)
   * and MainContent's mobile task-area wrapper carries the task-detail
   * parallax `transform`, which it applies even at rest as
   * `translateX(0) scale(1)`. So `fixed inset-x-0 bottom-0` pinned the sheet to
   * the ROW, and the full-screen backdrop covered one card. Measured on a
   * 390x664 viewport: sheet at y=158, backdrop 360x62.
   *
   * No styling escapes a transformed ancestor — the element has to leave the
   * subtree. Same pattern as attachment-viewer and list-settings-popover.
   */
  /*
   * The sheet is a React child of the row that opened it, and in project mode
   * that row's onClick opens task details — so every tap inside the sheet did
   * two things (task 465e71e6).
   *
   * PORTALLING DID NOT FIX IT. React propagates events through the REACT tree,
   * not the DOM tree, so a sheet living under <body> still delivers its clicks
   * to the row's handler. The escape has to be explicit.
   *
   * Stopped at the two portal roots rather than on each control: an unhandled
   * gap in the middle of the sheet is invisible until someone taps exactly
   * there. The sheet's own handlers still run — this stops the event LEAVING,
   * it does not stop it arriving.
   */
  const stopLeaking = (event: React.MouseEvent) => event.stopPropagation()

  const sheet = (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black z-40 transition-opacity duration-200 ${
          isClosing ? 'opacity-0' : 'opacity-30'
        }`}
        onClick={(event) => {
          // Dismiss, but do not also hand the tap to the row underneath.
          stopLeaking(event)
          handleBackdropClick(event)
        }}
        aria-hidden="true"
      />

      {/* Bottom Sheet */}
      <div
        /*
         * NOT FULL WIDTH (task 8599e136). `inset-x-0` stretched this sheet edge
         * to edge on every screen, which on a desktop window is a very wide
         * strip holding four small controls. It is capped and centred now;
         * `inset-x-0` stays so it still fills a phone, where full width IS the
         * right answer for a bottom sheet.
         *
         * TALLER, because the height was the reason the assignee list was
         * cramped: 50vh had to hold priority, board state, complete/reopen AND
         * a scrolling list of people. 85vh gives the list room; the inner
         * container scrolls rather than the sheet growing past the viewport.
         */
        className={`fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-md transform transition-transform duration-200 ease-out ${
          isClosing ? 'translate-y-full' : 'translate-y-0'
        }`}
        style={{ maxHeight: '85vh' }}
        onClick={stopLeaking}
      >
        <div className="flex max-h-[85vh] flex-col overflow-y-auto rounded-t-2xl bg-white shadow-xl dark:bg-gray-800 sm:rounded-2xl sm:mb-4">
          {/* Handle */}
          <div className="flex justify-center pt-3 pb-2">
            <div className="w-10 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
          </div>

          {/* Priority Section */}
          <div className="px-4 pb-4">
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">Priority</h3>
            <div className="flex gap-3">
              {PRIORITY_OPTIONS.map((option) => {
                const isSelected = tempPriority === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handlePrioritySelect(option.value)}
                    /* A rounded SQUARE, not a stretched bar (task 8599e136).
                       `flex-1` made each option as wide as a quarter of the
                       screen; a priority chip carries one or three characters
                       and reads better as a fixed square. */
                    className={`h-12 w-12 rounded-xl flex items-center justify-center font-medium text-lg transition-all duration-150 active:scale-95 ${
                      isSelected
                        ? `${option.bgColor} text-white`
                        : `bg-transparent border-2 ${option.borderColor} ${option.textColor}`
                    }`}
                    aria-label={`Priority ${option.value}`}
                    aria-pressed={isSelected}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Divider */}
          <div className="h-px bg-gray-200 dark:bg-gray-700" />

          {/* Board State Section — only when the caller has a task to move. */}
          {statusColumns && statusColumns.length > 0 && onStatusSelect && (
            <>
              <div className="px-4 py-4">
                <h3
                  className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3"
                  id="task-options-board-state"
                >
                  {t('tasks.boardState')}
                </h3>
                <div
                  className="flex flex-wrap gap-2"
                  role="group"
                  aria-labelledby="task-options-board-state"
                >
                  {statusColumns.map(column => {
                    const isSelected = selectedColumnId === column.id
                    return (
                      <button
                        key={column.id}
                        type="button"
                        onClick={() => onStatusSelect(column.id)}
                        aria-pressed={isSelected}
                        className={`h-9 px-3 rounded-lg text-sm font-medium transition-all duration-150 active:scale-95 ${
                          isSelected
                            ? 'bg-blue-500 text-white'
                            : 'bg-transparent border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200'
                        }`}
                      >
                        {column.name}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="h-px bg-gray-200 dark:bg-gray-700" />
            </>
          )}

          {/* Complete / reopen — project mode's only route to completion. */}
          {onToggleComplete && (
            <>
              <div className="px-4 py-4">
                <button
                  type="button"
                  data-testid="task-options-complete"
                  onClick={onToggleComplete}
                  className="w-full h-11 rounded-lg text-sm font-medium border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 transition-all duration-150 active:scale-95"
                >
                  {completed ? t('tasks.markIncomplete') : t('tasks.markComplete')}
                </button>
              </div>
              <div className="h-px bg-gray-200 dark:bg-gray-700" />
            </>
          )}

          {/* Assignee Section */}
          <div className="px-4 py-4">
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">Assignee</h3>
            <div className="max-h-48 overflow-y-auto -mx-4 px-4 space-y-1">
              {/* Unassigned option */}
              <button
                type="button"
                onClick={() => handleAssigneeSelect(null)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                  tempAssignee === null
                    ? 'bg-blue-50 dark:bg-blue-900/30'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <div className="w-9 h-9 rounded-lg border-2 border-gray-400 dark:border-gray-500 flex items-center justify-center">
                  <span className="text-gray-500 dark:text-gray-400 text-sm font-medium">{t('tasks.unassignedMark')}</span>
                </div>
                <div className="flex-1 text-left">
                  <div className="text-sm font-medium text-gray-900 dark:text-white">Unassigned</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">No one assigned</div>
                </div>
                {tempAssignee === null && (
                  <Check className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                )}
              </button>

              {/* User list */}
              {sortedUsers.map((user) => {
                const isSelected = tempAssignee?.id === user.id
                const isCurrentUser = user.id === currentUser?.id
                const isAIAgent = (user as User & { isAIAgent?: boolean }).isAIAgent
                return (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => handleAssigneeSelect(user)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                      isSelected
                        ? 'bg-blue-50 dark:bg-blue-900/30'
                        : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    <Avatar className="w-9 h-9">
                      <AvatarImage src={user.image || undefined} alt={user.name || 'User'} />
                      <AvatarFallback className="text-xs bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300">
                        {getInitials(user.name, user.email)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 text-left min-w-0">
                      <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                        {user.name || user.email}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        {isAIAgent ? 'AI Agent' : isCurrentUser ? 'You' : user.email}
                      </div>
                    </div>
                    {isSelected && (
                      <Check className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Bottom safe area for iOS */}
          <div className="h-safe-area-inset-bottom pb-6" />
        </div>
      </div>
    </>
  )

  // No document during SSR; the sheet only ever opens from a tap anyway.
  if (typeof window === 'undefined') return null

  return createPortal(sheet, document.body)
}

export default PriorityAssigneePicker
