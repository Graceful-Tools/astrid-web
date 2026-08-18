"use client"

import React from "react"
import { CheckCircle2, Inbox, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TaskDetail } from "@/components/task-detail"
import { canUserEditTask } from "@/lib/list-permissions"
import { TaskRowContent } from "@/components/task-row-content"
import { sortTasksForList } from "@/lib/task-sort"
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
import { usesCompactTaskDetail } from "@/lib/task-display-mode"
import { useUserSettings } from "@/hooks/useUserSettings"
import { useProjectCustomStates } from "@/hooks/useProjectCustomStates"
import { VirtualizedTaskList } from "@/components/TaskManager/MainContent/VirtualizedTaskList"
import { shouldVirtualizeTaskList } from "@/lib/virtualize-task-list"
import { useTranslations } from "@/lib/i18n/client"

interface ProjectStatusBoardProps {
  allTasks: Task[]
  lists: TaskList[]
  selectedListId: string
  currentUser?: User | null
  availableTasks?: Task[]
  onUpdateTask: (task: Task) => void
  onLocalUpdateTask?: (updatedTaskOrFn: Task | ((taskId: string, currentTask: Task) => Task)) => void
  onDeleteTask: (taskId: string) => void
  onCopyTask?: (taskId: string, targetListId?: string, includeComments?: boolean) => Promise<void>
  onCreateTask: (title: string, options?: { listIds?: string[] }) => Promise<string | null>
  isOneColumn?: boolean
}

/**
 * Scrollable body for a single board column (task a48b2d24). Each column owns
 * its own vertical scroll container, so virtualization is wired per-column here
 * (a hook can't live in the parent's `columns.map`). Above the shared threshold
 * the column windows its cards via the same primitive the list view uses; below
 * it — i.e. every normal board — the plain full render is kept, so there is zero
 * regression risk for the common case. Board DnD is column-level (drop changes
 * status; there is no within-column manual reorder), so windowing the cards is
 * safe — the drop target is the always-mounted column, not a specific row.
 */
function BoardColumnBody({
  tasks,
  renderCard,
  emptyState,
}: {
  tasks: Task[]
  renderCard: (task: Task) => React.ReactNode
  emptyState: React.ReactNode
}) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const virtualize = shouldVirtualizeTaskList(tasks.length, false)

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-hide p-2">
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
        <div className="space-y-2">
          {tasks.map(task => (
            <React.Fragment key={task.id}>{renderCard(task)}</React.Fragment>
          ))}
          {tasks.length === 0 ? emptyState : null}
        </div>
      )}
    </div>
  )
}

export function ProjectStatusBoard({
  allTasks,
  lists,
  selectedListId,
  currentUser,
  availableTasks,
  onUpdateTask,
  onLocalUpdateTask,
  onDeleteTask,
  onCopyTask,
  onCreateTask,
  isOneColumn = false,
}: ProjectStatusBoardProps) {
  const { t } = useTranslations()
  // One call for the whole board rather than one per row (task ffa5bbb5).
  const { taskDisplayMode } = useUserSettings()
  const compact = usesCompactTaskDetail(taskDisplayMode)
  const [optionsTaskId, setOptionsTaskId] = React.useState<string | null>(null)

  const projectId = getProjectIdForBoard(lists, selectedListId)
  // Custom columns live on the project (task b346e377). Undefined while the
  // read is in flight, which keeps the legacy list-backed columns rendering
  // rather than blinking them out on every load.
  const customStates = useProjectCustomStates(projectId)
  const columns = React.useMemo<ProjectBoardColumn[]>(
    () => (projectId ? getProjectBoardColumns(lists, projectId, customStates) : []),
    [lists, projectId, customStates],
  )
  const selectedList = lists.find(list => list.id === selectedListId)
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const longPressTimerRef = React.useRef<number | null>(null)
  const touchDragRef = React.useRef<{ taskId: string; columnIndex: number; active: boolean } | null>(null)
  const suppressClickTaskIdRef = React.useRef<string | null>(null)
  const [drafts, setDrafts] = React.useState<Record<string, string>>({})
  const [creatingColumnId, setCreatingColumnId] = React.useState<string | null>(null)
  const [expandedTaskId, setExpandedTaskId] = React.useState<string | null>(null)

  React.useEffect(() => {
    return () => {
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current)
      }
    }
  }, [])

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
      !task.completed || isTaskRecentlyCompleted(task, window, now),
    )

    const sortBy = selectedList?.sortBy || 'auto'
    const manualOrder = Array.isArray((selectedList as TaskList | undefined)?.manualSortOrder)
      ? ((selectedList as TaskList).manualSortOrder as unknown as string[]).filter(
          (id): id is string => typeof id === 'string',
        )
      : undefined

    return sortTasksForList(trimmed, sortBy, manualOrder)
  }, [allTasks, lists, projectId, selectedList])

  React.useEffect(() => {
    if (expandedTaskId && !boardTasks.some(task => task.id === expandedTaskId)) {
      setExpandedTaskId(null)
    }
  }, [boardTasks, expandedTaskId])

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
    column?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" })
  }

  const moveTaskToColumn = (taskId: string, column: ProjectBoardColumn) => {
    const task = boardTasks.find(candidate => candidate.id === taskId)
    if (!task) return

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

  const handleCreateTask = async (event: React.FormEvent<HTMLFormElement>, column: ProjectBoardColumn) => {
    event.preventDefault()
    const title = drafts[column.id]?.trim()
    if (!title) return

    setCreatingColumnId(column.id)
    try {
      const listIds = [
        defaultDomainList?.id,
        column.kind === 'status' ? column.id : undefined,
      ].filter((id): id is string => Boolean(id))
      await onCreateTask(title, { listIds: listIds.length > 0 ? listIds : undefined })
      setDrafts(prev => ({ ...prev, [column.id]: "" }))
    } finally {
      setCreatingColumnId(null)
    }
  }

  const toggleExpandedTask = (taskId: string) => {
    setExpandedTaskId(prevTaskId => prevTaskId === taskId ? null : taskId)
  }

  const columnTestId = (column: ProjectBoardColumn) => {
    if (column.id === VIRTUAL_INBOX_COLUMN_ID) return 'status-column-inbox'
    if (column.id === VIRTUAL_DONE_COLUMN_ID) return 'status-column-done'
    const role = column.statusList?.statusRole
    return `status-column-${role || column.id}`
  }

  return (
    <div className="flex h-full flex-col">
      {/* Board status management lives in the list-settings "Statuses" tab. */}
      <div
        ref={scrollRef}
        className={`flex-1 min-h-0 overflow-x-auto overflow-y-hidden scrollbar-hide px-4 pb-6 pt-4 ${isOneColumn ? "snap-x snap-mandatory scroll-px-4 overscroll-x-contain" : ""}`}
        data-testid="project-status-board"
      >
        <div className={`flex h-full gap-3 ${isOneColumn ? "min-w-max" : "w-full"}`}>
        {columns.map((column, columnIndex) => {
          const tasksForColumn = boardTasks.filter(task =>
            getTaskProjectColumnId(task, lists, projectId) === column.id
          )
          const isDoneColumn = column.kind === 'done'
          const isInboxColumn = column.kind === 'inbox'

          return (
            <div
              key={column.id}
              data-testid={columnTestId(column)}
              data-column-index={columnIndex}
              className={`flex h-full snap-start flex-col rounded-lg border theme-border theme-bg-secondary ${
                isOneColumn
                  ? "w-[calc(100vw-2rem)] shrink-0"
                  : "min-w-[18rem] max-w-[28rem] flex-1"
              }`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => handleDrop(event, column)}
            >
              <div
                role="button"
                tabIndex={expandedTaskId ? 0 : -1}
                aria-label={expandedTaskId ? `Collapse expanded task in ${column.name}` : undefined}
                title={expandedTaskId ? "Tap to collapse" : undefined}
                onClick={() => {
                  if (expandedTaskId) setExpandedTaskId(null)
                }}
                onKeyDown={(event) => {
                  if (!expandedTaskId) return
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    setExpandedTaskId(null)
                  }
                }}
                className={`flex min-h-[4.5rem] items-start justify-between gap-2 border-b theme-border px-3 py-2 ${
                  expandedTaskId ? "cursor-pointer hover:theme-bg-hover" : ""
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold theme-text-primary">{column.name}</span>
                    {isDoneColumn ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden="true" />
                    ) : null}
                    {isInboxColumn ? (
                      <Inbox className="h-4 w-4 theme-text-muted" aria-hidden="true" />
                    ) : null}
                  </div>
                  {column.description ? (
                    <p className="mt-1 line-clamp-2 text-xs theme-text-secondary">{column.description}</p>
                  ) : null}
                </div>
                <span className="min-w-6 rounded-full theme-bg-hover px-2 py-0.5 text-center text-xs theme-text-secondary">
                  {tasksForColumn.length}
                </span>
              </div>

              <BoardColumnBody
                tasks={tasksForColumn}
                emptyState={(
                  <div className="flex min-h-28 items-center justify-center rounded-md border border-dashed theme-border px-3 text-center text-xs theme-text-muted">
                    Drop tasks here
                  </div>
                )}
                renderCard={(task) => {
                  const isExpanded = expandedTaskId === task.id
                  const taskList = task.lists.find(list => list.projectId === projectId && list.listType !== "status")
                    || task.lists[0]
                    || selectedList
                  const canEdit = currentUser && taskList ? canUserEditTask(currentUser, task, taskList) : true

                  const handleToggleComplete = () => {
                    onUpdateTask({ ...task, completed: !task.completed })
                  }
                  const handleCopyPublic = async () => {
                    if (onCopyTask) await onCopyTask(task.id)
                  }

                  if (isExpanded && currentUser) {
                    return (
                      <div
                        data-testid={`status-card-${task.id}`}
                        className="relative rounded-md ring-2 ring-blue-500/40"
                        onClick={(event) => event.stopPropagation()}
                        onDragStart={(event) => event.stopPropagation()}
                      >
                        <TaskDetail
                          task={task}
                          currentUser={currentUser}
                          displayMode={taskDisplayMode}
                          availableLists={lists}
                          availableTasks={availableTasks || boardTasks}
                          onUpdate={onUpdateTask}
                          onLocalUpdate={onLocalUpdateTask}
                          onDelete={onDeleteTask}
                          onClose={() => setExpandedTaskId(null)}
                          onCopy={onCopyTask}
                          readOnly={!canEdit}
                          inline
                          allowFullScreen
                        />
                      </div>
                    )
                  }

                  return (
                    <div
                      data-testid={`status-card-${task.id}`}
                      className={`task-row task-card transition-theme relative theme-surface theme-border cursor-grab ${
                        task.completed
                          ? "task-row-completed theme-bg-hover"
                          : "theme-surface-hover"
                      }`}
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move"
                        event.dataTransfer.setData("text/plain", task.id)
                      }}
                      onPointerDown={(event) => handlePointerDown(event, task.id, columnIndex)}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerEnd}
                      onPointerCancel={handlePointerEnd}
                      onClick={() => {
                        if (suppressClickTaskIdRef.current === task.id) {
                          suppressClickTaskIdRef.current = null
                          return
                        }
                        toggleExpandedTask(task.id)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault()
                          toggleExpandedTask(task.id)
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-expanded={isExpanded}
                    >
                      <TaskRowContent
                        task={task}
                        currentUserId={currentUser?.id}
                        isSelected={false}
                        isMobile={isOneColumn}
                        onToggleComplete={handleToggleComplete}
                        onCopyPublic={handleCopyPublic}
                        displayMode={taskDisplayMode}
                        onOpenOptions={compact ? () => setOptionsTaskId(task.id) : undefined}
                      />
                    </div>
                  )
                }}
              />

              {isDoneColumn ? null : (
                <form
                  className="flex shrink-0 items-center gap-2 border-t theme-border p-2"
                  onSubmit={(event) => handleCreateTask(event, column)}
                >
                  <Input
                    value={drafts[column.id] || ""}
                    onChange={(event) => setDrafts(prev => ({ ...prev, [column.id]: event.target.value }))}
                    placeholder={t("tasks.addTaskPlaceholder")}
                    className="h-9 min-w-0 theme-input theme-text-primary"
                    disabled={creatingColumnId === column.id}
                  />
                  <Button
                    type="submit"
                    size="sm"
                    className="h-9 w-9 shrink-0 p-0"
                    disabled={creatingColumnId === column.id || !(drafts[column.id] || "").trim()}
                    aria-label={`Add task to ${column.name}`}
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </form>
              )}
            </div>
          )
        })}
        </div>
      </div>

      {/* Project mode: the leading control on a card opens this instead of
          completing the task (task ffa5bbb5).

          THE BOARD PASSES ITS OWN COLUMNS, which is the whole reason this is
          wired separately from the list rows. getProjectBoardColumns carries
          the project's CUSTOM states and the list ids that back the defaults —
          "custom states if relevant", in Jon's words. A list row has no project
          and gets the plain trio; here they finally appear.

          Selection routes through moveTaskToColumn, the same function
          drag-and-drop uses, so a state set from the sheet and a card dragged
          into a column cannot disagree about what the move means. */}
      {compact && optionsTaskId && (() => {
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
            availableUsers={[]}
            taskId={task.id}
            listIds={(task.lists || []).map(list => list.id)}
            statusColumns={columns}
            selectedColumnId={getTaskProjectColumnId(task, lists, projectId)}
            onStatusSelect={columnId => {
              const column = columns.find(candidate => candidate.id === columnId)
              if (column) moveTaskToColumn(task.id, column)
              setOptionsTaskId(null)
            }}
            completed={Boolean(task.completed)}
            onToggleComplete={() => {
              onUpdateTask({ ...task, completed: !task.completed })
              setOptionsTaskId(null)
            }}
          />
        )
      })()}
    </div>
  )
}
