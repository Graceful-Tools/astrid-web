import { useState, useCallback } from "react"
import type { TaskList } from "@/types/task"

export function useTaskManagerModals() {
  // Modal states
  const [showAddListModal, setShowAddListModal] = useState(false)
  const [showPublicBrowser, setShowPublicBrowser] = useState(false)
  const [showImagePicker, setShowImagePicker] = useState(false)
  const [selectedListForImagePicker, setSelectedListForImagePicker] = useState<TaskList | null>(null)
  const [showOwnerLeaveDialog, setShowOwnerLeaveDialog] = useState(false)
  const [listToLeave, setListToLeave] = useState<TaskList | null>(null)
  const [ownerLeavingWithOtherAdmins, setOwnerLeavingWithOtherAdmins] = useState(false)

  // List editing states
  const [editingListName, setEditingListName] = useState(false)
  const [tempListName, setTempListName] = useState("")
  const [editingListDescription, setEditingListDescription] = useState(false)
  const [tempListDescription, setTempListDescription] = useState("")
  const [showSettingsPopover, setShowSettingsPopover] = useState<string | null>(null)
  // Sort & Filters opens from the list header, beside the gear, at every width
  // (AWTD-1356). It lives here rather than in MainContent because the header
  // that opens it is a SIBLING of MainContent, not a child.
  const [showSortFiltersFor, setShowSortFiltersFor] = useState<string | null>(null)
  const [showLeaveListMenu, setShowLeaveListMenu] = useState<string | null>(null)

  // Task input state
  const [quickTaskInput, setQuickTaskInput] = useState("")

  // Modal control functions
  const openImagePicker = useCallback((list: TaskList) => {
    setSelectedListForImagePicker(list)
    setShowImagePicker(true)
  }, [])

  const closeImagePicker = useCallback(() => {
    setShowImagePicker(false)
    setSelectedListForImagePicker(null)
  }, [])

  const openOwnerLeaveDialog = useCallback((list: TaskList, hasOtherAdmins: boolean) => {
    setListToLeave(list)
    setOwnerLeavingWithOtherAdmins(hasOtherAdmins)
    setShowOwnerLeaveDialog(true)
  }, [])

  const closeOwnerLeaveDialog = useCallback(() => {
    setShowOwnerLeaveDialog(false)
    setListToLeave(null)
    setOwnerLeavingWithOtherAdmins(false)
  }, [])

  // List editing functions
  const startEditingListName = useCallback((list: TaskList) => {
    setTempListName(list.name)
    setEditingListName(true)
  }, [])

  const cancelEditingListName = useCallback(() => {
    setEditingListName(false)
    setTempListName("")
  }, [])

  const startEditingListDescription = useCallback((list: TaskList) => {
    setTempListDescription(list.description || "")
    setEditingListDescription(true)
  }, [])

  const cancelEditingListDescription = useCallback(() => {
    setEditingListDescription(false)
    setTempListDescription("")
  }, [])

  return {
    // Modal states
    showAddListModal,
    showPublicBrowser,
    showImagePicker,
    selectedListForImagePicker,
    showOwnerLeaveDialog,
    listToLeave,
    ownerLeavingWithOtherAdmins,

    // List editing states
    editingListName,
    tempListName,
    editingListDescription,
    tempListDescription,
    showSettingsPopover,
    showSortFiltersFor,
    showLeaveListMenu,

    // Task input state
    quickTaskInput,

    // State setters
    setShowAddListModal,
    setShowPublicBrowser,
    setQuickTaskInput,
    setShowSettingsPopover,
    setShowSortFiltersFor,
    setShowLeaveListMenu,
    setTempListName,
    setTempListDescription,
    setEditingListName,
    setEditingListDescription,

    // Modal control functions
    openImagePicker,
    closeImagePicker,
    openOwnerLeaveDialog,
    closeOwnerLeaveDialog,

    // List editing functions
    startEditingListName,
    cancelEditingListName,
    startEditingListDescription,
    cancelEditingListDescription,
  }
}