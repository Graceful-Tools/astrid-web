"use client"

/**
 * Full-screen task description (AWTD-1629) — web half of iOS AITD-649.
 *
 * Opens already in the mode `descriptionReaderInitialMode` picks, has an
 * Edit / Preview toggle, and Done saves only when the text changed.
 */
import { useState } from "react"
import { Eye, Edit3, FileText } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useTranslations } from "@/lib/i18n/client"
import { renderMarkdown } from "@/lib/markdown"
import {
  descriptionReaderInitialMode,
  descriptionReaderSaveNeeded,
  type DescriptionReaderEntry,
  type DescriptionReaderMode,
} from "@/lib/description-reader"

interface TaskDescriptionReaderProps {
  description: string
  readOnly: boolean
  entry: DescriptionReaderEntry
  onSave: (text: string) => void
  onClose: () => void
}

export function TaskDescriptionReader({ description, readOnly, entry, onSave, onClose }: TaskDescriptionReaderProps) {
  const { t } = useTranslations()
  const [mode, setMode] = useState<DescriptionReaderMode>(() =>
    descriptionReaderInitialMode(description, readOnly, entry)
  )
  const [draft, setDraft] = useState(description)

  const handleDone = () => {
    if (!readOnly && descriptionReaderSaveNeeded(description, draft)) onSave(draft)
    onClose()
  }

  const toggleClass = (active: boolean) =>
    `text-xs px-2.5 py-1 rounded ${active ? 'bg-brand text-brand-foreground' : 'theme-text-muted hover:theme-bg-hover'}`

  return (
    <Dialog open onOpenChange={(open) => { if (!open) handleDone() }}>
      <DialogContent
        data-testid="task-description-reader"
        className="theme-bg-primary theme-border flex flex-col max-sm:h-dvh max-sm:max-h-dvh max-sm:w-screen max-sm:max-w-none max-sm:rounded-none sm:max-w-2xl sm:max-h-[80vh]"
      >
        <DialogHeader>
          <DialogTitle className="theme-text-primary flex items-center space-x-2">
            <FileText className="w-5 h-5" />
            <span>{t('tasks.taskDescription')}</span>
          </DialogTitle>
        </DialogHeader>

        {!readOnly && (
          <div className="flex items-center space-x-1">
            <button type="button" className={toggleClass(mode === 'edit')} onClick={() => setMode('edit')}>
              <Edit3 className="w-3 h-3 inline mr-1" />
              {t('actions.edit')}
            </button>
            <button type="button" className={toggleClass(mode === 'preview')} onClick={() => setMode('preview')}>
              <Eye className="w-3 h-3 inline mr-1" />
              {t('tasks.detail.descriptionPreview')}
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto min-h-0">
          {mode === 'edit' ? (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t('tasks.placeholder.description')}
              className="w-full h-full theme-comment-bg theme-border border theme-text-primary rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent text-base min-h-52"
              spellCheck={true}
              autoFocus
            />
          ) : (
            <div
              className="prose prose-sm max-w-none theme-text-primary p-1 min-w-0 break-words [overflow-wrap:anywhere]"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(draft) }}
            />
          )}
        </div>

        <div className="flex justify-end">
          <Button size="sm" onClick={handleDone} className="bg-brand hover:bg-brand-hover text-brand-foreground">
            {t('actions.done')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
