"use client"

import React from "react"
import { Globe, Hash, Users } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { TaskCheckbox } from "@/components/task-checkbox"
import { PublicTaskCopyButton } from "@/components/public-task-copy-button"
import { isPublicListTask, shouldHideTaskWhen } from "@/lib/public-list-utils"
import { getAllListMembers } from "@/lib/list-member-utils"
import { formatDateForDisplay } from "@/lib/date-utils"
import { format } from "date-fns"
import type { Task } from "@/types/task"

export interface TaskRowContentProps {
  task: Task
  currentUserId?: string
  isSelected?: boolean
  isMobile?: boolean
  getPriorityColor: (priority: number) => string
  onToggleComplete: () => void
  onCopyPublic: () => void
}

export function TaskRowContent({
  task,
  currentUserId,
  isSelected,
  isMobile,
  getPriorityColor,
  onToggleComplete,
  onCopyPublic,
}: TaskRowContentProps) {
  return (
    <>
      {isPublicListTask(task) ? (
        <PublicTaskCopyButton onCopy={onCopyPublic} />
      ) : task.assigneeId && task.assigneeId !== currentUserId ? (
        <div className="relative p-2 -m-2 flex items-center justify-center self-center">
          <Avatar
            className="w-8 h-8 rounded-lg border-2"
            style={{ borderColor: getPriorityColor(task.priority) }}
          >
            <AvatarImage src={task.assignee?.image || undefined} />
            <AvatarFallback className="text-xs bg-gray-300 text-gray-700 rounded-lg">
              {task.assignee?.name?.slice(0, 2) || task.assignee?.email?.slice(0, 2) || '?'}
            </AvatarFallback>
          </Avatar>
        </div>
      ) : !task.assigneeId ? (
        task.completed ? (
          <TaskCheckbox
            checked={true}
            onToggle={onToggleComplete}
            priority={task.priority}
            repeating={task.repeating !== 'never'}
          />
        ) : (
          <div
            className="relative p-2 -m-2 cursor-pointer flex items-center justify-center self-center"
            onClick={(e) => {
              e.stopPropagation()
              onToggleComplete()
            }}
          >
            <div
              className="w-8 h-8 rounded-lg border-2 flex items-center justify-center"
              style={{ borderColor: getPriorityColor(task.priority) }}
            >
              <span
                className="text-sm font-medium"
                style={{ color: getPriorityColor(task.priority) }}
              >
                U
              </span>
            </div>
          </div>
        )
      ) : (
        <TaskCheckbox
          checked={task.completed}
          onToggle={onToggleComplete}
          priority={task.priority}
          repeating={task.repeating !== 'never'}
        />
      )}
      <div className="flex-1 min-w-0">
        <div className={`task-title ${
          isMobile ? 'text-base font-medium leading-tight' : ''
        } ${
          task.completed
            ? "task-title-completed theme-text-muted"
            : isSelected
              ? "theme-text-selected"
              : "theme-text-primary"
        }`}>
          {task.title}
        </div>

        {((task.dueDateTime && !shouldHideTaskWhen(task)) || (task.lists && task.lists.length > 0)) && (
          <div className="flex items-center mt-1 gap-2">
            {task.dueDateTime && !shouldHideTaskWhen(task) && (
              <div className="text-xs theme-text-muted flex-shrink-0">
                {formatDateForDisplay(new Date(task.dueDateTime), task.isAllDay)}
                {!task.isAllDay && ` ${format(new Date(task.dueDateTime), "h:mm a")}`}
              </div>
            )}
            <div className="flex flex-wrap gap-1 min-w-0 flex-1">
              {task.lists && task.lists.length > 0 && (
                <>
                  {task.lists.filter(list => list != null).slice(0, isMobile ? 2 : undefined).map((list) => (
                    <div
                      key={list.id}
                      className="flex items-center space-x-1 rounded px-1.5 py-0 text-xs"
                      style={{ backgroundColor: `${list.color}15` }}
                    >
                      {(() => {
                        const privacy = list?.privacy
                        if (privacy === 'PUBLIC') {
                          return <Globe className="w-3 h-3 text-green-500" />
                        }
                        const allMembers = getAllListMembers(list)
                        const hasAdditionalMembers = allMembers.length > 1
                        if (hasAdditionalMembers) {
                          return <Users className="w-3 h-3 text-blue-500" />
                        }
                        return (
                          <Hash
                            className={`w-3 h-3 ${isMobile ? 'flex-shrink-0' : ''}`}
                            style={{ color: list.color }}
                          />
                        )
                      })()}
                      <span className={`theme-text-secondary ${isMobile ? 'truncate' : ''}`}>{list.name}</span>
                    </div>
                  ))}
                  {isMobile && task.lists && task.lists.length > 2 && (
                    <span className="text-xs theme-text-muted">+{task.lists.length - 2}</span>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
