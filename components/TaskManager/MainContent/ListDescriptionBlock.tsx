"use client"

/**
 * The list description under the list's name: the inline editor, the search
 * banner that replaces it while searching, and the one-click preview that
 * opens the full view.
 *
 * Extracted from MainContent (AWTD-1175) because that file went past its
 * budget and the oversized-files ratchet asks for the next piece to come out
 * rather than the number to go up. This is a real seam — one block of state
 * about one field — and it is the sibling of DescriptionDialog, which owns the
 * modal this preview opens.
 *
 * Behaviour is unchanged from the inline version, including the two details
 * worth not losing: plain Enter saves while Shift/Cmd/Ctrl+Enter adds a line
 * break, and the preview shows the RAW text, since the rendered markdown is
 * what the dialog is for.
 */

import { Button } from "@/components/ui/button"
import { Check, X } from "lucide-react"
import type { TaskList } from "@/types/task"

export interface ListDescriptionBlockProps {
  list: TaskList
  editing: boolean
  draft: string
  onDraftChange: (value: string) => void
  onSave: () => void
  onCancel: () => void
  /** Starts the inline editor; only reached when the viewer may edit. */
  onEdit: (list: TaskList) => void
  /** Opens the full, rendered view. */
  onPreview: (description: string) => void
  canEdit: boolean
  /** The active search, already trimmed — non-empty replaces the description. */
  searchTerm: string
}

export function ListDescriptionBlock({
  list,
  editing,
  draft,
  onDraftChange,
  onSave,
  onCancel,
  onEdit,
  onPreview,
  canEdit,
  searchTerm,
}: ListDescriptionBlockProps) {
  if (editing) {
    return (
      <>
        <div className="flex items-start justify-start space-x-2 mt-2">
          <textarea
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                // Shift+Enter, Cmd/Ctrl+Enter: a line break. Plain Enter saves.
                if (e.shiftKey || e.metaKey || e.ctrlKey) return
                e.preventDefault()
                onSave()
              } else if (e.key === "Escape") {
                onCancel()
              }
            }}
            className="theme-comment-bg theme-border border theme-text-primary text-sm text-left max-w-md rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Add a description..."
            rows={2}
            autoFocus
          />
          <div className="flex flex-col space-y-1 mt-1">
            <Button size="sm" onClick={onSave} className="bg-blue-600 hover:bg-blue-700">
              <Check className="w-4 h-4" />
            </Button>
            <Button size="sm" variant="outline" onClick={onCancel}
                    className="theme-border theme-text-secondary hover:theme-bg-hover">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <div className="text-xs theme-text-muted mt-1 ml-0">
          Press Enter to save • Shift+Enter or Cmd/Ctrl+Enter for line breaks
        </div>
      </>
    )
  }

  if (searchTerm) {
    return (
      <div
        className="theme-text-muted text-sm text-left prose prose-sm max-w-none line-clamp-2 overflow-hidden"
        dangerouslySetInnerHTML={{
          __html: `Showing tasks matching "<strong>${searchTerm}</strong>" from all accessible lists`,
        }}
      />
    )
  }

  return (
    <div
      className="theme-text-muted text-sm text-left line-clamp-2 overflow-hidden whitespace-pre-wrap cursor-pointer hover:theme-text-secondary"
      onClick={() => {
        if (list.description) {
          onPreview(list.description)
        } else if (canEdit) {
          // No description and the viewer may add one: go straight to editing.
          onEdit(list)
        }
      }}
    >
      {list.description ? list.description : (canEdit ? "Add a description..." : "")}
    </div>
  )
}
