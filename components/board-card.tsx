"use client"

/**
 * One card on a board, for the list board and the project board alike (ADEV-156).
 * The two boards used to declare this markup twice and had drifted; what really
 * differs between them (touch drag on the list board, the row's list id on the
 * project board) arrives as props.
 */
import React from "react"
import { TaskRowContent } from "@/components/task-row-content"
import { BoardCompletedOnPill } from "@/components/board-completed-on-pill"
import { shouldShowTaskIdentifier } from "@/lib/task-identifier-links"
import type { Task, TaskList } from "@/types/task"

interface BoardCardProps {
  task: Task
  lists: TaskList[]
  currentUserId?: string
  /** The list the card is shown under: the board's list, or the project row's. */
  currentListId: string
  isSelected: boolean
  isMobile?: boolean
  isDone: boolean
  testId?: string
  /** A card opens task details as a list row does, anchored to itself (AITD-679). */
  onActivate: (taskId: string, card: HTMLElement) => void
  onToggleComplete: () => void
  onCopyPublic?: () => void | Promise<void>
  /** Set only for someone else's card: opens the options sheet (AWTD-877). */
  onOpenOptions?: () => void
  onPointerDown?: (event: React.PointerEvent<HTMLElement>) => void
  onPointerMove?: (event: React.PointerEvent<HTMLElement>) => void
  onPointerEnd?: () => void
  /** True when a long-press drag just ended on this card, so its click is swallowed. */
  consumeSuppressedClick?: (taskId: string) => boolean
}

export function BoardCard({
  task,
  lists,
  currentUserId,
  currentListId,
  isSelected,
  isMobile,
  isDone,
  testId,
  onActivate,
  onToggleComplete,
  onCopyPublic,
  onOpenOptions,
  onPointerDown,
  onPointerMove,
  onPointerEnd,
  consumeSuppressedClick,
}: BoardCardProps) {
  return (
    <div
      data-testid={testId}
      /* data-task-id, as on a list row: the details' click-outside close leaves a
       *  tap on another card to open that card, and the callout finds its anchor
       *  by it (AITD-679). */
      data-task-id={task.id}
      className={`task-row task-card board-card transition-theme relative theme-surface theme-border cursor-grab ${
        task.completed
          ? "task-row-completed theme-bg-hover"
          : isSelected
            ? "task-row-selected theme-bg-selected"
            : "theme-surface-hover"
      }`}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move"
        event.dataTransfer.setData("text/plain", task.id)
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onClick={(event) => {
        if (consumeSuppressedClick?.(task.id)) return
        onActivate(task.id, event.currentTarget)
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onActivate(task.id, event.currentTarget)
        }
      }}
      role="button"
      tabIndex={0}
      aria-haspopup="dialog"
    >
      <TaskRowContent
        task={task}
        currentUserId={currentUserId}
        isSelected={isSelected}
        isMobile={isMobile}
        onToggleComplete={onToggleComplete}
        onCopyPublic={onCopyPublic ?? (() => {})}
        identifier={shouldShowTaskIdentifier(task, "row-board", lists) ? task.identifier : null}
        currentListId={currentListId}
        belowTitle={isDone ? <BoardCompletedOnPill task={task} /> : null}
        onOpenOptions={onOpenOptions}
      />
    </div>
  )
}
