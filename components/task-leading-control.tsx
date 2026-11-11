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

/**
 * Priority-coloured square shared by the avatar and unassigned marks, at the
 * design token's size (`size.leading-control`, docs/specs/DESIGN_SYSTEM.md).
 */
const SQUARE_CLASS = "w-leading-control h-leading-control rounded-lg border-2 flex items-center justify-center"

/**
 * The repeat arrows as the BORDER of a photo or "U" mark (AWTD-1571).
 *
 * Your own repeating task already swaps its checkbox for the arrows icon; a
 * repeating task assigned to someone else or to nobody drew the plain square, so
 * "repeats" was visible on one of the three marks only.
 *
 * The frame is the leading control's own size (AWTD-1576: at 40px the mark was
 * wider than every other leading control, so a repeating row's title sat further
 * right than a one-off's), and the photo or "U" fills it (AWTD-1579, iOS
 * AITD-612): it is the same rounded square as a one-off's mark, with the arrows
 * drawn where the plain priority outline would be. It used to be a 20px round
 * photo inside the checkbox's arrows bitmap, whose loop only has room for half
 * the square — a smaller face than every other row's. Both sizes are the design
 * tokens `size.repeat-frame-scale` and `size.repeat-frame-inner-scale`
 * (`.repeat-frame-arrows` / `.repeat-frame-mark` in styles/components.css).
 */
function RepeatFrame({ priority, children }: { priority: number; children: React.ReactNode }) {
  return (
    <div data-testid="repeat-frame" className="relative flex h-leading-control w-leading-control items-center justify-center">
      <div
        data-testid="repeat-frame-mark"
        className="repeat-frame-mark flex items-center justify-center overflow-hidden rounded-lg"
      >
        {children}
      </div>
      <RepeatArrowsBorder color={getPriorityColor(priority)} />
    </div>
  )
}

/**
 * The geometry of the arrows, in the 32-unit box of the leading control. The
 * shares are iOS's `RepeatFrameGeometry` (headLength 0.16, headHalfWidth 0.13 of
 * the control); the corner and the 2px line are the plain square's own
 * (`rounded-lg`, `border-2`), drawn inside the edge as that border is.
 */
const ARROWS_BOX = 32
const ARROWS_LINE = 2
const ARROWS_CORNER = 8
const ARROWS_HEAD_LENGTH = ARROWS_BOX * 0.16
const ARROWS_HEAD_HALF_WIDTH = ARROWS_BOX * 0.13

/**
 * The repeat arrows drawn round a rounded square: two brackets, each ending in
 * an arrowhead halfway along the top or bottom edge, rotationally symmetric like
 * `check_box_repeat_<p>.png`. Drawn rather than the bitmap so they can follow
 * the edge of a full-size photo (iOS `RepeatArrowsBorder`).
 */
function RepeatArrowsBorder({ color }: { color: string }) {
  const inset = ARROWS_LINE / 2
  const far = ARROWS_BOX - inset
  const radius = ARROWS_CORNER - inset
  const middle = ARROWS_BOX / 2
  // The left bracket: from the bottom edge, round the left side, along the top to the middle.
  const bracket = [
    `M ${ARROWS_CORNER} ${far}`,
    `A ${radius} ${radius} 0 0 1 ${inset} ${ARROWS_BOX - ARROWS_CORNER}`,
    `L ${inset} ${ARROWS_CORNER}`,
    `A ${radius} ${radius} 0 0 1 ${ARROWS_CORNER} ${inset}`,
    `L ${middle} ${inset}`,
  ].join(' ')
  // Its arrowhead, pointing right along the top edge.
  const head = [
    `${middle},${inset - ARROWS_HEAD_HALF_WIDTH}`,
    `${middle + ARROWS_HEAD_LENGTH},${inset}`,
    `${middle},${inset + ARROWS_HEAD_HALF_WIDTH}`,
  ].join(' ')
  const half = (
    <>
      <path d={bracket} fill="none" stroke="currentColor" strokeWidth={ARROWS_LINE} />
      <polygon points={head} fill="currentColor" />
    </>
  )
  return (
    <svg
      data-testid="repeat-frame-arrows"
      aria-hidden="true"
      viewBox={`0 0 ${ARROWS_BOX} ${ARROWS_BOX}`}
      className="repeat-frame-arrows pointer-events-none absolute overflow-visible"
      style={{ color }}
    >
      {half}
      {/* The right bracket is the same half turned half a turn about the centre. */}
      <g transform={`rotate(180 ${middle} ${middle})`}>{half}</g>
    </svg>
  )
}

/** Someone's photo, or their initials on the fallback, at whatever size the caller's class gives it. */
function AssigneePhoto({
  assignee,
  className,
  style,
}: {
  assignee: TaskLeadingControlProps['assignee']
  className: string
  style?: React.CSSProperties
}) {
  return (
    <Avatar className={className} style={style}>
      <AvatarImage src={assignee?.image || undefined} />
      <AvatarFallback className="text-xs bg-theme-active text-theme-secondary rounded-lg">
        {assignee?.name?.slice(0, 2) || assignee?.email?.slice(0, 2) || '?'}
      </AvatarFallback>
    </Avatar>
  )
}

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
        completes={!opensOptions}
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
          {repeating ? (
            <RepeatFrame priority={priority}>
              <AssigneePhoto assignee={assignee} className="h-full w-full rounded-lg" />
            </RepeatFrame>
          ) : (
            <AssigneePhoto assignee={assignee} className={SQUARE_CLASS} style={{ borderColor }} />
          )}
        </div>
      </>
    )
  }

  const unassignedMark = (
    <span className="text-sm font-medium" style={{ color: borderColor }}>
      {t('tasks.unassignedMark')}
    </span>
  )
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
      {repeating ? (
        <RepeatFrame priority={priority}>{unassignedMark}</RepeatFrame>
      ) : (
        <div className={SQUARE_CLASS} style={{ borderColor }}>{unassignedMark}</div>
      )}
    </div>
  )
}
