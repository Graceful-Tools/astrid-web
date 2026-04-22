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
import {
  shouldPreventAutoFocus,
  shouldIgnoreTouchDuringKeyboard,
  needsAggressiveKeyboardProtection,
  getFocusProtectionThreshold
} from "@/lib/layout-detection"
import { sanitizeTextToHtml } from "@/lib/markdown"
import { Trash2, Check, X, Edit3, Bot, Sparkles, RefreshCw, FileText, Eye, EyeOff, ChevronDown, ChevronRight } from "lucide-react"
import { renderMarkdown } from "@/lib/markdown"

interface ListAdminSettingsProps {
  list: TaskList
  currentUser: User
  canEditSettings: boolean
  onUpdate: (list: TaskList) => void
  onDelete: (listId: string) => void
  onEditName?: () => void
  onEditImage?: () => void
}

export function ListAdminSettings({
  list,
  currentUser,
  canEditSettings,
  onUpdate,
  onDelete,
  onEditName,
  onEditImage
}: ListAdminSettingsProps) {

  // Inline editing states
  const [editingListName, setEditingListName] = useState(false)
  const [editingListDescription, setEditingListDescription] = useState(false)
  const [editingDefaultAssignee, setEditingDefaultAssignee] = useState(false)
  const [editingDefaultDueDate, setEditingDefaultDueDate] = useState(false)
  const [editingDefaultRepeating, setEditingDefaultRepeating] = useState(false)
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false)
  const [showInstructionPreview, setShowInstructionPreview] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)

  // Temporary edit values
  const [tempListName, setTempListName] = useState(list.name)
  const [tempListDescription, setTempListDescription] = useState(list.description || "")
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
  // AI Coding Agent Configuration
  const [tempGithubRepositoryId, setTempGithubRepositoryId] = useState<string | null>(list.githubRepositoryId || null)
  // GitHub repositories state
  const [availableRepositories, setAvailableRepositories] = useState<Array<{id: string, name: string, fullName: string}>>([])
  const [loadingRepositories, setLoadingRepositories] = useState(false)
  // AI providers state (determines if GitHub integration should be shown)
  const [availableAiProviders, setAvailableAiProviders] = useState<Array<{id: string, name: string}>>([])
  const [loadingAiProviders, setLoadingAiProviders] = useState(false)
  // Default agent for this list
  const [availableAgents, setAvailableAgents] = useState<Array<{id: string, name: string | null, email: string, image: string | null, service: string}>>([])
  const [listDefaultAgentId, setListDefaultAgentId] = useState<string | null>(() => {
    const config = list.aiAgentsEnabled
    if (config && typeof config === 'object' && !Array.isArray(config)) {
      return (config as Record<string, unknown>).defaultAgentId as string || null
    }
    return null
  })

  // Refs for click-outside handling
  const listNameRef = useRef<HTMLDivElement>(null)
  const listDescriptionRef = useRef<HTMLDivElement>(null)
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

  // Load available AI providers (determines if GitHub integration should be shown)
  const loadAiProviders = async () => {
    try {
      setLoadingAiProviders(true)
      const response = await fetch('/api/github/status')
      if (response.ok) {
        const data = await response.json()
        const providers = [
          { id: 'claude', name: 'Claude Code Agent' },
          { id: 'openai', name: 'OpenAI Codex Agent' },
          { id: 'gemini', name: 'Gemini AI Agent' }
        ].filter(provider => data.aiProviders?.includes(provider.id))
        setAvailableAiProviders(providers)
        console.log(`🤖 Found ${providers.length} AI providers configured`)
      }
    } catch (error) {
      console.error('Error loading AI providers:', error)
    } finally {
      setLoadingAiProviders(false)
    }
  }

  // Load available repositories when component mounts
  const loadRepositories = async (refresh = false) => {
    try {
      setLoadingRepositories(true)
      const url = refresh ? '/api/github/repositories?refresh=true' : '/api/github/repositories'
      const response = await fetch(url)
      if (response.ok) {
        const data = await response.json()
        setAvailableRepositories(data.repositories || [])
        console.log(`📦 Loaded ${data.repositories?.length || 0} repositories (cached: ${data.cached !== false})`)
      }
    } catch (error) {
      console.error('Error loading repositories:', error)
    } finally {
      setLoadingRepositories(false)
    }
  }

  useEffect(() => {
    loadAiProviders()
    loadRepositories()
    // Load available agents for default agent selector
    fetch('/api/user/available-agents').then(r => r.json()).then(data => {
      setAvailableAgents(data.agents || [])
    }).catch(() => {})
  }, [])

  // Update temporary state when list changes
  useEffect(() => {
    setTempListName(list.name)
    setTempListDescription(list.description || "")
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
    list.name,
    list.description,
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

  const handleSaveListName = useCallback(async () => {
    if (tempListName.trim() && tempListName !== list.name) {
      try {
        const response = await fetch(`/api/lists/${list.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...list,
            name: tempListName.trim()
          }),
        })

        if (response.ok) {
          const updatedList = await response.json()
          onUpdate(updatedList)
        } else {
          console.error('Failed to update list name')
        }
      } catch (error) {
        console.error('Error updating list name:', error)
      }
    }
    setEditingListName(false)
  }, [tempListName, list, onUpdate])

  const handleSaveListDescription = useCallback(async () => {
    if (tempListDescription !== (list.description || "")) {
      try {
        const response = await fetch(`/api/lists/${list.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...list,
            description: tempListDescription.trim() || undefined
          }),
        })

        if (response.ok) {
          const updatedList = await response.json()
          onUpdate(updatedList)
        } else {
          console.error('Failed to update list description')
        }
      } catch (error) {
        console.error('Error updating list description:', error)
      }
    }
    setEditingListDescription(false)
  }, [tempListDescription, list, onUpdate])

  // Handle click outside to save changes
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node

      // On devices that need keyboard protection, ignore touch events during keyboard interactions
      if (('touches' in event || event.type === 'touchstart') && shouldIgnoreTouchDuringKeyboard()) {
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

      if (listNameRef.current && !listNameRef.current.contains(target) && editingListName) {
        handleSaveListName()
      }

      if (listDescriptionRef.current && !listDescriptionRef.current.contains(target) && editingListDescription) {
        handleSaveListDescription()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('touchstart', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
    }
  }, [editingListName, editingListDescription, tempListName, tempListDescription, list, handleSaveListDescription, handleSaveListName])

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
      {canEditSettings && (
        <div className="flex items-center justify-between">
          <Label className="text-sm theme-text-secondary">List Name</Label>
          {editingListName ? (
            <div className="flex items-center space-x-2 flex-1 ml-4" ref={listNameRef}>
              <Input
                value={tempListName}
                onChange={(e) => setTempListName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveListName()
                  if (e.key === "Escape") setEditingListName(false)
                }}
                className="theme-input theme-text-primary flex-1"
                autoFocus={!shouldPreventAutoFocus()}
              />
              <Button size="sm" onClick={handleSaveListName} className="bg-blue-600 hover:bg-blue-700">
                <Check className="w-4 h-4" />
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditingListName(false)}
                      className="theme-border theme-text-secondary hover:theme-bg-hover">
                <X className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <div
              className="flex items-center space-x-2 cursor-pointer hover:theme-bg-hover px-2 py-1 rounded flex-1 ml-4 justify-end"
              onClick={() => {
                // Track focus time for mobile protection
                ;(window as any)._lastFocusTime = Date.now()
                setEditingListName(true)
              }}
            >
              <span className="theme-text-primary">{list.name}</span>
              <Edit3 className="w-3 h-3 theme-text-muted" />
            </div>
          )}
        </div>
      )}

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
      {canEditSettings && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm theme-text-secondary flex items-center space-x-1.5">
              <FileText className="w-4 h-4" />
              <span>Agent Instructions</span>
            </Label>
          </div>
          {editingListDescription ? (
            <div className="mt-1" ref={listDescriptionRef}>
              {/* Edit / Preview toggle */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-1">
                  <button
                    type="button"
                    onClick={() => setShowInstructionPreview(false)}
                    className={`text-xs px-2 py-1 rounded ${!showInstructionPreview ? 'bg-blue-600 text-white' : 'theme-text-muted hover:theme-bg-hover'}`}
                  >
                    <Edit3 className="w-3 h-3 inline mr-1" />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowInstructionPreview(true)}
                    className={`text-xs px-2 py-1 rounded ${showInstructionPreview ? 'bg-blue-600 text-white' : 'theme-text-muted hover:theme-bg-hover'}`}
                  >
                    <Eye className="w-3 h-3 inline mr-1" />
                    Preview
                  </button>
                </div>
                <span className="text-xs theme-text-muted">
                  {tempListDescription.length} chars
                </span>
              </div>

              {showInstructionPreview ? (
                <div
                  className="w-full theme-comment-bg theme-border border rounded-lg px-3 py-2 min-h-[120px] prose prose-sm max-w-none theme-text-primary"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(tempListDescription || '*No instructions yet*') }}
                />
              ) : (
                <textarea
                  value={tempListDescription}
                  onChange={(e) => setTempListDescription(e.target.value)}
                  placeholder={"Write instructions for AI agents working in this list...\n\nExample:\nYou help our family plan meals.\n\n## Goals\n- Suggest healthy recipes\n- Create weekly shopping lists\n\n## Guardrails\n- No shellfish (allergy)\n- Budget: $150/week"}
                  className="w-full theme-comment-bg theme-border border theme-text-primary rounded-lg px-3 py-2 resize-vertical focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                  rows={8}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setTempListDescription(list.description || "")
                      setEditingListDescription(false)
                      setShowInstructionPreview(false)
                    }
                  }}
                />
              )}

              {/* Save / Cancel buttons */}
              <div className="flex items-center justify-between mt-2">
                <div className="flex items-center space-x-1 text-xs theme-text-muted">
                  <Bot className="w-3 h-3" />
                  <span>Agents receive this as their primary context. Supports markdown.</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setTempListDescription(list.description || "")
                      setEditingListDescription(false)
                      setShowInstructionPreview(false)
                    }}
                    className="text-xs theme-border theme-text-secondary hover:theme-bg-hover"
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      handleSaveListDescription()
                      setShowInstructionPreview(false)
                    }}
                    className="text-xs bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    <Check className="w-3 h-3 mr-1" />
                    Save
                  </Button>
                </div>
              </div>

              {/* Templates */}
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setShowTemplates(!showTemplates)}
                  className="flex items-center space-x-1 text-xs theme-text-muted hover:theme-text-secondary"
                >
                  {showTemplates ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  <Sparkles className="w-3 h-3" />
                  <span>Starter templates</span>
                </button>
                {showTemplates && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {[
                      {
                        name: "Code Reviewer",
                        instructions: "Review code changes for this project.\n\n## Focus Areas\n- Security vulnerabilities (XSS, injection, auth issues)\n- Test coverage gaps\n- Code style consistency\n- Performance concerns\n\n## How to Work\n1. Read the task description and any linked PRs\n2. Post findings as comments\n3. If everything looks good, say so and mark complete"
                      },
                      {
                        name: "Research Assistant",
                        instructions: "Research the topic described in the task.\n\n## Deliverables\n1. Summary of key findings (2-3 paragraphs)\n2. Links to primary sources\n3. Conflicting viewpoints or caveats\n4. Recommended next steps\n\n## Guidelines\n- Be thorough but concise\n- Cite sources\n- Flag low-confidence claims"
                      },
                      {
                        name: "Family Assistant",
                        instructions: "You help our family stay organized.\n\n## How to Help\n- Research options and present pros/cons\n- Be friendly and practical\n- Ask for preferences rather than guessing\n- Don't make purchases or bookings — just recommend\n\n## Guardrails\n- Keep suggestions family-friendly\n- Respect our budget\n- Post updates as comments"
                      },
                      {
                        name: "Content Writer",
                        instructions: "Write content based on the task description.\n\n## Voice & Style\n- Casual but professional\n- Short sentences, no jargon\n- Use examples and analogies\n\n## Process\n1. Post a draft as a comment\n2. Wait for feedback before marking complete\n3. Revise based on comments"
                      }
                    ].map((template) => (
                      <button
                        key={template.name}
                        type="button"
                        onClick={() => {
                          setTempListDescription(template.instructions)
                          setShowTemplates(false)
                          setShowInstructionPreview(false)
                        }}
                        className="text-left text-xs p-2 rounded theme-border border hover:theme-bg-hover theme-text-secondary"
                      >
                        {template.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div
              className="theme-text-primary cursor-pointer hover:theme-bg-hover p-2 rounded border border-transparent hover:theme-border min-h-[2.5rem] flex items-start"
              onClick={() => {
                ;(window as any)._lastFocusTime = Date.now()
                setEditingListDescription(true)
              }}
            >
              {list.description ? (
                <div className="w-full">
                  <div
                    className="prose prose-sm max-w-none theme-text-primary"
                    dangerouslySetInnerHTML={{
                      __html: sanitizeTextToHtml(list.description)
                    }}
                  />
                  <div className="flex items-center space-x-1 text-xs theme-text-muted mt-2">
                    <Edit3 className="w-3 h-3" />
                    <span>Click to edit</span>
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  <span className="theme-text-muted italic">Click to add agent instructions...</span>
                  <div className="flex items-center space-x-1 text-xs theme-text-muted">
                    <Bot className="w-3 h-3" />
                    <span>AI agents use this as their primary guidance when working on tasks in this list</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

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

      {/* GitHub Repository Selection - Only show if user has AI providers configured */}
      {canEditSettings && availableAiProviders.length > 0 && (
        <div className="border-t theme-border pt-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-2">
                <Bot className="w-4 h-4 text-blue-600" />
                <Label className="text-sm font-medium theme-text-primary">GitHub Integration</Label>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => loadRepositories(true)}
                disabled={loadingRepositories}
                className="text-xs px-2 py-1"
              >
                {loadingRepositories ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : (
                  <RefreshCw className="w-3 h-3" />
                )}
              </Button>
            </div>

            <div className="flex items-center justify-between">
              <Label className="text-sm theme-text-secondary">GitHub Repository</Label>
              <Select
                value={tempGithubRepositoryId || "none"}
                onValueChange={(value) => {
                  const repoId = value === "none" ? null : value
                  setTempGithubRepositoryId(repoId)
                  onUpdate({ ...list, githubRepositoryId: repoId })
                }}
                disabled={loadingRepositories}
              >
                <SelectTrigger className="w-full max-w-[180px] min-w-[120px]">
                  <SelectValue placeholder={loadingRepositories ? "Loading..." : "Select repo"} />
                </SelectTrigger>
                <SelectContent className="z-[10100] max-w-[300px]">
                  <SelectItem value="none">None</SelectItem>
                  {availableRepositories.map((repo) => (
                    <SelectItem key={repo.fullName} value={repo.fullName}>
                      <div className="truncate max-w-[250px]" title={repo.name}>
                        {repo.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {availableRepositories.length === 0 && !loadingRepositories && (
              <div className="text-xs theme-text-muted">
                No repositories found. Make sure your GitHub account is connected and has access to repositories.
              </div>
            )}
          </div>
        </div>
      )}

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

      {/* Delete List Button */}
      {canEditSettings && (
        <div className="border-t theme-border pt-4">
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowDeleteConfirmation(true)}
            className="w-full text-red-400 hover:text-red-300 hover:bg-red-900/20"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Delete List
          </Button>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirmation && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowDeleteConfirmation(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-sm mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4">
              <h3 className="text-lg font-semibold theme-text-primary mb-2">Delete List</h3>
              <p className="theme-text-secondary mb-2">
                Are you sure you want to delete &quot;{list.name}&quot;?
              </p>
              <p className="text-sm theme-text-muted">
                This action cannot be undone. All tasks in this list will remain but will no longer be associated with this list.
              </p>
            </div>
            <div className="flex space-x-3 justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowDeleteConfirmation(false)}
                className="theme-border theme-text-secondary hover:theme-bg-hover"
              >
                Don&apos;t Delete
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  onDelete(list.id)
                  setShowDeleteConfirmation(false)
                }}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}