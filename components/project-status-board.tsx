"use client"

import { scrollBehavior } from "@/lib/design/reduced-motion"
import React from "react"
import type { CreateTaskOptions } from "@/hooks/task-manager/create-task-options"
import { BoardCard } from "@/components/board-card"
import { BoardColumn } from "@/components/board-column"
import { sortTasksForList } from "@/lib/task-sort"
import { applyBoardLiveFilters, type BoardLiveFilters } from "@/lib/board-live-filters"
import { sortDoneColumnTasks } from "@/lib/board-done-column"
import { useDoneSince } from "@/hooks/use-done-since"
import { filterDoneSince } from "@/lib/board-done-since"
import {
  isTaskRecentlyCompleted,
  type RecentlyCompletedWindow,
} from "@/lib/recently-completed-window"
import type { Task, TaskList, User } from "@/types/task"
import {
  type ProjectBoardColumn,
  VIRTUAL_INBOX_COLUMN_ID,
  VIRTUAL_DONE_COLUMN_ID,
  getProjectBoardColumns,
  getProjectDomainTasks,
  getProjectIdForBoard,
  getTaskProjectColumnId,
  resolveProjectColumnMove,
} from "@/lib/project-status"
import { PriorityAssigneePicker } from "@/components/priority-assignee-picker"
import { useCompletionConfirmation } from "@/components/completion-confirmation"
import { isSomeoneElsesTask } from "@/lib/task-leading-control"
import { useProjectCustomStates } from "@/hooks/useProjectCustomStates"
import { useProjectFields } from "@/hooks/use-project-fields"
import { useProjectFieldValues } from "@/hooks/use-project-field-values"
import {
  githubBoardListFor,
  matchesProjectFieldFilter,
  projectFieldValuesOf,
  resolveProjectFieldFilter,
} from "@/lib/project-field-filter"

interface ProjectStatusBoardProps {
  allTasks: Task[]
  lists: TaskList[]
  selectedListId: string
  currentUser?: User | null
  onUpdateTask: (task: Task) => void
  onCopyTask?: (taskId: string, targetListId?: string, includeComments?: boolean) => Promise<void>
  onCreateTask: (title: string, options?: CreateTaskOptions) => Promise<string | null>
  isOneColumn?: boolean
  /**
   * Opens task details the way a list row does, at every width (AWTD-1653,
   * core DS30; AITD-679). The card passes itself as the anchor: a phone pushes
   * the full-screen view, a multi-column board floats the callout beside the
   * card (components/board-task-callout.tsx). A card never expands in place.
   */
  onOpenTask?: (taskId: string, anchor?: HTMLElement) => void
  /** The task whose details are open, so its card reads as selected like a row. */
  selectedTaskId?: string | null
  /**
   * The Sort & Filters currently set on the list (ADEV-145). Absent, the board
   * falls back to the list's saved sort and no extra filters.
   */
  liveFilters?: BoardLiveFilters & { sortBy?: string }
}

export function ProjectStatusBoard({
  allTasks,
  lists,
  selectedListId,
  currentUser,
  onUpdateTask,
  onCopyTask,
  onCreateTask,
  isOneColumn = false,
  onOpenTask,
  selectedTaskId = null,
  liveFilters,
}:ProjectStatusBoardProps) {
  const [optionsTaskId, setOptionsTaskId] = React.useState<string | null>(null)
  const completion = useCompletionConfirmation(currentUser?.id)

  const projectId = getProjectIdForBoard(lists, selectedListId)
  // Custom columns live on the project (task b346e377). Undefined while the
  // read is in flight, so the three defaults render immediately and the
  // customs join them when it lands.
  const customStates = useProjectCustomStates(projectId)
  const columns = React.useMemo<ProjectBoardColumn[]>(
    () => (projectId ? getProjectBoardColumns(customStates) : []),
    [projectId, customStates],
  )
  const selectedList = lists.find(list => list.id === selectedListId)
  const [doneSince, setDoneSince] = useDoneSince(currentUser?.id, selectedListId)

  // The caller's project-field filter (AWTD-1259). Only a GitHub board has
  // fields, and a stale value resolves to null, so it can never blank a board.
  const githubBoard = githubBoardListFor(lists, projectId)
  const { fields: fieldSchema } = useProjectFields(githubBoard ? projectId : null)
  const fieldFilter = React.useMemo(
    () => resolveProjectFieldFilter(selectedList?.filterProjectField, fieldSchema),
    [selectedList?.filterProjectField, fieldSchema],
  )
  const fieldValues = useProjectFieldValues(fieldFilter && githubBoard ? githubBoard.id : null)

  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const longPressTimerRef = React.useRef<number | null>(null)
  const touchDragRef = React.useRef<{ taskId: string; columnIndex: number; active: boolean } | null>(null)
  const suppressClickTaskIdRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    return () => {
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current)
      }
    }
  }, [])

  // Phone width opens on Inbox, not on Waiting at the leading edge (ADEV-132):
  // Waiting is what you scroll left to. Wide layouts start at the leading edge.
  // Once per board, so a later column change never yanks the carousel back.
  const openedOnInboxRef = React.useRef<string | null>(null)
  const hasColumns = columns.length > 0
  React.useLayoutEffect(() => {
    if (!isOneColumn || !projectId || !hasColumns) return
    if (openedOnInboxRef.current === projectId) return
    const container = scrollRef.current
    const inbox = container?.querySelector<HTMLElement>('[data-column-kind="inbox"]')
    if (!container || !inbox) return
    openedOnInboxRef.current = projectId
    inbox.scrollIntoView?.({ behavior: "auto", block: "nearest", inline: "start" })
  }, [isOneColumn, projectId, hasColumns])

  const boardTasks = React.useMemo(() => {
    if (!projectId) return []
    const projectTasks = getProjectDomainTasks(allTasks, lists, projectId)

    // The board always shows the selected list's tasks (the list is the
    // management entity). Narrow the project's domain tasks to the selected
    // domain list; status lists fall back to the full project set.
    const isDomainListSelected =
      selectedList?.projectId === projectId && selectedList.listType !== "status"
    const scoped = isDomainListSelected && selectedList
      ? projectTasks.filter(task => task.lists?.some(l => l.id === selectedList.id))
      : projectTasks

    // Drop completed tasks that fall outside the list's "Recently completed"
    // window (null → legacy 24h default). The virtual Done column is the
    // unbounded one — this is the bounded view of it. Incomplete tasks (which
    // populate Inbox / Ready / Doing / Waiting) always show.
    const window = (selectedList?.recentlyCompletedWindow ?? null) as RecentlyCompletedWindow | null
    const now = new Date()
    const trimmed = scoped.filter(task =>
      (!task.completed || isTaskRecentlyCompleted(task, window, now)) &&
      // Applied once the values are in; until then the board shows unfiltered.
      (!fieldValues || matchesProjectFieldFilter(projectFieldValuesOf(task, fieldValues), fieldFilter)),
    )

    const sortBy = selectedList?.sortBy || 'auto'
    const manualOrder = Array.isArray((selectedList as TaskList | undefined)?.manualSortOrder)
      ? ((selectedList as TaskList).manualSortOrder as unknown as string[]).filter(
          (id): id is string => typeof id === 'string',
        )
      : undefined

    return sortTasksForList(applyBoardLiveFilters(trimmed, liveFilters), liveFilters?.sortBy || sortBy, manualOrder)
  }, [allTasks, lists, projectId, selectedList, fieldFilter, fieldValues, liveFilters])

  if (!projectId || columns.length === 0) {
    return null
  }

  const defaultDomainList = selectedList?.projectId === projectId && selectedList.listType !== "status"
    ? selectedList
    : lists.find(list => list.projectId === projectId && list.listType !== "status")

  const scrollToColumn = (index: number) => {
    const nextIndex = Math.max(0, Math.min(columns.length - 1, index))
    const container = scrollRef.current
    const column = container?.querySelector<HTMLElement>(`[data-column-index="${nextIndex}"]`)
    column?.scrollIntoView({ behavior: scrollBehavior(), block: "nearest", inline: "center" })
  }

  const moveTaskToColumn = (taskId: string, column: ProjectBoardColumn) => {
    const task = boardTasks.find(candidate => candidate.id === taskId)
    if (!task) return
    // Every move lands here — a drop, a touch drag, the sheet's state — so Done
    // asks once for all of them when the task is not yours (ADEV-71). Nothing
    // moves until the answer: a cancelled drop leaves the card in its column.
    completion.requestColumnMove(task, column, () => applyMove(task, column))
  }

  const applyMove = (task: Task, column: ProjectBoardColumn) => {
    const result = resolveProjectColumnMove(task, column, lists)
    const listById = new Map(lists.map(list => [list.id, list]))
    const nextLists = result.listIds
      .map(listId => listById.get(listId))
      .filter((list): list is TaskList => Boolean(list))

    onUpdateTask({
      ...task,
      completed: result.completed,
      lists: nextLists,
      // Status is a state on the task (AWTD-562). Written alongside the list
      // membership so web is authoritative while iOS still reads the list.
      statusRole: result.statusRole,
    } as typeof task)
  }

  const handleDrop = (event: React.DragEvent<HTMLDivElement>, column: ProjectBoardColumn) => {
    event.preventDefault()
    const taskId = event.dataTransfer.getData("text/plain")
    moveTaskToColumn(taskId, column)
  }

  const clearLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLElement>, taskId: string, columnIndex: number) => {
    if (!isOneColumn || event.pointerType === "mouse") return

    clearLongPress()
    const target = event.currentTarget
    const pointerId = event.pointerId
    touchDragRef.current = { taskId, columnIndex, active: false }
    longPressTimerRef.current = window.setTimeout(() => {
      touchDragRef.current = { taskId, columnIndex, active: true }
      suppressClickTaskIdRef.current = taskId
      target.setPointerCapture(pointerId)
    }, 280)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const drag = touchDragRef.current
    if (!drag) return

    if (!drag.active) {
      return
    }

    event.preventDefault()
    const edgeSize = 54
    const viewportWidth = window.innerWidth
    if (event.clientX < edgeSize && drag.columnIndex > 0) {
      const nextIndex = drag.columnIndex - 1
      touchDragRef.current = { ...drag, columnIndex: nextIndex }
      scrollToColumn(nextIndex)
    } else if (event.clientX > viewportWidth - edgeSize && drag.columnIndex < columns.length - 1) {
      const nextIndex = drag.columnIndex + 1
      touchDragRef.current = { ...drag, columnIndex: nextIndex }
      scrollToColumn(nextIndex)
    }
  }

  const handlePointerEnd = () => {
    clearLongPress()
    const drag = touchDragRef.current
    touchDragRef.current = null
    if (!drag?.active) return

    const targetColumn = columns[drag.columnIndex]
    if (targetColumn) {
      moveTaskToColumn(drag.taskId, targetColumn)
    }

    window.setTimeout(() => {
      if (suppressClickTaskIdRef.current === drag.taskId) {
        suppressClickTaskIdRef.current = null
      }
    }, 0)
  }

  // A card opens task details exactly as a list row does — the same handler,
  // the same detail view — and never expands in place (core DS30, AWTD-1653,
  // AITD-679). Where the details appear is the layout's call, not the board's.
  const activateCard = (taskId: string, card: HTMLElement) => {
    onOpenTask?.(taskId, card)
  }

  const columnTestId = (column: ProjectBoardColumn) => {
    if (column.id === VIRTUAL_INBOX_COLUMN_ID) return 'status-column-inbox'
    if (column.id === VIRTUAL_DONE_COLUMN_ID) return 'status-column-done'
    // A status column's id IS its role, so this reads `status-column-ready`
    // the way it always has. It used to prefer `statusList.statusRole` — but
    // nothing has assigned `statusList` since the status rows were deleted, so
    // that branch was already unreachable, and AWTD-853 retired the field.
    return `status-column-${column.id}`
  }

  return (
    <div className="flex h-full flex-col">
      {/* Board status management lives in the list-settings "Statuses" tab. */}
      <div
        ref={scrollRef}
        className={`flex-1 min-h-0 overflow-x-auto overflow-y-hidden scrollbar-hide px-4 pb-6 pt-4 ${isOneColumn ? "snap-x snap-mandatory scroll-px-4 overscroll-x-contain" : ""}`}
        data-testid="project-status-board"
        data-board-callout-viewport
      >
        {/*
          One-column (mobile) is a snap carousel, and its columns are sized from
          the SCROLLER, never from the viewport (AWTD-1305). `min-w-max` plus a
          `calc(100vw - 2rem)` column made the column's width a promise about
          the viewport that only held while the board happened to span it — and
          a column wider than the snapport is, per the scroll-snap spec, a snap
          area the scrollport can sit anywhere inside. The board then rests
          off-centre, by exactly the overflow. Letting the row stay at the
          scroller's width and each column fill it makes area and snapport equal
          whatever the shell does.
        */}
        <div className={`flex h-full gap-3 ${isOneColumn ? "" : "w-full"}`}>
        {columns.map((column, columnIndex) => {
          const isDoneColumn = column.kind === 'done'
          const inColumn = boardTasks.filter(task =>
            getTaskProjectColumnId(task, columns) === column.id
          )
          // Done is newest-completed first whatever the list's sort — the
          // same on every client (lib/board-done-column.ts).
          // The period filters the cards as well as the count (ADEV-133).
          const tasksForColumn = isDoneColumn ? sortDoneColumnTasks(filterDoneSince(inColumn, doneSince)) : inColumn

          return (
            <BoardColumn
              key={column.id}
              column={column}
              columnIndex={columnIndex}
              testId={columnTestId(column)}
              isOneColumn={isOneColumn}
              tasks={tasksForColumn}
              list={selectedList}
              doneSince={doneSince}
              onDoneSinceChange={setDoneSince}
              onDrop={(event) => handleDrop(event, column)}
              quickAdd={{
                listId: defaultDomainList?.id,
                lists,
                currentUser,
                onCreateTask,
                testId: `status-add-${column.id}`,
              }}
              renderCard={(task) => (
                <BoardCard
                  task={task}
                  lists={lists}
                  testId={`status-card-${task.id}`}
                  currentUserId={currentUser?.id}
                  currentListId={selectedListId}
                  isSelected={selectedTaskId === task.id}
                  isMobile={isOneColumn}
                  isDone={isDoneColumn}
                  onActivate={activateCard}
                  onToggleComplete={() => onUpdateTask({ ...task, completed: !task.completed })}
                  onCopyPublic={async () => {
                    if (onCopyTask) await onCopyTask(task.id)
                  }}
                  onPointerDown={(event) => handlePointerDown(event, task.id, columnIndex)}
                  onPointerMove={handlePointerMove}
                  onPointerEnd={handlePointerEnd}
                  consumeSuppressedClick={(taskId) => {
                    if (suppressClickTaskIdRef.current !== taskId) return false
                    suppressClickTaskIdRef.current = null
                    return true
                  }}
                  /* Someone else's card opens the sheet (AWTD-877) —
                     it is the only route to reassign, reprioritise or
                     move it, and to a completion that asks first. An
                     unassigned card's "U" asks before completing in the
                     control itself (ADEV-56). */
                  onOpenOptions={
                    isSomeoneElsesTask({
                      assigneeId: task.assigneeId,
                      currentUserId: currentUser?.id,
                    })
                      ? () => setOptionsTaskId(task.id)
                      : undefined
                  }
                />
              )}
            />
          )
        })}
        </div>
      </div>

      {/* The leading control on someone else's card opens this instead of
          completing the task (AWTD-877; the project layout that also opened
          it, task ffa5bbb5, left web in ADEV-56).

          THE BOARD PASSES ITS OWN COLUMNS, which is the whole reason this is
          wired separately from the list rows. getProjectBoardColumns carries
          the project's CUSTOM states and the list ids that back the defaults —
          "custom states if relevant", in Jon's words. A list row has no project
          and gets the plain trio; here they finally appear.

          Selection routes through moveTaskToColumn, the same function
          drag-and-drop uses, so a state set from the sheet and a card dragged
          into a column cannot disagree about what the move means. */}
      {optionsTaskId && (() => {
        const task = boardTasks.find(candidate => candidate.id === optionsTaskId)
        if (!task) return null
        return (
          <PriorityAssigneePicker
            isOpen
            onClose={() => setOptionsTaskId(null)}
            onSelect={(priority, assignee) => {
              onUpdateTask({
                ...task,
                priority: priority as Task['priority'],
                assigneeId: assignee?.id ?? null,
                assignee: assignee ?? null,
              })
              setOptionsTaskId(null)
            }}
            selectedPriority={task.priority}
            selectedAssignee={task.assignee ?? null}
            assigneeId={task.assigneeId ?? null}
            unassign={{ task, apply: onUpdateTask }}
            availableUsers={[]}
            taskId={task.id}
            listIds={(task.lists || []).map(list => list.id)}
            currentUser={currentUser ?? undefined}
            statusColumns={columns}
            selectedColumnId={getTaskProjectColumnId(task, columns)}
            onStatusSelect={columnId => {
              const column = columns.find(candidate => candidate.id === columnId)
              if (column) moveTaskToColumn(task.id, column)
              setOptionsTaskId(null)
            }}
            completed={Boolean(task.completed)}
            repeating={task.repeating !== 'never'}
            onToggleComplete={() => {
              onUpdateTask({ ...task, completed: !task.completed })
              setOptionsTaskId(null)
            }}
          />
        )
      })()}
      {completion.dialog}
    </div>
  )
}
