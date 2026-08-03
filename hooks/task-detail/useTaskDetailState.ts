import { useState, useRef, useEffect, useCallback } from 'react'
import type { Task } from '@/types/task'
import { useEditingSession } from '@/hooks/use-editing-session'

export interface FileAttachment {
  url: string
  name: string
  type: string
  size: number
}

export interface TaskDetailState {
  // Comment state
  comments: {
    newComment: string
    setNewComment: (value: string) => void
    uploadingFile: boolean
    setUploadingFile: (value: boolean) => void
    attachedFile: FileAttachment | null
    setAttachedFile: (value: FileAttachment | null) => void
    replyingTo: string | null
    setReplyingTo: (value: string | null) => void
    replyContent: string
    setReplyContent: (value: string) => void
    replyAttachedFile: FileAttachment | null
    setReplyAttachedFile: (value: FileAttachment | null) => void
    uploadingReplyFile: boolean
    setUploadingReplyFile: (value: boolean) => void
    showingActionsFor: string | null
    setShowingActionsFor: (value: string | null) => void
  }

  // Modal state
  modals: {
    showDeleteConfirmation: boolean
    setShowDeleteConfirmation: (value: boolean) => void
    showCopyConfirmation: boolean
    setShowCopyConfirmation: (value: boolean) => void
    copyIncludeComments: boolean
    setCopyIncludeComments: (value: boolean) => void
    copyTargetListId: string | undefined
    setCopyTargetListId: (value: string | undefined) => void
    showShareModal: boolean
    setShowShareModal: (value: boolean) => void
    shareUrl: string | null
    setShareUrl: (value: string | null) => void
    loadingShareUrl: boolean
    setLoadingShareUrl: (value: boolean) => void
    shareUrlCopied: boolean
    setShareUrlCopied: (value: boolean) => void
  }

  // List selection state
  listSelection: {
    searchTerm: string
    setSearchTerm: (value: string) => void
    showSuggestions: boolean
    setShowSuggestions: (value: boolean) => void
    selectedIndex: number
    setSelectedIndex: React.Dispatch<React.SetStateAction<number>>
    lastLocalUpdate: number
    setLastLocalUpdate: (value: number) => void
    searchRef: React.MutableRefObject<HTMLDivElement | null>
    inputRef: React.MutableRefObject<HTMLInputElement | null>
  }

  // Editing state
  editing: {
    title: boolean
    setEditingTitle: (value: boolean) => void
    description: boolean
    setEditingDescription: (value: boolean) => void
    when: boolean
    setEditingWhen: (value: boolean) => void
    time: boolean
    setEditingTime: (value: boolean) => void
    priority: boolean
    setEditingPriority: (value: boolean) => void
    repeating: boolean
    setEditingRepeating: (value: boolean) => void
    lists: boolean
    setEditingLists: (value: boolean) => void
    assignee: boolean
    setEditingAssignee: (value: boolean) => void
    assigneeRef: React.MutableRefObject<HTMLDivElement | null>
    descriptionRef: React.MutableRefObject<HTMLDivElement | null>
    descriptionTextareaRef: React.MutableRefObject<HTMLTextAreaElement | null>
    /** Register a pending-buffer editor's save, so hand-off commits it (task 7b60c7c5). */
    registerCommit: (id: string, commit: () => void) => void
    /** Explicit Cancel — the only path that discards. */
    cancelEditing: (id: string) => void
  }

  // Temporary edit values
  tempValues: {
    title: string
    setTempTitle: (value: string) => void
    description: string
    setTempDescription: (value: string) => void
    when: Date | undefined
    setTempWhen: (value: Date | undefined) => void
    priority: number
    setTempPriority: React.Dispatch<React.SetStateAction<number>>
    repeating: string | null
    setTempRepeating: React.Dispatch<React.SetStateAction<string | null>>
    repeatingData: any
    setTempRepeatingData: (value: any) => void
    lastRepeatingUpdate: number
    setLastRepeatingUpdate: (value: number) => void
    completed: boolean
    setTempCompleted: React.Dispatch<React.SetStateAction<boolean>>
  }

}

/**
 * Consolidated state management for TaskDetail component
 * Organizes 25+ state variables into logical groups
 */
export function useTaskDetailState(task: Task): TaskDetailState {
  // Comment state
  const [newComment, setNewComment] = useState("")
  const [uploadingFile, setUploadingFile] = useState(false)
  const [attachedFile, setAttachedFile] = useState<FileAttachment | null>(null)
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [replyContent, setReplyContent] = useState("")
  const [replyAttachedFile, setReplyAttachedFile] = useState<FileAttachment | null>(null)
  const [uploadingReplyFile, setUploadingReplyFile] = useState(false)
  const [showingActionsFor, setShowingActionsFor] = useState<string | null>(null)

  // Modal state
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false)
  const [showCopyConfirmation, setShowCopyConfirmation] = useState(false)
  const [copyIncludeComments, setCopyIncludeComments] = useState(false)
  const [copyTargetListId, setCopyTargetListId] = useState<string | undefined>(undefined)
  const [showShareModal, setShowShareModal] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [loadingShareUrl, setLoadingShareUrl] = useState(false)
  const [shareUrlCopied, setShareUrlCopied] = useState(false)

  // List selection state
  const [listSearchTerm, setListSearchTerm] = useState("")
  const [showListSuggestions, setShowListSuggestions] = useState(false)
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1)
  const [lastLocalListUpdate, setLastLocalListUpdate] = useState<number>(0)
  const listSearchRef = useRef<HTMLDivElement | null>(null)
  const listInputRef = useRef<HTMLInputElement | null>(null)

  // Editing state — ONE session, not eight independent booleans (task
  // 7b60c7c5). These used to be eight useState flags with nothing stopping two
  // being true at once, which is exactly the reported bug: edit a list, tap the
  // title, and both editors are open.
  //
  // The public shape below is unchanged on purpose — every `editingX` /
  // `setEditingX` call site still works — but `setEditingX(true)` now routes
  // through begin(), which commits and closes whatever was active. Mutual
  // exclusion is a property of the machine, not of each call site remembering.
  const session = useEditingSession()

  const editingTitle = session.isEditing('title')
  const editingDescription = session.isEditing('description')
  const editingWhen = session.isEditing('when')
  const editingTime = session.isEditing('time')
  const editingPriority = session.isEditing('priority')
  const editingRepeating = session.isEditing('repeating')
  const editingLists = session.isEditing('lists')
  const editingAssignee = session.isEditing('assignee')

  const makeSetEditing = (id: string) => (value: boolean) => {
    if (value) session.beginEditing(id)
    else session.endEditing(id)
  }

  const setEditingTitle = useCallback(makeSetEditing('title'), [session])
  const setEditingDescription = useCallback(makeSetEditing('description'), [session])
  const setEditingWhen = useCallback(makeSetEditing('when'), [session])
  const setEditingTime = useCallback(makeSetEditing('time'), [session])
  const setEditingPriority = useCallback(makeSetEditing('priority'), [session])
  const setEditingRepeating = useCallback(makeSetEditing('repeating'), [session])
  const setEditingLists = useCallback(makeSetEditing('lists'), [session])
  const setEditingAssignee = useCallback(makeSetEditing('assignee'), [session])
  const assigneeEditRef = useRef<HTMLDivElement | null>(null)
  const descriptionEditRef = useRef<HTMLDivElement | null>(null)
  const descriptionTextareaRef = useRef<HTMLTextAreaElement | null>(null)

  // Temporary edit values (sync with task)
  const [tempTitle, setTempTitle] = useState(task.title)
  const [tempDescription, setTempDescription] = useState(task.description || "")
  const [tempWhen, setTempWhen] = useState<Date | undefined>(task.dueDateTime || undefined)
  const [tempPriority, setTempPriority] = useState<number>(task.priority)
  const [tempRepeating, setTempRepeating] = useState<string | null>(task.repeating)
  const [tempRepeatingData, setTempRepeatingData] = useState(task.repeatingData)
  const [tempCompleted, setTempCompleted] = useState<boolean>(task.completed)

  // Track last local update to repeating data to prevent SSE overwrites
  const [lastRepeatingUpdate, setLastRepeatingUpdate] = useState<number>(0)

  // Sync temp values when task changes (but not while editing)
  useEffect(() => {
    if (!editingTitle) setTempTitle(task.title)
  }, [task.title, editingTitle])

  useEffect(() => {
    if (!editingDescription) setTempDescription(task.description || "")
  }, [task.description, editingDescription])

  useEffect(() => {
    // tempWhen feeds both the date picker (editingWhen) and the time picker
    // (editingTime). Resyncing while either is open lets a parent re-render
    // (SSE, focus events, etc.) overwrite the user's in-flight selection.
    if (!editingWhen && !editingTime) setTempWhen(task.dueDateTime || undefined)
  }, [task.dueDateTime, editingWhen, editingTime])

  useEffect(() => {
    if (!editingPriority) setTempPriority(task.priority)
  }, [task.priority, editingPriority])

  useEffect(() => {
    if (!editingRepeating) {
      // Don't sync if we just performed a local update recently (within 2 seconds)
      const timeSinceLastUpdate = Date.now() - lastRepeatingUpdate
      if (timeSinceLastUpdate > 2000) {
        setTempRepeating(task.repeating)
        setTempRepeatingData(task.repeatingData)
      }
    }
  }, [task.repeating, task.repeatingData, editingRepeating, lastRepeatingUpdate])

  useEffect(() => {
    setTempCompleted(task.completed)
  }, [task.completed])

  return {
    comments: {
      newComment,
      setNewComment,
      uploadingFile,
      setUploadingFile,
      attachedFile,
      setAttachedFile,
      replyingTo,
      setReplyingTo,
      replyContent,
      setReplyContent,
      replyAttachedFile,
      setReplyAttachedFile,
      uploadingReplyFile,
      setUploadingReplyFile,
      showingActionsFor,
      setShowingActionsFor
    },
    modals: {
      showDeleteConfirmation,
      setShowDeleteConfirmation,
      showCopyConfirmation,
      setShowCopyConfirmation,
      copyIncludeComments,
      setCopyIncludeComments,
      copyTargetListId,
      setCopyTargetListId,
      showShareModal,
      setShowShareModal,
      shareUrl,
      setShareUrl,
      loadingShareUrl,
      setLoadingShareUrl,
      shareUrlCopied,
      setShareUrlCopied
    },
    listSelection: {
      searchTerm: listSearchTerm,
      setSearchTerm: setListSearchTerm,
      showSuggestions: showListSuggestions,
      setShowSuggestions: setShowListSuggestions,
      selectedIndex: selectedSuggestionIndex,
      setSelectedIndex: setSelectedSuggestionIndex,
      lastLocalUpdate: lastLocalListUpdate,
      setLastLocalUpdate: setLastLocalListUpdate,
      searchRef: listSearchRef,
      inputRef: listInputRef
    },
    editing: {
      title: editingTitle,
      setEditingTitle,
      description: editingDescription,
      setEditingDescription,
      when: editingWhen,
      setEditingWhen,
      time: editingTime,
      setEditingTime,
      priority: editingPriority,
      setEditingPriority,
      repeating: editingRepeating,
      setEditingRepeating,
      lists: editingLists,
      setEditingLists,
      assignee: editingAssignee,
      setEditingAssignee,
      assigneeRef: assigneeEditRef,
      descriptionRef: descriptionEditRef,
      descriptionTextareaRef,
      /** Register a pending-buffer editor's save, so hand-off commits it. */
      registerCommit: session.registerCommit,
      /** Explicit Cancel — the only path that discards (task 7b60c7c5). */
      cancelEditing: session.cancelEditing
    },
    tempValues: {
      title: tempTitle,
      setTempTitle,
      description: tempDescription,
      setTempDescription,
      when: tempWhen,
      setTempWhen,
      priority: tempPriority,
      setTempPriority,
      repeating: tempRepeating,
      setTempRepeating,
      repeatingData: tempRepeatingData,
      setTempRepeatingData,
      lastRepeatingUpdate,
      setLastRepeatingUpdate,
      completed: tempCompleted,
      setTempCompleted
    }
  }
}
