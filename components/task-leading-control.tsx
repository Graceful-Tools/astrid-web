"use client"

import React from "react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { TaskCheckbox } from "@/components/task-checkbox"
import { useTranslations } from "@/lib/i18n/client"
import {
  getPriorityColor,
  isSomeoneElsesTask,
  leadingControlOpensOptions,
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
 * changes, the action does not — unless the task is on a project BOARD (task
 * 036ef139), where the tap opens the options popover so the board's states are
 * reachable from the row. The mark is untouched there: still the checkbox.
 *
 * SOMEONE ELSE'S TASK opens that popover too, on every surface and in both
 * modes (AWTD-877). Their avatar used to be inert on a row and grew a bespoke
 * confirm-on-tap in details (task 43bcc76c), so one task behaved three ways
 * depending on where you met it — and the row, being the safe one, also
 * withheld reassign, reprioritise and move-column. The popover carries all of
 * those, cannot finish anyone's work by accident, and asks before completing.
 * The confirmation moved with the tap: it lives on the sheet's Complete button
 * now (components/completion-confirmation.tsx), not here.
 *
 * In PROJECT mode both change (task ffa5bbb5). Your own task wears your photo,
 * and tapping ANY of the three opens the options popover — priority, assignee,
 * board state, complete — instead of completing outright.
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
  /**
   * Is this task's list part of a project board (task 036ef139)?
   *
   * On a board the tap opens the options sheet whatever the display mode, so
   * the board's states are reachable from the row. Absent means no board,
   * which is every call site that predates the task.
   */
  onBoard?: boolean
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
  onBoard = false,
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
  //
  // The MARK and the ACTION are decided separately, and only on a board do they
  // disagree (task 036ef139): there the checkbox stays a checkbox — Jon asked
  // for "the checkbox when tapped" — while the tap opens the sheet.
  const compactMark = usesCompactTaskDetail(displayMode) && Boolean(onOpenOptions)
  const isSomeoneElses = isSomeoneElsesTask({ assigneeId, currentUserId })
  const effectiveMode = compactMark ? 'project' : 'list'
  // The MARK is decided first now, because the ACTION depends on it: a tap
  // completes a checkbox and nothing else (AWTD-919). These two lines used to
  // be the other way round, which is precisely how the "U" glyph ended up
  // completing the task it was drawn to distinguish.
  const kind = taskLeadingControlKind({
    assigneeId,
    currentUserId,
    completed,
    displayMode: effectiveMode,
  })
  const opensOptions =
    leadingControlOpensOptions({ displayMode, onBoard, isSomeoneElses, kind }) &&
    Boolean(onOpenOptions)
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
    // Tappable wherever the tap has a sheet to open — which, since AWTD-877, is
    // every surface for someone else's task. It stays INERT when the call site
    // passes no `onOpenOptions`: an avatar that silently completes another
    // person's work on a stray tap is the hazard this control has always
    // refused, and a mark that does nothing is the safer half of the trade.
    const tappable = opensOptions
    return (
      <>
        <div
          className={`relative p-2 -m-2 flex items-center justify-center self-center${
            tappable ? ' cursor-pointer' : ''
          }`}
          {...(tappable
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
      </>
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
