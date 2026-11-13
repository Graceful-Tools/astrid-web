"use client"

import { useTranslations } from "@/lib/i18n/client"
import React from "react"
import dynamic from "next/dynamic"
import { unwrapList } from '@/lib/v1-response'
import { apiPut } from '@/lib/api'
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FileText, Eye, Edit3, Bot, Check } from "lucide-react"
import type { TaskList } from "@/types/task"

/*
 * The markdown renderer (marked + DOMPurify) is not first-load JS: the dialog is closed
 * on first paint. The chunk is warmed after hydration (the effect below), so the first
 * open renders at once.
 */
const loadDescriptionMarkdown = () => import("./DescriptionMarkdown")
const DescriptionMarkdown = dynamic(loadDescriptionMarkdown)

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
    const { t } = useTranslations()
    const [showDescriptionDialog, setShowDescriptionDialog] = React.useState(false)
    const [descriptionDialogMode, setDescriptionDialogMode] = React.useState<'view' | 'edit'>('view')
    const [dialogDescription, setDialogDescription] = React.useState('')

    React.useEffect(() => {
      void loadDescriptionMarkdown()
    }, [])

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
              <span>{t('lists.descriptionTitle')}</span>
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
                className={`text-xs px-2.5 py-1 rounded ${descriptionDialogMode === 'view' ? 'bg-brand text-brand-foreground' : 'theme-text-muted hover:theme-bg-hover'}`}
              >
                <Eye className="w-3 h-3 inline mr-1" />
                {t('lists.descriptionView')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDescriptionDialogMode('edit')
                  setDialogDescription(currentList.description || '')
                }}
                className={`text-xs px-2.5 py-1 rounded ${descriptionDialogMode === 'edit' ? 'bg-brand text-brand-foreground' : 'theme-text-muted hover:theme-bg-hover'}`}
              >
                <Edit3 className="w-3 h-3 inline mr-1" />
                {t('actions.edit')}
              </button>
            </div>
          )}

          {/* Content */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {descriptionDialogMode === 'view' ? (
              <DescriptionMarkdown markdown={dialogDescription || t('listSettings.admin.noInstructionsYet')} />
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-end">
                  <span className="text-xs theme-text-muted">{t('listSettings.admin.charCount', { count: String(dialogDescription.length) })}</span>
                </div>
                <textarea
                  value={dialogDescription}
                  onChange={(e) => setDialogDescription(e.target.value)}
                  placeholder={t('lists.descriptionDialogPlaceholder')}
                  className="w-full theme-comment-bg theme-border border theme-text-primary rounded-lg px-3 py-2 resize-vertical focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent font-mono text-sm min-h-52"
                  rows={12}
                  autoFocus
                />
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1 text-xs theme-text-muted">
                    <Bot className="w-3 h-3" />
                    <span>{t('lists.descriptionAgentHint')}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setDescriptionDialogMode('view')}
                      className="text-xs theme-border theme-text-secondary hover:theme-bg-hover"
                    >
                      {t('common.cancel')}
                    </Button>
                    <Button
                      size="sm"
                      onClick={async () => {
                        // Save via the existing handler
                        setTempListDescription(dialogDescription)
                        // Directly call the save
                        if (currentList && dialogDescription !== (currentList.description || '')) {
                          try {
                            // apiPut, not fetch: queued and replayed offline
                            // rather than lost (task b8b21855).
                            const response = await apiPut(`/api/v1/lists/${currentList.id}`, {
                              ...currentList,
                              description: dialogDescription.trim() || undefined
                            })
                            const updatedList = unwrapList<TaskList>(await response.json())
                            if (updatedList) onListUpdate(updatedList)
                          } catch (error) {
                            console.error('Error updating description:', error)
                          }
                        }
                        setDescriptionDialogMode('view')
                      }}
                      className="text-xs bg-brand hover:bg-brand-hover text-brand-foreground"
                    >
                      <Check className="w-3 h-3 mr-1" />
                      {t('actions.save')}
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
