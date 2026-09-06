"use client"

import type React from "react"
import { DEFAULT_LIST_COLOR } from '@/lib/brand/colors'

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { DateTimeReminderPicker } from "./date-time-reminder-picker"
import { WhenDateTimePicker } from "./when-date-time-picker"
import type { ReminderSettings } from "@/types/reminder"
// Removed MarkdownEditor and MarkdownToggle imports
import { AttachmentViewer } from "./attachment-viewer"
import { uploadCommentFile } from "@/lib/comment-file-upload"
import { addAttachment, isAttachmentQueueFull, fileIdFromUrl } from "@/lib/comment-attachments"
import { taskLevelAttachments, type TaskAttachmentView } from "@/lib/task-attachments"
import type { Task, User, TaskList, RepeatOption, PriorityLevel } from "../types/task"
import { useTranslations } from "@/lib/i18n/client"
import { X, Plus, Lock, Unlock, Upload, Image, FileText } from "lucide-react"
import { UserPicker } from "./user-picker"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

interface TaskFormProps {
  task?: Partial<Task>
  currentUser: User
  availableLists: TaskList[]
  availableUsers: User[]
  onSave: (task: Omit<Task, "id" | "createdAt" | "updatedAt">) => void
  onCancel: () => void
  onClose?: () => void // Alias for onCancel
  compact?: boolean // For sidebar usage
  currentListId?: string // For applying list defaults
}

/** Stored value + the copy key that names the resulting state (task ab01186a).
 *  "never" stays the stored value; the reader sees "One time only". */
const repeatOptions: RepeatOption[] = [
  { value: "never", labelKey: "repeating.oneTimeOnly" },
  { value: "daily", labelKey: "repeating.daily" },
  { value: "weekly", labelKey: "repeating.weekly" },
  { value: "monthly", labelKey: "repeating.monthly" },
  { value: "yearly", labelKey: "repeating.yearly" },
]

const priorityLevels: PriorityLevel[] = [
  { value: 0, label: "○", color: "bg-gray-500" },
  { value: 1, label: "!", color: "bg-blue-500" },
  { value: 2, label: "!!", color: "bg-yellow-500" },
  { value: 3, label: "!!!", color: "bg-red-500" },
]

// Add this function at the top of the component, after the imports
const applyListDefaults = (lists: TaskList[], currentSettings: any) => {
  // Apply defaults from the first list that has default settings (any privacy level)
  const listWithDefaults = lists.find((list) => 
    list.defaultAssignee || list.defaultPriority !== undefined || 
    list.defaultRepeating || list.defaultIsPrivate !== undefined ||
    list.defaultDueDate || list.defaultDueTime
  )

  if (listWithDefaults) {
    return {
      assignee: listWithDefaults.defaultAssignee || currentSettings.assignee,
      priority: listWithDefaults.defaultPriority !== undefined ? listWithDefaults.defaultPriority : currentSettings.priority,
      repeating: listWithDefaults.defaultRepeating || currentSettings.repeating,
      isPrivate: listWithDefaults.defaultIsPrivate !== undefined ? listWithDefaults.defaultIsPrivate : currentSettings.isPrivate,
      defaultDueTime: listWithDefaults.defaultDueTime || currentSettings.defaultDueTime,
    }
  }

  return currentSettings
}

export function TaskForm({ task, currentUser, availableLists, availableUsers, onSave, onCancel, onClose, compact = false, currentListId }: TaskFormProps) {
  const { t } = useTranslations()
  const handleCancel = onClose || onCancel
  const [title, setTitle] = useState(task?.title || "")
  const [description, setDescription] = useState(task?.description || "")
  const [assignee, setAssignee] = useState<User | null>(task?.assignee || currentUser)
  const [when, setWhen] = useState<Date | undefined>(task?.when)
  const [dueDateTime, setDueDateTime] = useState<Date | null>(task?.dueDateTime || null)
  const [reminderTime, setReminderTime] = useState<Date | null>(task?.reminderTime || null)
  const [reminderType, setReminderType] = useState<Task["reminderType"]>(task?.reminderType || null)
  const [repeating, setRepeating] = useState<Task["repeating"]>(task?.repeating || "never")
  const [repeatFrom, setRepeatFrom] = useState<"DUE_DATE" | "COMPLETION_DATE">(task?.repeatFrom || "COMPLETION_DATE")
  const [priority, setPriority] = useState<Task["priority"]>(task?.priority || 0)
  const [selectedLists, setSelectedLists] = useState<TaskList[]>(task?.lists || [])
  const [isPrivate, setIsPrivate] = useState(task?.isPrivate ?? true)
  const [newListName, setNewListName] = useState("")
  // Seeded from the task's secure files — uploads write SecureFile rows, so
  // re-seeding from the legacy `attachments` relation always read back empty
  // and the file looked lost (task b4a362f1).
  const [attachments, setAttachments] = useState<TaskAttachmentView[]>(
    task ? taskLevelAttachments(task) : []
  )
  const [uploadingFile, setUploadingFile] = useState(false)
  const [userReminderSettings, setUserReminderSettings] = useState<ReminderSettings | undefined>(undefined)
  // Removed isPreview state
  const [listInputValue, setListInputValue] = useState("")
  const [filteredLists, setFilteredLists] = useState<TaskList[]>([])
  const [showListSuggestions, setShowListSuggestions] = useState(false)

  // Load user reminder settings
  useEffect(() => {
    const loadReminderSettings = async () => {
      try {
        const response = await fetch("/api/v1/users/me/reminder-settings")
        if (response.ok) {
          const settings = await response.json()
          setUserReminderSettings(settings)
        }
      } catch (error) {
        console.error("Failed to load reminder settings:", error)
      }
    }
    loadReminderSettings()
  }, [])

  // Apply current list defaults for new tasks
  useEffect(() => {
    if (!task && currentListId) {
      const currentList = availableLists.find(list => list.id === currentListId)
      if (currentList) {
        // Apply defaults directly from list fields
        if (currentList.defaultAssignee) {
          setAssignee(currentList.defaultAssignee)
        }
        if (currentList.defaultPriority !== undefined) {
          setPriority(currentList.defaultPriority)
        }
        if (currentList.defaultRepeating) {
          setRepeating(currentList.defaultRepeating)
        }
        if (currentList.defaultIsPrivate !== undefined) {
          setIsPrivate(currentList.defaultIsPrivate)
        }
        if (currentList.defaultDueDate && currentList.defaultDueDate !== "none") {
          const today = new Date()
          switch (currentList.defaultDueDate) {
            case "today":
              setWhen(today)
              break
            case "tomorrow":
              const tomorrow = new Date(today)
              tomorrow.setDate(tomorrow.getDate() + 1)
              setWhen(tomorrow)
              break
            case "next_week":
              const nextWeek = new Date(today)
              nextWeek.setDate(nextWeek.getDate() + 7)
              setWhen(nextWeek)
              break
          }
        }
        
        // Auto-add current list to selected lists if not already there
        if (!selectedLists.some(list => list.id === currentList.id)) {
          setSelectedLists([currentList])
        }
      }
    }
  }, [currentListId, availableLists, task, selectedLists]) // Run when currentListId changes

  // Handle list input changes and filtering
  const handleListInputChange = (value: string) => {
    setListInputValue(value)
    
    if (value.trim()) {
      const filtered = availableLists.filter(list => 
        list.name.toLowerCase().includes(value.toLowerCase()) &&
        !selectedLists.some(selected => selected.id === list.id)
      )
      setFilteredLists(filtered)
      setShowListSuggestions(true)
    } else {
      setFilteredLists([])
      setShowListSuggestions(false)
    }
  }

  // Handle selecting a list from suggestions
  const handleSelectList = (list: TaskList) => {
    setSelectedLists([...selectedLists, list])
    setListInputValue("")
    setShowListSuggestions(false)

    // Apply list defaults only if user hasn't explicitly changed values
    const updatedSettings = applyListDefaults([list], {
      assignee,
      priority,
      repeating,
      isPrivate
    })

    // Only apply defaults if still at default values (avoid overwriting user selections)
    if (updatedSettings.assignee && !assignee) setAssignee(updatedSettings.assignee)
    if (updatedSettings.priority !== undefined && priority === 0) setPriority(updatedSettings.priority)
    if (updatedSettings.repeating && repeating === "never") setRepeating(updatedSettings.repeating)
    if (updatedSettings.isPrivate !== undefined && isPrivate === true) setIsPrivate(updatedSettings.isPrivate)
  }

  // Handle creating a new list
  const handleCreateNewList = () => {
    if (listInputValue.trim()) {
      const newList: TaskList = {
        id: Date.now().toString(),
        name: listInputValue.trim(),
        description: "",
        color: "#3B82F6",
        privacy: "PRIVATE", // Default to private as specified
        owner: currentUser,
        ownerId: currentUser.id,
        createdAt: new Date(),
        updatedAt: new Date(),
        defaultAssignee: currentUser,
        defaultPriority: 0,
        defaultRepeating: "never",
        defaultIsPrivate: true,
        defaultDueDate: "none"
      }
      
      setSelectedLists([...selectedLists, newList])
      setListInputValue("")
      setShowListSuggestions(false)
    }
  }

  // Handle removing a list
  const handleRemoveList = (listToRemove: TaskList) => {
    setSelectedLists(selectedLists.filter(list => list.id !== listToRemove.id))
  }

  // Handle key events in list input
  const handleListInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (filteredLists.length > 0) {
        handleSelectList(filteredLists[0])
      } else if (listInputValue.trim()) {
        handleCreateNewList()
      }
    } else if (e.key === 'Backspace' && !listInputValue && selectedLists.length > 0) {
      // Remove last selected list when backspacing on empty input
      handleRemoveList(selectedLists[selectedLists.length - 1])
    } else if (e.key === 'Escape') {
      setShowListSuggestions(false)
    }
  }

  // Update the handleAddList function to apply defaults when a shared list is added
  const handleAddList = () => {
    if (newListName.trim()) {
      const newList: TaskList = {
        id: Date.now().toString(),
        name: newListName.trim(),
        color: DEFAULT_LIST_COLOR,
        privacy: "PRIVATE",
        owner: currentUser,
        ownerId: currentUser.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      const updatedLists = [...selectedLists, newList]
      setSelectedLists(updatedLists)

      // Apply defaults if this is a shared list with defaults
      const defaults = applyListDefaults(updatedLists, {
        assignee,
        priority,
        repeating,
        isPrivate,
      })

      // Only apply defaults if still at default values (avoid overwriting user selections)
      if (defaults.assignee && !assignee) setAssignee(defaults.assignee)
      if (defaults.priority !== undefined && priority === 0) setPriority(defaults.priority)
      if (defaults.repeating && repeating === "never") setRepeating(defaults.repeating)
      if (defaults.isPrivate !== undefined && isPrivate === true) setIsPrivate(defaults.isPrivate)

      setNewListName("")
    }
  }

  // Old handler removed - using new handleRemoveList above

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? [])
    if (picked.length === 0) return

    setUploadingFile(true)
    try {
      // Use existing task ID, or the first selected list, or current list for context
      const contextData: Record<string, string> = {}
      if (task?.id) {
        contextData.taskId = task.id
      } else if (selectedLists.length > 0) {
        contextData.listId = selectedLists[0].id
      } else if (currentListId) {
        contextData.listId = currentListId
      } else {
        throw new Error('No context available for file upload')
      }

      // One request per file, in pick order (task b4a362f1 / 9f325964).
      let queue = attachments
      for (const file of picked) {
        if (isAttachmentQueueFull(queue)) break
        const result = await uploadCommentFile(file, { ...contextData, attachTarget: 'task' })
        if (!result.success) {
          console.error('Error uploading file:', new Error(result.error))
          continue
        }
        queue = addAttachment(queue, {
          ...result.attachment,
          id: fileIdFromUrl(result.attachment.url) || result.attachment.url,
          fileId: fileIdFromUrl(result.attachment.url) || result.attachment.url,
          createdAt: new Date(),
          isTaskLevel: true,
        } as TaskAttachmentView) as TaskAttachmentView[]
      }
      setAttachments(queue)
    } catch (error) {
      console.error('Error uploading file:', error)
    } finally {
      setUploadingFile(false)
      // Reset the input
      event.target.value = ''
    }
  }

  const handleRemoveAttachment = async (attachmentId: string) => {
    // Optimistic: the row leaving the list is the whole point of the button.
    const previous = attachments
    setAttachments(attachments.filter(attachment => attachment.id !== attachmentId))

    try {
      const response = await fetch(`/api/v1/secure-files/${attachmentId}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('Failed to delete attachment')
    } catch (error) {
      // Removal used to be local-only, so the file came back on reload with no
      // explanation. Put it back instead of lying about it (task b4a362f1).
      console.error('Error removing attachment:', error)
      setAttachments(previous)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return

    // Determine the assigneeId and assigneeEmail
    const assigneeId = assignee ? (assignee.id.startsWith('email-') ? currentUser.id : assignee.id) : null
    const assigneeEmail = assignee?.id.startsWith('email-') ? assignee.email : undefined

    onSave({
      title: title.trim(),
      description,
      assigneeId, // Can be null for unassigned tasks
      assignee: assignee, // Add the assignee object
      creatorId: currentUser.id, // Add creatorId
      creator: currentUser, // Add creator object
      // Note: assigneeEmail is handled separately for unregistered users
      when, // Legacy field - keep for backward compatibility
      dueDateTime, // New datetime field
      reminderTime,
      reminderType,
      repeating,
      repeatFrom,
      priority,
      lists: selectedLists,
      isPrivate,
      completed: task?.completed || false,
      // Legacy Attachment rows, passed through untouched — `POST /api/tasks`
      // never read this key anyway. The form's own attachments are SecureFile
      // rows, already persisted by the upload itself (task b4a362f1).
      attachments: task?.attachments || [],
      comments: task?.comments || [],
      occurrenceCount: task?.occurrenceCount || 0,
    })
  }

  return (
    <form onSubmit={handleSubmit} className={`space-y-4 ${compact ? 'p-0 bg-white' : 'p-6 bg-gray-800 rounded-lg'}`}>
      <div className="flex items-center justify-between">
        <h2 className={`text-lg font-semibold ${compact ? 'text-gray-900' : 'text-white'}`}>{task ? "Edit Task" : "Create New Task"}</h2>
        <div className="flex items-center space-x-2">
          {compact && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              className="p-1"
            >
              <X className="w-4 h-4" />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setIsPrivate(!isPrivate)}
            className={compact ? "text-gray-700" : "text-gray-300"}
          >
            {isPrivate ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
            {isPrivate ? "Private" : "Public"}
          </Button>
        </div>
      </div>

      <div>
        <Label htmlFor="title" className={compact ? "text-gray-700" : "text-gray-300"}>
          Title *
        </Label>
        <Input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Enter task title..."
          className={compact ? "bg-white border-gray-300 text-gray-900 placeholder-gray-500" : "bg-gray-700 border-gray-600 text-white placeholder-gray-400"}
          required
        />
      </div>

      <div>
        <Label htmlFor="assignee" className="text-gray-300">
          Assignee
        </Label>
        <div className="space-y-2">
          {/* Selected assignee display */}
          {assignee ? (
            <div className="flex items-center space-x-2 p-2 bg-gray-700 rounded-lg border border-gray-600">
              <Avatar className="w-6 h-6">
                <AvatarImage src={assignee.image || "/placeholder.svg"} />
                <AvatarFallback>{assignee.name?.charAt(0) || assignee.email.charAt(0)}</AvatarFallback>
              </Avatar>
              <span className="text-white flex-1">{assignee.name || assignee.email}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAssignee(null)}
                className="p-1 h-auto text-gray-400 hover:text-red-400"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center space-x-2 p-2 bg-gray-600 rounded-lg border border-gray-500">
              <span className="text-gray-300 flex-1">Unassigned</span>
            </div>
          )}
          
          {/* Assignee selection */}
          <Select
            value={
              !assignee ? "unassigned" : 
              assignee.id === currentUser.id ? "current" : 
              "other"
            }
            onValueChange={(value) => {
              if (value === "current") {
                setAssignee(currentUser)
              } else if (value === "unassigned") {
                setAssignee(null)
              }
            }}
          >
            <SelectTrigger className="bg-gray-700 border-gray-600 text-white">
              <SelectValue placeholder="Select assignee..." />
            </SelectTrigger>
            <SelectContent className="bg-gray-700 border-gray-600">
              <SelectItem value="unassigned" className="text-white">
                Unassigned
              </SelectItem>
              <SelectItem value="current" className="text-white">
                {currentUser.name || currentUser.email} (me)
              </SelectItem>
              <SelectItem value="other" className="text-white">
                Other user or email...
              </SelectItem>
            </SelectContent>
          </Select>
          
          {/* Email input for unregistered users */}
          {assignee && assignee.id !== currentUser.id && (
            <div className="space-y-2">
              <Input
                placeholder="Enter email address for unregistered user..."
                value={assignee.email}
                onChange={(e) => {
                  const email = e.target.value
                  setAssignee({
                    id: `email-${email}`, // Temporary ID for unregistered users
                    name: null,
                    email: email,
                    image: null,
                    createdAt: new Date()
                  })
                }}
                className="bg-gray-700 border-gray-600 text-white placeholder-gray-400"
              />
              <p className="text-xs text-gray-400">
                This user will be invited to join when the task is created
              </p>
            </div>
          )}
        </div>
      </div>

      <WhenDateTimePicker
        when={when}
        onWhenChange={setWhen}
        compact={compact}
        defaultDueTime={currentListId ? availableLists.find(list => list.id === currentListId)?.defaultDueTime : undefined}
        currentUser={currentUser}
      />

      <DateTimeReminderPicker
        dueDateTime={dueDateTime}
        reminderTime={reminderTime}
        reminderType={reminderType}
        onDueDateTimeChange={setDueDateTime}
        onReminderTimeChange={setReminderTime}
        onReminderTypeChange={setReminderType}
        compact={compact}
        userReminderSettings={userReminderSettings}
      />

      <div>
        <Label className="text-gray-300">Repeating</Label>
        <Select value={repeating} onValueChange={(value: Task["repeating"]) => setRepeating(value)}>
          <SelectTrigger className="bg-gray-700 border-gray-600 text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-gray-700 border-gray-600">
            {repeatOptions.map((option) => (
              <SelectItem key={option.value} value={option.value} className="text-white">
                {t(option.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {repeating === "custom" && (
        <div>
          <Label className="text-gray-300">Repeat Mode</Label>
          <Select value={repeatFrom} onValueChange={(value: "DUE_DATE" | "COMPLETION_DATE") => setRepeatFrom(value)}>
            <SelectTrigger className="bg-gray-700 border-gray-600 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-gray-700 border-gray-600">
              <SelectItem value="COMPLETION_DATE" className="text-white">
                Repeat from completion date
              </SelectItem>
              <SelectItem value="DUE_DATE" className="text-white">
                Repeat from due date
              </SelectItem>
            </SelectContent>
          </Select>
          <div className="text-xs text-gray-400 mt-1">
            {repeatFrom === "COMPLETION_DATE"
              ? "Next occurrence is based on when you complete the task"
              : "Next occurrence is based on the original due date"}
          </div>
        </div>
      )}

      <div>
        <Label className="text-gray-300">Priority</Label>
        <div className="flex space-x-2 mt-2">
          {priorityLevels.map((level) => (
            <Button
              key={level.value}
              type="button"
              variant={priority === level.value ? "default" : "outline"}
              size="sm"
              onClick={() => setPriority(level.value)}
              className={`${priority === level.value ? level.color : "bg-transparent border-gray-600"} text-white`}
            >
              {level.label}
            </Button>
          ))}
        </div>
      </div>

      <div>
        <Label className="text-gray-300">Lists</Label>
        <div className="space-y-2">
          {/* Selected lists with remove capability */}
          {selectedLists.length > 0 && (
            <div className="flex flex-wrap gap-2 p-2 bg-gray-800 border border-gray-600 rounded-md">
              {selectedLists.map((list) => (
                <Badge 
                  key={list.id} 
                  variant="secondary" 
                  className="bg-blue-600 text-white hover:bg-blue-700 group cursor-pointer"
                  onClick={() => handleRemoveList(list)}
                >
                  {list.name}
                  <X className="w-3 h-3 ml-1 opacity-0 group-hover:opacity-100 transition-opacity" />
                </Badge>
              ))}
            </div>
          )}
          
          {/* Autocomplete input */}
          <div className="relative">
            <Input
              placeholder="Type to search lists or create new..."
              value={listInputValue}
              onChange={(e) => handleListInputChange(e.target.value)}
              onKeyDown={handleListInputKeyDown}
              onFocus={() => listInputValue && setShowListSuggestions(true)}
              onBlur={() => setTimeout(() => setShowListSuggestions(false), 150)}
              className="bg-gray-700 border-gray-600 text-white placeholder-gray-400"
            />
            
            {/* Dropdown suggestions */}
            {showListSuggestions && (
              <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-gray-800 border border-gray-600 rounded-md shadow-lg max-h-40 overflow-y-auto">
                {filteredLists.length > 0 ? (
                  filteredLists.map((list) => (
                    <div
                      key={list.id}
                      onClick={() => handleSelectList(list)}
                      className="px-3 py-2 hover:bg-gray-700 cursor-pointer text-white flex items-center justify-between"
                    >
                      <span>{list.name}</span>
                      <Badge variant="outline" className="text-xs">
                        {list.privacy === 'PRIVATE' ? 'Private' : list.privacy === 'SHARED' ? 'Shared' : 'Public'}
                      </Badge>
                    </div>
                  ))
                ) : listInputValue.trim() ? (
                  <div
                    onClick={handleCreateNewList}
                    className="px-3 py-2 hover:bg-gray-700 cursor-pointer text-white border-t border-gray-600"
                  >
                    <div className="flex items-center space-x-2">
                      <Plus className="w-4 h-4 text-green-400" />
                      <span>Create new private list: &quot;{listInputValue}&quot;</span>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
          
          <div className="text-xs text-gray-400">
            Type to search existing lists or create a new private list. Use backspace to remove selected lists.
          </div>
        </div>
      </div>

      <div>
        <Label className="text-gray-300">Description</Label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Enter task description..."
          className="w-full mt-2 theme-comment-bg theme-border border theme-text-primary rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          rows={3}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.shiftKey || e.metaKey || e.ctrlKey)) {
              // Shift+Enter, Cmd/Ctrl + Enter: Add line break (default textarea behavior)
              return
            }
            // Plain Enter: Allow default behavior (form submission will be handled by form onSubmit)
          }}
        />
        <div className="text-xs theme-text-muted mt-1">
          Shift+Enter or Cmd/Ctrl+Enter for line breaks
        </div>
      </div>

      <div>
        <Label className="text-gray-300">Attachments</Label>
        <div className="mt-2 space-y-3">
          {/* Show existing attachments */}
          {attachments.length > 0 && (
            <div className="space-y-2">
              {attachments.map((attachment) => (
                <div key={attachment.id} className="flex items-center justify-between p-2 bg-gray-700 rounded-lg border border-gray-600">
                  <AttachmentViewer
                    url={attachment.url}
                    name={attachment.name}
                    type={attachment.type}
                    size={attachment.size}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveAttachment(attachment.id)}
                    className="text-red-400 hover:text-red-300 hover:bg-red-900/20"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          
          {/* File upload button */}
          <div className="relative">
            <input
              type="file"
              id="task-file-upload"
              multiple
              onChange={handleFileUpload}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              accept="image/*,.pdf,.doc,.docx,.txt,.xlsx,.pptx,.zip"
              disabled={uploadingFile}
            />
            <Button
              type="button"
              variant="outline"
              disabled={uploadingFile}
              className="border-gray-600 text-gray-300 hover:bg-gray-700 bg-gray-800"
            >
              <Upload className="w-4 h-4 mr-2" />
              {uploadingFile ? 'Uploading...' : 'Add Attachment'}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex justify-end items-center">
        {/* Action Buttons */}
        <div className="flex space-x-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleCancel}
            className={compact ? "border-gray-300 text-gray-700 bg-white hover:bg-gray-50" : "border-gray-600 text-gray-300 bg-transparent"}
          >
            Cancel
          </Button>
          <Button type="submit" className="bg-blue-600 hover:bg-blue-700">
            {task ? "Update Task" : "Create Task"}
          </Button>
        </div>
      </div>
    </form>
  )
}
