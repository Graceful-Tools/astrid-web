"use client"

/**
 * The multi-list project board (AWTD-1660): each chosen list is a row, the
 * project's status columns stay columns, and a card dragged to another column
 * moves exactly as it does on a list's own board (`applyProjectColumnTo`, the
 * shared planner). A card opens its details as a list row does, through
 * `onOpenTask` — beside the card as a callout, never in place (AITD-679).
 *
 * Each cell ends in the list board's add-task box (AWTD-1675). A new card joins
 * the cell's own row (its list) and its column's status, so "add here" means
 * here. Someone else's card opens the same options sheet as on a list board.
 *
 * Every row is the same height (ADEV-4): one fixed height, and each cell
 * scrolls its own cards inside it as a list board's column does, so a busy list
 * cannot stretch its row past the others. In one-column (mobile) mode the board
 * is the list board's snap carousel: each column header and cell is as wide as
 * the scroller and snaps to its start. A scroller-wide cell leaves no room for
 * the row-header column, so each cell names its row's list instead.
 *
 * The row header is a narrow card in its list's colour (ADEV-22): the list's
 * image, the name wrapped, and a count for every column. The column headers
 * stick to the top of the scroller so they stay visible on a long board.
 *
 * Rows are chosen per person and saved on the server
 * (`useProjectBoardRows`): drag a list from the sidebar onto the board, or use
 * Add list, and × on a row header removes it. Loaded lazily from
 * components/TaskManager/lazy-panels.tsx, so none of this is first-load JS.
 */
import React from "react"
import { Plus, Settings, X } from "lucide-react"
import { BoardCard } from "@/components/board-card"
import { BoardColumn } from "@/components/board-column"
import { useDoneSince } from "@/hooks/use-done-since"
import { filterDoneSince } from "@/lib/board-done-since"
import type { BoardLiveFilters } from "@/lib/board-live-filters"
import type { CreateTaskOptions } from "@/hooks/task-manager/create-task-options"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ProjectGoalsStrip } from "@/components/projects/ProjectGoalsStrip"
import { ProjectSettingsDialog } from "@/components/projects/ProjectSettingsDialog"
import { PriorityAssigneePicker } from "@/components/priority-assignee-picker"
import { useCompletionConfirmation } from "@/components/completion-confirmation"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { isSomeoneElsesTask } from "@/lib/task-leading-control"
import { useTranslations } from "@/lib/i18n/client"
import { useProjectCustomStates } from "@/hooks/useProjectCustomStates"
import { useProjectBoardRows } from "@/hooks/use-project-board-rows"
import {
  applyProjectColumnTo,
  getProjectBoardColumns,
  getTaskProjectColumnId,
  type ProjectBoardColumn,
} from "@/lib/project-status"
import {
  addBoardRow,
  boardRowCandidates,
  boardRowTextColor,
  buildSwimlanes,
  PROJECT_BOARD_LIST_DRAG_TYPE,
  readDraggedListId,
  removeBoardRow,
  resolveBoardRows,
} from "@/lib/project-board-rows"
import type { Task, TaskList, User } from "@/types/task"

export interface ProjectBoardProps {
  projectId: string
  projectName: string
  /** Owner or project admin: the board offers Project settings (ADEV-54). */
  canEditSettings?: boolean
  lists: TaskList[]
  allTasks: Task[]
  currentUser?: User | null
  onUpdateTask: (task: Task) => void
  onCreateTask: (title: string, options?: CreateTaskOptions) => Promise<string | null>
  /** Offered only where the person may create a list in this project (the sidebar's rule). */
  onCreateListInProject?: (name: string, projectId: string) => Promise<void> | void
  /** Opens a card's details as a list row does, anchored to the card (AITD-679). */
  onOpenTask?: (taskId: string, anchor?: HTMLElement) => void
  /** The task whose details are open, so its card reads as selected. */
  selectedTaskId?: string | null
  /** Phone width: the columns become a snap carousel, one at a time (ADEV-4). */
  isOneColumn?: boolean
  /** The Sort & Filters set on the view, applied to every row (ADEV-145, ADEV-156). */
  liveFilters?: BoardLiveFilters & { sortBy?: string }
}

export function ProjectBoard({
  projectId,
  projectName,
  canEditSettings = false,
  lists,
  allTasks,
  currentUser,
  onUpdateTask,
  onCreateTask,
  onCreateListInProject,
  onOpenTask,
  selectedTaskId = null,
  isOneColumn = false,
  liveFilters,
}: ProjectBoardProps) {
  const { t } = useTranslations()
  const [doneSince, setDoneSince] = useDoneSince(currentUser?.id, projectId)
  const customStates = useProjectCustomStates(projectId)
  const columns = React.useMemo(() => getProjectBoardColumns(customStates), [customStates])
  const { listIds, loaded, saveFailed, save } = useProjectBoardRows(projectId)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [isListDragOver, setIsListDragOver] = React.useState(false)
  const [newListName, setNewListName] = React.useState<string | null>(null)
  const [optionsTaskId, setOptionsTaskId] = React.useState<string | null>(null)

  const rows = React.useMemo(() => resolveBoardRows(listIds, projectId, lists), [listIds, projectId, lists])
  const rowIds = React.useMemo(() => rows.map(row => row.id), [rows])
  const lanes = React.useMemo(() => buildSwimlanes(rows, allTasks, columns, { liveFilters }), [rows, allTasks, columns, liveFilters])
  const candidates = React.useMemo(() => boardRowCandidates(lists, rowIds), [lists, rowIds])

  const addRow = (listId: string) => {
    if (!lists.some(list => list.id === listId)) return
    void save(addBoardRow(rowIds, listId))
  }
  const removeRow = (listId: string) => void save(removeBoardRow(rowIds, listId))

  // A drop or the sheet's state: Done asks first when the task is not yours,
  // and nothing moves until the answer (ADEV-71).
  const completion = useCompletionConfirmation(currentUser?.id)
  const moveTask = (taskId: string, column: ProjectBoardColumn) => {
    const task = allTasks.find(candidate => candidate.id === taskId)
    if (task) completion.requestColumnMove(task, column, () => applyProjectColumnTo(task, column.id, columns, lists, onUpdateTask))
  }

  const optionsTask = optionsTaskId ? allTasks.find(candidate => candidate.id === optionsTaskId) : undefined

  const isListDrag = (event: React.DragEvent) => Array.from(event.dataTransfer.types).includes(PROJECT_BOARD_LIST_DRAG_TYPE)

  // Overflow from a row inside the scroller does not count the scroller's end
  // padding, so without this the last column stops a padding short of its snap
  // point. The row's gap plus this quarter-rem is the scroller's 1rem padding.
  const snapTail = isOneColumn ? <div className="w-1 shrink-0" aria-hidden="true" /> : null

  const rowLabel = (lane: (typeof lanes)[number]) => {
    return (
      <>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {lane.list.imageUrl && (
            <img src={lane.list.imageUrl} alt="" className="h-6 w-6 shrink-0 rounded object-cover" />
          )}
          <div className="min-w-0 truncate text-sm font-semibold leading-tight">{lane.list.name}</div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 shrink-0 p-0 text-current opacity-80 hover:bg-black/10 hover:opacity-100"
          aria-label={t("projectMode.boardRemoveRow", { name: lane.list.name })}
          title={t("projectMode.boardRemoveRow", { name: lane.list.name })}
          data-testid={`project-board-remove-${lane.list.id}`}
          onClick={() => removeRow(lane.list.id)}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </>
    )
  }

  // The header card is the list's colour, with text chosen for contrast on it.
  const rowHeaderStyle = (lane: (typeof lanes)[number]): React.CSSProperties | undefined => {
    const color = lane.list.color
    const text = boardRowTextColor(color)
    return text ? { backgroundColor: color, color: text, borderColor: color } : undefined
  }

  return (
    <div
      className={`flex h-full min-w-0 flex-1 flex-col theme-bg-primary ${isListDragOver ? "ring-2 ring-inset ring-brand" : ""}`}
      data-testid="project-board"
      onDragOver={(event) => {
        if (!isListDrag(event)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = "copy"
        setIsListDragOver(true)
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setIsListDragOver(false)
      }}
      onDrop={(event) => {
        setIsListDragOver(false)
        const listId = readDraggedListId(event.dataTransfer)
        if (!listId) return
        event.preventDefault()
        addRow(listId)
      }}
    >
      {/* No project-name heading: TaskManagerHeader already names the project (ADEV-63). */}
      <div className="flex items-center justify-end gap-3 border-b theme-border px-4 py-3">
        <ProjectGoalsStrip projectId={projectId} />
        <div className="flex shrink-0 items-center gap-2">
        {canEditSettings && (
          <>
            <Button
              variant="outline"
              size="sm"
              aria-label={t("projectMode.boardSettings")}
              title={t("projectMode.boardSettings")}
              data-testid="project-board-settings"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings className="h-4 w-4" aria-hidden="true" />
            </Button>
            <ProjectSettingsDialog
              projectId={projectId}
              projectName={projectName}
              open={settingsOpen}
              onOpenChange={setSettingsOpen}
            />
          </>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              data-testid="project-board-add-list"
              disabled={candidates.length === 0 && !onCreateListInProject}
            >
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
              {t("projectMode.boardAddList")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
            {candidates.map(list => (
              <DropdownMenuItem key={list.id} onSelect={() => addRow(list.id)}>
                {list.name}
              </DropdownMenuItem>
            ))}
            {onCreateListInProject && (
              <DropdownMenuItem data-testid="project-board-new-list" onSelect={() => setNewListName("")}>
                {t("projectMode.boardNewList")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
      </div>

      {newListName !== null && onCreateListInProject && (
        <form
          className="border-b theme-border px-4 py-2"
          onSubmit={event => {
            event.preventDefault()
            const name = newListName.trim()
            if (!name) return
            setNewListName(null)
            void onCreateListInProject(name, projectId)
          }}
        >
          <Input
            autoFocus
            value={newListName}
            onChange={event => setNewListName(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Escape") setNewListName(null)
            }}
            placeholder={t("projectMode.newListName")}
            aria-label={t("projectMode.boardNewList")}
            data-testid="project-board-new-list-name"
            className="h-8 text-sm"
          />
        </form>
      )}

      {saveFailed && (
        <p role="alert" className="px-4 pt-2 text-xs text-destructive">{t("projectMode.boardSaveFailed")}</p>
      )}

      <div
        className={`flex-1 min-h-0 overflow-auto p-4 pt-0 ${isOneColumn ? "snap-x snap-mandatory scroll-px-4 overscroll-x-contain" : ""}`}
        data-testid="project-board-scroller"
        data-board-callout-viewport
      >
        {loaded && lanes.length === 0 ? (
          <div className="flex min-h-28 items-center justify-center rounded-md border border-dashed theme-border px-3 text-center text-sm theme-text-muted">
            {t("projectMode.boardEmpty")}
          </div>
        ) : (
          <div className={`${isOneColumn ? "flex" : "inline-flex min-w-full"} flex-col gap-3`}>
            {lanes.map(lane => (
              <div key={lane.list.id} className="flex flex-col gap-2" data-testid={`project-board-row-${lane.list.id}`}>
                {/* One row per list: a header strip, then the list's own board (ADEV-63). */}
                {!isOneColumn && (
                  <div
                    className="flex items-center justify-between gap-2 rounded-md border theme-border theme-bg-secondary px-2 py-1"
                    style={rowHeaderStyle(lane)}
                    role="rowheader"
                  >
                    {rowLabel(lane)}
                  </div>
                )}
                <div className="board-row flex" role="row">
                {columns.map(column => {
                  const cell = lane.cells[column.id] ?? []
                  // The period filters the cards as well as the count (ADEV-133).
                  const tasksForColumn = column.kind === "done" ? filterDoneSince(cell, doneSince) : cell
                  return (
                    <BoardColumn
                      key={column.id}
                      column={column}
                      tasks={tasksForColumn}
                      list={lane.list}
                      isOneColumn={isOneColumn}
                      testId={`project-board-cell-${lane.list.id}-${column.id}`}
                      headerTestId={`project-board-cell-header-${lane.list.id}-${column.id}`}
                      /* Fixed height, about 3–4 cards: the cards scroll inside it (ADEV-63). */
                      bodyClassName="board-column-body h-64 shrink-0 overflow-y-auto scrollbar-hide"
                      bodyTestId={`project-board-cell-body-${lane.list.id}-${column.id}`}
                      doneSince={doneSince}
                      onDoneSinceChange={setDoneSince}
                      lead={isOneColumn ? (
                        <div className="mb-2 flex shrink-0 items-start justify-between gap-2 rounded-md border theme-border px-2 py-1" style={rowHeaderStyle(lane)}>
                          {rowLabel(lane)}
                        </div>
                      ) : null}
                      onDragOver={(event) => {
                        if (!isListDrag(event)) event.preventDefault()
                      }}
                      onDrop={(event) => {
                        if (isListDrag(event)) return
                        event.preventDefault()
                        event.stopPropagation()
                        moveTask(event.dataTransfer.getData("text/plain"), column)
                      }}
                      quickAdd={{
                        listId: lane.list.id,
                        lists,
                        currentUser,
                        onCreateTask,
                        testId: `project-board-add-${lane.list.id}-${column.id}`,
                      }}
                      renderCard={(task) => (
                        <BoardCard
                          task={task}
                          lists={lists}
                          currentUserId={currentUser?.id}
                          currentListId={lane.list.id}
                          isSelected={selectedTaskId === task.id}
                          isDone={column.kind === "done"}
                          onActivate={(taskId, card) => onOpenTask?.(taskId, card)}
                          onToggleComplete={() => onUpdateTask({ ...task, completed: !task.completed })}
                          onOpenOptions={
                            isSomeoneElsesTask({ assigneeId: task.assigneeId, currentUserId: currentUser?.id })
                              ? () => setOptionsTaskId(task.id)
                              : undefined
                          }
                        />
                      )}
                    />
                  )
                })}
                {snapTail}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {optionsTask && (
        <PriorityAssigneePicker
          isOpen
          onClose={() => setOptionsTaskId(null)}
          onSelect={(priority, assignee) => {
            onUpdateTask({
              ...optionsTask,
              priority: priority as Task["priority"],
              assigneeId: assignee?.id ?? null,
              assignee: assignee ?? null,
            })
            setOptionsTaskId(null)
          }}
          selectedPriority={optionsTask.priority}
          selectedAssignee={optionsTask.assignee ?? null}
          assigneeId={optionsTask.assigneeId ?? null}
          unassign={{ task: optionsTask, apply: onUpdateTask }}
          availableUsers={[]}
          taskId={optionsTask.id}
          listIds={(optionsTask.lists || []).map(list => list.id)}
          currentUser={currentUser ?? undefined}
          statusColumns={columns}
          selectedColumnId={getTaskProjectColumnId(optionsTask, columns)}
          onStatusSelect={columnId => {
            const column = columns.find(candidate => candidate.id === columnId)
            if (column) moveTask(optionsTask.id, column)
            setOptionsTaskId(null)
          }}
          completed={Boolean(optionsTask.completed)}
          repeating={optionsTask.repeating !== 'never'}
          onToggleComplete={() => {
            onUpdateTask({ ...optionsTask, completed: !optionsTask.completed })
            setOptionsTaskId(null)
          }}
        />
      )}
      {completion.dialog}
    </div>
  )
}
