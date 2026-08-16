"use client"

import React from "react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { TaskCheckbox } from "@/components/task-checkbox"
import { useTranslations } from "@/lib/i18n/client"
import {
  getPriorityColor,
  taskLeadingControlKind,
} from "@/lib/task-leading-control"
import { usesCompactTaskDetail } from "@/lib/task-display-mode"

/**
 * The leading control on a task — one component for all three answers to
 * "whose task is this?" (task 2bb1b196, companion to iOS/Mac 42013da7).
 *
 * The task row, task details, view-only details and quick add all render this
 * rather than each deciding for itself, which is how unassigned came to look
 * identical to "mine" in some places and not others. The rule itself lives in
 * `lib/task-leading-control.ts`.
 *
 * In LIST mode, tapping any of the three marks completes the task: the mark
 * changes, the action does not.
 *
 * In PROJECT mode both change (task ffa5bbb5). Your own task wears your photo,
 * and tapping ANY of the three opens the options popover — priority, assignee,
 * board state, complete — instead of completing outright. Someone else's avatar
 * becomes tappable here, which it never was in list mode: the popover is the
 * only route to assignee and state, so leaving it inert would make another
 * person's task uneditable from the board.
 */
interface TaskLeadingControlProps {
  assigneeId?: string | null
  currentUserId?: string | null
  completed: boolean
  priority: number
  repeating?: boolean
  /** Only read for the 'avatar' kind. */
  assignee?: { name?: string | null; email?: string | null; image?: string | null } | null
  onToggleComplete: () => void
  /**
   * The user's task display mode. Absent means list, so every call site that
   * predates task ffa5bbb5 keeps today's behaviour untouched.
   */
  displayMode?: string | null
  /**
   * Open the options popover. Project mode only.
   *
   * Optional so a call site that has not been given a popover yet degrades to
   * completing rather than becoming a control that does nothing — a dead
   * control is a worse regression than one behaving like list mode.
   */
  onOpenOptions?: () => void
}

/** Priority-coloured square shared by the avatar and unassigned marks. */
const SQUARE_CLASS = "w-8 h-8 rounded-lg border-2 flex items-center justify-center"

export function TaskLeadingControl({
  assigneeId,
  currentUserId,
  completed,
  priority,
  repeating = false,
  assignee,
  onToggleComplete,
  displayMode,
  onOpenOptions,
}: TaskLeadingControlProps) {
  const { t } = useTranslations()
  const borderColor = getPriorityColor(priority)

  // Project mode needs somewhere for the tap to GO. Without a popover handler
  // it degrades to list mode wholesale — mark included, not just action.
  //
  // Falling back on the action alone was the first attempt and it produced a
  // DEAD CONTROL: the rule gave your own task an avatar, the avatar is only
  // clickable in project mode, and so nothing was tappable at all. Deciding the
  // effective mode once, here, is what keeps the mark and the action agreeing.
  const opensOptions = usesCompactTaskDetail(displayMode) && Boolean(onOpenOptions)
  const effectiveMode = opensOptions ? 'project' : 'list'
  const kind = taskLeadingControlKind({
    assigneeId,
    currentUserId,
    completed,
    displayMode: effectiveMode,
  })
  const activate = opensOptions ? onOpenOptions! : onToggleComplete

  if (kind === 'checkbox') {
    return (
      <TaskCheckbox
        checked={completed}
        onToggle={activate}
        priority={priority as 0 | 1 | 2 | 3}
        repeating={repeating}
      />
    )
  }

  if (kind === 'avatar') {
    // Someone else's task, or your own in project mode: a photo rather than a
    // checkbox you could mistake for your own.
    //
    // Clickable ONLY in project mode. In list mode completing another person's
    // task from the row was never an affordance and still is not.
    return (
      <div
        className={`relative p-2 -m-2 flex items-center justify-center self-center${
          opensOptions ? ' cursor-pointer' : ''
        }`}
        {...(opensOptions
          ? {
              role: 'button' as const,
              tabIndex: 0,
              'aria-label': t('tasks.taskOptions'),
              onClick: (e: React.MouseEvent) => {
                e.stopPropagation()
                activate()
              },
              onKeyDown: (e: React.KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  e.stopPropagation()
                  activate()
                }
              },
            }
          : {})}
      >
        <Avatar className={SQUARE_CLASS} style={{ borderColor }}>
          <AvatarImage src={assignee?.image || undefined} />
          <AvatarFallback className="text-xs bg-gray-300 text-gray-700 rounded-lg">
            {assignee?.name?.slice(0, 2) || assignee?.email?.slice(0, 2) || '?'}
          </AvatarFallback>
        </Avatar>
      </div>
    )
  }

  return (
    <div
      className="relative p-2 -m-2 cursor-pointer flex items-center justify-center self-center"
      role="button"
      tabIndex={0}
      aria-label={t('tasks.unassigned')}
      onClick={(e) => {
        e.stopPropagation()
        activate()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          e.stopPropagation()
          activate()
        }
      }}
    >
      <div className={SQUARE_CLASS} style={{ borderColor }}>
        <span className="text-sm font-medium" style={{ color: borderColor }}>
          {t('tasks.unassignedMark')}
        </span>
      </div>
    </div>
  )
}
