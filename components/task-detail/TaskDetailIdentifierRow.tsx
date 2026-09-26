"use client"

/**
 * The TASK ID row in task details (AWTD-1017, docs/specs/TASK_IDENTIFIERS.md §7).
 *
 * Its own component for the reason TaskDetailBoardStateRow is: it keeps
 * `TaskFieldEditors` from growing (tests/rules/oversized-files-ratchet.test.ts).
 * Whether it renders is `shouldShowTaskIdentifier` — the one show rule — and
 * never restated here.
 */
import { Copy, Hash } from "lucide-react"
import { TaskFieldRow } from "./TaskFieldRow"
import { useTranslations } from "@/lib/i18n/client"
import { useCopyTaskIdentifier } from "@/hooks/use-copy-task-identifier"
import { shouldShowTaskIdentifier } from "@/lib/task-identifier-links"
import type { Task, TaskList } from "@/types/task"

interface TaskDetailIdentifierRowProps {
  task: Task
  availableLists: TaskList[]
}

export function TaskDetailIdentifierRow({ task, availableLists }: TaskDetailIdentifierRowProps) {
  const { t } = useTranslations()
  const { copy } = useCopyTaskIdentifier(task)

  if (!shouldShowTaskIdentifier(task, "details", availableLists)) return null

  return (
    <TaskFieldRow label={t("tasks.taskId.label")} icon={<Hash className="w-4 h-4" />}>
      <button
        type="button"
        onClick={copy}
        title={t("tasks.taskId.copy")}
        className="group inline-flex items-center gap-1.5 text-sm font-mono theme-text-muted hover:theme-text-secondary"
      >
        {task.identifier}
        <Copy className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100" aria-hidden />
      </button>
    </TaskFieldRow>
  )
}
