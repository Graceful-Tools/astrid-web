"use client"

import React from "react"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useProjectFields } from "@/hooks/use-project-fields"
import { useTranslations } from "@/lib/i18n/client"
import {
  githubBoardListFor,
  formatProjectFieldFilter,
  projectFieldFilterGroups,
  resolveProjectFieldFilter,
} from "@/lib/project-field-filter"
import type { TaskList } from "@/types/task"

const ALL = "all"

/**
 * "Filter by a GitHub project field" in Sort & Filters (AWTD-1259, P6a-5).
 *
 * Renders nothing off a GitHub-backed board, and nothing on one whose schema
 * has no single-select or iteration field — so every other list's panel is
 * unchanged and makes no request. A stored value that no longer resolves
 * shows as "All tasks", which is also what the board applies.
 */
export function ProjectFieldFilterSelect({
  list,
  onChange,
}: {
  list: TaskList
  onChange: (value: string | null) => void
}) {
  const { t } = useTranslations()
  const board = githubBoardListFor([list], list.projectId)
  const { fields } = useProjectFields(board?.projectId)
  const groups = React.useMemo(() => projectFieldFilterGroups(fields), [fields])

  if (!board || groups.length === 0) return null

  const resolved = resolveProjectFieldFilter(list.filterProjectField, fields)
  const value = resolved ? formatProjectFieldFilter(resolved.fieldId, resolved.valueId) : ALL

  return (
    <div className="flex items-center justify-between mb-3" data-testid="project-field-filter">
      <Label className="text-sm theme-text-secondary">{t("tasks.projectFields.filterLabel")}</Label>
      <Select value={value} onValueChange={next => onChange(next === ALL ? null : next)}>
        <SelectTrigger className="w-40 theme-input">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="z-[10100]">
          <SelectItem value={ALL}>
            <span className="text-blue-400">{t("tasks.projectFields.filterAll")}</span>
          </SelectItem>
          {groups.map(group => (
            <SelectGroup key={group.fieldId}>
              <SelectLabel>{group.fieldName}</SelectLabel>
              {group.choices.map(choice => (
                <SelectItem key={choice.value} value={choice.value}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
