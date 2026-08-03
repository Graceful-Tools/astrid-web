"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
// Removed unused MarkdownEditor import
import { UserPicker } from "./user-picker"
import { ListMembersManager } from "./list-members-manager"
import { PriorityPicker } from "./ui/priority-picker"
import { useTranslations } from "@/lib/i18n/client"
import type { TaskList, User } from "../types/task"
import { getAllListMembers } from "@/lib/list-member-utils"
import { Calendar as CalendarIcon, Trash2, Lock, Unlock, Check, X, Users, Settings, Palette, Crown, Shield } from "lucide-react"
import { format } from "date-fns"

interface ListDetailProps {
  list: TaskList
  currentUser: User
  availableUsers: User[]
  canEditSettings: boolean
  onUpdate: (list: TaskList) => void
  onDelete: (listId: string) => void
  onClose?: () => void
}

export function ListDetail({ list, currentUser, availableUsers, canEditSettings, onUpdate, onDelete, onClose }: ListDetailProps) {
  const { t } = useTranslations()
  // Inline editing states
  const [editingPrivacy, setEditingPrivacy] = useState(false)
  const [editingDefaultAssignee, setEditingDefaultAssignee] = useState(false)
  const [editingDefaultDueDate, setEditingDefaultDueDate] = useState(false)
  const [editingDefaultRepeating, setEditingDefaultRepeating] = useState(false)

  
  // Temporary edit values
  const [tempPrivacy, setTempPrivacy] = useState(list.privacy)
  const [tempDefaultAssignee, setTempDefaultAssignee] = useState<User | undefined>(list.defaultAssignee)
  const [tempDefaultAssigneeType, setTempDefaultAssigneeType] = useState(() => {
    if (!list.defaultAssigneeId) return "task_creator"
    if (list.defaultAssigneeId === "unassigned") return "unassigned"
    return list.defaultAssigneeId // Use the actual user ID for specific members
  })
  const [tempDefaultDueDate, setTempDefaultDueDate] = useState<TaskList["defaultDueDate"]>(list.defaultDueDate || "none")
  const [tempDefaultRepeating, setTempDefaultRepeating] = useState<TaskList["defaultRepeating"]>(list.defaultRepeating || "never")
  const [tempDefaultPriority, setTempDefaultPriority] = useState(list.defaultPriority || 0)
  const [tempDefaultIsPrivate, setTempDefaultIsPrivate] = useState(list.defaultIsPrivate ?? true)

  // Update temporary state when list changes
  useEffect(() => {
    setTempPrivacy(list.privacy)
    setTempDefaultAssignee(list.defaultAssignee)
    setTempDefaultAssigneeType(() => {
      if (!list.defaultAssigneeId) return "task_creator"
      if (list.defaultAssigneeId === "unassigned") return "unassigned"
      return list.defaultAssigneeId // Use the actual user ID
    })
    setTempDefaultDueDate(list.defaultDueDate || "none")
    setTempDefaultRepeating(list.defaultRepeating || "never")
    setTempDefaultPriority(list.defaultPriority || 0)
    setTempDefaultIsPrivate(list.defaultIsPrivate ?? true)
  }, [list])

  // Check if current default assignee is still a member
  const isCurrentDefaultAssigneeMember = useCallback(() => {
    if (!list.defaultAssignee) return false
    const allMembers = getAllListMembers(list)
    return allMembers.some(member => member.id === list.defaultAssignee!.id)
  }, [list])

  // Check if default assignee is still a member and fallback if not
  useEffect(() => {
    if (list.defaultAssignee && list.defaultAssigneeId &&
        list.defaultAssigneeId !== "unassigned" &&
        !isCurrentDefaultAssigneeMember()) {
      // Default assignee is no longer a member, fallback to unassigned
      onUpdate({
        ...list,
        defaultAssignee: undefined,
        defaultAssigneeId: "unassigned"
      })
    }
  }, [list, onUpdate, isCurrentDefaultAssigneeMember])

  // Inline editing handlers

  // Helper function to get the current default assignee type
  const getDefaultAssigneeType = () => {
    if (!list.defaultAssigneeId) return "task_creator"
    if (list.defaultAssigneeId === "unassigned") return "unassigned"
    return list.defaultAssigneeId // Return the actual user ID
  }
  
  // Handler for default assignee type change - now with auto-save
  const handleDefaultAssigneeTypeChange = (type: string) => {
    setTempDefaultAssigneeType(type)
    
    let assigneeId: string | null = null
    let assignee: User | undefined = undefined
    
    if (type === "task_creator") {
      assigneeId = null // null means task creator
      setTempDefaultAssignee(undefined)
    } else if (type === "unassigned") {
      assigneeId = "unassigned" // special value for unassigned
      setTempDefaultAssignee(undefined)
    } else {
      // For specific user ID, find the user in current members
      const currentMembers = getDefaultAssigneeOptions()
      const selectedUser = currentMembers.find(member => member.id === type)
      assigneeId = type
      assignee = selectedUser
      setTempDefaultAssignee(selectedUser)
    }
    
    // Auto-save immediately
    onUpdate({ 
      ...list, 
      defaultAssignee: assignee,
      defaultAssigneeId: assigneeId
    })
    
    // Close the editor
    setEditingDefaultAssignee(false)
  }

  // Get all users who can be assigned to tasks (anyone who has access to this list)
  const getDefaultAssigneeOptions = () => {
    const allMembers = getAllListMembers(list)
    
    // Convert ListMemberDefinition to User format for the dropdown
    return allMembers.map(member => ({
      id: member.id,
      name: member.name,
      email: member.email,
      image: member.image,
      createdAt: new Date(), // Required by User type
      updatedAt: new Date(), // Required by User type
      emailVerified: null,
      isActive: true,
      pendingEmail: null,
      emailVerificationToken: null,
      emailTokenExpiresAt: null,
      password: null
    } as User))
  }

  // Helper function to get the display content for default assignee
  const getDefaultAssigneeDisplay = () => {
    const assigneeType = getDefaultAssigneeType()
    
    if (assigneeType === "task_creator") {
      return <span className="text-blue-400 mt-1 cursor-pointer">Task Creator</span>
    } else if (assigneeType === "unassigned") {
      return <span className="text-blue-400 mt-1 cursor-pointer">Unassigned</span>
    } else if (assigneeType !== "task_creator" && assigneeType !== "unassigned") {
      // This is a specific user ID
      if (list.defaultAssignee) {
        return (
          <>
            <Avatar className="w-6 h-6">
              <AvatarImage src={list.defaultAssignee.image || "/placeholder.svg"} />
              <AvatarFallback>{list.defaultAssignee.name?.charAt(0) || list.defaultAssignee.email.charAt(0)}</AvatarFallback>
            </Avatar>
            <span className="text-blue-400">{list.defaultAssignee.name || list.defaultAssignee.email}</span>
          </>
        )
      } else {
        // Find the user in current members
        const currentMembers = getDefaultAssigneeOptions()
        const assignedUser = currentMembers.find((member: User) => member.id === assigneeType)
        if (assignedUser) {
          return (
            <>
              <Avatar className="w-6 h-6">
                <AvatarImage src={assignedUser.image || "/placeholder.svg"} />
                <AvatarFallback>{assignedUser.name?.charAt(0) || assignedUser.email.charAt(0)}</AvatarFallback>
              </Avatar>
              <span className="text-blue-400">{assignedUser.name || assignedUser.email}</span>
            </>
          )
        } else {
          return <span className="text-red-400">Member not found</span>
        }
      }
    } else {
      return <span className="text-gray-400 italic">Click to set default assignee...</span>
    }
  }


  const handleSaveDefaultDueDate = (dueDate: TaskList["defaultDueDate"]) => {
    // If setting to "none", also reset repeating to "never"
    const updates: Partial<TaskList> = { 
      defaultDueDate: dueDate,
      defaultRepeating: dueDate === "none" ? "never" : list.defaultRepeating || "never"
    }
    onUpdate({ ...list, ...updates })
    setTempDefaultDueDate(dueDate)
    if (dueDate === "none") {
      setTempDefaultRepeating("never")
    }
    setEditingDefaultDueDate(false)
  }

  const handleSaveDefaultRepeating = (repeating: TaskList["defaultRepeating"]) => {
    onUpdate({ ...list, defaultRepeating: repeating })
    setTempDefaultRepeating(repeating)
    setEditingDefaultRepeating(false)
  }

  const handleSavePrivacy = () => {
    onUpdate({ ...list, privacy: tempPrivacy })
    setEditingPrivacy(false)
  }

  const handleCancelPrivacy = () => {
    setTempPrivacy(list.privacy)
    setEditingPrivacy(false)
  }



  const handleInviteUser = async (email: string) => {
    // This would typically call an API to invite a user
    if (process.env.NODE_ENV === "development") {
      console.log("Inviting user:", email)
    }
  }

  const getDefaultDueDateDisplay = (dueDate: TaskList["defaultDueDate"]) => {
    switch (dueDate) {
      case "none": return "No default due date"
      case "today": return "Today"
      case "tomorrow": return "Tomorrow"
      case "next_week": return "Next week"
      default: return "No default due date"
    }
  }

  const getDefaultRepeatingDisplay = (repeating: TaskList["defaultRepeating"]) => {
    switch (repeating) {
      case "daily": return t('repeating.daily')
      case "weekly": return t('repeating.weekly')
      case "monthly": return t('repeating.monthly')
      case "yearly": return t('repeating.yearly')
      case "custom": return t('repeating.custom')
      // "never" and anything unset are the same state: this task happens once.
      default: return t('repeating.oneTimeOnly')
    }
  }

  return (
    <div className="w-80 bg-gray-800 border-l border-gray-700 flex flex-col h-full">
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <h2 className="text-lg font-semibold text-white">
              {canEditSettings ? "List Settings" : "List Details"}
            </h2>
          </div>
          <div className="flex items-center space-x-1">
            {list.privacy === "PRIVATE" ? <Lock className="w-4 h-4 text-gray-400" /> : <Unlock className="w-4 h-4 text-gray-400" />}
            {canEditSettings && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onDelete(list.id)}
                className="text-red-400 hover:text-red-300 hover:bg-red-900/20 p-1"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
            {onClose && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="text-gray-400 hover:text-gray-200 p-1"
              >
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">


        {/* Privacy */}
        {canEditSettings && (
          <div>
            <Label className="text-sm text-gray-400">Privacy</Label>
          {editingPrivacy ? (
            <div className="mt-1">
              <Select value={tempPrivacy} onValueChange={(value) => setTempPrivacy(value as "PRIVATE" | "SHARED" | "PUBLIC")}>
                <SelectTrigger className="w-full bg-gray-700 border-gray-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PRIVATE">Private</SelectItem>
                  <SelectItem value="SHARED">Shared</SelectItem>
                  <SelectItem value="PUBLIC">Public</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex space-x-2 mt-2">
                <Button size="sm" onClick={handleSavePrivacy} className="bg-green-600 hover:bg-green-700">
                  <Check className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCancelPrivacy}
                  className="border-gray-600 text-gray-300"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ) : (
            <div 
              className="text-blue-400 mt-1 cursor-pointer hover:bg-gray-700 px-2 py-1 rounded capitalize"
              onClick={() => setEditingPrivacy(true)}
            >
              {tempPrivacy.toLowerCase()}
            </div>
          )}
          </div>
        )}

        {/* Default Priority */}
        {canEditSettings && (
        <div>
          <PriorityPicker 
            value={tempDefaultPriority} 
            onChange={(priority: number) => {
              setTempDefaultPriority(priority)
              onUpdate({ ...list, defaultPriority: priority as 0 | 1 | 2 | 3 })
            }}
            showLabel={false}
          />
        </div>
        )}

        {/* Default Assignee */}
        {canEditSettings && (
        <div>
          <Label className="text-sm text-gray-400">Default Assignee</Label>
          {editingDefaultAssignee ? (
            <div className="mt-1">
              <div className="space-y-2">
                <Select 
                  value={tempDefaultAssigneeType} 
                  onValueChange={handleDefaultAssigneeTypeChange}
                >
                  <SelectTrigger className="w-full bg-gray-800 border-gray-700">
                    <SelectValue placeholder="Select default assignee..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="task_creator">Task Creator</SelectItem>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {getDefaultAssigneeOptions().map(member => (
                      <SelectItem key={member.id} value={member.id}>
                        <div className="flex items-center space-x-2">
                          <Avatar className="w-4 h-4">
                            <AvatarImage src={member.image || "/placeholder.svg"} />
                            <AvatarFallback className="text-xs">
                              {member.name?.charAt(0) || member.email.charAt(0)}
                            </AvatarFallback>
                          </Avatar>
                          <span>{member.name || member.email}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            <div 
              className="flex items-center space-x-2 mt-1 cursor-pointer hover:bg-gray-700 px-2 py-1 rounded"
              onClick={() => setEditingDefaultAssignee(true)}
            >
              {getDefaultAssigneeDisplay()}
            </div>
          )}
        </div>
        )}

        {/* Default Due Date */}
        {canEditSettings && (
        <div>
          {editingDefaultDueDate ? (
            <div className="mt-1">
              <div className="grid grid-cols-3 gap-2 mb-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSaveDefaultDueDate("today")}
                  className="text-sm border-gray-600 text-gray-200 hover:bg-gray-700 hover:text-white"
                >
                  Today
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSaveDefaultDueDate("tomorrow")}
                  className="text-sm border-gray-600 text-gray-200 hover:bg-gray-700 hover:text-white"
                >
                  Tomorrow
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSaveDefaultDueDate("next_week")}
                  className="text-sm border-gray-600 text-gray-200 hover:bg-gray-700 hover:text-white"
                >
                  Next Week
                </Button>
              </div>
              <div className="mb-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSaveDefaultDueDate("none")}
                  className="text-sm w-full border-gray-600 text-gray-200 hover:bg-gray-700 hover:text-white"
                >
                  No Default
                </Button>
              </div>
              <div className="flex space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditingDefaultDueDate(false)}
                  className="border-gray-600 text-gray-300"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ) : (
            <div 
              className="text-blue-400 mt-1 cursor-pointer hover:bg-gray-700 px-2 py-1 rounded"
              onClick={() => setEditingDefaultDueDate(true)}
            >
              {getDefaultDueDateDisplay(tempDefaultDueDate)}
            </div>
          )}
        </div>
        )}

        {/* Default Repeating - Only show if there's a default due date */}
        {canEditSettings && tempDefaultDueDate !== "none" && (
          <div>
            <Label className="text-sm text-gray-400">Default Repeating</Label>
            {editingDefaultRepeating ? (
              <div className="mt-1">
                <Select 
                  value={tempDefaultRepeating} 
                  onValueChange={(value) => {
                    setTempDefaultRepeating(value as TaskList["defaultRepeating"])
                    // Save immediately but don't close editing state
                    onUpdate({ ...list, defaultRepeating: value as TaskList["defaultRepeating"] })
                  }}
                >
                  <SelectTrigger className="w-full bg-gray-700 border-gray-600 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="never">{t('repeating.oneTimeOnly')}</SelectItem>
                    <SelectItem value="daily">{t('repeating.daily')}</SelectItem>
                    <SelectItem value="weekly">{t('repeating.weekly')}</SelectItem>
                    <SelectItem value="monthly">{t('repeating.monthly')}</SelectItem>
                    <SelectItem value="yearly">{t('repeating.yearly')}</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex space-x-2 mt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditingDefaultRepeating(false)}
                    className="border-gray-600 text-gray-300"
                  >
                    Done
                  </Button>
                </div>
              </div>
            ) : (
              <div 
                className="text-blue-400 mt-1 cursor-pointer hover:bg-gray-700 px-2 py-1 rounded"
                onClick={() => setEditingDefaultRepeating(true)}
              >
                {getDefaultRepeatingDisplay(tempDefaultRepeating)}
              </div>
            )}
          </div>
        )}

        {/* Members Management */}
        <div>
          <ListMembersManager
            list={list}
            currentUser={currentUser}
            onUpdate={onUpdate}
          />
        </div>

        {/* List Stats */}
        <div className="border-t border-gray-700 pt-4">
          <Label className="text-sm text-gray-400">List Information</Label>
          <div className="mt-2 space-y-2 text-sm text-gray-300">
            <div className="flex justify-between">
              <span>Privacy:</span>
              <span className="capitalize">{list.privacy.toLowerCase()}</span>
            </div>
            <div className="flex justify-between">
              <span>Created:</span>
              <span>{format(new Date(list.createdAt), "MMM d, yyyy")}</span>
            </div>
            {list.updatedAt && (
              <div className="flex justify-between">
                <span>Updated:</span>
                <span>{format(new Date(list.updatedAt), "MMM d, yyyy")}</span>
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  )
}
