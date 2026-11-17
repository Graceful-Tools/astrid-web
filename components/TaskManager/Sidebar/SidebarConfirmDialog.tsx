"use client"

/**
 * The confirm step for a sidebar menu's destructive item (ADEV-61): iOS's
 * `confirmationDialog` for Delete Project… and Remove from Project.
 */
import React from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog"
import { useTranslations } from "@/lib/i18n/client"

interface SidebarConfirmDialogProps {
  open: boolean
  title: string
  detail: string
  confirmLabel: string
  busy?: boolean
  error?: string | null
  confirmTestId: string
  onCancel: () => void
  onConfirm: () => void
}

export function SidebarConfirmDialog({
  open, title, detail, confirmLabel, busy = false, error, confirmTestId, onCancel, onConfirm,
}: SidebarConfirmDialogProps) {
  const { t } = useTranslations()
  return (
    <Dialog open={open} onOpenChange={next => { if (!next && !busy) onCancel() }}>
      <DialogContent className="max-w-sm">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{detail}</DialogDescription>
        {error ? <p className="text-xs text-danger">{error}</p> : null}
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={onCancel}>
            {t("actions.cancel")}
          </Button>
          <Button variant="destructive" size="sm" disabled={busy} onClick={onConfirm} data-testid={confirmTestId}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
