"use client"

/**
 * The goals a task serves, in task details (ADEV-276). Its own row for the reason the blockers row is:
 * `TaskFieldEditors` is not allowed to grow. Draws nothing outside Project Mode, on a task whose lists
 * are in no project, or when the project states no goals (GoalChips decides that last one).
 */
import { Target } from "lucide-react"
import { TaskFieldRow } from "./TaskFieldRow"
import { GoalChips } from "@/components/projects/GoalChips"
import { useProjectMode } from "@/hooks/use-project-mode"
import { useTranslations } from "@/lib/i18n/client"
import type { Task } from "@/types/task"

export function TaskDetailGoalsRow({ task, readOnly = false }: { task: Task; readOnly?: boolean }) {
  const { t } = useTranslations()
  const projectMode = useProjectMode()
  const projectId = task.lists?.find(list => list.projectId)?.projectId
  if (!projectMode || !projectId || !task.id) return null
  return (
    <TaskFieldRow label={t("projectMode.goals.linkedGoals")} icon={<Target className="h-4 w-4" aria-hidden="true" />} align="start">
      <GoalChips kind="task" id={task.id} projectId={projectId} canEdit={!readOnly} />
    </TaskFieldRow>
  )
}
