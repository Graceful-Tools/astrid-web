"use client"

import React from "react"
import { createPortal } from "react-dom"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { TaskCheckbox } from "@/components/task-checkbox"
import { useTranslations } from "@/lib/i18n/client"
import {
  getPriorityColor,
  leadingControlConfirmsCompletion,
  leadingControlOpensOptions,
  taskLeadingControlKind,
  type TaskLeadingControlSurface,
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
 * IN TASK DETAILS someone else's avatar is tappable even in list mode (task
 * 43bcc76c), because there the control is the ONLY completion affordance and an
 * inert photo meant their task could not be completed at all. It asks first —
 * the row's objection to finishing another person's work on a stray tap still
 * stands, and the confirmation is what answers it.
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
  /**
   * Is this task's list part of a project board (task 036ef139)?
   *
   * On a board the tap opens the options sheet whatever the display mode, so
   * the board's states are reachable from the row. Absent means no board,
   * which is every call site that predates the task.
   */
  onBoard?: boolean
  /**
   * Which surface is rendering this. Absent means a row, so every call site
   * that predates task 43bcc76c keeps today's behaviour.
   */
  surface?: TaskLeadingControlSurface
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
  surface,
}: TaskLeadingControlProps) {
  const { t } = useTranslations()
  const [confirmingComplete, setConfirmingComplete] = React.useState(false)
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
  const opensOptions =
    leadingControlOpensOptions({ displayMode, onBoard }) && Boolean(onOpenOptions)
  const effectiveMode = compactMark ? 'project' : 'list'
  const kind = taskLeadingControlKind({
    assigneeId,
    currentUserId,
    completed,
    displayMode: effectiveMode,
  })
  const activate = opensOptions ? onOpenOptions! : onToggleComplete

  // Someone else's task, in details, in list mode: the one case where the
  // avatar has to do something and completing outright is not it.
  const confirmsCompletion = leadingControlConfirmsCompletion({
    kind,
    opensOptions,
    surface,
  })

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
    // Tappable in project mode, where it opens the options sheet, and in task
    // DETAILS, where it asks to confirm completion (task 43bcc76c). On a ROW in
    // list mode it stays inert: completing another person's task from the row
    // was never an affordance and still is not.
    const tappable = opensOptions || confirmsCompletion
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
                'aria-label': confirmsCompletion
                  ? t('tasks.completeTask')
                  : t('tasks.taskOptions'),
                onClick: (e: React.MouseEvent) => {
                  e.stopPropagation()
                  if (confirmsCompletion) setConfirmingComplete(true)
                  else activate()
                },
                onKeyDown: (e: React.KeyboardEvent) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    e.stopPropagation()
                    if (confirmsCompletion) setConfirmingComplete(true)
                    else activate()
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
        {confirmingComplete && (
          <CompletionConfirmation
            assigneeLabel={assignee?.name || assignee?.email || ''}
            onCancel={() => setConfirmingComplete(false)}
            onConfirm={() => {
              setConfirmingComplete(false)
              onToggleComplete()
            }}
          />
        )}
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

/**
 * "Complete this task?" — the confirmation behind someone else's avatar in task
 * details (task 43bcc76c).
 *
 * Portalled to the body for the same reason the options sheet is
 * (components/priority-assignee-picker.tsx): the leading control sits inside a
 * task-detail panel that scrolls and clips, and a confirmation that can be cut
 * off by its own container is worse than none.
 *
 * It names the assignee. A dialog asking whether to complete "this task" over
 * an unlabelled photo is exactly the blind confirmation that trains people to
 * accept without reading.
 */
function CompletionConfirmation({
  assigneeLabel,
  onCancel,
  onConfirm,
}: {
  assigneeLabel: string
  onCancel: () => void
  onConfirm: () => void
}) {
  const { t } = useTranslations()

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      onClick={event => event.stopPropagation()}
    >
      <div
        className="absolute inset-0 bg-black/40"
        aria-hidden="true"
        onClick={onCancel}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-xs rounded-2xl bg-white p-4 shadow-xl dark:bg-gray-800"
      >
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {t('tasks.confirmCompleteTitle')}
        </p>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {t('tasks.confirmCompleteAssigned', { name: assigneeLabel })}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={onConfirm}>
            {t('common.complete')}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
