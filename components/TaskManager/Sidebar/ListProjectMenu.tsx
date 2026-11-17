"use client"

/**
 * A sidebar list row's project moves (ADEV-61; iOS `ListRowView`): Move to
 * Project ▸ and Remove from Project, offered exactly where astrid-core's
 * `listProjectMoves` allows — the table `PUT /api/v1/lists/:id` enforces. A row
 * with nothing to offer keeps the browser's own menu.
 */
import React from "react"
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu"
import { useTranslations } from "@/lib/i18n/client"
import { useProjectMode } from "@/hooks/use-project-mode"
import { useLoadedProjects } from "@/hooks/use-loaded-projects"
import { listProjectMoves } from "@/lib/list-project-moves"
import { sidebarProjectName } from "@/lib/sidebar-projects"
import { PROJECT_BOARD_LIST_DRAG_TYPE } from "@/lib/project-board-list-drag"
import type { TaskList } from "@/types/task"
import { SidebarConfirmDialog } from "./SidebarConfirmDialog"
import { SidebarContextMenu } from "./SidebarContextMenu"

interface ListProjectMenuProps {
  list: TaskList
  currentUserId?: string
  onMoveListToProject?: (listId: string, projectId: string | null) => Promise<void> | void
  children: React.ReactNode
}

export function ListProjectMenu({ list, currentUserId, onMoveListToProject, children }: ListProjectMenuProps) {
  const { t } = useTranslations()
  const enabled = useProjectMode()
  const projects = useLoadedProjects()
  const [leaving, setLeaving] = React.useState(false)

  const moves = React.useMemo(
    () => listProjectMoves(currentUserId ?? "", list, projects),
    [currentUserId, list, projects],
  )

  if (!enabled || !onMoveListToProject || list.isVirtual) return <>{children}</>

  const byId = new Map(projects.map(project => [project.id, project]))
  const current = list.projectId ? byId.get(list.projectId) : undefined
  const offers = moves.destinations.length > 0 || moves.canLeave

  const items = offers ? (
    <>
      {moves.destinations.length > 0 && (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{t("projectMode.moveToProject")}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {moves.destinations.map(projectId => (
              <DropdownMenuItem key={projectId} onSelect={() => void onMoveListToProject(list.id, projectId)}>
                {sidebarProjectName(byId.get(projectId) ?? {})}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )}
      {moves.canLeave && (
        <DropdownMenuItem onSelect={() => setLeaving(true)}>{t("projectMode.removeFromProject")}</DropdownMenuItem>
      )}
    </>
  ) : null

  return (
    <>
      {/* A list that may move drags onto a project's sidebar header (ADEV-61). */}
      <SidebarContextMenu
        items={items}
        draggable={moves.destinations.length > 0 || undefined}
        onDragStart={moves.destinations.length > 0 ? event => {
          event.dataTransfer.effectAllowed = "copy"
          event.dataTransfer.setData(PROJECT_BOARD_LIST_DRAG_TYPE, list.id)
        } : undefined}
      >
        {children}
      </SidebarContextMenu>
      {moves.canLeave && (
        <SidebarConfirmDialog
          open={leaving}
          title={t("projectMode.projectLeaveConfirm", { list: list.name, project: current ? sidebarProjectName(current) : "" })}
          detail={t("projectMode.projectLeaveDetail")}
          confirmLabel={t("projectMode.removeFromProject")}
          confirmTestId="sidebar-list-leave-confirm"
          onCancel={() => setLeaving(false)}
          onConfirm={() => {
            setLeaving(false)
            void onMoveListToProject(list.id, null)
          }}
        />
      )}
    </>
  )
}
