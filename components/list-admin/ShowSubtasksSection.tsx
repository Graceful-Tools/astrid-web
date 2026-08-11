"use client"

import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { ListTree } from "lucide-react"
import { useTranslations } from "@/lib/i18n/client"
import { DEFAULT_LIST_SHOW_SUBTASKS } from "@/lib/list-subtask-visibility"
import type { TaskList } from "@/types/task"

interface ShowSubtasksSectionProps {
  list: TaskList
  canEditSettings: boolean
  onUpdate: (list: TaskList) => void
}

/**
 * Per-list "Show subtasks" toggle (task dce843a1) — the web half of the
 * iOS/Mac per-list show/hide subtasks feature.
 *
 * Purely derived from `list.showSubtasks`, like RecentlyCompletedWindowSection:
 * no local state, so the switch always reflects what was saved. A null/absent
 * value renders as ON, matching lib/list-subtask-visibility.ts — the list
 * predates the column and its subtasks are showing.
 */
export function ShowSubtasksSection({
  list,
  canEditSettings,
  onUpdate,
}: ShowSubtasksSectionProps) {
  const { t } = useTranslations()

  if (!canEditSettings) return null

  const checked = list.showSubtasks ?? DEFAULT_LIST_SHOW_SUBTASKS

  return (
    <div className="space-y-2 rounded-md border theme-border p-3" data-testid="show-subtasks-section">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Label className="text-sm theme-text-secondary flex items-center space-x-1.5">
            <ListTree className="w-4 h-4" />
            <span>{t("lists.showSubtasksLabel")}</span>
          </Label>
          <p className="mt-1 text-xs theme-text-muted">
            {t("lists.showSubtasksDescription")}
          </p>
        </div>
        <Switch
          checked={checked}
          onCheckedChange={(value) => onUpdate({ ...list, showSubtasks: value })}
          aria-label={t("lists.showSubtasksLabel")}
          data-testid="show-subtasks-toggle"
          className="shrink-0"
        />
      </div>
    </div>
  )
}
