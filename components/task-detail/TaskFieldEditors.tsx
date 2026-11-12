"use client"

import { scrollBehavior } from "@/lib/design/reduced-motion"
import { useEffect, useState } from "react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Calendar } from "@/components/ui/calendar"
import { UserPicker } from "@/components/user-picker"
import { CustomRepeatingEditor, isCustomPatternSavable } from "@/components/custom-repeating-editor"
import { PriorityPicker } from "@/components/ui/priority-picker"
import { PRIORITY_ROW_GLYPH } from "@/lib/priority-glyph"
import { TaskFieldRow } from "./TaskFieldRow"
import { usesCompactTaskDetail } from "@/lib/task-display-mode"
import { TaskDetailBoardStateRow } from "./TaskDetailBoardStateRow"
import { TaskDetailBlockersRow } from "./TaskDetailBlockersRow"
import { TaskDetailDescriptionRow } from "./TaskDetailDescriptionRow"
import { TaskDetailListsRow } from "./TaskDetailListsRow"
import { TaskDetailPriorityRow } from "./TaskDetailPriorityRow"
import { TaskProjectFieldsSection } from "./TaskProjectFieldsSection"
import { TimePicker, formatConciseTime } from "@/components/ui/time-picker"
import { useMobileKeyboard } from "@/hooks/shared/useMobileKeyboard"
import { Calendar as CalendarIcon, User as UserIcon } from "lucide-react"
import { format } from "date-fns"
import { formatDateForDisplay } from "@/lib/date-utils"
import { allDayInstantForLocalDay, taskCalendarDay } from "@/lib/date-comparison"
import { useTranslations } from "@/lib/i18n/client"
import { fillMessage } from "@/components/shared/RichMessage"
import { customRepeatingSummary } from "./custom-repeating-summary"
import type { Task, TaskList, User } from "@/types/task"

interface TaskFieldEditorsProps {
  task: Task
  currentUser: User
  availableLists: TaskList[]
  onUpdate: (task: Task) => void
  readOnly?: boolean  // If true, disable all editing
  shouldHidePriority?: boolean  // Hide priority field for public lists
  /** Viewer's task display mode; absent means list (task ffa5bbb5). */
  displayMode?: string | null
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
  displayMode,
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
  // Project mode compacts priority and assignee out of the panel and behind
  // the leading control's popover (task ffa5bbb5). Normalized rather than
  // compared, so an unrecognised mode renders the safe layout.
  const compactTaskDetail = usesCompactTaskDetail(displayMode)
  const { t, locale } = useTranslations()

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
        textarea.scrollIntoView({ behavior: scrollBehavior(), block: 'center', inline: 'nearest' })
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
        // Default to all-day task: UTC midnight of the picked local day
        date = allDayInstantForLocalDay(date)
        onUpdate({ ...task, dueDateTime: date, isAllDay: true })
      }
    } else {
      // Removing date: null, not undefined, so the clear reaches the server (AWTD-1272).
      onUpdate({ ...task, dueDateTime: null, isAllDay: false })
    }
    setTempWhen(date)
    setEditingWhen(false)
  }

  const handleSaveTime = (time: Date | string | null) => {
    if (!time) {
      // Clear the time - make it all-day on the task's own day
      if (task.dueDateTime) {
        const dateOnly = allDayInstantForLocalDay(taskCalendarDay(new Date(task.dueDateTime), !!task.isAllDay))
        onUpdate({ ...task, dueDateTime: dateOnly, isAllDay: true })
        setTempWhen(dateOnly)
      }
    } else if (time instanceof Date) {
      // Combine the existing date with the new time
      if (!task.dueDateTime) return
      const updatedDate = taskCalendarDay(new Date(task.dueDateTime), !!task.isAllDay)
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

  const handleSaveAssignee = () => {
    onUpdate({ ...task, assignee: tempAssignee, assigneeId: tempAssignee?.id || null })
    setEditingAssignee(false)
  }

  const handleCancelAssignee = () => {
    setTempAssignee(task.assignee || null)
    setEditingAssignee(false)
  }

  return (
    <>
      {/* FIELD ORDER: Who, Date, Priority, Lists (task 4dd640d9).
       *
       *  Stated once in lib/task-detail-field-order.ts and pinned by
       *  tests/components/task-detail-field-order.test.ts, mirroring
       *  TaskDetailFieldOrder.swift on iOS/Mac. Before this, all three
       *  platforms rendered Priority before Who — the same wrong order
       *  written out three times, which is why it is stated once now.
       *
       *  Who and Priority are separate blocks rather than one, because Date
       *  sits BETWEEN them. They still share their conditions exactly. */}
      {/* Priority and Assignee.
       *
       *  LIST MODE gives each its own row (task ffa5bbb5). They shared one row
       *  — labelled "Priority", assignee beside the picker — since task
       *  dcbbb0fa; Jon asked for "separate rows in task details in all
       *  interfaces on board and list view for Priority and assigned".
       *
       *  PROJECT MODE drops both entirely: "we compact the task details so
       *  priority and assignee and complete/mark as incomplete are accessed by
       *  tapping on the checkbox". The leading control opens the popover that
       *  carries them, so this is a move rather than a removal.
       *
       *  A PUBLIC-LIST TASK keeps its single "Created by" row and is not split.
       *  It shows its creator INSTEAD of an assignee and hides the priority
       *  picker, so splitting it would invent an assignee row for a task with
       *  no assignee concept. */}
      {!shouldHidePriority && !compactTaskDetail && (
        isPublicListTask ? (
          <TaskFieldRow label={t('tasks.createdBy')} icon={<UserIcon className="w-4 h-4" />}>
            <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center space-x-2 px-2 py-1 rounded">
            {task.creator ? (
              <>
                <Avatar className="w-6 h-6">
                  <AvatarImage src={task.creator.image || "/placeholder.svg"} />
                  <AvatarFallback>{task.creator.name?.charAt(0) || task.creator.email?.charAt(0)}</AvatarFallback>
                </Avatar>
                <span className="text-brand">{task.creator.name || task.creator.email}</span>
              </>
            ) : (
              <span className="theme-text-muted">{t('tasks.detail.unknownCreator')}</span>
            )}
          </div>
            </div>
          </TaskFieldRow>
        ) : (
            <TaskFieldRow label={t('tasks.assignee')} icon={<UserIcon className="w-4 h-4" />}>
              <div className="flex flex-wrap items-center gap-3" data-testid="task-detail-assignee">
          {/* An IIFE, lifted verbatim from the combined row so the editor's
              behaviour is unchanged by the split. */}
          {(() => {
            return editingAssignee ? (
              <div ref={assigneeRef}>
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
                  placeholder={t('tasks.detail.searchUsersOrEmail')}
                  inline={true}
                  autoFocus={true}
                />
              </div>
            ) : (
              <div
                className={`flex items-center space-x-2 px-2 py-1 rounded ${!readOnly ? 'cursor-pointer theme-surface-hover' : ''}`}
                onClick={() => !readOnly && setEditingAssignee(true)}
              >
                {task.assignee ? (
                  <>
                    <Avatar className="w-6 h-6">
                      <AvatarImage src={task.assignee.image || "/placeholder.svg"} />
                      <AvatarFallback>{task.assignee.name?.charAt(0) || task.assignee.email?.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <span className="text-brand">{task.assignee.name || task.assignee.email}</span>
                  </>
                ) : (
                  <>
                    <Avatar className="w-6 h-6">
                      <AvatarImage src="/placeholder.svg" />
                      <AvatarFallback>{t('tasks.unassignedMark')}</AvatarFallback>
                    </Avatar>
                    <span className="theme-text-muted">{t('tasks.unassigned')}</span>
                  </>
                )}
              </div>
            )
          })()}
              </div>
            </TaskFieldRow>
        )
      )}

      {/* When row: Date · Time · Repeat on ONE line (task dcbbb0fa).
       *
       *  Previously three stacked rows, each with its own label and padding.
       *  The reclaimed vertical space is the deliverable — the description was
       *  being pushed below the fold by chrome. Mirrors the iOS/Mac shape from
       *  42013da7, where Time and Repeat stay conditional on a date existing,
       *  so an undated task shows a single "Add date" control rather than
       *  three empty ones. */}
      {!shouldHideWhen && (
      <TaskFieldRow label={t('tasks.when')} icon={<CalendarIcon className="w-4 h-4" />} align="start">
        <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-2 min-w-0" data-testid="when-date">
        {editingWhen ? (
          <Popover open={editingWhen} onOpenChange={setEditingWhen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className="w-auto justify-start bg-theme-button border-theme-button text-theme-primary hover:bg-theme-button-hover"
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {tempWhen ? (locale && locale !== 'en' ? tempWhen.toLocaleDateString(locale, { dateStyle: 'long' }) : format(tempWhen, "PPP")) : t('tasks.detail.selectDate')}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0">
              <div className="p-3 border-b border-theme-surface">
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
                    {t('time.today')}
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
                    {t('time.tomorrow')}
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
                    {t('tasks.detail.nextWeek')}
                  </Button>
                </div>
              </div>
              <Calendar
                mode="single"
                selected={tempWhen}
                onSelect={handleSaveWhen}
                autoFocus
              />
              <div className="p-3 border-t border-theme-surface flex justify-between">
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
            <span className={task.dueDateTime ? "text-brand" : "theme-text-muted"}>
              {task.dueDateTime ? formatDateForDisplay(new Date(task.dueDateTime), task.isAllDay, { locale, t }) : t('time.noDate')}
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
                value={task.isAllDay ? null : tempWhen} // all-day is UTC midnight, "4pm" in LA (AWTD-1274)
                onChange={handleSaveTime}
              />
            </div>
          ) : (
            <div
              className={`flex items-center gap-1 px-2 py-1 rounded ${!readOnly ? 'cursor-pointer theme-surface-hover' : ''}`}
              onClick={() => !readOnly && setEditingTime(true)}
            >
              <span className={task.dueDateTime && !task.isAllDay ? "text-brand" : "theme-text-muted"}>
                {task.dueDateTime && !task.isAllDay ? formatConciseTime(new Date(task.dueDateTime), locale) : t('time.allDay')}
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
                    <SelectValue placeholder={t('tasks.detail.selectRepeat')} />
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
                      <span className="font-medium">{t('tasks.detail.preview')} </span>
                      {customRepeatingSummary(tempRepeatingData, localRepeatFrom, t, locale)}
                    </div>
                  )}

                  {/* Repeat Mode Selector - part of custom pattern chooser */}
                  <div className="mb-3">
                    <Label className="text-sm theme-text-muted mb-2 block">{t('tasks.detail.repeatMode')}</Label>
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
                          <SelectItem value="COMPLETION_DATE">{t('tasks.detail.repeatFromCompletion')}</SelectItem>
                          <SelectItem value="DUE_DATE">{t('tasks.detail.repeatFromDue')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="text-xs theme-text-muted mt-1">
                      {localRepeatFrom === "COMPLETION_DATE"
                        ? t('tasks.detail.repeatFromCompletionHint')
                        : t('tasks.detail.repeatFromDueHint')}
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
                      size="sm" disabled={!isCustomPatternSavable(tempRepeatingData)}
                      onClick={() => handleSaveRepeating('custom')}
                    >
                      {t('tasks.detail.saveCustomPattern')}
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
                  const summary = customRepeatingSummary(repeatingDataValue, repeatFrom, t, locale)
                  return summary
                }

                // Show simple pattern with mode indicator
                const pattern = repeatingValue || 'never'
                // AITD-582: the picker's label, not the raw value
                const label = t(`repeating.${pattern === 'never' ? 'oneTimeOnly' : pattern}`)
                return pattern !== 'never' && repeatFrom === 'DUE_DATE' ? fillMessage(t('repeating.summary.labelFromDueDate'), { label }) : label
              })()}
            </div>
          )}
        </div>
      )}
        </div>
      </TaskFieldRow>
      )}

      {/* Priority — third, after Date. Its own component since AWTD-1210. */}
      <TaskDetailPriorityRow
        value={tempPriority}
        onChange={handleSavePriority}
        readOnly={readOnly}
        hidden={shouldHidePriority || compactTaskDetail || isPublicListTask}
      />


      {/* Lists row — its own component since AWTD-1002; see that file for why. */}
      <TaskDetailListsRow
        task={task}
        availableLists={availableLists}
        onUpdate={onUpdate}
        readOnly={readOnly}
        editingLists={editingLists}
        setEditingLists={setEditingLists}
        tempLists={tempLists}
        setTempLists={setTempLists}
        listSearchTerm={listSearchTerm}
        setListSearchTerm={setListSearchTerm}
        showListSuggestions={showListSuggestions}
        setShowListSuggestions={setShowListSuggestions}
        selectedSuggestionIndex={selectedSuggestionIndex}
        listSearchRef={listSearchRef}
        listInputRef={listInputRef}
      />

      {/* BOARD STATE — appended AFTER the Who/Date/Priority/Lists contract
          above, never interleaved into it (task 5221e43f). State belongs with
          WHERE the task lives, so it follows Lists; the cross-platform order in
          lib/task-detail-field-order.ts covers those four fields only, and iOS
          appends this row in the same place for the same reason.

          The row decides its own visibility, from the rule iOS and Mac share. */}
      <TaskDetailBoardStateRow
        task={task}
        availableLists={availableLists}
        displayMode={displayMode}
        readOnly={readOnly}
        onUpdate={onUpdate}
      />

      {/* WAITING ON — after board state, because a blocker is a statement about
          the task's lane (AWTD-1002). Decides its own visibility from
          `showsTaskBlockers`, beside the rule above. */}
      <TaskDetailBlockersRow
        task={task}
        availableLists={availableLists}
        readOnly={readOnly}
      />

      <TaskDetailDescriptionRow
        task={task}
        readOnly={readOnly}
        editingDescription={editingDescription}
        setEditingDescription={setEditingDescription}
        tempDescription={tempDescription}
        setTempDescription={setTempDescription}
        descriptionRef={descriptionRef}
        descriptionTextareaRef={descriptionTextareaRef}
        handleSaveDescription={handleSaveDescription}
        handleCancelDescription={handleCancelDescription}
      />

      {/* PROJECT FIELDS — last, after every native row (AWTD-1210, §9.4 D4).
          They are the board's own columns rather than this app's, and there can
          be many of them, so they follow the fixed rows instead of pushing
          Description down the pane. The section renders nothing at all unless
          the task is on a GitHub-backed board with unmapped fields, so a
          classic task's pane is unchanged. */}
      <TaskProjectFieldsSection task={task} onUpdate={onUpdate} readOnly={readOnly} />
    </>
  )
}
