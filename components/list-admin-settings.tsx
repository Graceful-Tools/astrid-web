"use client"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { EnhancedListImageDisplay } from "./enhanced-list-image-display"
import type { TaskList, User } from "../types/task"
import { BoardViewSection } from "@/components/list-admin/BoardViewSection"
import { DeleteListSection } from "@/components/list-admin/DeleteListSection"
import { RecentlyCompletedWindowSection } from "@/components/list-admin/RecentlyCompletedWindowSection"
import { GithubIntegrationSection } from "@/components/list-admin/GithubIntegrationSection"
import { ListNameSection } from "@/components/list-admin/ListNameSection"
import { AgentInstructionsSection } from "@/components/list-admin/AgentInstructionsSection"
import { DefaultTaskSettingsSection } from "@/components/list-admin/DefaultTaskSettingsSection"
import { AstridAgentSection } from "@/components/list-admin/AstridAgentSection"
import { ListIdSection } from "@/components/list-admin/ListIdSection"

interface ListAdminSettingsProps {
  list: TaskList
  currentUser: User
  canEditSettings: boolean
  onUpdate: (list: TaskList) => void
  onDelete: (listId: string) => void
  onEditName?: () => void
  onEditImage?: () => void
  onProjectBoardCreated?: (projectLists: TaskList[]) => void
  onProjectBoardRemoved?: (projectId: string, detachedListIds: string[]) => void
}

export function ListAdminSettings({
  list,
  currentUser,
  canEditSettings,
  onUpdate,
  onDelete,
  onEditName,
  onEditImage,
  onProjectBoardCreated,
  onProjectBoardRemoved
}: ListAdminSettingsProps) {
  return (
    <div className="space-y-4">
      {/* List Name */}
      <ListNameSection list={list} canEditSettings={canEditSettings} onUpdate={onUpdate} />

      {/* Enhanced List Image Display */}
      <div className="flex items-center justify-between">
        <Label className="text-sm theme-text-secondary">List Image</Label>
        <EnhancedListImageDisplay
          list={list}
          canEdit={canEditSettings}
          onImageClick={onEditImage}
          size="thumbnail"
          showEditOverlay={true}
          className="rounded-full"
        />
      </div>

      {/* Project Status Board */}
      <BoardViewSection
        list={list}
        canEditSettings={canEditSettings}
        onUpdate={onUpdate}
        onProjectBoardCreated={onProjectBoardCreated}
        onProjectBoardRemoved={onProjectBoardRemoved}
      />

      {/* Astrid — AI agent for this list */}
      <AstridAgentSection list={list} canEditSettings={canEditSettings} onUpdate={onUpdate} />

      {/* Agent Instructions (List Description) */}
      <AgentInstructionsSection list={list} canEditSettings={canEditSettings} onUpdate={onUpdate} />

      <div className="border-b theme-border"></div>

      {/* Default task settings */}
      <DefaultTaskSettingsSection list={list} canEditSettings={canEditSettings} onUpdate={onUpdate} />

      {/* GitHub Repository Selection */}
      <GithubIntegrationSection
        list={list}
        canEditSettings={canEditSettings}
        onUpdate={onUpdate}
      />

      {/* Advanced Settings: Recently Completed window */}
      <RecentlyCompletedWindowSection
        list={list}
        canEditSettings={canEditSettings}
        onUpdate={onUpdate}
      />

      {/* List ID (for API/OAuth integration) */}
      <ListIdSection list={list} />

      {/* Delete List */}
      <DeleteListSection list={list} canEditSettings={canEditSettings} onDelete={onDelete} />
    </div>
  )
}
