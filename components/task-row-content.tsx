"use client"

import React from "react"
import { ListGlyph } from "@/components/list-glyph"
import { TaskLeadingControl } from "@/components/task-leading-control"
import { PublicTaskCopyButton } from "@/components/public-task-copy-button"
import { isPublicListTask, shouldHideTaskWhen } from "@/lib/public-list-utils"
import { formatDateForDisplay } from "@/lib/date-utils"
import { isCanceled } from "@/lib/closed-reason"
import { listsShownOnRow, splitTaskLists } from "@/lib/list-flavors"
import { useTranslations } from "@/lib/i18n/client"
import { format } from "date-fns"
import type { Task } from "@/types/task"

export interface TaskRowContentProps {
  task: Task
  currentUserId?: string
  isSelected?: boolean
  isMobile?: boolean
  onToggleComplete: () => void
  onCopyPublic: () => void
  /** The viewer's task display mode; absent means list (task ffa5bbb5). */
  displayMode?: string | null
  /** Project mode: open the options popover instead of completing. */
  onOpenOptions?: () => void
  /** The task's list is on a project board: tap opens the options popover
   *  whatever the display mode (task 036ef139). */
  onBoard?: boolean
  /** Task id to show, muted, in the metadata row with the due time and the list
   *  pills (AWTD-1017, moved off the title line by AWTD-1170). The caller decides
   *  with shouldShowTaskIdentifier — only board cards pass one. */
  identifier?: string | null
  /** The list being viewed; its chip is not repeated on every row (AWTD-1025). */
  currentListId?: string | null
}

export function TaskRowContent({
  task,
  currentUserId,
  isSelected,
  isMobile,
  onToggleComplete,
  onCopyPublic,
  displayMode,
  onOpenOptions,
  onBoard,
  identifier,
  currentListId,
}: TaskRowContentProps) {
  const { t } = useTranslations()
  // Split memberships once: lists are destinations, labels are tags
  // (task 60f5849d).
  const { lists: domainLists, labels } = splitTaskLists(
    listsShownOnRow((task.lists || []).filter(list => list != null), currentListId)
  )
  return (
    <>
      {isPublicListTask(task) ? (
        <PublicTaskCopyButton onCopy={onCopyPublic} />
      ) : (
        <TaskLeadingControl
          assigneeId={task.assigneeId}
          currentUserId={currentUserId}
          assignee={task.assignee}
          completed={task.completed}
          priority={task.priority}
          repeating={task.repeating !== 'never'}
          onToggleComplete={onToggleComplete}
          displayMode={displayMode}
          onOpenOptions={onOpenOptions}
          onBoard={onBoard}
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
          {/* Canceled tasks are visually distinct from finished ones (task
              11042ae3). Nothing renders when closedReason is null, which is
              every task that was simply completed. */}
          {isCanceled(task) && (
            <span className="ml-2 align-middle rounded px-1.5 py-0 text-xs theme-text-muted border theme-border">
              {t("tasks.wontDoChip")}
            </span>
          )}
        </div>

        {(identifier || (task.dueDateTime && !shouldHideTaskWhen(task)) || domainLists.length > 0 || labels.length > 0) && (
          <div className="flex items-center mt-1 gap-2">
            {identifier && (
              <span className="text-xs font-mono theme-text-muted flex-shrink-0">{identifier}</span>
            )}
            {task.dueDateTime && !shouldHideTaskWhen(task) && (
              <div className="text-xs theme-text-muted flex-shrink-0">
                {formatDateForDisplay(new Date(task.dueDateTime), task.isAllDay)}
                {!task.isAllDay && ` ${format(new Date(task.dueDateTime), "h:mm a")}`}
              </div>
            )}
            <div className="flex flex-wrap gap-1 min-w-0 flex-1">
              {/* Labels render as their own chips, board columns as columns —
                  neither belongs in the list-membership row (task 60f5849d). */}
              {labels.map((label) => (
                <div
                  key={label.id}
                  className="flex items-center rounded-full px-2 py-0 text-xs"
                  style={{ backgroundColor: `${label.color}25`, color: label.color }}
                >
                  <span className="truncate">{label.name}</span>
                </div>
              ))}
              {domainLists.length > 0 && (
                <>
                  {domainLists.slice(0, isMobile ? 2 : undefined).map((list) => (
                    <div
                      key={list.id}
                      className="flex items-center space-x-1 rounded px-1.5 py-0 text-xs"
                      style={{ backgroundColor: `${list.color}15` }}
                    >
                      <ListGlyph list={list} className={`w-3 h-3 ${isMobile ? 'flex-shrink-0' : ''}`} />
                      <span className={`theme-text-secondary ${isMobile ? 'truncate' : ''}`}>{list.name}</span>
                    </div>
                  ))}
                  {isMobile && domainLists.length > 2 && (
                    <span className="text-xs theme-text-muted">+{domainLists.length - 2}</span>
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
