"use client"

/**
 * The Estimate button and the estimate card, in task details (ADEV-280). Its own row for the reason the
 * goals row is: `TaskFieldEditors` is not allowed to grow. Draws nothing outside Project Mode, on a task
 * whose lists are in no project, or when the project states nothing to estimate against
 * (EstimateControl decides the last one).
 */
import { Gauge } from "lucide-react"
import { TaskFieldRow } from "./TaskFieldRow"
import { EstimateControl } from "@/components/projects/EstimateControl"
import { useProjectMode } from "@/hooks/use-project-mode"
import { useTranslations } from "@/lib/i18n/client"
import type { Task } from "@/types/task"

export function TaskDetailEstimateRow({ task, readOnly = false }: { task: Task; readOnly?: boolean }) {
  const { t } = useTranslations()
  const projectMode = useProjectMode()
  const projectId = task.lists?.find(list => list.projectId)?.projectId
  if (!projectMode || !projectId || !task.id) return null
  return (
    <TaskFieldRow label={t("projectMode.estimate.title")} icon={<Gauge className="h-4 w-4" aria-hidden="true" />} align="start">
      <EstimateControl taskId={task.id} projectId={projectId} canEdit={!readOnly} />
    </TaskFieldRow>
  )
}
