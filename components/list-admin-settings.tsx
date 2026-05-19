"use client"

import React, { useState, useEffect, useRef, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { EnhancedListImageDisplay } from "./enhanced-list-image-display"
import { PriorityPicker } from "./ui/priority-picker"
import { TimePicker } from "./ui/time-picker"
import type { TaskList, User } from "../types/task"
import { getAllListMembers } from "@/lib/list-member-utils"
import { X, Bot } from "lucide-react"
import { BoardViewSection } from "@/components/list-admin/BoardViewSection"
import { DeleteListSection } from "@/components/list-admin/DeleteListSection"
import { RecentlyCompletedWindowSection } from "@/components/list-admin/RecentlyCompletedWindowSection"
import { GithubIntegrationSection } from "@/components/list-admin/GithubIntegrationSection"
import { ListNameSection } from "@/components/list-admin/ListNameSection"
import { AgentInstructionsSection } from "@/components/list-admin/AgentInstructionsSection"

interface ListAdminSettingsProps {
  list: TaskList
  currentUser: User
  canEditSettings: boolean
  onUpdate: (list: TaskList) => void
  onDelete: (listId: string) => void
  onEditName?: () => void
  onEditImage?: () => void
  onProjectBoardCreated?: (projectLists: TaskList[]) => void
  onProjectBoardRemoved?: (projectId: string, detachedListIds: string[]) => void
}

export function ListAdminSettings({
  list,
  currentUser,
  canEditSettings,
  onUpdate,
  onDelete,
  onEditName,
  onEditImage,
  onProjectBoardCreated,
  onProjectBoardRemoved
}: ListAdminSettingsProps) {

  // Inline editing states
  const [editingDefaultAssignee, setEditingDefaultAssignee] = useState(false)
  const [editingDefaultDueDate, setEditingDefaultDueDate] = useState(false)
  const [editingDefaultRepeating, setEditingDefaultRepeating] = useState(false)

  // Temporary edit values
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
  const [tempDefaultDueTime, setTempDefaultDueTime] = useState<string | null>(list.defaultDueTime || null)
  // Default agent for this list
  const [availableAgents, setAvailableAgents] = useState<Array<{id: string, name: string | null, email: string, image: string | null, service: string}>>([])
  const [listDefaultAgentId, setListDefaultAgentId] = useState<string | null>(() => {
    const config = list.aiAgentsEnabled
    if (config && typeof config === 'object' && !Array.isArray(config)) {
      return (config as Record<string, unknown>).defaultAgentId as string || null
    }
    return null
  })

  const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Debounced update function to prevent excessive API calls
  const debouncedUpdate = useCallback((updatedList: TaskList) => {
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current)
    }
    updateTimeoutRef.current = setTimeout(() => {
      onUpdate(updatedList)
    }, 500) // 500ms debounce
  }, [onUpdate])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    // Load available agents for default agent selector
    fetch('/api/user/available-agents').then(r => r.json()).then(data => {
      setAvailableAgents(data.agents || [])
    }).catch(() => {})
  }, [])

  // Update temporary state when list changes
  useEffect(() => {
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
    setTempDefaultDueTime(list.defaultDueTime || null)
  }, [
    list.id,
    list.defaultAssignee,
    list.defaultAssigneeId,
    list.defaultDueDate,
    list.defaultRepeating,
    list.defaultPriority,
    list.defaultIsPrivate,
    list.defaultDueTime
  ])

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
      return <span className="text-blue-400">Task Creator</span>
    } else if (assigneeType === "unassigned") {
      return <span className="text-blue-400">Unassigned</span>
    } else if (assigneeType !== "task_creator" && assigneeType !== "unassigned") {
      // This is a specific user ID
      if (list.defaultAssignee) {
        return (
          <>
            <Avatar className="w-5 h-5">
              <AvatarImage src={list.defaultAssignee.image || "/placeholder.svg"} />
              <AvatarFallback className="text-xs">{list.defaultAssignee.name?.charAt(0) || list.defaultAssignee.email.charAt(0)}</AvatarFallback>
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
              <Avatar className="w-5 h-5">
                <AvatarImage src={assignedUser.image || "/placeholder.svg"} />
                <AvatarFallback className="text-xs">{assignedUser.name?.charAt(0) || assignedUser.email.charAt(0)}</AvatarFallback>
              </Avatar>
              <span className="text-blue-400">{assignedUser.name || assignedUser.email}</span>
            </>
          )
        } else {
          return <span className="text-red-400">Member not found</span>
        }
      }
    } else {
      return <span className="text-blue-400 italic">Click to set...</span>
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

  const getDefaultDueDateDisplay = (dueDate: TaskList["defaultDueDate"]) => {
    switch (dueDate) {
      case "none": return "No default when"
      case "today": return "Today"
      case "tomorrow": return "Tomorrow"
      case "next_week": return "Next week"
      default: return "No default when"
    }
  }

  const getDefaultRepeatingDisplay = (repeating: TaskList["defaultRepeating"]) => {
    switch (repeating) {
      case "never": return "Never"
      case "daily": return "Daily"
      case "weekly": return "Weekly"
      case "monthly": return "Monthly"
      case "yearly": return "Yearly"
      case "custom": return "Custom"
      default: return "Never"
    }
  }

  return (
    <div className="space-y-4">
      {/* List Name */}
      <ListNameSection list={list} canEditSettings={canEditSettings} onUpdate={onUpdate} />

      {/* Enhanced List Image Display */}
      <div className="flex items-center justify-between">
        <Label className="text-sm theme-text-secondary">List Image</Label>
        <EnhancedListImageDisplay
          list={list}
          canEdit={canEditSettings}
          onImageClick={onEditImage}
          size="thumbnail"
          showEditOverlay={true}
          className="rounded-full"
        />
      </div>

      {/* Project Status Board */}
      <BoardViewSection
        list={list}
        canEditSettings={canEditSettings}
        onUpdate={onUpdate}
        onProjectBoardCreated={onProjectBoardCreated}
        onProjectBoardRemoved={onProjectBoardRemoved}
      />

      {/* Astrid — AI agent for this list */}
      {canEditSettings && availableAgents.length > 0 && (
        <div className="space-y-2">
          <Label className="text-sm theme-text-secondary flex items-center space-x-1.5">
            <Bot className="w-4 h-4" />
            <span>Astrid Agent</span>
          </Label>
          <Select
            value={listDefaultAgentId || '_account_default'}
            onValueChange={(value) => {
              const newAgentId = value === '_account_default' ? null : value
              setListDefaultAgentId(newAgentId)
              // Build the updated aiAgentsEnabled config
              const currentTypes = Array.isArray(list.aiAgentsEnabled)
                ? list.aiAgentsEnabled
                : (list.aiAgentsEnabled as Record<string, unknown>)?.enabledTypes || []
              const updatedConfig = {
                enabledTypes: currentTypes,
                defaultAgentId: newAgentId,
              }
              onUpdate({ ...list, aiAgentsEnabled: updatedConfig as unknown as string[] })
            }}
          >
            <SelectTrigger className="theme-bg-tertiary theme-border theme-text-primary">
              <SelectValue placeholder="Use account default" />
            </SelectTrigger>
            <SelectContent className="theme-bg-primary theme-border z-[10100]">
              <SelectItem value="_account_default" className="theme-text-primary">
                Use account default
              </SelectItem>
              {availableAgents.map(agent => (
                <SelectItem key={agent.id} value={agent.id} className="theme-text-primary">
                  <div className="flex items-center gap-2">
                    {agent.image ? (
                      <img src={agent.image} alt="" className="w-4 h-4 rounded-full" />
                    ) : (
                      <Bot className="w-4 h-4 text-purple-500" />
                    )}
                    <span>{agent.name || agent.email}</span>
                    <span className="text-xs theme-text-muted">({agent.service})</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs theme-text-muted">
            Choose a model to power Astrid for this list. Astrid reads messages, acts on tasks, and completes tasks by their due dates.
          </p>
        </div>
      )}

      {/* Agent Instructions (List Description) */}
      <AgentInstructionsSection list={list} canEditSettings={canEditSettings} onUpdate={onUpdate} />

      <div className="border-b theme-border"></div>

      {/* Default Priority */}
      {canEditSettings && (
        <div className="flex items-center justify-between">
          <Label className="text-sm theme-text-secondary">Default Priority</Label>
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
        <div className="flex items-center justify-between">
          <Label className="text-sm theme-text-secondary">Default Assignee</Label>
          {editingDefaultAssignee ? (
            <div className="flex items-center space-x-2">
              <Select
                value={tempDefaultAssigneeType}
                onValueChange={handleDefaultAssigneeTypeChange}
              >
                <SelectTrigger className="w-48 theme-input">
                  <SelectValue placeholder="Select default assignee..." />
                </SelectTrigger>
                <SelectContent className="z-[10100]">
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
          ) : (
            <div
              className="flex items-center space-x-2 cursor-pointer hover:theme-bg-hover px-2 py-1 rounded"
              onClick={() => setEditingDefaultAssignee(true)}
            >
              {getDefaultAssigneeDisplay()}
            </div>
          )}
        </div>
      )}

      {/* Default When */}
      {canEditSettings && (
        <div className="flex items-center justify-between">
          <Label className="text-sm theme-text-secondary">Default When</Label>
          {editingDefaultDueDate ? (
            <div className="flex flex-col space-y-2">
              <div className="flex space-x-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSaveDefaultDueDate("today")}
                  className="text-xs px-2 py-1 theme-border theme-text-secondary hover:theme-bg-hover hover:theme-text-primary"
                >
                  Today
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSaveDefaultDueDate("tomorrow")}
                  className="text-xs px-2 py-1 theme-border theme-text-secondary hover:theme-bg-hover hover:theme-text-primary"
                >
                  Tomorrow
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSaveDefaultDueDate("next_week")}
                  className="text-xs px-2 py-1 theme-border theme-text-secondary hover:theme-bg-hover hover:theme-text-primary"
                >
                  Next Week
                </Button>
              </div>
              <div className="flex space-x-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSaveDefaultDueDate("none")}
                  className="text-xs px-2 py-1 theme-border theme-text-secondary hover:theme-bg-hover hover:theme-text-primary"
                >
                  No Default When
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditingDefaultDueDate(false)}
                  className="px-2 py-1 theme-border theme-text-secondary"
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
            </div>
          ) : (
            <div
              className="text-blue-400 cursor-pointer hover:theme-bg-hover px-2 py-1 rounded"
              onClick={() => setEditingDefaultDueDate(true)}
            >
              {getDefaultDueDateDisplay(tempDefaultDueDate)}
            </div>
          )}
        </div>
      )}

      {/* Default Repeating - Only show if there's a default due date */}
      {canEditSettings && tempDefaultDueDate !== "none" && (
        <div className="flex items-center justify-between">
          <Label className="text-sm theme-text-secondary">Default Repeating</Label>
          {editingDefaultRepeating ? (
            <div className="flex items-center space-x-2">
              <Select
                value={tempDefaultRepeating}
                onValueChange={(value) => {
                  setTempDefaultRepeating(value as TaskList["defaultRepeating"])
                  // Save immediately but don't close editing state
                  onUpdate({ ...list, defaultRepeating: value as TaskList["defaultRepeating"] })
                }}
              >
                <SelectTrigger className="w-32 theme-input">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[10100]">
                  <SelectItem value="never">Never</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="yearly">Yearly</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditingDefaultRepeating(false)}
                className="theme-border theme-text-secondary"
              >
                Done
              </Button>
            </div>
          ) : (
            <div
              className="text-blue-400 cursor-pointer hover:theme-bg-hover px-2 py-1 rounded"
              onClick={() => setEditingDefaultRepeating(true)}
            >
              {getDefaultRepeatingDisplay(tempDefaultRepeating)}
            </div>
          )}
        </div>
      )}

      {/* Default When Time */}
      {canEditSettings && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label className="text-sm theme-text-secondary">Default When Time</Label>
            <TimePicker
              mode="string"
              value={tempDefaultDueTime || undefined}
              onChange={(time) => {
                // Handle three states:
                // - string (HH:MM) = specific time
                // - null = "all day" (preserve as null)
                // - undefined = no default time
                const timeString = typeof time === "string" ? time : null
                setTempDefaultDueTime(timeString)
                // Save null as-is (represents "all day"), not undefined
                onUpdate({ ...list, defaultDueTime: timeString })
              }}
              placeholder="No default time"
              showAllDayOption={true}
              compact
              popoverClassName="z-[10100]"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}
          </p>
        </div>
      )}

      {/* GitHub Repository Selection */}
      <GithubIntegrationSection
        list={list}
        canEditSettings={canEditSettings}
        onUpdate={onUpdate}
      />

      {/* Advanced Settings: Recently Completed window */}
      <RecentlyCompletedWindowSection
        list={list}
        canEditSettings={canEditSettings}
        onUpdate={onUpdate}
      />

      {/* List ID (for API/OAuth integration) */}
      <div className="border-t theme-border pt-4">
        <div className="flex items-center justify-between">
          <Label className="text-xs theme-text-muted">List ID</Label>
          <div className="flex items-center space-x-2">
            <code className="text-xs theme-text-muted font-mono bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
              {list.id}
            </code>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(list.id)
                  // Optional: Show a toast notification
                } catch (err) {
                  console.error('Failed to copy:', err)
                }
              }}
              className="h-6 w-6 p-0"
              title="Copy List ID"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </Button>
          </div>
        </div>
        <p className="text-xs theme-text-muted mt-1">
          Use this ID for OAuth API integrations and coding agents
        </p>
      </div>

      {/* Delete List */}
      <DeleteListSection list={list} canEditSettings={canEditSettings} onDelete={onDelete} />
    </div>
  )
}
