"use client"

/**
 * The add-a-task bar at the foot of a board column (ADEV-63): the same
 * add bar the list uses — checkbox with the priority/assignee picker, a
 * growing field, ⊕ to add and open — so a column is no longer a bare input
 * with a square "+". The card joins the column's status (a role, never a list
 * id, see resolveProjectColumnCreate) and the given list.
 */
import React from "react"
import { AddTaskInput } from "@/components/add-task-input"
import { resolveProjectColumnCreate, type ProjectBoardColumn } from "@/lib/project-status"
import type { CreateTaskOptions } from "@/hooks/task-manager/create-task-options"
import type { TaskList, User } from "@/types/task"

interface BoardColumnQuickAddProps {
  listId: string | undefined
  lists: TaskList[]
  column: ProjectBoardColumn
  currentUser?: User | null
  onCreateTask: (title: string, options?: CreateTaskOptions) => Promise<string | null>
  testId?: string
}

export function BoardColumnQuickAdd({ listId, lists, column, currentUser, onCreateTask, testId }: BoardColumnQuickAddProps) {
  const [draft, setDraft] = React.useState("")
  return (
    <div className="shrink-0 border-t theme-border p-2" data-testid={testId}>
      <AddTaskInput
        variant="inline"
        selectedListId={listId ?? ""}
        availableLists={lists}
        availableUsers={[]}
        currentUser={currentUser ?? undefined}
        quickTaskInput={draft}
        setQuickTaskInput={setDraft}
        onKeyDown={() => {}}
        isSessionReady
        placeholderKey="tasks.board.addTaskPlaceholder"
        onCreateTask={(title, options) =>
          onCreateTask(title, { ...options, ...resolveProjectColumnCreate(column, listId) })
        }
      />
    </div>
  )
}
