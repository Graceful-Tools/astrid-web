"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Trash2 } from "lucide-react"
import { useTranslations } from "@/lib/i18n/client"
import { fillMessage } from "@/components/shared/RichMessage"
import type { TaskList } from "@/types/task"

interface DeleteListSectionProps {
  list: TaskList
  canEditSettings: boolean
  onDelete: (listId: string) => void
}

/**
 * Delete List control for a list's admin settings: the destructive
 * button and its confirmation modal. Extracted from list-admin-settings.tsx
 * (Stage 13 of the god-file refactor).
 */
export function DeleteListSection({ list, canEditSettings, onDelete }: DeleteListSectionProps) {
  const { t } = useTranslations()
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false)

  if (!canEditSettings) return null

  return (
    <>
      <div className="border-t theme-border pt-4">
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setShowDeleteConfirmation(true)}
          className="w-full hover:text-danger hover:bg-danger-subtle"
        >
          <Trash2 className="w-4 h-4 mr-2" />
          {t("listSettings.admin.deleteList")}
        </Button>
      </div>

      {showDeleteConfirmation && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowDeleteConfirmation(false)}>
          <div className="bg-theme-surface rounded-lg p-6 max-w-sm mx-4 shadow-xl" data-testid="list-delete-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4">
              <h3 className="text-lg font-semibold theme-text-primary mb-2">{t("listSettings.admin.deleteList")}</h3>
              <p className="theme-text-secondary mb-2">
                {fillMessage(t("listSettings.admin.deleteConfirm"), { name: list.name })}
              </p>
              <p className="text-sm theme-text-muted">
                {t("listSettings.admin.deleteWarning")}
              </p>
            </div>
            <div className="flex space-x-3 justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowDeleteConfirmation(false)}
                className="theme-border theme-text-secondary hover:theme-bg-hover"
              >
                {t("listSettings.admin.dontDelete")}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  onDelete(list.id)
                  setShowDeleteConfirmation(false)
                }}
                className="bg-danger hover:bg-danger/90 text-danger-foreground"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                {t("actions.delete")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
