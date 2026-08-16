"use client"

import { useState, useEffect, useMemo, useRef, useCallback, memo } from "react"
import { unwrapTask, unwrapList } from '@/lib/v1-response'
import { useTaskDetailState } from "@/hooks/task-detail/useTaskDetailState"
import { useTaskShareLink } from "@/hooks/task-detail/useTaskShareLink"
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh"
import { useAgentTyping } from "@/hooks/use-agent-typing"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MarkdownEditor } from "./markdown-editor"
import { UserPicker } from "./user-picker"
import { CustomRepeatingEditor } from "./custom-repeating-editor"
import { PriorityPicker } from "./ui/priority-picker"
import { TimePicker, formatConciseTime } from "./ui/time-picker"
import { CommentSection, CommentInputBar } from "./task-detail/CommentSection"
import { TaskFieldEditors } from "./task-detail/TaskFieldEditors"
import { PriorityAssigneePicker } from "./priority-assignee-picker"
import { usesCompactTaskDetail } from "@/lib/task-display-mode"
import { boardColumnsFor, resolveColumnMove, taskColumnId } from "@/lib/task-status"
import { TaskModals } from "./task-detail/TaskModals"
import { TaskHeader } from "./task-detail/TaskHeader"
import { TaskActivitySection } from "./task-detail/TaskActivitySection"
import type { Task, Comment, User, TaskList } from "../types/task"
import { Calendar as CalendarIcon, Paperclip, MessageSquare, Lock, Unlock, Check, X, Upload, Image as ImageIcon, FileText, Reply, Send, Copy, Link as LinkIcon } from "lucide-react"
import { apiPost } from "@/lib/api"
import { shouldHideTaskPriority, shouldHideTaskWhen, shouldHideTaskComments } from "@/lib/public-list-utils"
import { format } from "date-fns"
import { useTheme } from "@/contexts/theme-context"
import { useSSESubscription } from "@/hooks/use-sse-subscription"
import { useSettings } from "@/contexts/settings-context"
import { useReminders } from "@/lib/reminder-manager"
import { useCodingAssignmentDetector } from "@/hooks/use-coding-assignment-detector"
import { usePanelArrowPosition } from "@/hooks/usePanelArrowPosition"
import {
  isIPadDevice,
  shouldPreventAutoFocus,
  getKeyboardDetectionThreshold,
  needsAggressiveKeyboardProtection,
  shouldIgnoreTouchDuringKeyboard,
  needsScrollIntoViewHandling,
  getFocusProtectionThreshold,
  needsMobileFormHandling,
  isMobileDevice
} from "@/lib/layout-detection"

// Stable event type arrays to prevent re-subscriptions
const TASK_DETAIL_EVENT_TYPES = [
  'comment_created',
  'comment_updated',
  'comment_deleted',
  'task_updated'
] as const

interface TaskDetailProps {
  task: Task
  currentUser: User
  availableLists?: TaskList[]
  availableTasks?: Task[]
  onUpdate: (task: Task) => void
  onLocalUpdate?: (updatedTaskOrFn: Task | ((taskId: string, currentTask: Task) => Task)) => void  // Update local state only, no API call
  onDelete: (taskId: string) => void
  onEdit?: () => void
  onClose?: () => void
  onCopy?: (taskId: string, targetListId?: string, includeComments?: boolean) => Promise<void>
  onSaveNew?: (task: Task) => Promise<void>
  selectedTaskElement?: HTMLElement | null
  readOnly?: boolean  // If true, shows view-only mode (no editing)
  /** Viewer's task display mode: 'list' | 'project'; absent means list (task ffa5bbb5). */
  displayMode?: string | null
  /**
   * Whether the viewer may post comments. Separate from `readOnly` on purpose:
   * on a shared list a member who cannot EDIT a task can still COMMENT on it,
   * which is the whole reason task-detail-viewonly renders a CommentSection
   * (it passes readOnly={!canComment} rather than reusing one flag for both).
   *
   * `readOnly` used to decide this too, and that conflation is live rather than
   * theoretical: project-status-board passes readOnly={!canEdit}, so a member
   * who can view but not edit a task on the board gets no comment box today.
   *
   * Defaults to !readOnly so every existing caller behaves exactly as before —
   * this prop only ADDS the ability to say "cannot edit, may comment". Changing
   * what the status board passes is a separate, visible change (task 72cb4a13).
   */
  canComment?: boolean
  inline?: boolean
  /**
   * Whether this pane can be expanded to full screen. Set by whoever renders
   * the pane, because only they know if it is windowed: the desktop floating
   * pane can expand, the phone pane already fills the screen so a toggle
   * there is meaningless. Previously inferred from a CSS width breakpoint,
   * which hid the control on iPad portrait. (Task 0ea0b818)
   */
  allowFullScreen?: boolean
  swipeToDismiss?: {
    onTouchStart: (e: React.TouchEvent) => void
    onTouchMove: (e: React.TouchEvent) => void
    onTouchEnd: (e: React.TouchEvent) => void
  }
}

function TaskDetailComponent({ task, currentUser, availableLists = [], availableTasks = [], onUpdate, onLocalUpdate, onDelete, onEdit, onClose, onCopy, onSaveNew, selectedTaskElement, readOnly = false, displayMode, canComment, inline = false, allowFullScreen = false, swipeToDismiss }: TaskDetailProps) {
  const { theme } = useTheme()

  // Editing and commenting are separate permissions — see the canComment prop.
  // Defaulting to !readOnly preserves every current caller's behaviour exactly,
  // so this widening is a no-op until a caller passes canComment explicitly.
  const canPostComments = canComment ?? !readOnly

  // SSE subscriptions handled by useSSESubscription hook below
  const { reminderDebugMode } = useSettings()
  const { triggerManualReminder } = useReminders(currentUser.id)

  // Detect coding agent assignments and trigger workflows
  useCodingAssignmentDetector(task, (workflowId) => {
    console.log('🎯 [TaskDetail] Coding workflow created:', workflowId)
    // Could show a notification or update UI here
  })

  // Agent typing indicator for task comments
  const agentTyping = useAgentTyping(null, task.id)

  // Consolidated state management using custom hook
  const state = useTaskDetailState(task)

  // Destructure for easier access (maintain backward compatibility)
  const { newComment, setNewComment, uploadingFile, setUploadingFile, attachedFiles, setAttachedFiles,
    replyingTo, setReplyingTo, replyContent, setReplyContent, replyAttachedFiles, setReplyAttachedFiles,
    uploadingReplyFile, setUploadingReplyFile, showingActionsFor, setShowingActionsFor } = state.comments

  const { showDeleteConfirmation, setShowDeleteConfirmation, showCopyConfirmation, setShowCopyConfirmation,
    copyIncludeComments, setCopyIncludeComments, copyTargetListId, setCopyTargetListId } = state.modals

  // Share-by-link owns its own state — see hooks/task-detail/useTaskShareLink.
  const { showShareModal, shareUrl, loadingShareUrl, shareUrlCopied,
    openShareModal, copyShareUrl, closeShareModal } = useTaskShareLink(task.id)

  const { searchTerm: listSearchTerm, setSearchTerm: setListSearchTerm, showSuggestions: showListSuggestions,
    setShowSuggestions: setShowListSuggestions, selectedIndex: selectedSuggestionIndex, setSelectedIndex: setSelectedSuggestionIndex,
    lastLocalUpdate: lastLocalListUpdate, setLastLocalUpdate: setLastLocalListUpdate,
    searchRef: listSearchRef, inputRef: listInputRef } = state.listSelection

  const { assigneeRef: assigneeEditRef, descriptionRef: descriptionEditRef,
    descriptionTextareaRef } = state.editing

  // Scroll area ref for auto-scrolling when new comments are added.
  // Tracked as IDS, not a count: the task object is replaced wholesale on every
  // refresh and every field edit, so a count alone cannot tell "a comment was
  // posted" from "the comments array finally arrived" (task 5e997cf9).
  const scrollAreaRef = useRef<HTMLDivElement | null>(null)
  const prevCommentIdsRef = useRef<string[]>((task.comments || []).map(c => c.id))
  const prevCommentTaskIdRef = useRef(task.id)

  const arrowTop = usePanelArrowPosition({
    sourceSelector: `[data-task-id="${task.id}"]`,
    getPanelElement: () =>
      (document.querySelector('[data-task-panel-desktop]') as HTMLElement | null)
        ?? (document.querySelector('[data-task-detail-panel]') as HTMLElement | null),
    initialTop: 60,
  })

  // Inline editing states (from consolidated state)
  const { title: editingTitle, setEditingTitle, description: editingDescription, setEditingDescription,
    when: editingWhen, setEditingWhen, time: editingTime, setEditingTime,
    priority: editingPriority, setEditingPriority, repeating: editingRepeating, setEditingRepeating,
    lists: editingLists, setEditingLists, assignee: editingAssignee, setEditingAssignee,
    registerCommit, cancelEditing } = state.editing

  // Temporary edit values (from consolidated state with auto-sync)
  const { title: tempTitle, setTempTitle, description: tempDescription, setTempDescription,
    when: tempWhen, setTempWhen, priority: tempPriority, setTempPriority,
    repeating: tempRepeating, setTempRepeating, repeatingData: tempRepeatingData,
    setTempRepeatingData, lastRepeatingUpdate, setLastRepeatingUpdate,
    completed: tempCompleted, setTempCompleted } = state.tempValues

  // Note: Temp state synchronization is now handled automatically by useTaskDetailState hook
  // This eliminates 5 useEffect blocks for title, description, priority, when, and repeating sync

  // Sync tempLists when task.lists changes from external updates (but not while editing)
  useEffect(() => {
    if (!editingLists && task.lists) {
      // Don't sync if we just performed a local update recently (within 2 seconds)
      const timeSinceLastUpdate = Date.now() - lastLocalListUpdate
      if (timeSinceLastUpdate < 2000) {
        return
      }
      
      setTempLists(task.lists)
    }
  }, [task.lists, editingLists, lastLocalListUpdate])

  // Initialize tempLists when task changes (like when switching between different tasks)
  useEffect(() => {
    setTempLists(task.lists || [])
  }, [task.id, task.lists])

  // Auto-focus the list search input when editing lists starts
  useEffect(() => {
    if (editingLists && listInputRef.current) {
      // Small delay to ensure the input is rendered
      const timer = setTimeout(() => {
        listInputRef.current?.focus()
      }, 10)
      return () => clearTimeout(timer)
    }
  }, [editingLists, listInputRef])

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

  // Auto-focus the description textarea when editing description starts
  useEffect(() => {
    if (editingDescription && descriptionTextareaRef.current) {
      if (shouldPreventAutoFocus()) {
        // On touch devices, don't auto-focus programmatically
        // Focus is handled in the click handler to maintain user gesture
        return
      }

      // Auto-focus on desktop (including narrow desktop windows)
      const timer = setTimeout(() => {
        if (descriptionTextareaRef.current) {
          descriptionTextareaRef.current.focus()
        }
      }, 10)
      return () => clearTimeout(timer)
    }
  }, [editingDescription, descriptionTextareaRef])


  // Mobile keyboard handling - prevent task details from closing when keyboard opens/closes
  useEffect(() => {
    if (typeof window === 'undefined') return
    
    let isKeyboardOpen = false
    const initialViewportHeight = window.innerHeight
    
    const handleResize = () => {
      const currentHeight = window.innerHeight
      const heightDifference = initialViewportHeight - currentHeight
      
      // Use centralized keyboard detection threshold
      const keyboardThreshold = getKeyboardDetectionThreshold()
      const keyboardOpened = heightDifference > keyboardThreshold
      
      if (keyboardOpened !== isKeyboardOpen) {
        isKeyboardOpen = keyboardOpened
        
        // When keyboard opens/closes, temporarily disable click-outside handlers
        // This prevents the task detail from closing due to viewport changes
        if (isKeyboardOpen) {
          document.body.classList.add('keyboard-open')
        } else {
          document.body.classList.remove('keyboard-open')
        }
      }
    }
    
    let focusInTimeout: NodeJS.Timeout | null = null
    let focusOutTimeout: NodeJS.Timeout | null = null

    // Handle focus events for mobile form elements
    const handleFocusIn = (event: Event) => {
      const target = event.target as HTMLElement
      if (target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT'
      )) {
        // Track focus time for iPad protection
        ;(window as any)._lastFocusTime = Date.now()

        // Add a class to prevent accidental closes during focus
        document.body.classList.add('form-element-focused')

        // For iPad, also add keyboard-open class since resize events don't fire
        if (isIPadDevice() && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) {
          document.body.classList.add('keyboard-open')
          ;(window as any)._iPadKeyboardOpen = true
        }

        // Also prevent scrolling issues on iOS and iPad
        if (needsScrollIntoViewHandling()) {
          focusInTimeout = setTimeout(() => {
            target.scrollIntoView({
              behavior: 'smooth',
              block: 'center',
              inline: 'nearest'
            })
          }, 100)
        }
      }
    }

    const handleFocusOut = (event: Event) => {
      // Small delay to prevent flickering when focus moves between elements
      focusOutTimeout = setTimeout(() => {
        const activeElement = document.activeElement as HTMLElement
        const shouldRemoveClass = !activeElement || (
          activeElement.tagName !== 'INPUT' &&
          activeElement.tagName !== 'TEXTAREA' &&
          activeElement.tagName !== 'SELECT'
        )

        if (shouldRemoveClass) {
          document.body.classList.remove('form-element-focused')

          // For iPad, also remove keyboard-open class since resize events don't fire
          if (isIPadDevice() && (window as any)._iPadKeyboardOpen) {
            document.body.classList.remove('keyboard-open')
            ;(window as any)._iPadKeyboardOpen = false
          }
        }
      }, 100)
    }

    // Add listeners
    window.addEventListener('resize', handleResize, { passive: true })
    document.addEventListener('focusin', handleFocusIn, { passive: true })
    document.addEventListener('focusout', handleFocusOut, { passive: true })

    return () => {
      // Clean up timeouts to prevent errors in tests
      if (focusInTimeout) {
        clearTimeout(focusInTimeout)
      }
      if (focusOutTimeout) {
        clearTimeout(focusOutTimeout)
      }

      window.removeEventListener('resize', handleResize)
      document.removeEventListener('focusin', handleFocusIn)
      document.removeEventListener('focusout', handleFocusOut)
      document.body.classList.remove('keyboard-open', 'form-element-focused')
    }
  }, [])


  

  const [showCustomRepeatingEditor, setShowCustomRepeatingEditor] = useState(false)
  const [showTimer, setShowTimer] = useState(false)
  const [tempLists, setTempLists] = useState<TaskList[]>(task.lists || [])
  const [tempAssignee, setTempAssignee] = useState<User | null>(task.assignee || null)

  // Ref for refreshing comments - used by SSE reconnection handler
  const refreshCommentsRef = useRef<(() => Promise<void>) | null>(null)

  // Guard to prevent race conditions during comment refresh
  // When true, SSE events skip updating comments to avoid flashing
  const isRefreshingCommentsRef = useRef(false)

  // Ref for latest task - used by SSE callbacks to avoid stale closure issues
  const taskRef = useRef(task)
  taskRef.current = task

  // Handle clicking outside to auto-save various fields
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node

      // On devices that need keyboard protection, ignore touch events during keyboard interactions
      if (('touches' in event || event.type === 'touchstart') && shouldIgnoreTouchDuringKeyboard()) {
        return
      }
      
      // Check if any form element is focused (more reliable than class-based detection)
      const activeElement = document.activeElement
      const isFormElementFocused = activeElement && (
        activeElement.tagName === 'INPUT' || 
        activeElement.tagName === 'TEXTAREA' || 
        activeElement.tagName === 'SELECT'
      )
      
      // Aggressive protection for devices that need it
      const hasKeyboardOpen = document.body.classList.contains('keyboard-open')
      const hasFormFocusedClass = document.body.classList.contains('form-element-focused')

      const shouldIgnoreForProtection = needsAggressiveKeyboardProtection() && (
        hasKeyboardOpen ||
        hasFormFocusedClass ||
        isFormElementFocused ||
        // Also check if our specific textarea is focused
        (descriptionTextareaRef.current && document.activeElement === descriptionTextareaRef.current)
      )

      // Ignore if keyboard is open or form element is focused to prevent accidental closes
      if (shouldIgnoreForProtection || hasKeyboardOpen || hasFormFocusedClass || isFormElementFocused) {
        return
      }

      // Extra protection - if this event is happening right after focus, ignore it
      if (needsAggressiveKeyboardProtection() && event.type === 'mousedown') {
        const now = Date.now()
        const lastFocusTime = (window as any)._lastFocusTime || 0
        const timeSinceFocus = now - lastFocusTime
        const threshold = getFocusProtectionThreshold()

        if (timeSinceFocus < threshold) {
          return
        }
      }
      
      // Also ignore if the target is an input, textarea, or other form element that should have focus
      const targetElement = target as Element
      if (targetElement && (
        targetElement.tagName === 'INPUT' || 
        targetElement.tagName === 'TEXTAREA' || 
        targetElement.tagName === 'SELECT' ||
        targetElement.closest('input') ||
        targetElement.closest('textarea') ||
        targetElement.closest('select') ||
        targetElement.closest('[role="combobox"]') ||
        targetElement.closest('[role="listbox"]')
      )) {
        return
      }
      
      // Handle list editing
      if (listSearchRef.current && !listSearchRef.current.contains(target)) {
        setShowListSuggestions(false)
        setSelectedSuggestionIndex(-1)
        
        // If we're editing lists and clicked outside, auto-save and close editing
        if (editingLists) {
          // Don't auto-save if the lists haven't actually changed
          const currentListIds = task.lists.map(l => l.id).sort()
          const tempListIds = tempLists.map(l => l.id).sort()
          const listsChanged = JSON.stringify(currentListIds) !== JSON.stringify(tempListIds)
          
          if (listsChanged) {
            onUpdate({ 
              ...task, 
              lists: tempLists
            })
          }
          setEditingLists(false)
          setListSearchTerm("")
        }
      }
      
      // Handle assignee editing
      if (assigneeEditRef.current && !assigneeEditRef.current.contains(target) && editingAssignee) {
        if (tempAssignee) {
          onUpdate({ ...task, assignee: tempAssignee })
        }
        setEditingAssignee(false)
      }
      
      // Handle description editing
      if (descriptionEditRef.current && !descriptionEditRef.current.contains(target) && editingDescription) {
        if (tempDescription !== task.description) {
          onUpdate({ ...task, description: tempDescription })
        }
        setEditingDescription(false)
      }
      
      // Handle repeating editing - no auto-save, user must click Save button

      // Hide comment actions when clicking elsewhere (but not on an action button itself)
      if (showingActionsFor) {
        const actionBar = (target as HTMLElement).closest?.('[data-comment-actions]')
        if (!actionBar) {
          setShowingActionsFor(null)
        }
      }
    }

    // Use both mousedown and touchstart, but with different handling
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('touchstart', handleClickOutside, { passive: true })
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
    }
  }, [
    editingLists,
    tempLists,
    editingAssignee,
    tempAssignee,
    editingDescription,
    tempDescription,
    task,
    onUpdate,
    showingActionsFor,
    listSearchRef,
    assigneeEditRef,
    descriptionEditRef,
    setShowListSuggestions,
    setSelectedSuggestionIndex,
    setEditingLists,
    setListSearchTerm,
    setEditingAssignee,
    setEditingDescription,
    setShowingActionsFor,
    descriptionTextareaRef
  ])

  const isNewTask = task.id.startsWith('new-')

  // Subscribe to SSE events for real-time comment and task updates using centralized SSE Manager
  // Uses taskRef.current to always access the latest task state and avoid stale closure issues
  useSSESubscription(TASK_DETAIL_EVENT_TYPES, (event) => {
    // Don't process SSE for new/unsaved tasks
    if (isNewTask) {
      return
    }

    // Skip SSE updates for comment events while refresh is in progress
    // This prevents race conditions that cause comments to flash/disappear
    if (isRefreshingCommentsRef.current &&
        (event.type === 'comment_created' || event.type === 'comment_updated' || event.type === 'comment_deleted' ||
         (event.type === 'task_updated' && event.data.task?.comments))) {
      console.log('🔄 [TaskDetail] Skipping SSE update - comment refresh in progress')
      return
    }

    // Always use taskRef.current to get the latest task state
    const currentTask = taskRef.current

    switch (event.type) {
      case 'comment_created': {
        const { taskId, comment, userId } = event.data

        // Only update if this is the same task and not from current user
        // (current user already sees their comment via optimistic update)
        if (taskId === currentTask.id && userId !== currentUser.id && comment) {
          console.log(`📡 [TaskDetail] Received new comment for task ${taskId}:`, comment.id)

          // Check if comment already exists (avoid duplicates)
          const existingComments = currentTask.comments || []
          const commentExists = existingComments.some(c => c.id === comment.id)

          if (!commentExists) {
            // Add the new comment and sort by creation date
            const updatedComments = [...existingComments, comment].sort((a, b) =>
              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
            )

            onUpdate({
              ...currentTask,
              comments: updatedComments
            })
          }
        }
        break
      }

      case 'task_updated': {
        const { task: updatedTask, userId } = event.data

        // Don't process SSE updates from the same user to avoid overriding local changes
        if (userId === currentUser.id) {
          return
        }

        // Only update if this is the same task and has comments in the payload
        if (updatedTask.id === currentTask.id && updatedTask.comments) {
          const existingComments = currentTask.comments || []
          const existingCommentIds = new Set(existingComments.map((c: any) => c.id))

          // Find new comments that don't exist locally
          const newComments = updatedTask.comments.filter((c: any) => !existingCommentIds.has(c.id))

          if (newComments.length > 0) {
            console.log(`📡 [TaskDetail] Task updated with ${newComments.length} new comments for task ${updatedTask.id}`)

            // Merge and sort by creation date
            const mergedComments = [...existingComments, ...newComments].sort((a, b) =>
              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
            )

            onUpdate({
              ...currentTask,
              ...updatedTask,
              comments: mergedComments  // Use merged comments, not replacement
            })
          } else {
            // Even if no new comments, update task fields (but preserve local comments)
            // This handles cases where task metadata changed but comments are the same
            const { comments: _, ...taskWithoutComments } = updatedTask
            if (Object.keys(taskWithoutComments).length > 1) { // More than just 'id'
              onUpdate({
                ...currentTask,
                ...taskWithoutComments,
                comments: existingComments  // Preserve existing comments
              })
            }
          }
        }
        break
      }

      case 'comment_updated': {
        const { taskId, comment, userId } = event.data

        // Only update if this is the same task and not from current user
        if (taskId === currentTask.id && userId !== currentUser.id) {
          console.log(`📡 [TaskDetail] Received comment update for task ${taskId}:`, comment)

          // Update the specific comment in the task
          const existingComments = currentTask.comments || []
          const updatedComments = existingComments.map(c =>
            c.id === comment.id ? { ...c, ...comment } : c
          )

          onUpdate({
            ...currentTask,
            comments: updatedComments
          })
        }
        break
      }

      case 'comment_deleted': {
        const { taskId, commentId, userId } = event.data

        // Only update if this is the same task and not from current user
        if (taskId === currentTask.id && userId !== currentUser.id) {
          console.log(`📡 [TaskDetail] Comment deleted for task ${taskId}:`, commentId)

          // Remove the deleted comment from the task
          const existingComments = currentTask.comments || []
          const filteredComments = existingComments.filter(c => c.id !== commentId)

          onUpdate({
            ...currentTask,
            comments: filteredComments
          })
        }
        break
      }
    }
  }, {
    enabled: !isNewTask,
    componentName: 'TaskDetail',
    // Auto-refresh comments when SSE reconnects after a disconnect
    // This ensures comments posted during the disconnect window are not lost
    onReconnection: () => {
      console.log('🔄 [TaskDetail] SSE reconnected - refreshing comments')
      if (refreshCommentsRef.current) {
        refreshCommentsRef.current()
      }
    }
  })

  /**
   * Close the task as "won't do", or reopen it (task 11042ae3).
   *
   * Closing as canceled still sets completed = true, so the task leaves active
   * views and lands in Done exactly like a finished one; only the reason and
   * the rendering differ. Reopening clears both.
   */
  const handleSetClosedReason = async (closedReason: string | null) => {
    const nextCompleted = closedReason !== null
    setTempCompleted(nextCompleted)

    try {
      await onUpdate({ ...task, completed: nextCompleted, closedReason } as typeof task)
    } catch (error) {
      setTempCompleted(task.completed)
      console.error('Failed to update task closed reason:', error)
    }
  }

  // Full-screen task details (task dcbbb0fa, item 3). Off by default — this is
  // an escape hatch for a long description, not a new default layout.
  const [fullScreen, setFullScreen] = useState(false)
  // Inline/board panels used to be excluded here on the reasoning that a card
  // is a peek. Task 52bf1efb overrode that: a board card's details are the only
  // way to read a task on the board, so they need the escape hatch most.
  // Whoever renders the panel still decides, via allowFullScreen — the phone
  // pane opts out because it is already full screen.
  const canFullScreen = allowFullScreen
  const isFullScreen = canFullScreen && fullScreen

  // Project mode moves priority, assignee, board state and completion behind
  // the leading control (task ffa5bbb5). The panel hosts the sheet because the
  // detail view's own checkbox has to reach it too — compacting the rows away
  // without providing this would REMOVE access rather than relocate it.
  const compactTaskDetail = usesCompactTaskDetail(displayMode)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const statusColumns = useMemo(() => boardColumnsFor(null), [])

  const handleToggleComplete = async () => {
    const newCompleted = !tempCompleted

    // 1. OPTIMISTIC UPDATE: Update UI immediately for instant feedback
    setTempCompleted(newCompleted)

    try {
      // 2. API CALL: Send the update to server
      await onUpdate({ ...task, completed: newCompleted })
    } catch (error) {
      // 3. ROLLBACK: Restore original completed state on error
      setTempCompleted(task.completed)
      console.error('Failed to toggle task completion:', error)
    }
  }

  // Handle saving a new task
  const handleSaveNewTask = async () => {
    if (isNewTask && onSaveNew) {
      try {
        await onSaveNew(task)
      } catch (error) {
        console.error('Failed to save new task:', error)
      }
    }
  }

  // Delete confirmation handlers
  const handleDeleteClick = () => {
    setShowDeleteConfirmation(true)
  }

  const handleConfirmDelete = () => {
    onDelete(task.id)
    setShowDeleteConfirmation(false)
  }

  const handleCancelDelete = () => {
    setShowDeleteConfirmation(false)
  }

  // Copy confirmation handlers
  const handleCopyClick = () => {
    // Reset copy options
    setCopyIncludeComments(false)
    setCopyTargetListId(task.lists?.[0]?.id) // Default to current list
    setShowCopyConfirmation(true)
  }

  const handleConfirmCopy = async () => {
    try {
      if (onCopy) {
        // Use the parent's callback - it will handle the API call and reload data
        await onCopy(task.id, copyTargetListId, copyIncludeComments)
      } else {
        // Fallback: Use the API directly (shouldn't happen in normal TaskManager flow)
        const response = await fetch(`/api/v1/tasks/${task.id}/copy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetListId: copyTargetListId,
            preserveDueDate: true,
            preserveAssignee: false,
            includeComments: copyIncludeComments
          })
        })

        if (!response.ok) {
          throw new Error('Failed to copy task')
        }

        const result = await response.json()
        console.log('✅ Task copied successfully:', result.task?.id)
      }

      setShowCopyConfirmation(false)

      // Close task detail if onClose is provided
      if (onClose) {
        onClose()
      }
    } catch (error) {
      console.error('Failed to copy task:', error)
      // Error notification will be shown by parent's handleCopyTask
    }
  }

  const handleCancelCopy = () => {
    setShowCopyConfirmation(false)
  }

  // Debug mode: Test reminder handler
  const handleTestReminder = () => {
    triggerManualReminder(task)
    console.log('🔔 [DEBUG] Test reminder triggered for:', task.title)
  }

  // Inline editing handlers
  const handleSaveTitle = () => {
    if (tempTitle.trim() && tempTitle !== task.title) {
      onUpdate({ ...task, title: tempTitle.trim() })
    }
    setEditingTitle(false)
  }

  const handleCancelTitle = () => {
    setTempTitle(task.title)
    setEditingTitle(false)
  }

  const handleSaveDescription = () => {
    if (tempDescription !== task.description) {
      onUpdate({ ...task, description: tempDescription })
    }
    setEditingDescription(false)
  }

  const handleCancelDescription = () => {
    setTempDescription(task.description || "")
    setEditingDescription(false)
  }

  const handleSaveWhen = (date: Date | undefined) => {
    // If removing the due date, also remove any repeating settings
    if (!date) {
      const updatedTask = { ...task, dueDateTime: undefined, isAllDay: false, repeating: 'never' as const, repeatingData: undefined }
      onUpdate(updatedTask)
      setTempWhen(undefined)
      setTempRepeating('never')
      setTempRepeatingData(undefined)
      setEditingWhen(false)
      return
    }

    // If there's an existing dueDateTime with a time, preserve the time component
    if (task.dueDateTime && !task.isAllDay) {
      const existingDate = new Date(task.dueDateTime)
      date.setHours(existingDate.getHours(), existingDate.getMinutes(), 0, 0)
      onUpdate({ ...task, dueDateTime: date, isAllDay: false })
    } else {
      // Default to all-day task (midnight)
      date.setHours(0, 0, 0, 0)
      onUpdate({ ...task, dueDateTime: date, isAllDay: true })
    }
    setTempWhen(date)
    setEditingWhen(false)
  }

  const handleSaveTime = (time: Date | string | null) => {
    if (!task.dueDateTime) return // Can only set time if there's a dueDateTime

    if (time === null) {
      // Set time to midnight (all day)
      const updatedDate = new Date(task.dueDateTime)
      updatedDate.setHours(0, 0, 0, 0)
      onUpdate({ ...task, dueDateTime: updatedDate, isAllDay: true })
      setTempWhen(updatedDate)
    } else if (time instanceof Date) {
      // Combine the existing date with the new time
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
    onUpdate({ 
      ...task, 
      repeating,
      repeatingData: repeating === 'custom' ? tempRepeatingData : undefined
    })
    setTempRepeating(repeating)
    setEditingRepeating(false)
  }

  const handleSaveLists = () => {
    onUpdate({ 
      ...task, 
      lists: tempLists
    })
    setEditingLists(false)
  }

  const handleSaveAssignee = () => {
    if (tempAssignee) {
      onUpdate({ ...task, assignee: tempAssignee })
    }
    setEditingAssignee(false)
  }

  const handleCancelAssignee = () => {
    setTempAssignee(task.assignee || null)
    setEditingAssignee(false)
  }

  /**
   * Hand-off commits (task 7b60c7c5). Opening any editor closes the active one
   * BY CONSTRUCTION; these tell the session how to SAVE the one it closes.
   *
   * Only editors holding a pending buffer need this. The pickers — when, time,
   * priority, repeating — already commit on selection, so for them closing is
   * the whole story and there is nothing to register.
   *
   * Re-registered every render because the handlers close over the current
   * temp values; the registry is a ref, so this is a map write, not a re-render.
   */
  useEffect(() => {
    registerCommit('title', handleSaveTitle)
    registerCommit('description', handleSaveDescription)
    registerCommit('lists', handleSaveLists)
    registerCommit('assignee', handleSaveAssignee)
  })

  const handleInviteUser = async (email: string, message?: string) => {
    try {
      const response = await fetch('/api/invitations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          type: 'TASK_ASSIGNMENT',
          taskId: task.id,
          message
        })
      })

      const result = await response.json()

      if (response.ok) {
        if (result.userExists && result.assignedUser) {
          // User exists and was assigned directly
          setTempAssignee(result.assignedUser)
          handleSaveAssignee()
        } else {
          // Invitation sent
          if (process.env.NODE_ENV === "development") {
            console.log('Invitation sent to:', email)
          }
          // You might want to show a toast notification here
        }
      } else {
        console.error('Failed to invite user:', result.error)
        // You might want to show an error toast here
      }
    } catch (error) {
      console.error('Error inviting user:', error)
      // You might want to show an error toast here
    }
  }

  const handleRefreshComments = async () => {
    // Guard against concurrent refreshes to prevent race conditions and comment flashing
    if (isRefreshingCommentsRef.current) {
      console.log('🔄 [TaskDetail] Refresh already in progress, skipping')
      return
    }

    isRefreshingCommentsRef.current = true
    try {
      console.log('🔄 [TaskDetail] Refreshing comments for task:', task.id)
      // Fetch fresh task data from the API
      const response = await fetch(`/api/v1/tasks/${task.id}`, {
        method: 'GET',
        credentials: 'include',
      })

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '')
        throw new Error(
          `Failed to refresh task data (${response.status}${errorBody ? `: ${errorBody}` : ''})`
        )
      }

      const freshTask = unwrapTask<Task>(await response.json())
      if (!freshTask) {
        throw new Error('Task refresh returned no task')
      }

      // CRITICAL: Update taskRef immediately BEFORE triggering state updates
      // This prevents race conditions where SSE events arrive before React re-renders
      // and use stale taskRef.current to merge comments, losing the fresh data
      taskRef.current = freshTask

      // Update the task with fresh data (including comments)
      // Use onLocalUpdate to avoid triggering an API call - we just fetched the data!
      if (onLocalUpdate) {
        onLocalUpdate(freshTask)
      } else {
        // Fallback to onUpdate if onLocalUpdate not available
        onUpdate(freshTask)
      }
    } catch (error) {
      console.error('Error refreshing comments:', error)
    } finally {
      isRefreshingCommentsRef.current = false
    }
  }

  // Update ref for SSE reconnection handler
  refreshCommentsRef.current = handleRefreshComments

  // Auto-load comments when task detail opens
  // Comments are not loaded in the task list to reduce payload size
  // So we fetch full task data when the detail view opens
  const lastLoadedTaskIdRef = useRef<string | null>(null)
  useEffect(() => {
    // Skip for new/unsaved tasks
    if (isNewTask) return

    // Skip if we already loaded comments for this task
    if (lastLoadedTaskIdRef.current === task.id) return

    // Check if comments need to be loaded
    // Task list view returns _count.comments but not the actual comments array
    const hasComments = task.comments && task.comments.length > 0
    const hasCommentCount = (task as any)._count?.comments > 0

    // If task has comment count but no actual comments, fetch them
    if (!hasComments && hasCommentCount) {
      lastLoadedTaskIdRef.current = task.id
      handleRefreshComments()
    } else if (!hasComments) {
      // Even if no count, mark as loaded to avoid repeated attempts
      lastLoadedTaskIdRef.current = task.id
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, isNewTask]) // Only depend on task.id to avoid loops - handleRefreshComments is stable

  // Pull-to-refresh for mobile task detail view
  const pullToRefresh = usePullToRefresh({
    threshold: 60,
    onRefresh: handleRefreshComments,
    disabled: !isMobileDevice()
  })

  // Combined callback ref for scroll area (pullToRefresh + auto-scroll)
  const scrollAreaCallbackRef = useCallback((el: HTMLDivElement | null) => {
    scrollAreaRef.current = el
    pullToRefresh.bindToElement(el)
  }, [pullToRefresh])

  // Auto-scroll to bottom when a comment is genuinely ADDED to the thread.
  //
  // This used to compare `task.comments.length` against the previous length,
  // which scroll-jumped the pane on any edit (task 5e997cf9): `task` is
  // replaced wholesale by `handleRefreshComments` and by every
  // `onUpdate({ ...task, x })` call site, so a local copy holding no comments
  // becoming one holding N read as "N comments arrived" and jumped the user to
  // the bottom mid-edit.
  //
  // An append is now identified structurally — the previous ids must remain a
  // prefix of the new ones — and a first population is only treated as an
  // append when the new comment is optimistic (`temp-`), i.e. this client just
  // posted it. Loading N comments into an empty thread is indistinguishable
  // from N arriving at once, so the quiet option is the right default there.
  const commentIdsKey = (task.comments || []).map(c => c.id).join(',')
  useEffect(() => {
    const currentIds = (task.comments || []).map(c => c.id)
    const previousIds = prevCommentIdsRef.current
    const isSameTask = prevCommentTaskIdRef.current === task.id

    const isAppend =
      isSameTask &&
      currentIds.length > previousIds.length &&
      previousIds.every((id, index) => currentIds[index] === id)

    // A thread that was empty may have just been loaded rather than added to.
    // Only our own optimistic write proves otherwise.
    const appended = isAppend ? currentIds.slice(previousIds.length) : []
    const isLocalPost = appended.some(id => id.startsWith('temp-'))
    const shouldScroll = isAppend && (previousIds.length > 0 || isLocalPost)

    if (shouldScroll && scrollAreaRef.current) {
      setTimeout(() => {
        scrollAreaRef.current?.scrollTo({
          top: scrollAreaRef.current.scrollHeight,
          behavior: 'smooth'
        })
      }, 100)
    }

    prevCommentIdsRef.current = currentIds
    prevCommentTaskIdRef.current = task.id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentIdsKey, task.id])

  const handleCancelLists = () => {
    setTempLists(task.lists || [])
    setListSearchTerm("")
    setShowListSuggestions(false)
    setSelectedSuggestionIndex(-1)
    setEditingLists(false)
  }

  const handleAddList = (list: TaskList) => {
    const isAlreadyAdded = tempLists.some(l => l.id === list.id)
    if (!isAlreadyAdded) {
      const updatedTempLists = [...tempLists, list]
      setTempLists(updatedTempLists)
      setLastLocalListUpdate(Date.now()) // Mark when we made a local change
      // Auto-save immediately when a list is added
      onUpdate({ 
        ...task, 
        lists: updatedTempLists
      })
    }
    setListSearchTerm("")
    setShowListSuggestions(false)
    setSelectedSuggestionIndex(-1)
  }

  const handleRemoveList = (listId: string) => {
    const updatedTempLists = tempLists.filter(l => l.id !== listId)
    setTempLists(updatedTempLists)
    setLastLocalListUpdate(Date.now()) // Mark when we made a local change
    // Auto-save immediately when a list is removed
    onUpdate({ 
      ...task, 
      lists: updatedTempLists
    })
  }

  const handleCreateNewList = async (name: string) => {
    if (!name.trim()) return

    try {
      // Derive privacy from the task's current lists: PUBLIC > SHARED > PRIVATE
      const targetPrivacy: TaskList["privacy"] =
        tempLists.some((l) => l.privacy === "PUBLIC")
          ? "PUBLIC"
          : tempLists.some((l) => l.privacy === "SHARED")
          ? "SHARED"
          : "PRIVATE"

      // If shared, collect admin ids from existing shared lists (deduped)
      const adminIds = targetPrivacy === "SHARED"
        ? Array.from(
            new Set(
              tempLists
                .filter((l) => l.privacy === "SHARED")
                .flatMap((l) => (l.admins || []).map((a) => a.id))
            )
          )
        : undefined

      // Pick a color
      const colors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899']
      const randomColor = colors[Math.floor(Math.random() * colors.length)]

      // Create via API
      const response = await apiPost('/api/v1/lists', {
        name: name.trim(),
        color: randomColor,
        privacy: targetPrivacy,
        adminIds,
      })
      // v1 wraps the new list in { list, meta }; legacy returned it bare.
      const createdList = unwrapList<TaskList>(await response.json())
      if (!createdList) {
        throw new Error('List creation returned no list')
      }

      // Add to selected lists and auto-save
      const updatedTempLists = [...tempLists, createdList]
      setTempLists(updatedTempLists)
      setLastLocalListUpdate(Date.now()) // Mark when we made a local change
      onUpdate({ 
        ...task, 
        lists: updatedTempLists
      })
    } catch (error) {
      console.error('Failed to create list:', error)
    } finally {
      setListSearchTerm("")
      setShowListSuggestions(false)
      setSelectedSuggestionIndex(-1)
    }
  }

  const getFilteredLists = () => {
    // Filter out virtual lists (saved filters) from available lists
    const realLists = availableLists.filter(list => !list.isVirtual)
    
    if (!listSearchTerm.trim()) return realLists
    
    return realLists.filter(list => 
      list.name.toLowerCase().includes(listSearchTerm.toLowerCase()) &&
      !tempLists.some(selectedList => selectedList.id === list.id)
    )
  }

  const getAllSuggestions = () => {
    const filteredLists = getFilteredLists()
    const suggestions = [...filteredLists]
    
    // Add create new list option if search term doesn't match existing non-virtual list
    const realLists = availableLists.filter(list => !list.isVirtual)
    if (listSearchTerm.trim() && !realLists.some(list => 
      list.name.toLowerCase() === listSearchTerm.toLowerCase()
    )) {
      suggestions.push({
        id: 'create-new',
        name: listSearchTerm.trim(),
        color: '#3b82f6',
        isCreateNew: true
      } as TaskList & { isCreateNew: boolean })
    }
    
    return suggestions
  }



  const priorityColors = {
    0: "bg-gray-500",
    1: "bg-blue-500",
    2: "bg-yellow-500",
    3: "bg-red-500",
  }

  const priorityLabels = {
    0: "None",
    1: "Low",
    2: "Medium",
    3: "High",
  }

  return (
    <>
      {/* Arrow rendered outside the panel div so it escapes overflow:hidden */}
      {!inline && !onClose ? (
        <div
          className="task-panel-arrow theme-panel-arrow"
          style={{ top: `${arrowTop}px`, transition: 'top 0.15s ease-out' }}
        ></div>
      ) : !inline ? (
        <div
          className="task-panel-arrow theme-panel-arrow hidden cols2:block"
          style={{ top: `${arrowTop}px`, transition: 'top 0.15s ease-out' }}
        ></div>
      ) : null}
      <div
        className={`${
          isFullScreen
            // A board card has no expanding wrapper to fill, so it positions
            // against the viewport itself. The floating pane keeps `absolute`:
            // its `.task-panel-desktop` wrapper expands underneath it via
            // :has(), and staying inside that wrapper is what keeps the close
            // animation working. (Task 52bf1efb.)
            ? inline ? 'task-panel-expanded-viewport' : 'task-panel-expanded'
            : inline ? 'w-full overflow-hidden rounded-md border theme-border' : onClose ? 'w-full' : 'task-panel'
        } theme-panel flex flex-col ${
          isFullScreen ? 'h-screen' : inline ? 'h-auto max-h-[70vh]' : 'h-full'
        }${isFullScreen ? '' : ' relative'}`}
        data-task-detail-panel
        data-fullscreen={isFullScreen ? 'true' : undefined}
        {...(swipeToDismiss || {})}
      >

      <TaskHeader
        task={task}
        currentUser={currentUser}
        displayMode={displayMode}
        onOpenOptions={compactTaskDetail ? () => setOptionsOpen(true) : undefined}
        readOnly={readOnly}
        onClose={onClose}
        tempCompleted={tempCompleted}
        tempTitle={tempTitle}
        editingTitle={editingTitle}
        setTempTitle={setTempTitle}
        setEditingTitle={setEditingTitle}
        onToggleComplete={handleToggleComplete}
        onSaveTitle={handleSaveTitle}
        onCancelTitle={handleCancelTitle}
        reminderDebugMode={reminderDebugMode}
        onCopy={handleCopyClick}
        onShare={openShareModal}
        onDelete={handleDeleteClick}
        onTestReminder={handleTestReminder}
        onCancel={handleSetClosedReason}
        compact={inline}
        fullScreen={canFullScreen ? fullScreen : undefined}
        onToggleFullScreen={canFullScreen ? () => setFullScreen(value => !value) : undefined}
      />
      {compactTaskDetail && (
        <PriorityAssigneePicker
          isOpen={optionsOpen}
          onClose={() => setOptionsOpen(false)}
          onSelect={(priority, assignee) => {
            onUpdate({
              ...task,
              priority: priority as Task['priority'],
              assigneeId: assignee?.id ?? null,
              assignee: assignee ?? null,
            })
            setOptionsOpen(false)
          }}
          selectedPriority={task.priority}
          selectedAssignee={task.assignee ?? null}
          availableUsers={[]}
          taskId={task.id}
          listIds={task.lists?.map(list => list.id)}
          statusColumns={statusColumns}
          selectedColumnId={taskColumnId(task)}
          onStatusSelect={columnId => {
            const move = resolveColumnMove(task, columnId)
            onUpdate({ ...task, statusRole: move.statusRole, completed: move.completed })
            setOptionsOpen(false)
          }}
          completed={Boolean(task.completed)}
          onToggleComplete={() => {
            handleToggleComplete()
            setOptionsOpen(false)
          }}
        />
      )}

      <div
        className={`${inline ? 'max-h-[48vh]' : 'flex-1'} overflow-y-auto scrollbar-hide p-4 space-y-4 relative`}
        ref={scrollAreaCallbackRef}
        onTouchStart={pullToRefresh.onTouchStart}
        onTouchMove={pullToRefresh.onTouchMove}
        onTouchEnd={pullToRefresh.onTouchEnd}
      >
        {/* Pull-to-refresh indicator */}
        {isMobileDevice() && (pullToRefresh.isPulling || pullToRefresh.isRefreshing) && (
          <div
            className="absolute left-0 right-0 flex items-center justify-center z-20"
            style={{
              top: 0,
              height: pullToRefresh.isRefreshing ? 60 : Math.min(pullToRefresh.pullDistance, 60),
            }}
          >
            <div className="flex items-center space-x-2 theme-text-muted">
              {pullToRefresh.isRefreshing ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                  <span className="text-sm font-medium">Refreshing...</span>
                </>
              ) : pullToRefresh.canRefresh ? (
                <span className="text-sm font-medium">Release to refresh</span>
              ) : (
                <span className="text-sm font-medium">Pull to refresh</span>
              )}
            </div>
          </div>
        )}
        <TaskFieldEditors
          displayMode={displayMode}
          task={task}
          currentUser={currentUser}
          availableLists={availableLists}
          onUpdate={onUpdate}
          readOnly={readOnly}
          shouldHidePriority={shouldHideTaskPriority(task)}
          shouldHideWhen={shouldHideTaskWhen(task)}
          editingTitle={editingTitle}
          setEditingTitle={setEditingTitle}
          editingDescription={editingDescription}
          setEditingDescription={setEditingDescription}
          editingWhen={editingWhen}
          setEditingWhen={setEditingWhen}
          editingTime={editingTime}
          setEditingTime={setEditingTime}
          editingPriority={editingPriority}
          setEditingPriority={setEditingPriority}
          editingRepeating={editingRepeating}
          setEditingRepeating={setEditingRepeating}
          editingLists={editingLists}
          setEditingLists={setEditingLists}
          editingAssignee={editingAssignee}
          setEditingAssignee={setEditingAssignee}
          assigneeRef={assigneeEditRef}
          descriptionRef={descriptionEditRef}
          descriptionTextareaRef={descriptionTextareaRef}
          tempTitle={tempTitle}
          setTempTitle={setTempTitle}
          tempDescription={tempDescription}
          setTempDescription={setTempDescription}
          tempWhen={tempWhen}
          setTempWhen={setTempWhen}
          tempPriority={tempPriority}
          setTempPriority={setTempPriority}
          tempRepeating={tempRepeating}
          setTempRepeating={setTempRepeating}
          tempRepeatingData={tempRepeatingData}
          setTempRepeatingData={setTempRepeatingData}
          setLastRepeatingUpdate={setLastRepeatingUpdate}
          tempLists={tempLists}
          setTempLists={setTempLists}
          listSearchTerm={listSearchTerm}
          setListSearchTerm={setListSearchTerm}
          showListSuggestions={showListSuggestions}
          setShowListSuggestions={setShowListSuggestions}
          selectedSuggestionIndex={selectedSuggestionIndex}
          setSelectedSuggestionIndex={setSelectedSuggestionIndex}
          listSearchRef={listSearchRef}
          listInputRef={listInputRef}
          tempAssignee={tempAssignee}
          setTempAssignee={setTempAssignee}
          onInviteUser={handleInviteUser}
        />

        {/* Activity: attachments + timer (Stage 22 sub-view) */}
        <TaskActivitySection
          task={task}
          showTimer={showTimer}
          setShowTimer={setShowTimer}
          onUpdate={onUpdate}
        />

        {/* Comments Section (chat bubbles only - input bar is outside scroll area) */}
        {!shouldHideTaskComments(task) && (
        <CommentSection
          task={task}
          currentUser={currentUser}
          onUpdate={onUpdate}
          onLocalUpdate={onLocalUpdate}
          onRefreshComments={handleRefreshComments}
          hideInput={true}
          lists={availableLists}
          tasks={availableTasks}
          agentTyping={agentTyping}
          {...state.comments}
        />
        )}
      </div>

      {/* Floating comment input bar - outside scroll area, sticks to bottom */}
      {!shouldHideTaskComments(task) && canPostComments && (
        <CommentInputBar
          task={task}
          currentUser={currentUser}
          onUpdate={onUpdate}
          onLocalUpdate={onLocalUpdate}
          onTimerClick={() => setShowTimer(true)}
          lists={availableLists}
          tasks={availableTasks}
          newComment={newComment}
          setNewComment={setNewComment}
          uploadingFile={uploadingFile}
          setUploadingFile={setUploadingFile}
          attachedFiles={attachedFiles}
          setAttachedFiles={setAttachedFiles}
        />
      )}

      {/* Footer with Action Buttons - only for new tasks now */}
      {isNewTask && onSaveNew && (
        <div className="p-4 border-t border-gray-200 dark:border-gray-700">
          <Button
            size="sm"
            onClick={handleSaveNewTask}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Check className="w-4 h-4 mr-2" />
            Save New Task
          </Button>
        </div>
      )}

      <TaskModals
        task={task}
        availableLists={availableLists}
        showDeleteConfirmation={showDeleteConfirmation}
        setShowDeleteConfirmation={setShowDeleteConfirmation}
        onDelete={onDelete}
        showCopyConfirmation={showCopyConfirmation}
        setShowCopyConfirmation={setShowCopyConfirmation}
        copyIncludeComments={copyIncludeComments}
        setCopyIncludeComments={setCopyIncludeComments}
        copyTargetListId={copyTargetListId}
        setCopyTargetListId={setCopyTargetListId}
        onCopy={onCopy}
        onClose={onClose}
        showShareModal={showShareModal}
        shareUrl={shareUrl}
        loadingShareUrl={loadingShareUrl}
        shareUrlCopied={shareUrlCopied}
        onCopyShareUrl={copyShareUrl}
        onCloseShareModal={closeShareModal}
      />
    </div>
    </>
  )
}

// Memoized export to prevent unnecessary re-renders
const TaskDetailMemo = memo(TaskDetailComponent, (prevProps, nextProps) => {
  // Check if comments have actually changed (not just length)
  const prevComments = prevProps.task.comments || []
  const nextComments = nextProps.task.comments || []
  
  const commentsChanged = prevComments.length !== nextComments.length ||
    prevComments.some((comment, index) => {
      const nextComment = nextComments[index]
      return !nextComment || comment.id !== nextComment.id || comment.content !== nextComment.content
    })
  
  // Check if lists have changed
  const prevLists = prevProps.task.lists || []
  const nextLists = nextProps.task.lists || []
  const listsChanged = prevLists.length !== nextLists.length ||
    prevLists.some((list, index) => {
      const nextList = nextLists[index]
      return !nextList || list.id !== nextList.id || list.name !== nextList.name
    })

  // Only re-render if task ID changes, critical props change, lists changed, or comments changed
  return (
    prevProps.task.id === nextProps.task.id &&
    prevProps.task.title === nextProps.task.title &&
    prevProps.task.description === nextProps.task.description &&
    prevProps.task.completed === nextProps.task.completed &&
    prevProps.task.priority === nextProps.task.priority &&
    prevProps.task.repeating === nextProps.task.repeating &&
    prevProps.task.dueDateTime === nextProps.task.dueDateTime &&
    prevProps.task.isAllDay === nextProps.task.isAllDay &&
    prevProps.task.assigneeId === nextProps.task.assigneeId &&
    prevProps.inline === nextProps.inline &&
    !listsChanged &&
    !commentsChanged &&
    prevProps.currentUser?.id === nextProps.currentUser?.id
  )
})

export { TaskDetailMemo as TaskDetail }
