"use client"

/**
 * The one add-task input (Reuse Phase 2, task 5fac84e8; unified in f699462a).
 *
 * Callers import this and pick a variant; they never reach for a specific
 * implementation:
 *
 *   <AddTaskInput variant="inline" ... />   in the flow above the list (2- and 3-column)
 *   <AddTaskInput variant="footer" ... />   pinned to the bottom of the 1-column view
 *
 * Both variants now render the SAME control (components/quick-add.tsx) in two
 * placements. Task 5fac84e8 collapsed the seam to one component and one prop but
 * left two implementations behind it: a single-line input with `#list`
 * autocomplete for the desktop columns, and the expanding textarea with priority
 * and assignee pickers for the phone bar. That was two designs for one job, and
 * they drifted — the columns never got the pickers, the phone never got the
 * autocomplete. f699462a merged them: the control is the phone bar's design in
 * both places, it kept the autocomplete, and the create button grows an
 * "Add task" label where a column is wide enough for the words.
 *
 * `variant` survives because callers name a placement, not a component — the
 * distinction is real (one floats over the list, one does not) and one prop is
 * a smaller thing for a call site to know than a positioning strategy.
 */

import type { TaskList, User } from "../types/task"
import { QuickAdd } from "./quick-add"
import type { LayoutType } from "@/lib/quick-add"

export type AddTaskInputVariant = "inline" | "footer"
export type { LayoutType }

export interface AddTaskInputProps {
  variant: AddTaskInputVariant
  selectedListId: string
  availableLists: TaskList[]
  quickTaskInput: string
  setQuickTaskInput: (value: string) => void
  onCreateTask: (
    title: string,
    options?: { priority?: number; assigneeId?: string | null; navigateToDetail?: boolean },
  ) => Promise<string | null>
  onKeyDown: (e: React.KeyboardEvent) => void
  isSessionReady: boolean
  className?: string

  /** inline only — picks the contextual placeholder. */
  layoutType?: LayoutType
  /** Powers the assignee picker. */
  availableUsers?: User[]
  currentUser?: User
}

export function AddTaskInput({
  variant,
  layoutType,
  availableUsers,
  currentUser,
  ...shared
}: AddTaskInputProps) {
  return (
    <QuickAdd
      {...shared}
      placement={variant === "footer" ? "fixed-bottom" : "inline"}
      layoutType={variant === "footer" ? undefined : layoutType ?? "1-column"}
      availableUsers={availableUsers ?? []}
      currentUser={currentUser}
    />
  )
}
