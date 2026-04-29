"use client"

import { useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AlertCircle, RefreshCw, Trash2 } from "lucide-react"
import { useTranslations } from "@/lib/i18n/client"

const REQUIRED_CONFIRMATION_TEXT = "DELETE MY ACCOUNT"

/**
 * Stage 14c: account-deletion danger zone + confirmation dialog,
 * extracted from AccountSettings.
 *
 * Modal state (open/closed, confirmation text) is owned here since it's
 * purely UI. The destructive action callback + the in-flight `deleting`
 * flag are passed in from the parent — the parent does signOut + router
 * push after a successful delete, so the actual mutation has to stay
 * with the page-level component.
 *
 * The required confirmation text ("DELETE MY ACCOUNT") is enforced both
 * here (button disabled) and in the parent's onConfirmDelete handler
 * (defense in depth).
 */
export interface AccountDeletionSectionProps {
  deleting: boolean
  onConfirmDelete: (confirmationText: string) => Promise<void>
}

export function AccountDeletionSection({ deleting, onConfirmDelete }: AccountDeletionSectionProps) {
  const { t } = useTranslations()
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deleteConfirmationText, setDeleteConfirmationText] = useState("")

  const closeDialog = () => {
    setShowDeleteDialog(false)
    setDeleteConfirmationText("")
  }

  const handleConfirm = async () => {
    if (deleteConfirmationText !== REQUIRED_CONFIRMATION_TEXT) return
    await onConfirmDelete(deleteConfirmationText)
  }

  return (
    <>
      <Card className="theme-bg-secondary border-red-600">
        <CardHeader>
          <CardTitle className="text-red-400 flex flex-wrap items-center gap-2">
            <Trash2 className="w-5 h-5" />
            <span>{t("settingsPages.deleteAccount.title")}</span>
          </CardTitle>
          <CardDescription className="text-red-300">
            {t("settingsPages.deleteAccount.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert className="border-red-600 bg-red-900/20">
            <AlertCircle className="w-4 h-4 text-red-400" />
            <AlertDescription className="text-red-300 text-sm">
              <p className="font-semibold mb-2">{t("settingsPages.deleteAccount.warning")}</p>
              <p>{t("settingsPages.deleteAccount.willRemove")}</p>
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>All tasks, lists, and comments</li>
                <li>All uploaded files and attachments</li>
                <li>All integrations and settings</li>
                <li>Access to shared lists and collaborations</li>
              </ul>
              <p className="mt-2 font-semibold">Consider exporting your data first (see above).</p>
            </AlertDescription>
          </Alert>
          <Button
            onClick={() => setShowDeleteDialog(true)}
            variant="destructive"
            className="w-full bg-red-600 hover:bg-red-700"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            {t("settingsPages.deleteAccount.deleteMyAccount")}
          </Button>
        </CardContent>
      </Card>

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="theme-bg-secondary theme-border">
          <DialogHeader>
            <DialogTitle className="text-red-400 flex flex-wrap items-center gap-2">
              <Trash2 className="w-5 h-5" />
              <span>{t("settingsPages.deleteAccount.confirmTitle")}</span>
            </DialogTitle>
            <DialogDescription className="theme-text-muted">
              {t("settingsPages.deleteAccount.confirmDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Alert className="border-red-600 bg-red-900/20">
              <AlertCircle className="w-4 h-4 text-red-400" />
              <AlertDescription className="text-red-300 text-sm">
                All your data will be permanently deleted, including tasks, lists, and files.
              </AlertDescription>
            </Alert>

            <div>
              <Label htmlFor="deleteConfirmation" className="theme-text-secondary">
                {t("settingsPages.deleteAccount.typeToConfirm")}
              </Label>
              <Input
                id="deleteConfirmation"
                value={deleteConfirmationText}
                onChange={e => setDeleteConfirmationText(e.target.value)}
                placeholder={REQUIRED_CONFIRMATION_TEXT}
                className="theme-input theme-text-primary font-mono"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={closeDialog}
              disabled={deleting}
              className="border-gray-600 text-gray-400 hover:bg-gray-600 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirm}
              disabled={deleting || deleteConfirmationText !== REQUIRED_CONFIRMATION_TEXT}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleting ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  {t("settingsPages.deleteAccount.deleting")}
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  {t("settingsPages.deleteAccount.permanentlyDelete")}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
