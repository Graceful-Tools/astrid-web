"use client"

/**
 * The multi-list project board (AWTD-1660): each chosen list is a row, the
 * project's status columns stay columns, and a card dragged to another column
 * moves exactly as it does on a list's own board (`applyProjectColumnTo`, the
 * shared planner). A card opens in place, as on the wide single-list board.
 *
 * Rows are chosen per person and saved on the server
 * (`useProjectBoardRows`): drag a list from the sidebar onto the board, or use
 * Add list, and × on a row header removes it. Loaded lazily from
 * components/TaskManager/lazy-panels.tsx, so none of this is first-load JS.
 */
import React from "react"
import { CheckCircle2, Inbox, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { TaskRowContent } from "@/components/task-row-content"
import { TaskDetail } from "@/components/task-detail"
import { canUserEditTask } from "@/lib/list-permissions"
import { useUserSettings } from "@/hooks/useUserSettings"
import { useTranslations } from "@/lib/i18n/client"
import { useProjectCustomStates } from "@/hooks/useProjectCustomStates"
import { useProjectBoardRows } from "@/hooks/use-project-board-rows"
import { boardColumnLabel } from "@/lib/board-column-labels"
import { applyProjectColumnTo, getProjectBoardColumns, type ProjectBoardColumn } from "@/lib/project-status"
import {
  addBoardRow,
  boardRowCandidates,
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
  lists: TaskList[]
  allTasks: Task[]
  currentUser?: User | null
  onUpdateTask: (task: Task) => void
  onDeleteTask: (taskId: string) => void
}

export function ProjectBoard({
  projectId,
  projectName,
  lists,
  allTasks,
  currentUser,
  onUpdateTask,
  onDeleteTask,
}: ProjectBoardProps) {
  const { t } = useTranslations()
  const { taskDisplayMode } = useUserSettings()
  // The card open in place, keyed by row too: a card on two rows opens in one.
  const [expanded, setExpanded] = React.useState<string | null>(null)
  const customStates = useProjectCustomStates(projectId)
  const columns = React.useMemo(() => getProjectBoardColumns(customStates), [customStates])
  const { listIds, loaded, saveFailed, save } = useProjectBoardRows(projectId)
  const [isListDragOver, setIsListDragOver] = React.useState(false)

  const rows = React.useMemo(() => resolveBoardRows(listIds, projectId, lists), [listIds, projectId, lists])
  const rowIds = React.useMemo(() => rows.map(row => row.id), [rows])
  const lanes = React.useMemo(() => buildSwimlanes(rows, allTasks, columns), [rows, allTasks, columns])
  const candidates = React.useMemo(() => boardRowCandidates(lists, rowIds), [lists, rowIds])

  const addRow = (listId: string) => {
    if (!lists.some(list => list.id === listId)) return
    void save(addBoardRow(rowIds, listId))
  }
  const removeRow = (listId: string) => void save(removeBoardRow(rowIds, listId))

  const moveTask = (taskId: string, column: ProjectBoardColumn) => {
    const task = allTasks.find(candidate => candidate.id === taskId)
    if (task) applyProjectColumnTo(task, column.id, columns, lists, onUpdateTask)
  }

  const isListDrag = (event: React.DragEvent) => Array.from(event.dataTransfer.types).includes(PROJECT_BOARD_LIST_DRAG_TYPE)

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
      <div className="flex items-center justify-between gap-3 border-b theme-border px-4 py-4">
        <h1 className="truncate text-2xl font-semibold tracking-tight theme-text-primary">{projectName}</h1>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" data-testid="project-board-add-list">
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
              {t("projectMode.boardAddList")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
            {candidates.length === 0 ? (
              <DropdownMenuItem disabled>{t("projectMode.boardNoCandidates")}</DropdownMenuItem>
            ) : candidates.map(list => (
              <DropdownMenuItem key={list.id} onSelect={() => addRow(list.id)}>
                {list.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {saveFailed && (
        <p role="alert" className="px-4 pt-2 text-xs text-destructive">{t("projectMode.boardSaveFailed")}</p>
      )}

      <div className="flex-1 min-h-0 overflow-auto p-4">
        {loaded && lanes.length === 0 ? (
          <div className="flex min-h-28 items-center justify-center rounded-md border border-dashed theme-border px-3 text-center text-sm theme-text-muted">
            {t("projectMode.boardEmpty")}
          </div>
        ) : (
          <div className="inline-flex min-w-full flex-col gap-3">
            <div className="flex gap-3" role="row">
              <div className="w-48 shrink-0" />
              {columns.map(column => (
                <div key={column.id} className="flex min-w-64 flex-1 items-center gap-2 px-2 text-sm font-semibold theme-text-primary" role="columnheader">
                  <span className="truncate">{boardColumnLabel(column, t)}</span>
                  {column.kind === "done" && <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />}
                  {column.kind === "inbox" && <Inbox className="h-4 w-4 theme-text-muted" aria-hidden="true" />}
                </div>
              ))}
            </div>

            {lanes.map(lane => (
              <div key={lane.list.id} className="flex gap-3" role="row" data-testid={`project-board-row-${lane.list.id}`}>
                <div className="flex w-48 shrink-0 items-start justify-between gap-2 rounded-md border theme-border theme-bg-secondary px-3 py-2" role="rowheader">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold theme-text-primary">{lane.list.name}</div>
                    <div className="text-xs theme-text-muted">{lane.total}</div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 shrink-0 p-0 theme-text-muted hover:theme-text-primary"
                    aria-label={t("projectMode.boardRemoveRow", { name: lane.list.name })}
                    title={t("projectMode.boardRemoveRow", { name: lane.list.name })}
                    data-testid={`project-board-remove-${lane.list.id}`}
                    onClick={() => removeRow(lane.list.id)}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>

                {columns.map(column => (
                  <div
                    key={column.id}
                    className="board-column min-w-64 flex-1 space-y-2 rounded-md border theme-border theme-bg-secondary p-2"
                    data-testid={`project-board-cell-${lane.list.id}-${column.id}`}
                    onDragOver={(event) => {
                      if (!isListDrag(event)) event.preventDefault()
                    }}
                    onDrop={(event) => {
                      if (isListDrag(event)) return
                      event.preventDefault()
                      event.stopPropagation()
                      moveTask(event.dataTransfer.getData("text/plain"), column)
                    }}
                  >
                    {lane.cells[column.id]?.map(task => {
                      const key = `${lane.list.id}:${task.id}`
                      if (expanded === key && currentUser) {
                        return (
                          <div key={task.id} className="relative rounded-md ring-2 ring-brand/40" data-testid={`project-board-open-${task.id}`}>
                            <TaskDetail
                              task={task}
                              currentUser={currentUser}
                              displayMode={taskDisplayMode}
                              availableLists={lists}
                              availableTasks={allTasks}
                              onUpdate={onUpdateTask}
                              onDelete={onDeleteTask}
                              onClose={() => setExpanded(null)}
                              readOnly={!canUserEditTask(currentUser, task, lane.list)}
                              inline
                              allowFullScreen
                            />
                          </div>
                        )
                      }
                      const toggle = () => setExpanded(previous => (previous === key ? null : key))
                      return (
                        <div
                          key={task.id}
                          className={`task-row task-card board-card transition-theme relative theme-surface theme-border cursor-grab ${
                            task.completed ? "task-row-completed theme-bg-hover" : "theme-surface-hover"
                          }`}
                          draggable
                          role="button"
                          tabIndex={0}
                          aria-expanded={false}
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = "move"
                            event.dataTransfer.setData("text/plain", task.id)
                          }}
                          onClick={toggle}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault()
                              toggle()
                            }
                          }}
                        >
                          <TaskRowContent
                            task={task}
                            currentUserId={currentUser?.id}
                            onToggleComplete={() => onUpdateTask({ ...task, completed: !task.completed })}
                            onCopyPublic={() => {}}
                            displayMode={taskDisplayMode}
                            currentListId={lane.list.id}
                          />
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
