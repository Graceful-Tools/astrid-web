"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
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

      <ConfirmDialog
        open={showDeleteConfirmation}
        testId="list-delete-confirm"
        title={t("listSettings.admin.deleteList")}
        detail={fillMessage(t("listSettings.admin.deleteConfirm"), { name: list.name })}
        note={t("listSettings.admin.deleteWarning")}
        cancelLabel={t("listSettings.admin.dontDelete")}
        confirmLabel={<><Trash2 className="w-4 h-4 mr-2" />{t("actions.delete")}</>}
        onCancel={() => setShowDeleteConfirmation(false)}
        onConfirm={() => {
          onDelete(list.id)
          setShowDeleteConfirmation(false)
        }}
      />
    </>
  )
}
