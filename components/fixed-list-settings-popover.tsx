"use client"

import React from "react"
import { useTranslations } from "@/lib/i18n/client"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Select, SelectContent, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Filter } from "lucide-react"
import { SettingsModalShell } from "./list-settings/SettingsModalShell"
import {
  COMPLETION_FILTER_OPTIONS,
  DUE_DATE_FILTER_OPTIONS,
  FilterSelectItems,
  PRIORITY_FILTER_OPTIONS,
  SORT_BY_OPTIONS,
} from "./list-settings/filter-options"
import type { User } from "../types/task"

interface FixedListSettingsPopoverProps {
  listId: string
  listName: string
  listDescription: string
  currentUser: User
  availableUsers: User[]
  open: boolean
  onOpenChange: (open: boolean) => void
  // Filter and sort props
  filterPriority: number[]
  setFilterPriority: (priority: number[]) => void
  filterAssignee: string[]
  setFilterAssignee: (assignee: string[]) => void
  filterDueDate: "overdue" | "today" | "tomorrow" | "this_week" | "this_month" | "this_calendar_week" | "this_calendar_month" | "no_date" | "all"
  setFilterDueDate: (dueDate: "overdue" | "today" | "tomorrow" | "this_week" | "this_month" | "this_calendar_week" | "this_calendar_month" | "no_date" | "all") => void
  filterCompletion: "completed" | "incomplete" | "all" | "default"
  setFilterCompletion: (completion: "completed" | "incomplete" | "all" | "default") => void
  sortBy: "auto" | "priority" | "when" | "assignee" | "completed" | "incomplete" | "completedAt" | "manual"
  setSortBy: (sort: "auto" | "priority" | "when" | "assignee" | "completed" | "incomplete" | "completedAt" | "manual") => void
  hasActiveFilters: boolean
  clearAllFilters: () => void
}

export function FixedListSettingsPopover({
  listId,
  listName,
  listDescription,
  currentUser,
  availableUsers,
  open = false,
  onOpenChange = () => {},
  // Filter and sort props
  filterPriority = [],
  setFilterPriority = () => {},
  filterAssignee = [],
  setFilterAssignee = () => {},
  filterDueDate = "all",
  setFilterDueDate = () => {},
  filterCompletion = "all",
  setFilterCompletion = () => {},
  sortBy = "auto",
  setSortBy = () => {},
  hasActiveFilters = false,
  clearAllFilters = () => {}
}: FixedListSettingsPopoverProps) {
  const { t } = useTranslations()

  const getFixedListSpecificDefaults = () => {
    switch (listId) {
      case "today":
        return {
          title: "Today's Tasks Settings",
          description: "Configure how today's tasks are displayed and filtered",
          fixedDueDate: "today" as const,
          fixedDueDateLabel: "Due Date: Today (Fixed)"
        }
      case "my-tasks":
        return {
          title: "My Tasks Settings", 
          description: "Configure how your personal tasks are displayed and filtered",
          fixedDueDate: null,
          fixedDueDateLabel: null
        }
      case "not-in-list":
        return {
          title: "Unassigned Tasks Settings",
          description: "Configure how tasks without lists are displayed and filtered", 
          fixedDueDate: null,
          fixedDueDateLabel: null
        }
      case "assigned":
        return {
          title: "Assigned Tasks Settings",
          description: "Configure how tasks you've assigned to others are displayed and filtered",
          fixedDueDate: null,
          fixedDueDateLabel: null
        }
      default:
        return {
          title: "List Settings",
          description: "Configure how tasks are displayed and filtered",
          fixedDueDate: null,
          fixedDueDateLabel: null
        }
    }
  }

  const defaults = getFixedListSpecificDefaults()

  return (
    <SettingsModalShell
      open={open}
      onOpenChange={onOpenChange}
      header={
        <>
          <Filter className="w-5 h-5 theme-text-muted" />
          <h2 className="text-lg font-semibold theme-text-primary">{defaults.title}</h2>
        </>
      }
      subtitle={<p className="theme-text-muted text-sm mt-2">{defaults.description}</p>}
    >
      <div className="p-4 pb-40 md:pb-4 space-y-4">
          {/* Fixed Due Date Display (for Today view) */}
          {defaults.fixedDueDate && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
              <div className="flex items-center space-x-2">
                <Filter className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span className="text-sm font-medium text-blue-800 dark:text-blue-200">
                  {defaults.fixedDueDateLabel}
                </span>
              </div>
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                This filter cannot be changed for the &quot;{listName}&quot; view
              </p>
            </div>
          )}

          {/* Sort By */}
          <div className="flex items-center justify-between mb-3">
            <Label className="text-sm theme-text-secondary">{t('listSettings.sortBy')}</Label>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-32 theme-input">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-[10100]">
                <FilterSelectItems options={SORT_BY_OPTIONS} />
              </SelectContent>
            </Select>
          </div>

          {/* Filter by Status */}
          <div className="flex items-center justify-between mb-3">
            <Label className="text-sm theme-text-secondary">{t('listSettings.showTasks')}</Label>
            <Select value={filterCompletion} onValueChange={setFilterCompletion}>
              <SelectTrigger className="w-32 theme-input">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-[10100]">
                <FilterSelectItems options={COMPLETION_FILTER_OPTIONS} />
              </SelectContent>
            </Select>
          </div>

          {/* Filter by Priority */}
          <div className="flex items-center justify-between mb-3">
            <Label className="text-sm theme-text-secondary">{t('listSettings.priorityFilter')}</Label>
            <Select 
              value={filterPriority.length === 0 ? "all" : filterPriority[0]?.toString() || "all"} 
              onValueChange={(value) => {
                if (value === "all") {
                  setFilterPriority([])
                } else {
                  setFilterPriority([Number(value)])
                }
              }}
            >
              <SelectTrigger className="w-32 theme-input">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-[10100]">
                <FilterSelectItems options={PRIORITY_FILTER_OPTIONS} />
              </SelectContent>
            </Select>
          </div>

          {/* Filter by Assignee (hide for my-tasks) */}
          {listId !== "my-tasks" && (
            <div className="flex items-start justify-between mb-3">
              <Label className="text-sm theme-text-secondary mt-2">{t('listSettings.assigneeFilter')}</Label>
              <div className="space-y-1 max-h-24 overflow-y-auto">
                {availableUsers.map((user) => (
                  <div key={user.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`assignee-${user.id}`}
                      checked={filterAssignee.includes(user.id)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setFilterAssignee([...filterAssignee, user.id])
                        } else {
                          setFilterAssignee(filterAssignee.filter(a => a !== user.id))
                        }
                      }}
                    />
                    <label htmlFor={`assignee-${user.id}`} className="text-xs flex items-center space-x-1">
                      <Avatar className="w-3 h-3">
                        <AvatarImage src={user.image || undefined} />
                        <AvatarFallback className="text-xs">
                          {user.name?.charAt(0) || user.email?.charAt(0)}
                        </AvatarFallback>
                      </Avatar>
                      <span>{user.name || user.email}</span>
                    </label>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Due Date Filter (only show if not Today view) */}
          {!defaults.fixedDueDate && (
            <div className="flex items-center justify-between mb-3">
              <Label className="text-sm theme-text-secondary">{t('listSettings.dueDateFilter')}</Label>
              <Select value={filterDueDate} onValueChange={setFilterDueDate}>
                <SelectTrigger className="w-32 theme-input">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[10100]">
                  <FilterSelectItems options={DUE_DATE_FILTER_OPTIONS} />
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Clear Filters Button */}
          {hasActiveFilters && (
            <div className="pt-4 border-t theme-border">
              <Button
                variant="outline"
                size="sm"
                onClick={clearAllFilters}
                className="w-full text-orange-400 hover:text-orange-300 hover:bg-orange-900/20 border-orange-600 hover:border-orange-500"
              >
                <Filter className="w-4 h-4 mr-2" />
                Clear All Filters
              </Button>
            </div>
          )}
      </div>
    </SettingsModalShell>
  )
}
