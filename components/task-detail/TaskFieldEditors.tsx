"use client"

import { useEffect, useState } from "react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Calendar } from "@/components/ui/calendar"
import { Badge } from "@/components/ui/badge"
import { UserPicker } from "@/components/user-picker"
import { CustomRepeatingEditor } from "@/components/custom-repeating-editor"
import { PriorityPicker } from "@/components/ui/priority-picker"
import { selectableLists } from "@/lib/status-lists"
import { TimePicker, formatConciseTime } from "@/components/ui/time-picker"
import { useMobileKeyboard } from "@/hooks/shared/useMobileKeyboard"
import { Calendar as CalendarIcon, Lock, Globe, Users, X, Check, Hash } from "lucide-react"
import { format } from "date-fns"
import { renderMarkdownWithLinks } from "@/lib/markdown"
import { formatDateForDisplay } from "@/lib/date-utils"
import { useTranslations } from "@/lib/i18n/client"
import type { Task, TaskList, User } from "@/types/task"

interface TaskFieldEditorsProps {
  task: Task
  currentUser: User
  availableLists: TaskList[]
  onUpdate: (task: Task) => void
  readOnly?: boolean  // If true, disable all editing
  shouldHidePriority?: boolean  // Hide priority field for public lists
  shouldHideWhen?: boolean  // Hide when/due date field for public lists

  // Editing state from useTaskDetailState
  editingTitle: boolean
  setEditingTitle: (value: boolean) => void
  editingDescription: boolean
  setEditingDescription: (value: boolean) => void
  editingWhen: boolean
  setEditingWhen: (value: boolean) => void
  editingTime: boolean
  setEditingTime: (value: boolean) => void
  editingPriority: boolean
  setEditingPriority: (value: boolean) => void
  editingRepeating: boolean
  setEditingRepeating: (value: boolean) => void
  editingLists: boolean
  setEditingLists: (value: boolean) => void
  editingAssignee: boolean
  setEditingAssignee: (value: boolean) => void

  // Refs from editing state
  assigneeRef: React.MutableRefObject<HTMLDivElement | null>
  descriptionRef: React.MutableRefObject<HTMLDivElement | null>
  descriptionTextareaRef: React.MutableRefObject<HTMLTextAreaElement | null>

  // Temp values from useTaskDetailState
  tempTitle: string
  setTempTitle: (value: string) => void
  tempDescription: string
  setTempDescription: (value: string) => void
  tempWhen: Date | undefined
  setTempWhen: (value: Date | undefined) => void
  tempPriority: number
  setTempPriority: React.Dispatch<React.SetStateAction<number>>
  tempRepeating: string | null
  setTempRepeating: React.Dispatch<React.SetStateAction<string | null>>
  tempRepeatingData: any
  setTempRepeatingData: (value: any) => void
  setLastRepeatingUpdate: (value: number) => void

  // List selection state
  tempLists: TaskList[]
  setTempLists: (value: TaskList[]) => void
  listSearchTerm: string
  setListSearchTerm: (value: string) => void
  showListSuggestions: boolean
  setShowListSuggestions: (value: boolean) => void
  selectedSuggestionIndex: number
  setSelectedSuggestionIndex: React.Dispatch<React.SetStateAction<number>>
  listSearchRef: React.MutableRefObject<HTMLDivElement | null>
  listInputRef: React.MutableRefObject<HTMLInputElement | null>

  // Assignee state
  tempAssignee: User | null
  setTempAssignee: (value: User | null) => void

  // Invite handler
  onInviteUser: (email: string, message?: string) => Promise<void>
}

export function TaskFieldEditors({
  task,
  currentUser,
  availableLists,
  onUpdate,
  readOnly = false,
  shouldHidePriority = false,
  shouldHideWhen = false,
  editingTitle,
  setEditingTitle,
  editingDescription,
  setEditingDescription,
  editingWhen,
  setEditingWhen,
  editingTime,
  setEditingTime,
  editingPriority,
  setEditingPriority,
  editingRepeating,
  setEditingRepeating,
  editingLists,
  setEditingLists,
  editingAssignee,
  setEditingAssignee,
  assigneeRef,
  descriptionRef,
  descriptionTextareaRef,
  tempTitle,
  setTempTitle,
  tempDescription,
  setTempDescription,
  tempWhen,
  setTempWhen,
  tempPriority,
  setTempPriority,
  tempRepeating,
  setTempRepeating,
  tempRepeatingData,
  setTempRepeatingData,
  setLastRepeatingUpdate,
  tempLists,
  setTempLists,
  listSearchTerm,
  setListSearchTerm,
  showListSuggestions,
  setShowListSuggestions,
  selectedSuggestionIndex,
  setSelectedSuggestionIndex,
  listSearchRef,
  listInputRef,
  tempAssignee,
  setTempAssignee,
  onInviteUser
}: TaskFieldEditorsProps) {
  const { t } = useTranslations()

  // Local state for controlling Select dropdown open state
  const [repeatingSelectOpen, setRepeatingSelectOpen] = useState(false)

  // Local state for repeat mode to make UI responsive
  const [localRepeatFrom, setLocalRepeatFrom] = useState<"DUE_DATE" | "COMPLETION_DATE">(
    task.repeatFrom || "COMPLETION_DATE"
  )

  // Track if we've initialized from the current task (prevents initialization overwrites)
  const [initializedTaskId, setInitializedTaskId] = useState<string | null>(null)

  // Sync local state with task prop when it changes (for optimistic updates)
  useEffect(() => {
    setLocalRepeatFrom(task.repeatFrom || "COMPLETION_DATE")
  }, [task.repeatFrom])

  // Initialize temp state from task on mount or when switching tasks
  // Only runs once per task ID to preserve optimistic updates during editing
  useEffect(() => {
    if (task.id !== initializedTaskId) {
      setInitializedTaskId(task.id)
      setTempRepeating(task.repeating)
      if (task.repeating === 'custom' && task.repeatingData) {
        setTempRepeatingData(task.repeatingData)
      } else {
        setTempRepeatingData(null)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task, initializedTaskId]) // setTempRepeating and setTempRepeatingData are stable setState functions

  // Mobile keyboard detection
  const { keyboardVisible, shouldPreventFocus } = useMobileKeyboard()

  // Check if task is in any public list
  const isPublicListTask = task.lists?.some(list => list.privacy === 'PUBLIC') ?? false

  // Auto-resize textarea to fit content
  useEffect(() => {
    if (editingDescription && descriptionTextareaRef.current) {
      const textarea = descriptionTextareaRef.current
      // Reset height to auto to get the correct scrollHeight
      textarea.style.height = 'auto'
      // Set height to scrollHeight to fit content
      textarea.style.height = `${textarea.scrollHeight}px`
    }
  }, [editingDescription, tempDescription, descriptionTextareaRef])

  // Auto-focus and scroll to cursor when editing description on mobile with keyboard
  useEffect(() => {
    if (editingDescription && descriptionTextareaRef.current && keyboardVisible) {
      const textarea = descriptionTextareaRef.current

      // Scroll the textarea into view, ensuring cursor is visible
      setTimeout(() => {
        textarea.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'nearest'
        })
      }, 100)
    }
  }, [editingDescription, keyboardVisible, descriptionTextareaRef])

  // Handler functions
  const handleSaveTitle = () => {
    if (tempTitle.trim()) {
      onUpdate({ ...task, title: tempTitle.trim() })
    }
    setEditingTitle(false)
  }

  const handleCancelTitle = () => {
    setTempTitle(task.title)
    setEditingTitle(false)
  }

  const handleSaveDescription = () => {
    onUpdate({ ...task, description: tempDescription })
    setEditingDescription(false)
  }

  const handleCancelDescription = () => {
    setTempDescription(task.description || '')
    setEditingDescription(false)
  }

  const handleSaveWhen = (date: Date | undefined) => {
    if (date) {
      // If there's an existing dueDateTime with a time, preserve the time component
      if (task.dueDateTime && !task.isAllDay) {
        const existingDate = new Date(task.dueDateTime)
        date.setHours(existingDate.getHours(), existingDate.getMinutes(), 0, 0)
        // Keep as timed task
        onUpdate({ ...task, dueDateTime: date, isAllDay: false })
      } else {
        // Default to all-day task (midnight UTC)
        date.setUTCHours(0, 0, 0, 0)
        onUpdate({ ...task, dueDateTime: date, isAllDay: true })
      }
    } else {
      // Removing date
      onUpdate({ ...task, dueDateTime: undefined, isAllDay: false })
    }
    setTempWhen(date)
    setEditingWhen(false)
  }

  const handleSaveTime = (time: Date | string | null) => {
    if (!time) {
      // Clear the time - make it all-day (midnight UTC)
      if (task.dueDateTime) {
        const dateOnly = new Date(task.dueDateTime)
        dateOnly.setUTCHours(0, 0, 0, 0)
        onUpdate({ ...task, dueDateTime: dateOnly, isAllDay: true })
        setTempWhen(dateOnly)
      }
    } else if (time instanceof Date) {
      // Combine the existing date with the new time
      if (!task.dueDateTime) return
      const updatedDate = new Date(task.dueDateTime)
      updatedDate.setHours(time.getHours(), time.getMinutes(), 0, 0)
      onUpdate({ ...task, dueDateTime: updatedDate, isAllDay: false })
      setTempWhen(updatedDate)
    } else {
      // Handle string case - convert to Date first
      // This is a fallback, typically TimePicker returns Date objects
      return
    }

    setEditingTime(false)
  }

  const handleSavePriority = async (priority: number) => {
    const validPriority = Math.max(0, Math.min(3, priority)) as 0 | 1 | 2 | 3

    // 1. OPTIMISTIC UPDATE: Update UI immediately for instant feedback
    setTempPriority(validPriority)

    try {
      // 2. API CALL: Send the update to server
      await onUpdate({ ...task, priority: validPriority })
      setEditingPriority(false)
    } catch (error) {
      // 3. ROLLBACK: Restore original priority on error
      setTempPriority(task.priority)
      console.error('Failed to update priority:', error)
      // Could show an error toast here if desired
    }
  }

  const handleSaveRepeating = (repeating: Task["repeating"]) => {
    const updateData = {
      ...task,
      repeating,
      repeatingData: repeating === 'custom' ? tempRepeatingData : null,
      // Use localRepeatFrom to avoid using stale task.repeatFrom value
      repeatFrom: localRepeatFrom,
    }

    // Mark the timestamp of this local update to prevent SSE overwrites
    setLastRepeatingUpdate(Date.now())

    onUpdate(updateData)
    setTempRepeating(repeating)
    setEditingRepeating(false)
    setRepeatingSelectOpen(false)
    // Don't clear tempRepeatingData - keep it for optimistic display until server confirms
  }

  const getCustomRepeatingSummary = (repeatingData: any, repeatFrom?: "DUE_DATE" | "COMPLETION_DATE"): string => {
    if (!repeatingData) return ''

    // CustomRepeatingEditor uses 'unit' (days/weeks/months/years)
    // Support both 'unit' and 'frequency' for compatibility
    const { unit, frequency, interval, weekdays, monthDay, month, endCondition, endAfterOccurrences, endUntilDate } = repeatingData

    // Default interval to 1 if not provided
    const actualInterval = interval || 1
    const repeatUnit = unit || frequency

    let summary = `Every ${actualInterval > 1 ? actualInterval + ' ' : ''}`

    if (repeatUnit === 'days' || repeatUnit === 'daily') {
      summary += actualInterval > 1 ? 'days' : 'day'
    } else if (repeatUnit === 'weeks' || repeatUnit === 'weekly') {
      summary += actualInterval > 1 ? 'weeks' : 'week'
      if (weekdays && weekdays.length > 0) {
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
        const daysText = weekdays.map((day: string) => {
          // Handle both numeric indices and string day names
          if (typeof day === 'number') {
            return dayNames[day]
          }
          return day.charAt(0).toUpperCase() + day.slice(1, 3)
        }).join(', ')
        summary += ` on ${daysText}`
      }
    } else if (repeatUnit === 'months' || repeatUnit === 'monthly') {
      summary += actualInterval > 1 ? 'months' : 'month'
      if (monthDay) {
        summary += ` on the ${monthDay}${getOrdinalSuffix(monthDay)}`
      }
    } else if (repeatUnit === 'years' || repeatUnit === 'yearly') {
      summary += actualInterval > 1 ? 'years' : 'year'
      if (month !== undefined && monthDay) {
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        summary += ` on ${monthNames[month - 1]} ${monthDay}${getOrdinalSuffix(monthDay)}`
      }
    } else {
      // Fallback for unknown unit/frequency
      summary += `(${repeatUnit || 'unknown'})`
    }

    // Add end condition information
    if (endCondition === 'after_occurrences' && endAfterOccurrences) {
      summary += `, ends after ${endAfterOccurrences} occurrence${endAfterOccurrences > 1 ? 's' : ''}`
    } else if (endCondition === 'until_date' && endUntilDate) {
      const date = endUntilDate instanceof Date ? endUntilDate : new Date(endUntilDate)
      summary += `, until ${format(date, 'MMM d, yyyy')}`
    }

    // Add "from due date" suffix if using DUE_DATE mode (COMPLETION_DATE is default)
    if (repeatFrom === 'DUE_DATE') {
      summary += ', from due date'
    }

    return summary
  }

  const getOrdinalSuffix = (num: number): string => {
    const j = num % 10
    const k = num % 100
    if (j === 1 && k !== 11) return 'st'
    if (j === 2 && k !== 12) return 'nd'
    if (j === 3 && k !== 13) return 'rd'
    return 'th'
  }

  const handleSaveLists = () => {
    onUpdate({ ...task, lists: tempLists })
    setEditingLists(false)
    setListSearchTerm('')
  }

  const handleSaveAssignee = () => {
    onUpdate({ ...task, assignee: tempAssignee, assigneeId: tempAssignee?.id || null })
    setEditingAssignee(false)
  }

  const handleCancelAssignee = () => {
    setTempAssignee(task.assignee || null)
    setEditingAssignee(false)
  }

  const handleCancelLists = () => {
    setTempLists(task.lists || [])
    setEditingLists(false)
    setListSearchTerm('')
  }

  // List filtering
  const getFilteredLists = () => {
    const selectedListIds = new Set(tempLists.map(l => l.id))
    // selectableLists drops status lists (a state, not a destination) and
    // labels as well as virtual lists. This previously filtered only virtual
    // lists, so a user with two boards was offered nine status lists here —
    // three "Ready", three "Doing", three "Waiting".
    return selectableLists(availableLists)
      .filter(list => !selectedListIds.has(list.id))
      .filter(list => {
        if (!listSearchTerm) return true
        return list.name.toLowerCase().includes(listSearchTerm.toLowerCase())
      })
      .slice(0, 10)
  }

  const getListPrivacyIcon = (list: any, useWhiteColor = false) => {
    if (list.privacy === 'PUBLIC') {
      return <Globe className={`w-3 h-3 ${useWhiteColor ? 'text-white' : ''}`} />
    } else if (list.privacy === 'SHARED') {
      return <Users className={`w-3 h-3 ${useWhiteColor ? 'text-white' : ''}`} />
    } else {
      // Private list - use hashtag with white color for solid badges, list color otherwise
      return <Hash className="w-3 h-3" style={{ color: useWhiteColor ? 'white' : (list.color || '#3b82f6') }} />
    }
  }

  return (
    <>
      {/* When row: Date · Time · Repeat on ONE line (task dcbbb0fa).
       *
       *  Previously three stacked rows, each with its own label and padding.
       *  The reclaimed vertical space is the deliverable — the description was
       *  being pushed below the fold by chrome. Mirrors the iOS/Mac shape from
       *  42013da7, where Time and Repeat stay conditional on a date existing,
       *  so an undated task shows a single "Add date" control rather than
       *  three empty ones. */}
      {!shouldHideWhen && (
      <div className="grid grid-cols-3 gap-4 items-start">
        <Label className="text-sm theme-text-muted pt-2">When</Label>
        <div className="col-span-2 flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-2 min-w-0" data-testid="when-date">
        {editingWhen ? (
          <Popover open={editingWhen} onOpenChange={setEditingWhen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className="w-auto justify-start bg-gray-700 border-gray-600 text-white hover:bg-gray-600"
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {tempWhen ? format(tempWhen, "PPP") : "Select date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0">
              <div className="p-3 border-b border-gray-200">
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const today = new Date()
                      handleSaveWhen(today)
                    }}
                    className="text-sm"
                  >
                    Today
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const tomorrow = new Date()
                      tomorrow.setDate(tomorrow.getDate() + 1)
                      handleSaveWhen(tomorrow)
                    }}
                    className="text-sm"
                  >
                    Tomorrow
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const nextWeek = new Date()
                      nextWeek.setDate(nextWeek.getDate() + 7)
                      handleSaveWhen(nextWeek)
                    }}
                    className="text-sm"
                  >
                    Next Week
                  </Button>
                </div>
              </div>
              <Calendar
                mode="single"
                selected={tempWhen}
                onSelect={handleSaveWhen}
                initialFocus
              />
              <div className="p-3 border-t border-gray-200 flex justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    handleSaveWhen(undefined)
                  }}
                  className="text-sm"
                >
                  {t('time.noDate')}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        ) : (
          <div
            className={`flex items-center gap-1 px-2 py-1 rounded ${!readOnly ? 'cursor-pointer theme-surface-hover' : ''}`}
            onClick={() => !readOnly && setEditingWhen(true)}
          >
            <span className={task.dueDateTime ? "text-blue-600 dark:text-blue-400" : "theme-text-muted"}>
              {task.dueDateTime ? formatDateForDisplay(new Date(task.dueDateTime), task.isAllDay) : t('time.noDate')}
            </span>
          </div>
        )}
      </div>

      {/* Time — only once a date exists */}
      {task.dueDateTime && (
        <div className="flex items-center gap-2 min-w-0" data-testid="when-time">
          {editingTime ? (
            <div className="mt-1">
              <TimePicker
                value={tempWhen}
                onChange={handleSaveTime}
              />
            </div>
          ) : (
            <div
              className={`flex items-center gap-1 px-2 py-1 rounded ${!readOnly ? 'cursor-pointer theme-surface-hover' : ''}`}
              onClick={() => !readOnly && setEditingTime(true)}
            >
              <span className={task.dueDateTime && !task.isAllDay ? "text-blue-600 dark:text-blue-400" : "theme-text-muted"}>
                {task.dueDateTime && !task.isAllDay ? formatConciseTime(new Date(task.dueDateTime)) : t('time.allDay')}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Repeat — only once a date exists */}
      {task.dueDateTime && (
        <div className="flex items-center gap-2 min-w-0" data-testid="when-repeat">
          {editingRepeating ? (
            <div
              className="mt-1"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div
                data-task-detail-content="true"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onMouseUp={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
              >
                <Select
                  value={tempRepeating || undefined}
                  open={repeatingSelectOpen}
                  onValueChange={(value) => {
                    // Always close the dropdown first
                    setRepeatingSelectOpen(false)

                    if (value === 'custom') {
                      setTempRepeating(value)
                    } else {
                      handleSaveRepeating(value as Task["repeating"])
                    }
                  }}
                  onOpenChange={(open) => setRepeatingSelectOpen(open)}
                >
                  <SelectTrigger className="theme-input">
                    <SelectValue placeholder="Select repeat" />
                  </SelectTrigger>
                  <SelectContent
                    position="popper"
                    sideOffset={4}
                    data-task-detail-content="true"
                    onCloseAutoFocus={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                    }}
                    onPointerDownOutside={(e) => e.stopPropagation()}
                    onEscapeKeyDown={(e) => e.stopPropagation()}
                  >
                    <SelectItem value="never">{t('repeating.oneTimeOnly')}</SelectItem>
                    <SelectItem value="daily">{t('repeating.daily')}</SelectItem>
                    <SelectItem value="weekly">{t('repeating.weekly')}</SelectItem>
                    <SelectItem value="monthly">{t('repeating.monthly')}</SelectItem>
                    <SelectItem value="yearly">{t('repeating.yearly')}</SelectItem>
                    <SelectItem value="custom">{t('repeating.custom')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Custom Repeating Editor - only for custom patterns */}
              {tempRepeating === 'custom' && (
                <div
                  className="mt-2 p-3 theme-surface rounded-md border theme-border"
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  {/* Live preview of custom pattern */}
                  {tempRepeatingData && (
                    <div className="mb-3 p-2 theme-surface-secondary rounded text-sm theme-text">
                      <span className="font-medium">Preview: </span>
                      {getCustomRepeatingSummary(tempRepeatingData, localRepeatFrom)}
                    </div>
                  )}

                  {/* Repeat Mode Selector - part of custom pattern chooser */}
                  <div className="mb-3">
                    <Label className="text-sm theme-text-muted mb-2 block">Repeat Mode</Label>
                    <div
                      data-task-detail-content="true"
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      onMouseUp={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                      onPointerUp={(e) => e.stopPropagation()}
                    >
                      <Select
                        value={localRepeatFrom}
                        onValueChange={(value: "DUE_DATE" | "COMPLETION_DATE") => {
                          // Update local state immediately for responsive UI
                          setLocalRepeatFrom(value)

                          // Then update via API
                          onUpdate({ ...task, repeatFrom: value })
                        }}
                      >
                        <SelectTrigger className="theme-input">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent
                          position="popper"
                          sideOffset={4}
                          data-task-detail-content="true"
                          onCloseAutoFocus={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                          }}
                          onPointerDownOutside={(e) => {
                            e.stopPropagation()
                          }}
                          onEscapeKeyDown={(e) => {
                            e.stopPropagation()
                          }}
                        >
                          <SelectItem value="COMPLETION_DATE">Repeat from completion date</SelectItem>
                          <SelectItem value="DUE_DATE">Repeat from due date</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="text-xs theme-text-muted mt-1">
                      {localRepeatFrom === "COMPLETION_DATE"
                        ? "Next occurrence is based on when you complete the task"
                        : "Next occurrence is based on the original due date"}
                    </div>
                  </div>

                  <CustomRepeatingEditor
                    value={tempRepeatingData}
                    onChange={setTempRepeatingData}
                    onCancel={() => {
                      setTempRepeating(task.repeating)
                      setEditingRepeating(false)
                      setRepeatingSelectOpen(false)
                    }}
                  />

                  <div className="flex justify-end space-x-2 mt-2">
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => handleSaveRepeating('custom')}
                    >
                      Save Custom Pattern
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div
              className={`flex items-center gap-1 px-2 py-1 rounded ${!readOnly ? 'cursor-pointer theme-surface-hover' : ''}`}
              onClick={() => {
                if (!readOnly) {
                  setEditingRepeating(true)
                  // Only auto-open dropdown if NOT already custom (to avoid covering custom editor)
                  if (task.repeating !== 'custom') {
                    setRepeatingSelectOpen(true)
                  }
                }
              }}
            >
              {(() => {
                // OPTIMISTIC UPDATE: Use temp values if available, fall back to task values
                // This ensures immediate UI updates before server confirms

                // For pattern type: prefer temp if set, otherwise use task
                const repeatingValue = tempRepeating || task.repeating

                // For pattern data: prefer temp if we're in custom mode, otherwise use task
                const repeatingDataValue = tempRepeatingData || task.repeatingData

                // For repeat mode: use local state (already optimistic)
                const repeatFrom = localRepeatFrom

                // Show custom pattern summary with mode indicator
                if (repeatingValue === 'custom' && repeatingDataValue) {
                  const summary = getCustomRepeatingSummary(repeatingDataValue, repeatFrom)
                  return summary
                }

                // Show simple pattern with mode indicator
                const pattern = repeatingValue || 'never'
                if (pattern !== 'never' && repeatFrom === 'DUE_DATE') {
                  return `${pattern} (from due date)`
                }

                return pattern
              })()}
            </div>
          )}
        </div>
      )}
        </div>
      </div>
      )}

      {/* Priority row: Priority · Assignee on ONE line (task dcbbb0fa).
       *
       *  Priority leads because it is the row's label and its colour reads at a
       *  glance; the assignee follows. Mirrors iOS/Mac 42013da7. A public-list
       *  task shows its creator here instead of an assignee, which is why the
       *  block below still branches on isPublicListTask. */}
      {!shouldHidePriority && (
      <div className="grid grid-cols-3 gap-4 items-center">
        <Label className="text-sm theme-text-muted">
          {isPublicListTask ? "Created by" : "Priority"}
        </Label>
        <div className="col-span-2 flex flex-wrap items-center gap-3">
          {!isPublicListTask && (
            <PriorityPicker
              value={tempPriority}
              onChange={handleSavePriority}
              label="Priority"
            />
          )}
        {isPublicListTask ? (
          // For public list tasks, show creator (non-editable)
          <div className="flex items-center space-x-2 mt-1 px-2 py-1 rounded">
            {task.creator ? (
              <>
                <Avatar className="w-6 h-6">
                  <AvatarImage src={task.creator.image || "/placeholder.svg"} />
                  <AvatarFallback>{task.creator.name?.charAt(0) || task.creator.email?.charAt(0)}</AvatarFallback>
                </Avatar>
                <span className="text-blue-600 dark:text-blue-400">{task.creator.name || task.creator.email}</span>
              </>
            ) : (
              <span className="theme-text-muted">Unknown creator</span>
            )}
          </div>
        ) : (
          // For regular tasks, show editable assignee
          (() => {
            return editingAssignee ? (
              <div className="mt-1" ref={assigneeRef}>
                <UserPicker
                  selectedUser={tempAssignee}
                  taskId={task.id}
                  listIds={task.lists?.map(list => list.id)}
                  includeAIAgents={true}
                  onUserSelect={(user) => {
                    setTempAssignee(user)
                    // Auto-save immediately when user is selected or unassigned
                    const updatedTask = { ...task, assignee: user, assigneeId: user?.id || null }
                    onUpdate(updatedTask)
                    // Always close the editor after selection
                    setEditingAssignee(false)
                  }}
                  onInviteUser={onInviteUser}
                  placeholder="Search users or enter email..."
                  inline={true}
                  autoFocus={true}
                />
              </div>
            ) : (
              <div
                className={`flex items-center space-x-2 mt-1 px-2 py-1 rounded ${!readOnly ? 'cursor-pointer theme-surface-hover' : ''}`}
                onClick={() => !readOnly && setEditingAssignee(true)}
              >
                {task.assignee ? (
                  <>
                    <Avatar className="w-6 h-6">
                      <AvatarImage src={task.assignee.image || "/placeholder.svg"} />
                      <AvatarFallback>{task.assignee.name?.charAt(0) || task.assignee.email?.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <span className="text-blue-600 dark:text-blue-400">{task.assignee.name || task.assignee.email}</span>
                  </>
                ) : (
                  <>
                    <Avatar className="w-6 h-6">
                      <AvatarImage src="/placeholder.svg" />
                      <AvatarFallback>U</AvatarFallback>
                    </Avatar>
                    <span className="theme-text-muted">Unassigned</span>
                  </>
                )}
              </div>
            )
          })()
        )}
        </div>
      </div>
      )}

      {/* Lists Field */}
      <div className="grid grid-cols-3 gap-4 items-center">
        <Label className="text-sm theme-text-muted">Lists</Label>
        {editingLists ? (
          <div className="mt-1 space-y-3 col-span-2">
            {/* Search input with autocomplete */}
            <div className="relative" ref={listSearchRef}>
              {/* Selected lists as chips - INSIDE listSearchRef */}
              {tempLists.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {tempLists.map((list) => (
                    <Badge
                      key={list.id}
                      variant="secondary"
                      className="flex items-center gap-1 pr-1 cursor-pointer"
                      style={{ backgroundColor: list.color, color: 'white' }}
                    >
                      {getListPrivacyIcon(list, true)}
                      {list.name}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setTempLists(tempLists.filter((l) => l.id !== list.id))
                        }}
                        className="ml-1 hover:bg-black/20 rounded-full p-0.5"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}

              <input
                ref={listInputRef}
                type="text"
                value={listSearchTerm}
                onChange={(e) => {
                  setListSearchTerm(e.target.value)
                  setShowListSuggestions(true)
                }}
                onFocus={() => setShowListSuggestions(true)}
                placeholder="Search lists..."
                className="w-full px-3 py-2 border rounded-md bg-gray-700 border-gray-600 text-white placeholder-gray-400"
              />

              {/* Suggestions dropdown */}
              {showListSuggestions && getFilteredLists().length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-gray-700 border border-gray-600 rounded-md shadow-lg max-h-60 overflow-auto">
                  {getFilteredLists().map((list, index) => (
                    <div
                      key={list.id}
                      className={`px-3 py-2 cursor-pointer ${
                        index === selectedSuggestionIndex ? 'bg-gray-600' : 'hover:bg-gray-600'
                      } flex items-center gap-2`}
                      onClick={() => {
                        setTempLists([...tempLists, list])
                        setListSearchTerm('')
                        setShowListSuggestions(false)
                      }}
                    >
                      {getListPrivacyIcon(list)}
                      <span className="text-white">{list.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCancelLists}
              >
                <X className="w-4 h-4 mr-1" />
                Cancel
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={handleSaveLists}
              >
                <Check className="w-4 h-4 mr-1" />
                Save
              </Button>
            </div>
          </div>
        ) : (
          <div
            className={`flex flex-wrap gap-2 mt-1 col-span-2 px-2 py-1 rounded ${!readOnly ? 'cursor-pointer theme-surface-hover' : ''}`}
            onClick={() => !readOnly && setEditingLists(true)}
          >
            {task.lists && task.lists.length > 0 ? (
              task.lists.filter(list => list != null).map((list) => (
                <Badge
                  key={list.id}
                  variant="secondary"
                  className="flex items-center gap-1"
                  style={{ backgroundColor: list.color, color: 'white' }}
                >
                  {getListPrivacyIcon(list, true)}
                  {list.name}
                </Badge>
              ))
            ) : (
              <span className="theme-text-muted">No lists</span>
            )}
          </div>
        )}
      </div>

      {/* Description Field */}
      <div className="flex flex-col gap-2">
        <Label className="text-sm theme-text-muted">Description</Label>
        {editingDescription ? (
          <div ref={descriptionRef}>
            <textarea
              ref={descriptionTextareaRef}
              value={tempDescription}
              onChange={(e) => setTempDescription(e.target.value)}
              placeholder="Add a description..."
              className="w-full theme-comment-bg theme-border border theme-text-primary rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-base min-h-[80px] overflow-hidden"
              autoComplete="off"
              spellCheck={true}
              autoCapitalize="sentences"
              inputMode="text"
              enterKeyHint="done"
              onTouchStart={(e) => {
                // Track focus time for mobile keyboard protection
                const target = e.target as HTMLTextAreaElement
                ;(window as any)._lastFocusTime = Date.now()
                target.focus()
              }}
              onClick={(e) => {
                // Ensure click also triggers focus
                const target = e.target as HTMLTextAreaElement
                ;(window as any)._lastFocusTime = Date.now()
                target.focus()
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (e.shiftKey || e.metaKey || e.ctrlKey) {
                    // Shift+Enter, Cmd/Ctrl + Enter: Add line break (default textarea behavior)
                    return
                  } else {
                    // Plain Enter: Save description
                    e.preventDefault()
                    handleSaveDescription()
                  }
                } else if (e.key === 'Escape') {
                  handleCancelDescription()
                }
              }}
            />
            <div className="text-xs theme-text-muted mt-1">
              Press Enter to save • Shift+Enter for line breaks
            </div>
          </div>
        ) : (
          <div
            className={`px-3 py-2 rounded border border-transparent flex items-start !min-h-0 ${!readOnly ? 'cursor-pointer theme-surface-hover hover:theme-border' : ''}`}
            onClick={() => !readOnly && setEditingDescription(true)}
          >
            {task.description ? (
              <div
                className="prose prose-sm max-w-none theme-text-primary"
                dangerouslySetInnerHTML={{
                  __html: renderMarkdownWithLinks(task.description, { codeClass: 'theme-bg-tertiary px-1 rounded text-sm' })
                }}
              />
            ) : (
              <span className="theme-text-muted italic">Click to add a description...</span>
            )}
          </div>
        )}
      </div>
    </>
  )
}
