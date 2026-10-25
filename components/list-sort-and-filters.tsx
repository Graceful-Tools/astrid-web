"use client"

/**
 * The user-list Sort & Filters panel.
 *
 * Laid out by how often each control is used (AWTD-1271): Sort first, then
 * which tasks show (complete/incomplete — the filter most people want), then
 * the rest of the filters, and the list options (favourite, saved filter,
 * show subtasks) last. Every filter is the same kind of control at the same
 * width, so the column of dropdowns lines up; Assignee and Assigned-by used to
 * be text links that only turned into dropdowns once tapped.
 */

import React, { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  COMPLETION_FILTER_OPTIONS,
  DUE_DATE_FILTER_OPTIONS,
  FILTER_TRIGGER_CLASS,
  FilterSelectItems,
  PRIORITY_FILTER_OPTIONS,
  SORT_BY_OPTIONS,
} from "./list-settings/filter-options"
import { Checkbox } from "@/components/ui/checkbox"
import type { TaskList, User } from "../types/task"
import { getAllListMembers } from "@/lib/list-member-utils"
import { Star, StarOff } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { useTranslations } from "@/lib/i18n/client"
import { DEFAULT_LIST_SHOW_SUBTASKS } from "@/lib/list-subtask-visibility"
import { apiPatch } from '@/lib/api'
import { ProjectFieldFilterSelect } from "./list-settings/ProjectFieldFilterSelect"

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

/** A label on the left, its dropdown on the right — the one row shape every filter uses. */
function FilterRow({
  label,
  value,
  onChange,
  testId,
  children,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  testId?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3" data-testid={testId}>
      <Label className="text-sm theme-text-secondary">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className={FILTER_TRIGGER_CLASS} aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="z-[10100]">{children}</SelectContent>
      </Select>
    </div>
  )
}

function MemberItem({ member }: { member: User }) {
  return (
    <SelectItem value={member.id}>
      <div className="flex items-center space-x-2 min-w-0">
        <Avatar className="w-4 h-4 shrink-0">
          <AvatarImage src={member.image || "/placeholder.svg"} />
          <AvatarFallback className="text-xs">
            {member.name?.charAt(0) || member.email.charAt(0)}
          </AvatarFallback>
        </Avatar>
        <span className="truncate">{member.name || member.email}</span>
      </div>
    </SelectItem>
  )
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
      // apiPatch, not fetch. This route is PATCH-only because it is the one
      // favourite path open to a non-owner member, and lib/api had no PATCH
      // helper until task b8b21855 — which is the whole reason this call was
      // still raw and still lost offline. A non-ok response now throws.
      await apiPatch(`/api/v1/lists/${list.id}/favorite`, { isFavorite: !list.isFavorite })

      // Update the list with the new favorite status
      onUpdate({
        ...list,
        isFavorite: !list.isFavorite,
        favoriteOrder: !list.isFavorite ? 1 : null
      })
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
      filterProjectField: null,
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

    onUpdate({ ...list, ...resetFilters })
  }

  const hasActiveFilters = (
    filterCompletion !== "default" ||
    filterDueDate !== "all" ||
    filterAssignee !== "all" ||
    filterAssignedBy !== "all" ||
    filterRepeating !== "all" ||
    filterPriority !== "all" ||
    filterInLists !== "dont_filter" ||
    Boolean(list.filterProjectField)
  )

  const members = getDefaultAssigneeOptions()
  const currentUserLabel = `Me (${currentUser.name || currentUser.email})`

  return (
    <div className="space-y-4">
      {/* Most used first: how the list is ordered, and whether completed tasks show. */}
      <div className="space-y-3">
        <FilterRow
          label={t("listSettings.sortBy")}
          value={sortBy}
          onChange={(value) => {
            setSortBy(value)
            onUpdate({ ...list, sortBy: value })
          }}
          testId="sort-by-row"
        >
          <FilterSelectItems options={SORT_BY_OPTIONS} />
        </FilterRow>

        <FilterRow
          label={t("listSettings.showTasks")}
          value={filterCompletion}
          onChange={(value) => {
            setFilterCompletion(value)
            onUpdate({ ...list, filterCompletion: value })
          }}
          testId="show-tasks-row"
        >
          <FilterSelectItems options={COMPLETION_FILTER_OPTIONS} />
        </FilterRow>
      </div>

      {/* The rest of the filters */}
      <div className="border-t theme-border pt-4 space-y-3">
        <FilterRow
          label={t("listSettings.priorityFilter")}
          value={filterPriority}
          onChange={(value) => {
            setFilterPriority(value)
            onUpdate({ ...list, filterPriority: value })
          }}
          testId="priority-filter-row"
        >
          <FilterSelectItems options={PRIORITY_FILTER_OPTIONS} />
        </FilterRow>

        <FilterRow
          label={t("listSettings.dueDateFilter")}
          value={filterDueDate}
          onChange={(value) => {
            setFilterDueDate(value)
            onUpdate({ ...list, filterDueDate: value })
          }}
        >
          <FilterSelectItems options={DUE_DATE_FILTER_OPTIONS} />
        </FilterRow>

        <FilterRow
          label={t("listSettings.assigneeFilter")}
          value={filterAssignee}
          onChange={(value) => {
            setFilterAssignee(value)
            onUpdate({ ...list, filterAssignee: value })
          }}
        >
          <SelectItem value="all">All assignees</SelectItem>
          <SelectItem value="current_user">{currentUserLabel}</SelectItem>
          <SelectItem value="not_current_user">Not me (others)</SelectItem>
          <SelectItem value="unassigned">Unassigned</SelectItem>
          {members.map(member => <MemberItem key={member.id} member={member} />)}
        </FilterRow>

        <FilterRow
          label="Assigned by filter"
          value={filterAssignedBy}
          onChange={(value) => {
            setFilterAssignedBy(value)
            onUpdate({ ...list, filterAssignedBy: value })
          }}
        >
          <SelectItem value="all">All creators</SelectItem>
          <SelectItem value="current_user">{currentUserLabel}</SelectItem>
          {members.map(member => <MemberItem key={member.id} member={member} />)}
        </FilterRow>

        {/* Filter by a GitHub project field — only renders on a GitHub board (AWTD-1259) */}
        <ProjectFieldFilterSelect
          list={list}
          onChange={(value) => onUpdate({ ...list, filterProjectField: value })}
        />

        <FilterRow
          label="Repeating filter"
          value={filterRepeating}
          onChange={(value) => {
            setFilterRepeating(value)
            onUpdate({ ...list, filterRepeating: value })
          }}
        >
          <SelectItem value="all"><span className="text-blue-400">All tasks</span></SelectItem>
          <SelectItem value="not_repeating"><span className="text-gray-400">Not repeating</span></SelectItem>
          <SelectItem value="daily"><span className="text-green-500">Daily</span></SelectItem>
          <SelectItem value="weekly"><span className="text-blue-500">Weekly</span></SelectItem>
          <SelectItem value="monthly"><span className="text-purple-500">Monthly</span></SelectItem>
          <SelectItem value="yearly"><span className="text-orange-500">Yearly</span></SelectItem>
          <SelectItem value="custom"><span className="text-pink-500">Custom</span></SelectItem>
        </FilterRow>

        <FilterRow
          label="List filter"
          value={filterInLists}
          onChange={(value) => {
            setFilterInLists(value)
            onUpdate({ ...list, filterInLists: value })
          }}
        >
          <SelectItem value="dont_filter"><span className="text-blue-400">All tasks</span></SelectItem>
          <SelectItem value="in_list"><span className="text-green-500">Tasks in any list</span></SelectItem>
          <SelectItem value="not_in_list"><span className="text-orange-500">Tasks not in any list</span></SelectItem>
        </FilterRow>

        {hasActiveFilters && (
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAllFilters}
              className="text-xs text-blue-400 hover:text-blue-300"
            >
              Clear All
            </Button>
          </div>
        )}
      </div>

      {/* List options — set once, so they sit below the filters people reach for. */}
      <div className="border-t theme-border pt-4 space-y-3" data-testid="list-options-section">
        <Label className="text-xs font-medium uppercase tracking-wide theme-text-muted">
          {t("listSettings.listOptions")}
        </Label>

        <div className="flex items-center justify-between" data-testid="favorite-row">
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

        <div className="flex items-center justify-between" data-testid="saved-filter-row">
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
            what everything else on this panel does. */}
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
      </div>
    </div>
  )
}
