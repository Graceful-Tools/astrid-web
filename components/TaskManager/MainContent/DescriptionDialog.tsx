"use client"

import React from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FileText, Eye, Edit3, Bot, Check } from "lucide-react"
import { renderMarkdown } from "@/lib/markdown"
import type { TaskList } from "@/types/task"

/**
 * Imperative handle for opening the description dialog from the parent.
 */
export interface DescriptionDialogHandle {
  /** Open the dialog in view mode with the given description text. */
  open: (description: string) => void
}

interface DescriptionDialogProps {
  /** The list the dialog is operating on (reactive — title + save target). */
  currentList: TaskList | undefined
  /** Whether the current user can edit this list's settings. */
  canEditSettings: boolean
  /** Hide the edit affordances when viewing a featured/public list. */
  isViewingFromFeatured: boolean
  /** Mirror the saved description into the parent's inline-edit buffer. */
  setTempListDescription: (value: string) => void
  /** Persist an updated list back to the parent after a successful save. */
  onListUpdate: (updatedList: TaskList) => Promise<void>
}

/**
 * View/Edit dialog for a list's Agent Instructions (description). Owns its own
 * open/mode/draft state and is opened imperatively via a ref. Extracted from
 * MainContent.tsx (Stage 21) with no behavior change.
 */
export const DescriptionDialog = React.forwardRef<DescriptionDialogHandle, DescriptionDialogProps>(
  function DescriptionDialog(
    { currentList, canEditSettings, isViewingFromFeatured, setTempListDescription, onListUpdate },
    ref
  ) {
    const [showDescriptionDialog, setShowDescriptionDialog] = React.useState(false)
    const [descriptionDialogMode, setDescriptionDialogMode] = React.useState<'view' | 'edit'>('view')
    const [dialogDescription, setDialogDescription] = React.useState('')

    React.useImperativeHandle(ref, () => ({
      open: (description: string) => {
        setDialogDescription(description)
        setDescriptionDialogMode('view')
        setShowDescriptionDialog(true)
      },
    }), [])

    return (
      <Dialog open={showDescriptionDialog} onOpenChange={(open) => {
        if (!open) {
          setShowDescriptionDialog(false)
          setDescriptionDialogMode('view')
        }
      }}>
        <DialogContent className="theme-bg-primary theme-border sm:max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="theme-text-primary flex items-center space-x-2">
              <FileText className="w-5 h-5" />
              <span>List Description</span>
              {currentList && (
                <span className="text-sm font-normal theme-text-muted">— {currentList.name}</span>
              )}
            </DialogTitle>
          </DialogHeader>

          {/* Mode toggle */}
          {currentList && canEditSettings && !isViewingFromFeatured && (
            <div className="flex items-center space-x-1">
              <button
                type="button"
                onClick={() => setDescriptionDialogMode('view')}
                className={`text-xs px-2.5 py-1 rounded ${descriptionDialogMode === 'view' ? 'bg-blue-600 text-white' : 'theme-text-muted hover:theme-bg-hover'}`}
              >
                <Eye className="w-3 h-3 inline mr-1" />
                View
              </button>
              <button
                type="button"
                onClick={() => {
                  setDescriptionDialogMode('edit')
                  setDialogDescription(currentList.description || '')
                }}
                className={`text-xs px-2.5 py-1 rounded ${descriptionDialogMode === 'edit' ? 'bg-blue-600 text-white' : 'theme-text-muted hover:theme-bg-hover'}`}
              >
                <Edit3 className="w-3 h-3 inline mr-1" />
                Edit
              </button>
            </div>
          )}

          {/* Content */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {descriptionDialogMode === 'view' ? (
              <div
                className="prose prose-sm max-w-none theme-text-primary p-1"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(dialogDescription || '*No instructions yet*') }}
              />
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-end">
                  <span className="text-xs theme-text-muted">{dialogDescription.length} chars</span>
                </div>
                <textarea
                  value={dialogDescription}
                  onChange={(e) => setDialogDescription(e.target.value)}
                  placeholder={"Write instructions for AI agents working in this list...\n\nSupports markdown: **bold**, *italic*, ## headings, - lists, [links](url)"}
                  className="w-full theme-comment-bg theme-border border theme-text-primary rounded-lg px-3 py-2 resize-vertical focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm min-h-[200px]"
                  rows={12}
                  autoFocus
                />
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1 text-xs theme-text-muted">
                    <Bot className="w-3 h-3" />
                    <span>Agents receive this as their primary context. Supports markdown.</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setDescriptionDialogMode('view')}
                      className="text-xs theme-border theme-text-secondary hover:theme-bg-hover"
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={async () => {
                        // Save via the existing handler
                        setTempListDescription(dialogDescription)
                        // Directly call the save
                        if (currentList && dialogDescription !== (currentList.description || '')) {
                          try {
                            const response = await fetch(`/api/lists/${currentList.id}`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                ...currentList,
                                description: dialogDescription.trim() || undefined
                              }),
                            })
                            if (response.ok) {
                              const updatedList = await response.json()
                              onListUpdate(updatedList)
                            }
                          } catch (error) {
                            console.error('Error updating description:', error)
                          }
                        }
                        setDescriptionDialogMode('view')
                      }}
                      className="text-xs bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      <Check className="w-3 h-3 mr-1" />
                      Save
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    )
  }
)
