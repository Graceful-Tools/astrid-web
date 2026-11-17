"use client"

/**
 * The lists' side of project changes (ADEV-61).
 *
 * `moveListToProject`: a sidebar row's Move to Project ▸ / Remove from Project,
 * or a drop on a project header. One PUT, the same call the list settings'
 * Project picker makes (BoardViewSection); the sidebar updates only on success,
 * and a refusal shows the server's reason.
 *
 * `detachProjectLists`: a project was deleted (its sidebar header, or the list
 * settings). Its own status columns go with it; its lists stay, outside any project.
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

  const detachProjectLists = React.useCallback((projectId: string, detachedListIds: string[]) => {
    const detached = new Set(detachedListIds)
    setLists(previous =>
      previous
        .filter(list => !(list.projectId === projectId && list.listType === "status"))
        .map(list => (list.projectId === projectId || detached.has(list.id) ? { ...list, projectId: null } : list)),
    )
  }, [setLists])

  return { moveListToProject, detachProjectLists }
}
