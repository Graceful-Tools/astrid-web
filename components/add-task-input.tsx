"use client"

/**
 * The one add-task input (Reuse Phase 2, task 5fac84e8).
 *
 * Callers import this and pick a variant; they never reach for a specific
 * implementation:
 *
 *   <AddTaskInput variant="inline" ... />   inline in the list header/body
 *   <AddTaskInput variant="footer" ... />   fixed to the bottom on phones
 *
 * WHY THE TWO IMPLEMENTATIONS SURVIVE BEHIND IT
 *
 * The task asked to collapse three components into one. quick-task-create was
 * dead and is gone. The remaining two are not stylistic variants of one input —
 * they render different controls:
 *
 *   inline (enhanced-task-creation) single-line <Input>, hashtag autocomplete
 *                                    over lists, layout-aware placeholder
 *   footer (mobile-quick-add)        auto-expanding <textarea>, priority picker,
 *                                    assignee picker, fixed bottom sheet
 *
 * Inlining both trees into one function body would produce a component that is
 * two components wearing a trenchcoat — larger, and easy to break one half while
 * editing the other. So the seam callers touch is collapsed to one component and
 * one prop, while each implementation keeps its own file. Adding a control to
 * both, or extracting their shared core later, now happens behind this surface
 * without touching a single call site.
 */

import type { TaskList, User } from "../types/task"
import { EnhancedTaskCreation, type LayoutType } from "./enhanced-task-creation"
import { MobileQuickAdd } from "./mobile-quick-add"

export type AddTaskInputVariant = "inline" | "footer"

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

  /** inline only — drives width, button text and the contextual placeholder. */
  layoutType?: LayoutType
  /** inline only. */
  isMobile?: boolean

  /** footer only — powers the assignee picker. */
  availableUsers?: User[]
  /** footer only. */
  currentUser?: User
}

export function AddTaskInput({
  variant,
  layoutType,
  isMobile,
  availableUsers,
  currentUser,
  ...shared
}: AddTaskInputProps) {
  if (variant === "footer") {
    return (
      <MobileQuickAdd
        {...shared}
        availableUsers={availableUsers ?? []}
        currentUser={currentUser}
      />
    )
  }

  return (
    <EnhancedTaskCreation
      {...shared}
      layoutType={layoutType ?? "1-column"}
      isMobile={isMobile ?? false}
    />
  )
}
