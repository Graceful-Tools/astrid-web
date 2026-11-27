"use client"

/**
 * One column on a board, for the list board and the project board alike
 * (ADEV-156): header (name, blurb, count or Done-since picker), a scrolling body
 * that windows its cards past the shared threshold, the quick-add bar and the
 * empty state. Sizing is the list board's, so both boards read the same.
 */
import { Pill } from "@/components/ui/pill"
import React from "react"
import { AstridEmptyState } from "@/components/ui/astrid-empty-state"
import { BoardColumnQuickAdd } from "@/components/board-column-quick-add"
import { BoardDoneSincePicker } from "@/components/board-done-since-picker"
import dynamic from "next/dynamic"
import { shouldVirtualizeTaskList } from "@/lib/virtualize-task-list"
import { boardColumnBlurb, boardColumnEmptyKey, boardColumnLabel } from "@/lib/board-column-labels"
import { empathyFrameSrc } from "@/lib/empathy-art/board"
import { useTranslations } from "@/lib/i18n/client"
import type { DoneSince } from "@/lib/board-done-since"
import type { ProjectBoardColumn } from "@/lib/project-status"
import type { CreateTaskOptions } from "@/hooks/task-manager/create-task-options"
import type { Task, TaskList, User } from "@/types/task"

// Only a column past the virtualize threshold needs the windowing primitive, so it loads on
// demand rather than joining the list route's first load through the board (ADEV-156).
const VirtualizedTaskList = dynamic(
  () => import("@/components/TaskManager/MainContent/VirtualizedTaskList").then(module => module.VirtualizedTaskList),
  { ssr: false, loading: () => null },
)

/**
 * Scrollable body for a single board column (task a48b2d24). Each column owns
 * its own vertical scroll container, so virtualization is wired per-column here.
 * Board DnD is column-level (drop changes status; there is no within-column
 * manual reorder), so windowing the cards is safe.
 */
function BoardColumnBody({
  tasks,
  renderCard,
  emptyState,
  className,
  testId,
}: {
  tasks: Task[]
  renderCard: (task: Task) => React.ReactNode
  emptyState: React.ReactNode
  className: string
  testId?: string
}) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const virtualize = shouldVirtualizeTaskList(tasks.length, false)

  return (
    <div ref={scrollRef} className={className} data-testid={testId}>
      {virtualize ? (
        <VirtualizedTaskList
          tasks={tasks}
          scrollElementRef={scrollRef}
          renderRow={renderCard}
          estimateSize={64}
          gap={8}
          testId="virtualized-board-column"
        />
      ) : (
        <div className="board-column-cards">
          {tasks.map(task => (
            <React.Fragment key={task.id}>{renderCard(task)}</React.Fragment>
          ))}
          {tasks.length === 0 ? emptyState : null}
        </div>
      )}
    </div>
  )
}

interface BoardColumnProps {
  column: ProjectBoardColumn
  tasks: Task[]
  /** The list the empty state and its empathy art are keyed on. */
  list?: Pick<TaskList, "id" | "name">
  renderCard: (task: Task) => React.ReactNode
  isOneColumn?: boolean
  testId?: string
  columnIndex?: number
  /** Shown above the header: the project board names the row's list here on a phone. */
  lead?: React.ReactNode
  headerTestId?: string
  /** Replaces the list board's fill-the-column body, e.g. a fixed-height cell. */
  bodyClassName?: string
  bodyTestId?: string
  /** Done only: the period control (ADEV-133). Absent, the header shows a plain count. */
  doneSince?: DoneSince
  onDoneSinceChange?: (next: DoneSince) => void
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void
  onDragOver?: (event: React.DragEvent<HTMLDivElement>) => void
  /** The quick-add bar's target; Done never has one. */
  quickAdd?: {
    listId: string | undefined
    lists: TaskList[]
    currentUser?: User | null
    onCreateTask: (title: string, options?: CreateTaskOptions) => Promise<string | null>
    testId?: string
  }
}

export function BoardColumn({
  column,
  tasks,
  list,
  renderCard,
  isOneColumn = false,
  testId,
  columnIndex,
  lead,
  headerTestId,
  bodyClassName = "board-column-body flex-1 overflow-y-auto scrollbar-hide",
  bodyTestId,
  doneSince,
  onDoneSinceChange,
  onDrop,
  onDragOver,
  quickAdd,
}: BoardColumnProps) {
  const { t } = useTranslations()
  const isDoneColumn = column.kind === "done"
  const blurb = boardColumnBlurb(column, t)

  return (
    <div
      data-testid={testId}
      data-column-index={columnIndex}
      data-column-kind={column.kind}
      className={`board-column flex h-full snap-start min-h-0 flex-col border theme-border theme-bg-secondary ${
        isOneColumn ? "w-full shrink-0" : "board-column-shared flex-1"
      }`}
      onDragOver={onDragOver ?? ((event) => event.preventDefault())}
      onDrop={onDrop}
    >
      {lead}
      <div
        className="flex min-h-18 shrink-0 items-start justify-between gap-2 border-b theme-border board-column-header"
        data-testid={headerTestId}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold theme-text-primary">{boardColumnLabel(column, t)}</span>
          </div>
          {blurb ? <p className="mt-1 line-clamp-2 text-xs theme-text-secondary">{blurb}</p> : null}
        </div>
        {isDoneColumn && doneSince && onDoneSinceChange ? (
          <BoardDoneSincePicker count={tasks.length} since={doneSince} onChange={onDoneSinceChange} />
        ) : (
          <Pill className="min-w-6 justify-center">{tasks.length}</Pill>
        )}
      </div>

      <BoardColumnBody
        tasks={tasks}
        className={bodyClassName}
        testId={bodyTestId}
        renderCard={renderCard}
        emptyState={(
          <AstridEmptyState
            listType="default"
            listName={list?.name}
            message={t(boardColumnEmptyKey(column))}
            characterSrc={empathyFrameSrc(list?.id, column, new Date())}
            className="board-column-empty py-4"
            artClassName="board-empty-art"
            bubblePaddingClassName="board-empty-bubble"
          />
        )}
      />

      {isDoneColumn || !quickAdd ? null : (
        <BoardColumnQuickAdd
          listId={quickAdd.listId}
          lists={quickAdd.lists}
          column={column}
          currentUser={quickAdd.currentUser}
          onCreateTask={quickAdd.onCreateTask}
          testId={quickAdd.testId}
        />
      )}
    </div>
  )
}
