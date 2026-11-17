"use client"

/**
 * Moving a list into or out of a project from the sidebar (ADEV-61): its row's
 * Move to Project ▸ / Remove from Project, or a drop on a project header. One
 * PUT, the same call the list settings' Project picker makes (BoardViewSection);
 * the sidebar updates only on success, and a refusal shows the server's reason.
 */
import React from "react"
import { apiCall, refusalReason } from "@/lib/api"
import { useToast } from "@/hooks/use-toast"
import { useTranslations } from "@/lib/i18n/client"
import type { TaskList } from "@/types/task"

export function useSidebarProjectActions(setLists: (value: React.SetStateAction<TaskList[]>) => void) {
  const { toast } = useToast()
  const { t } = useTranslations()

  const moveListToProject = React.useCallback(async (listId: string, projectId: string | null) => {
    try {
      await apiCall(`/api/v1/lists/${listId}`, {
        method: "PUT",
        body: JSON.stringify({ projectId }),
      })
      setLists(previous => previous.map(list => (list.id === listId ? { ...list, projectId } : list)))
    } catch (error) {
      toast({ title: refusalReason(error) ?? t("projectMode.projectMoveFailed"), variant: "destructive" })
    }
  }, [setLists, t, toast])

  return { moveListToProject }
}
