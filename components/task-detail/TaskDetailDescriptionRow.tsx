"use client"

/**
 * The DESCRIPTION row in task details.
 *
 * Lifted verbatim out of `TaskFieldEditors` when the board-state row was added
 * (task 5221e43f): `tests/rules/oversized-files-ratchet.test.ts` budgets that
 * file and says, in as many words, to take the next piece out rather than raise
 * the number. This was the largest self-contained row left in it.
 *
 * Presentation only — the save and cancel handlers stay with the state they
 * mutate and arrive as props, so nothing about WHEN a description is written
 * moved with the markup.
 */
import { FileText as FileTextIcon } from "lucide-react"
import { TaskFieldRow } from "./TaskFieldRow"
import { useTranslations } from "@/lib/i18n/client"
import { renderMarkdownWithLinks } from "@/lib/markdown"
import type { Task } from "@/types/task"

interface TaskDetailDescriptionRowProps {
  task: Task
  readOnly: boolean
  editingDescription: boolean
  setEditingDescription: (value: boolean) => void
  tempDescription: string
  setTempDescription: (value: string) => void
  descriptionRef: React.RefObject<HTMLDivElement | null>
  descriptionTextareaRef: React.RefObject<HTMLTextAreaElement | null>
  handleSaveDescription: () => void
  handleCancelDescription: () => void
}

export function TaskDetailDescriptionRow({
  task,
  readOnly,
  editingDescription,
  setEditingDescription,
  tempDescription,
  setTempDescription,
  descriptionRef,
  descriptionTextareaRef,
  handleSaveDescription,
  handleCancelDescription,
}: TaskDetailDescriptionRowProps) {
  const { t } = useTranslations()

  return (
    <TaskFieldRow label={t('tasks.taskDescription')} icon={<FileTextIcon className="w-4 h-4" />} align="start">
      {editingDescription ? (
        <div ref={descriptionRef}>
          <textarea
            ref={descriptionTextareaRef}
            value={tempDescription}
            onChange={(e) => setTempDescription(e.target.value)}
            placeholder="Add a description..."
            className="w-full theme-comment-bg theme-border border theme-text-primary rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-base min-h-[80px] overflow-hidden"
            autoComplete="off"
            spellCheck={true}
            autoCapitalize="sentences"
            inputMode="text"
            enterKeyHint="done"
            onTouchStart={(e) => {
              // Track focus time for mobile keyboard protection
              const target = e.target as HTMLTextAreaElement
              ;(window as any)._lastFocusTime = Date.now()
              target.focus()
            }}
            onClick={(e) => {
              // Ensure click also triggers focus
              const target = e.target as HTMLTextAreaElement
              ;(window as any)._lastFocusTime = Date.now()
              target.focus()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (e.shiftKey || e.metaKey || e.ctrlKey) {
                  // Shift+Enter, Cmd/Ctrl + Enter: Add line break (default textarea behavior)
                  return
                } else {
                  // Plain Enter: Save description
                  e.preventDefault()
                  handleSaveDescription()
                }
              } else if (e.key === 'Escape') {
                handleCancelDescription()
              }
            }}
          />
          <div className="text-xs theme-text-muted mt-1">
            Press Enter to save • Shift+Enter for line breaks
          </div>
        </div>
      ) : (
        <div
          className={`px-3 py-2 rounded border border-transparent flex items-start !min-h-0 ${!readOnly ? 'cursor-pointer theme-surface-hover hover:theme-border' : ''}`}
          onClick={() => !readOnly && setEditingDescription(true)}
        >
          {task.description ? (
            <div
              // min-w-0: this is a flex child; without it the intrinsic width of
              // a code block stretches the row past the panel instead of letting
              // `.prose pre` scroll horizontally (task 61a21152).
              className="prose prose-sm max-w-none theme-text-primary min-w-0 flex-1"
              dangerouslySetInnerHTML={{
                __html: renderMarkdownWithLinks(task.description, { codeClass: 'theme-bg-tertiary px-1 rounded text-sm' })
              }}
            />
          ) : (
            <span className="theme-text-muted italic">Click to add a description...</span>
          )}
        </div>
      )}
    </TaskFieldRow>
  )
}
