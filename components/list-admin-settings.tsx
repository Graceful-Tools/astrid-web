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
      <div className="border-t theme-border pt-4">
        <div className="flex items-center justify-between">
          <Label className="text-xs theme-text-muted">List ID</Label>
          <div className="flex items-center space-x-2">
            <code className="text-xs theme-text-muted font-mono bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
              {list.id}
            </code>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(list.id)
                  // Optional: Show a toast notification
                } catch (err) {
                  console.error('Failed to copy:', err)
                }
              }}
              className="h-6 w-6 p-0"
              title="Copy List ID"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </Button>
          </div>
        </div>
        <p className="text-xs theme-text-muted mt-1">
          Use this ID for OAuth API integrations and coding agents
        </p>
      </div>

      {/* Delete List */}
      <DeleteListSection list={list} canEditSettings={canEditSettings} onDelete={onDelete} />
    </div>
  )
}
