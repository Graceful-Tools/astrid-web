"use client"

import React, { useState, useRef, useCallback, useEffect } from 'react'
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { PriorityAssigneePicker } from "./priority-assignee-picker"
import type { User, TaskList } from '@/types/task'

interface MobileQuickAddProps {
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
}

const PRIORITY_COLORS = {
  0: 'rgb(107, 114, 128)', // Gray - no priority
  1: 'rgb(59, 130, 246)',  // Blue - low priority
  2: 'rgb(251, 191, 36)',  // Yellow/Orange - medium priority
  3: 'rgb(239, 68, 68)',   // Red - highest priority
} as const

export function MobileQuickAdd({
  selectedListId,
  availableLists,
  availableUsers,
  currentUser,
  quickTaskInput,
  setQuickTaskInput,
  onCreateTask,
  onKeyDown,
  isSessionReady,
  className = ""
}: MobileQuickAddProps) {
  const [isCreating, setIsCreating] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [selectedPriority, setSelectedPriority] = useState<number>(0)
  const [selectedAssignee, setSelectedAssignee] = useState<User | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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
      console.error('Mobile quick add error:', error)
    } finally {
      setIsCreating(false)
    }
  }, [quickTaskInput, isSessionReady, isCreating, onCreateTask, setQuickTaskInput, selectedPriority, selectedAssignee, selectedList])

  // Handle keyboard
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleCreateTask(false)
      return
    }
    onKeyDown(e)
  }, [handleCreateTask, onKeyDown])

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

  const priorityColor = PRIORITY_COLORS[selectedPriority as keyof typeof PRIORITY_COLORS]

  // Get checkbox icon path (same as TaskCheckbox component)
  const getCheckboxIconPath = () => {
    const safePriority = selectedPriority >= 0 && selectedPriority <= 3 ? selectedPriority : 0
    return `/icons/check_box_${safePriority}.png`
  }

  return (
    <>
      {/* Quick Add Bar - margins match task list container (px-2) */}
      <div
        className={`fixed z-30 ${className}`}
        style={{
          left: 'max(0.5rem, env(safe-area-inset-left, 0.5rem))',
          right: 'max(0.5rem, env(safe-area-inset-right, 0.5rem))',
          bottom: 'max(0.75rem, env(safe-area-inset-bottom, 0.75rem))',
        }}
      >
        <div
          className="mobile-quick-add bg-white dark:bg-gray-800 rounded-xl px-4 py-3"
          style={{
            boxShadow: '0 2px 12px rgba(0, 0, 0, 0.15)',
          }}
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
                    U
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
                  className="w-8 h-8 rounded-full flex items-center justify-center"
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
                placeholder="Add a task"
                value={quickTaskInput}
                onChange={(e) => setQuickTaskInput(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full px-3 py-2 text-base rounded-lg resize-none overflow-hidden
                  bg-gray-100 dark:bg-gray-700
                  text-gray-900 dark:text-white
                  placeholder-gray-500 dark:placeholder-gray-400
                  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white dark:focus:bg-gray-600
                  transition-all duration-200"
                style={{
                  minHeight: '36px',
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
            </div>

            {/* Plus Button - Creates task AND navigates to details */}
            <Button
              onClick={() => handleCreateTask(true)}
              disabled={!isSessionReady || !quickTaskInput.trim() || isCreating}
              className="flex-shrink-0 w-9 h-9 p-0 rounded-lg bg-blue-600 hover:bg-blue-700
                text-white disabled:opacity-50 disabled:cursor-not-allowed
                transition-all duration-200 active:scale-95"
              aria-label="Add task and open details"
            >
              <Plus className="w-5 h-5" />
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

export default MobileQuickAdd
