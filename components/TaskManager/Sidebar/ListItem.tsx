"use client"

import React from "react"
import { Button } from "@/components/ui/button"
import { Globe, Users, Settings } from "lucide-react"
import { getListImageUrl, getConsistentDefaultImage } from "@/lib/default-images"
import { getAllListMembers } from "@/lib/list-member-utils"
import type { TaskList } from "@/types/task"

interface ListItemProps {
  list: TaskList
  selectedListId: string
  isMobile: boolean
  taskCount: number
  onClick: (listId: string) => void
  onTaskDrop?: (shiftKey: boolean) => void
  onTaskDragEnter?: (shiftKey: boolean) => void
  onTaskDragLeave?: () => void
  onTaskDragOver?: (shiftKey: boolean, listId: string) => void
  onSettingsClick?: (listId: string) => void
  droppable?: boolean
  isDragActive?: boolean
  isDropTarget?: boolean
  dropMode?: 'move' | 'add'
}

export function ListItem({
  list,
  selectedListId,
  isMobile,
  taskCount,
  onClick,
  onTaskDrop,
  onTaskDragEnter,
  onTaskDragLeave,
  onTaskDragOver,
  onSettingsClick,
  droppable = false,
  isDragActive = false,
  isDropTarget = false,
  dropMode = 'move'
}: ListItemProps) {
  const privacy = list.privacy

  // Determine if list has additional members (shared) using consolidated utility
  const allMembers = getAllListMembers(list)
  const hasAdditionalMembers = allMembers.length > 1 // More than just the owner

  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!droppable || !isDragActive) return
    event.preventDefault()
    onTaskDragEnter?.(event.shiftKey)
  }

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!droppable || !isDragActive) return
    event.preventDefault()
    event.dataTransfer.dropEffect = event.shiftKey ? 'copy' : 'move'
    onTaskDragOver?.(event.shiftKey, list.id)
  }

  const handleDragLeave = () => {
    if (!droppable || !isDragActive) return
    onTaskDragLeave?.()
  }

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!droppable || !isDragActive) return
    event.preventDefault()
    onTaskDrop?.(event.shiftKey)
    onTaskDragLeave?.()
  }

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="relative"
      aria-dropeffect={droppable && isDragActive ? (dropMode === 'add' ? 'copy' : 'move') : undefined}
    >
      <Button
        variant="ghost"
        className={`relative w-full justify-start overflow-visible ${
          isMobile ? 'mobile-list-item text-left' : ''
        } ${
          selectedListId === list.id
          ? "bg-blue-500/15 text-blue-700 dark:text-blue-300 font-medium"
          : "theme-text-secondary hover:theme-text-primary hover:theme-bg-hover"
        } ${
          isDropTarget
            ? "ring-2 ring-blue-400 ring-offset-2 ring-offset-transparent bg-blue-500/15 text-blue-50"
            : ""
        } ${droppable && isDragActive ? "transition-colors duration-150" : ""}`}
        onMouseDown={(event) => {
          if (droppable && isDragActive) {
            event.preventDefault()
          }
        }}
        onClick={(event) => {
          if (droppable && isDragActive) {
            event.preventDefault()
            return
          }
          onClick(list.id)
        }}
        aria-describedby={isDropTarget ? `${list.id}-drop-indicator` : undefined}
      >
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center space-x-2 min-w-0 flex-1 overflow-hidden">
            <img
              src={getListImageUrl(list)}
              alt={list.name}
              className="w-5 h-5 rounded-full object-cover flex-shrink-0"
              onError={(e) => {
                const target = e.currentTarget as HTMLImageElement
                const defaultImage = getConsistentDefaultImage(list.id).filename
                if (target.src !== defaultImage) {
                  target.src = defaultImage
                }
              }}
            />
            <span className="truncate text-left w-full">{list.name}</span>
          </div>
          <div className="flex items-center space-x-2 flex-shrink-0">
            {/* Privacy/sharing indicator - positioned to the right of the list name */}
            {(privacy === 'PUBLIC' || hasAdditionalMembers) && (
              <div>
                {privacy === 'PUBLIC' ? (
                  <Globe className="w-3 h-3 text-green-500" />
                ) : hasAdditionalMembers ? (
                  <Users className="w-3 h-3 text-blue-500" />
                ) : null}
              </div>
            )}
            <span className="text-[0.6875rem] theme-count-bg theme-text-primary px-2 py-1 rounded">
              {taskCount}
            </span>
            {isMobile && onSettingsClick && (
              <div
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation()
                  onSettingsClick(list.id)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.stopPropagation(); onSettingsClick(list.id) }
                }}
                className="p-1 rounded hover:bg-white/20 transition-colors cursor-pointer"
                aria-label={`Settings for ${list.name}`}
              >
                <Settings className="w-3.5 h-3.5" />
              </div>
            )}
          </div>
        </div>
      </Button>
      {isDropTarget && (
        <span className="pointer-events-none absolute inset-y-1 left-0 w-1 rounded-full bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.7)]" />
      )}
    </div>
  )
}
