"use client"

import React, { useState } from "react"
import { useTranslations } from "@/lib/i18n/client"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { SettingsModalShell } from "./list-settings/SettingsModalShell"
import { ListSortAndFilters } from "./list-sort-and-filters"
import { ListMembership } from "./list-membership"
import { ListAdminSettings } from "./list-admin-settings"
import type { ProjectBoardColumn } from "@/lib/project-status"
import { ManageStatusesPanel } from "./list-admin/ManageStatusesPanel"
import type { TaskList, User } from "../types/task"
import { Lock, Unlock, Filter, Users, Settings, KanbanSquare } from "lucide-react"

interface ListSettingsPopoverProps {
  list: TaskList
  currentUser: User
  availableUsers: User[]
  canEditSettings: boolean
  onUpdate: (list: TaskList) => void
  onFavoriteToggle?: (listId: string) => void
  onDelete: (listId: string) => void
  onLeave?: (list: TaskList, isOwnerLeaving?: boolean) => void
  onEditName?: () => void
  onEditImage?: () => void
  onProjectBoardCreated?: (projectLists: TaskList[]) => void
  onProjectBoardRemoved?: (projectId: string, detachedListIds: string[]) => void
  /** The user's global board status lists (Ready/Doing/Waiting + custom). */
  statuses?: ProjectBoardColumn[]
  /** Reload lists after a status column is renamed/reordered/added. */
  onStatusesChanged?: () => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
  // No longer need local filter props as they will be loaded from database
}

export function ListSettingsPopover({
  list,
  currentUser,
  availableUsers,
  canEditSettings,
  onUpdate,
  onFavoriteToggle,
  onDelete,
  onLeave,
  onEditName,
  onEditImage,
  onProjectBoardCreated,
  onProjectBoardRemoved,
  statuses = [],
  onStatusesChanged,
  open = false,
  onOpenChange = () => {},
  children,
  // No longer need local filter props
}: ListSettingsPopoverProps) {
  const { t } = useTranslations()
  const [activeTab, setActiveTab] = useState("sort-filters")

  // The Statuses tab manages board columns — only relevant when this list has a
  // board enabled and the viewer can edit settings.
  const showStatusesTab = canEditSettings && Boolean(list.projectId)

  // Ensure activeTab is valid for non-admin users
  React.useEffect(() => {
    if (!canEditSettings && activeTab === "admin") {
      setActiveTab("sort-filters")
    }
    if (!showStatusesTab && activeTab === "statuses") {
      setActiveTab("sort-filters")
    }
  }, [canEditSettings, showStatusesTab, activeTab])

  return (
    <SettingsModalShell
      open={open}
      onOpenChange={onOpenChange}
      header={
        <>
          <h2 className="text-lg font-semibold theme-text-primary">
            {canEditSettings ? "List Settings" : "List Details"}
          </h2>
          {list.privacy === "PRIVATE"
            ? <Lock className="w-4 h-4 theme-text-muted" />
            : <Unlock className="w-4 h-4 theme-text-muted" />}
        </>
      }
    >
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className={`grid w-full ${showStatusesTab ? 'grid-cols-4' : canEditSettings ? 'grid-cols-3' : 'grid-cols-2'} theme-bg-secondary`}>
                <TabsTrigger value="sort-filters" className="flex items-center space-x-1 text-xs">
                  <Filter className="w-3 h-3" />
                  <span>Sort & Filters</span>
                </TabsTrigger>
                <TabsTrigger value="membership" className="flex items-center space-x-1 text-xs">
                  <Users className="w-3 h-3" />
                  <span>Membership</span>
                </TabsTrigger>
                {showStatusesTab && (
                  <TabsTrigger value="statuses" className="flex items-center space-x-1 text-xs">
                    <KanbanSquare className="w-3 h-3" />
                    <span>Statuses</span>
                  </TabsTrigger>
                )}
                {canEditSettings && (
                  <TabsTrigger value="admin" className="flex items-center space-x-1 text-xs">
                    <Settings className="w-3 h-3" />
                    <span>{t('listSettings.adminSettings')}</span>
                  </TabsTrigger>
                )}
              </TabsList>

              <div className="p-4 pb-40 md:pb-4">
                <TabsContent value="sort-filters" className="mt-0">
                  <ListSortAndFilters
                    list={list}
                    currentUser={currentUser}
                    onUpdate={onUpdate}
                    onFavoriteToggle={onFavoriteToggle}
                    canEditSettings={canEditSettings}
                  />
                </TabsContent>

                <TabsContent value="membership" className="mt-0">
                  <ListMembership
                    list={list}
                    currentUser={currentUser}
                    canEditSettings={canEditSettings}
                    onUpdate={onUpdate}
                    onLeave={(list, isOwnerLeaving) => {
                      if (onLeave) {
                        onLeave(list, isOwnerLeaving)
                        onOpenChange(false)
                      }
                    }}
                  />
                </TabsContent>

                {showStatusesTab && (
                  <TabsContent value="statuses" className="mt-0">
                    <ManageStatusesPanel
                      statuses={statuses}
                      onChanged={() => onStatusesChanged?.()}
                      projectId={list.projectId!}
                    />
                  </TabsContent>
                )}

                {canEditSettings && (
                  <TabsContent value="admin" className="mt-0">
                    <ListAdminSettings
                      list={list}
                      currentUser={currentUser}
                      canEditSettings={canEditSettings}
                      onUpdate={onUpdate}
                      onDelete={(listId) => {
                        onDelete(listId)
                        onOpenChange(false)
                      }}
                      onEditName={onEditName}
                      onEditImage={onEditImage}
                      onProjectBoardCreated={onProjectBoardCreated}
                      onProjectBoardRemoved={onProjectBoardRemoved}
                    />
                  </TabsContent>
                )}
              </div>
            </Tabs>
    </SettingsModalShell>
  )
}
