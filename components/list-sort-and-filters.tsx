"use client"

import React, { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import type { TaskList, User } from "../types/task"
import { getAllListMembers } from "@/lib/list-member-utils"
import { Star, StarOff } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { useTranslations } from "@/lib/i18n/client"
import { DEFAULT_LIST_SHOW_SUBTASKS } from "@/lib/list-subtask-visibility"

interface ListSortAndFiltersProps {
  list: TaskList
  currentUser: User
  onUpdate: (list: TaskList) => void
  onFavoriteToggle?: (listId: string) => void
  /**
   * Gates the per-list "Show subtasks" toggle. The rest of this panel is
   * per-member filter state, but showSubtasks is a list-level setting the
   * API only accepts from an owner/admin — showing it to everyone would
   * offer a control whose save is rejected. (Task dce843a1)
   */
  canEditSettings?: boolean
}

export function ListSortAndFilters({
  list,
  currentUser,
  onUpdate,
  onFavoriteToggle,
  canEditSettings = false
}: ListSortAndFiltersProps) {
  const { t } = useTranslations()

  // Filter states loaded from list settings
  const [filterPriority, setFilterPriority] = useState<string>(list.filterPriority || "all")
  const [filterAssignee, setFilterAssignee] = useState<string>(list.filterAssignee || "all")
  const [filterDueDate, setFilterDueDate] = useState<string>(list.filterDueDate || "all")
  const [filterCompletion, setFilterCompletion] = useState<string>(list.filterCompletion || "all")
  const [filterAssignedBy, setFilterAssignedBy] = useState<string>(list.filterAssignedBy || "all")
  const [filterRepeating, setFilterRepeating] = useState<string>(list.filterRepeating || "all")
  const [filterInLists, setFilterInLists] = useState<string>(list.filterInLists || "dont_filter")
  const [isVirtual, setIsVirtual] = useState<boolean>(list.isVirtual || false)
  const [sortBy, setSortBy] = useState<string>(list.sortBy || "auto")
  const [isToggleFavorite, setIsToggleFavorite] = useState(false)

  // Editing states for filters (to match default assignee pattern)
  const [editingFilterAssignee, setEditingFilterAssignee] = useState(false)
  const [editingFilterAssignedBy, setEditingFilterAssignedBy] = useState(false)

  // Update filter states when list changes
  useEffect(() => {
    setFilterCompletion(list.filterCompletion || "all")
    setFilterDueDate(list.filterDueDate || "all")
    setFilterAssignee(list.filterAssignee || "all")
    setFilterAssignedBy(list.filterAssignedBy || "all")
    setFilterRepeating(list.filterRepeating || "all")
    setFilterPriority(list.filterPriority || "all")
    setFilterInLists(list.filterInLists || "dont_filter")
    setIsVirtual(list.isVirtual || false)
    setSortBy(list.sortBy || "auto")

    // Reset editing states when list changes
    setEditingFilterAssignee(false)
    setEditingFilterAssignedBy(false)
  }, [
    list.id,
    list.filterCompletion,
    list.filterDueDate,
    list.filterAssignee,
    list.filterAssignedBy,
    list.filterRepeating,
    list.filterPriority,
    list.filterInLists,
    list.isVirtual,
    list.sortBy
  ])

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

  const handleToggleFavorite = async () => {
    if (onFavoriteToggle) {
      // Use dedicated handler that calls PATCH endpoint (works for all members)
      onFavoriteToggle(list.id)
      return
    }
    setIsToggleFavorite(true)
    try {
      const response = await fetch(`/api/lists/${list.id}/favorite`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          isFavorite: !list.isFavorite
        }),
      })

      if (response.ok) {
        // Update the list with the new favorite status
        onUpdate({
          ...list,
          isFavorite: !list.isFavorite,
          favoriteOrder: !list.isFavorite ? 1 : null
        })
      } else {
        console.error('Failed to toggle favorite')
      }
    } catch (error) {
      console.error('Error toggling favorite:', error)
    } finally {
      setIsToggleFavorite(false)
    }
  }

  const clearAllFilters = () => {
    const resetFilters = {
      filterCompletion: "default",
      filterDueDate: "all",
      filterAssignee: "all",
      filterAssignedBy: "all",
      filterRepeating: "all",
      filterPriority: "all",
      filterInLists: "dont_filter",
      sortBy: "auto"
    }

    setFilterCompletion("default")
    setFilterDueDate("all")
    setFilterAssignee("all")
    setFilterAssignedBy("all")
    setFilterRepeating("all")
    setFilterPriority("all")
    setFilterInLists("dont_filter")
    setSortBy("auto")

    // Close editing states
    setEditingFilterAssignee(false)
    setEditingFilterAssignedBy(false)

    onUpdate({ ...list, ...resetFilters })
  }

  const hasActiveFilters = (
    filterCompletion !== "default" ||
    filterDueDate !== "all" ||
    filterAssignee !== "all" ||
    filterAssignedBy !== "all" ||
    filterRepeating !== "all" ||
    filterPriority !== "all" ||
    filterInLists !== "dont_filter"
  )

  // Handler for filter assignee change (matches default assignee pattern)
  const handleFilterAssigneeChange = (value: string) => {
    setFilterAssignee(value)
    onUpdate({ ...list, filterAssignee: value })
    setEditingFilterAssignee(false)
  }

  // Handler for filter assigned by change (matches default assignee pattern)
  const handleFilterAssignedByChange = (value: string) => {
    setFilterAssignedBy(value)
    onUpdate({ ...list, filterAssignedBy: value })
    setEditingFilterAssignedBy(false)
  }

  // Get display content for filter assignee (matches default assignee pattern)
  const getFilterAssigneeDisplay = () => {
    if (filterAssignee === "all") {
      return <span className="text-blue-400">All assignees</span>
    } else if (filterAssignee === "current_user") {
      return (
        <>
          <Avatar className="w-5 h-5">
            <AvatarImage src={currentUser.image || "/placeholder.svg"} />
            <AvatarFallback className="text-xs">{currentUser.name?.charAt(0) || currentUser.email.charAt(0)}</AvatarFallback>
          </Avatar>
          <span className="text-blue-400">Me ({currentUser.name || currentUser.email})</span>
        </>
      )
    } else if (filterAssignee === "not_current_user") {
      return <span className="text-blue-400">Not me (others)</span>
    } else if (filterAssignee === "unassigned") {
      return <span className="text-blue-400">Unassigned</span>
    } else {
      // Find the user in current members
      const currentMembers = getDefaultAssigneeOptions()
      const assignedUser = currentMembers.find(member => member.id === filterAssignee)
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
  }

  // Get display content for filter assigned by (matches default assignee pattern)
  const getFilterAssignedByDisplay = () => {
    if (filterAssignedBy === "all") {
      return <span className="text-blue-400">All creators</span>
    } else if (filterAssignedBy === "current_user") {
      return (
        <>
          <Avatar className="w-5 h-5">
            <AvatarImage src={currentUser.image || "/placeholder.svg"} />
            <AvatarFallback className="text-xs">{currentUser.name?.charAt(0) || currentUser.email.charAt(0)}</AvatarFallback>
          </Avatar>
          <span className="text-blue-400">Me ({currentUser.name || currentUser.email})</span>
        </>
      )
    } else {
      // Find the user in current members
      const currentMembers = getDefaultAssigneeOptions()
      const assignedUser = currentMembers.find(member => member.id === filterAssignedBy)
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
  }

  return (
    <div className="space-y-4">
      {/* Favorite Toggle */}
      <div className="flex items-center justify-between">
        <Label className="text-sm theme-text-secondary">Favorite</Label>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleToggleFavorite}
          disabled={isToggleFavorite}
          className="flex items-center space-x-2 hover:theme-bg-hover"
        >
          {list.isFavorite ? (
            <>
              <Star className="w-4 h-4 text-yellow-400 fill-current" />
              <span className="text-yellow-400">Remove from Favorites</span>
            </>
          ) : (
            <>
              <StarOff className="w-4 h-4 theme-text-muted" />
              <span className="theme-text-muted">Make Favorite</span>
            </>
          )}
        </Button>
      </div>

      {/* Saved Filter Toggle */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <Label className="text-sm theme-text-secondary">Saved Filter</Label>
          <span className="text-xs theme-text-muted">Show tasks based on filter settings, not list membership</span>
        </div>
        <Checkbox
          checked={isVirtual}
          onCheckedChange={(checked) => {
            const virtualValue = checked === true
            setIsVirtual(virtualValue)
            onUpdate({ ...list, isVirtual: virtualValue })
          }}
          className="theme-checkbox"
        />
      </div>

      {/* Show subtasks — per-list, owner/admin only. Lives here rather than in
          Admin Settings because it decides what the list VIEW renders, which is
          what everything else on this tab does. */}
      {canEditSettings && (
        <div className="flex items-center justify-between" data-testid="show-subtasks-row">
          <div className="flex flex-col pr-3">
            <Label className="text-sm theme-text-secondary">{t("lists.showSubtasksLabel")}</Label>
            <span className="text-xs theme-text-muted">{t("lists.showSubtasksDescription")}</span>
          </div>
          <Switch
            checked={list.showSubtasks ?? DEFAULT_LIST_SHOW_SUBTASKS}
            onCheckedChange={(value) => onUpdate({ ...list, showSubtasks: value })}
            aria-label={t("lists.showSubtasksLabel")}
            data-testid="show-subtasks-toggle"
            className="shrink-0"
          />
        </div>
      )}

      {/* Filter and Sort Controls */}
      <div className="border-t theme-border pt-4">
        <div className="flex items-center justify-between mb-4">
          <Label className="text-sm theme-text-secondary">Filter & Sort Tasks</Label>
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAllFilters}
              className="text-xs text-blue-400 hover:text-blue-300"
            >
              Clear All
            </Button>
          )}
        </div>

        {/* Sort By */}
        <div className="flex items-center justify-between mb-3">
          <Label className="text-sm theme-text-secondary">Sort by</Label>
          <Select
            value={sortBy}
            onValueChange={(value) => {
              setSortBy(value)
              onUpdate({ ...list, sortBy: value })
            }}
          >
            <SelectTrigger className="w-32 theme-input">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[10100]">
              <SelectItem value="auto">Auto</SelectItem>
              <SelectItem value="priority">Priority</SelectItem>
              <SelectItem value="when">Date</SelectItem>
              <SelectItem value="assignee">Who</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="incomplete">Incomplete</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Filter by Status */}
        <div className="flex items-center justify-between mb-3">
          <Label className="text-sm theme-text-secondary">Show tasks</Label>
          <Select
            value={filterCompletion}
            onValueChange={(value) => {
              setFilterCompletion(value)
              onUpdate({ ...list, filterCompletion: value })
            }}
          >
            <SelectTrigger className="w-32 theme-input">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[10100]">
              <SelectItem value="default">Incomplete + Recently completed</SelectItem>
              <SelectItem value="all">All tasks</SelectItem>
              <SelectItem value="completed">Completed only</SelectItem>
              <SelectItem value="incomplete">Incomplete only</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Filter by Priority */}
        <div className="flex items-center justify-between mb-3">
          <Label className="text-sm theme-text-secondary">Priority filter</Label>
          <Select
            value={filterPriority}
            onValueChange={(value) => {
              setFilterPriority(value)
              onUpdate({ ...list, filterPriority: value })
            }}
          >
            <SelectTrigger className="w-32 theme-input">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[10100]">
              <SelectItem value="all"><span className="text-blue-400">All priorities</span></SelectItem>
              <SelectItem value="3"><span className="text-red-500">!!! Highest</span></SelectItem>
              <SelectItem value="2"><span className="text-orange-500">!! High</span></SelectItem>
              <SelectItem value="1"><span className="text-blue-500">! Medium</span></SelectItem>
              <SelectItem value="0"><span className="text-gray-400">○ Low</span></SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Filter by Assignee */}
        <div className="flex items-center justify-between mb-3">
          <Label className="text-sm theme-text-secondary">Assignee filter</Label>
          {editingFilterAssignee ? (
            <div className="flex items-center space-x-2">
              <Select
                value={filterAssignee}
                onValueChange={handleFilterAssigneeChange}
              >
                <SelectTrigger className="w-48 theme-input">
                  <SelectValue placeholder="Select assignee filter..." />
                </SelectTrigger>
                <SelectContent className="z-[10100]">
                  <SelectItem value="all">All assignees</SelectItem>
                  <SelectItem value="current_user">Me ({currentUser.name || currentUser.email})</SelectItem>
                  <SelectItem value="not_current_user">Not me (others)</SelectItem>
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
              onClick={() => setEditingFilterAssignee(true)}
            >
              {getFilterAssigneeDisplay()}
            </div>
          )}
        </div>

        {/* Filter by Due Date */}
        <div className="flex items-center justify-between mb-3">
          <Label className="text-sm theme-text-secondary">Due date filter</Label>
          <Select
            value={filterDueDate}
            onValueChange={(value) => {
              setFilterDueDate(value)
              onUpdate({ ...list, filterDueDate: value })
            }}
          >
            <SelectTrigger className="w-40 theme-input">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[10100]">
              <SelectItem value="all"><span className="text-blue-400">All dates</span></SelectItem>
              <SelectItem value="overdue"><span className="text-red-500">Overdue</span></SelectItem>
              <SelectItem value="today"><span className="text-green-500">Today</span></SelectItem>
              <SelectItem value="this_week"><span className="text-blue-500">Next 7 days</span></SelectItem>
              <SelectItem value="this_month"><span className="text-purple-500">Next 30 days</span></SelectItem>
              <SelectItem value="this_calendar_week"><span className="text-cyan-500">This calendar week</span></SelectItem>
              <SelectItem value="this_calendar_month"><span className="text-indigo-500">This calendar month</span></SelectItem>
              <SelectItem value="no_date"><span className="text-gray-400">No due date</span></SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Filter by Assigned By */}
        <div className="flex items-center justify-between mb-3">
          <Label className="text-sm theme-text-secondary">Assigned by filter</Label>
          {editingFilterAssignedBy ? (
            <div className="flex items-center space-x-2">
              <Select
                value={filterAssignedBy}
                onValueChange={handleFilterAssignedByChange}
              >
                <SelectTrigger className="w-48 theme-input">
                  <SelectValue placeholder="Select creator filter..." />
                </SelectTrigger>
                <SelectContent className="z-[10100]">
                  <SelectItem value="all">All creators</SelectItem>
                  <SelectItem value="current_user">Me ({currentUser.name || currentUser.email})</SelectItem>
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
              onClick={() => setEditingFilterAssignedBy(true)}
            >
              {getFilterAssignedByDisplay()}
            </div>
          )}
        </div>

        {/* Filter by Repeating */}
        <div className="flex items-center justify-between mb-3">
          <Label className="text-sm theme-text-secondary">Repeating filter</Label>
          <Select
            value={filterRepeating}
            onValueChange={(value) => {
              setFilterRepeating(value)
              onUpdate({ ...list, filterRepeating: value })
            }}
          >
            <SelectTrigger className="w-32 theme-input">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[10100]">
              <SelectItem value="all"><span className="text-blue-400">All tasks</span></SelectItem>
              <SelectItem value="not_repeating"><span className="text-gray-400">Not repeating</span></SelectItem>
              <SelectItem value="daily"><span className="text-green-500">Daily</span></SelectItem>
              <SelectItem value="weekly"><span className="text-blue-500">Weekly</span></SelectItem>
              <SelectItem value="monthly"><span className="text-purple-500">Monthly</span></SelectItem>
              <SelectItem value="yearly"><span className="text-orange-500">Yearly</span></SelectItem>
              <SelectItem value="custom"><span className="text-pink-500">Custom</span></SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Filter in Lists */}
        <div className="flex items-center justify-between mb-3">
          <Label className="text-sm theme-text-secondary">List filter</Label>
          <Select
            value={filterInLists}
            onValueChange={(value) => {
              setFilterInLists(value)
              onUpdate({ ...list, filterInLists: value })
            }}
          >
            <SelectTrigger className="w-40 theme-input">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[10100]">
              <SelectItem value="dont_filter"><span className="text-blue-400">All tasks</span></SelectItem>
              <SelectItem value="in_list"><span className="text-green-500">Tasks in any list</span></SelectItem>
              <SelectItem value="not_in_list"><span className="text-orange-500">Tasks not in any list</span></SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )
}
