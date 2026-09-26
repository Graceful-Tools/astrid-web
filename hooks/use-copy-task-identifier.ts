"use client"

/**
 * "Copy task id" (AWTD-1017) — one action shared by the task menu and the id
 * row in task details, so the two cannot copy different things or confirm it
 * differently.
 */
import { useCallback } from "react"
import { copyCredential } from "@/components/credential-field"
import { useToast } from "@/hooks/use-toast"
import { useTranslations } from "@/lib/i18n/client"
import { canCopyTaskIdentifier } from "@/lib/task-identifier-links"
import type { Task } from "@/types/task"

export function useCopyTaskIdentifier(task: Pick<Task, "identifier">) {
  const { toast } = useToast()
  const { t } = useTranslations()
  const identifier = task.identifier

  const copy = useCallback(async () => {
    if (!identifier) return
    await copyCredential(identifier)
    toast({ description: t("tasks.taskId.copied", { id: identifier }) })
  }, [identifier, toast, t])

  return { canCopy: canCopyTaskIdentifier(task), copy }
}
