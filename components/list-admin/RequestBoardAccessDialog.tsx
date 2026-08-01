"use client"

import { useCallback, useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useTranslations } from "@/lib/i18n/client"
import { PROJECT_MODE_FEATURE_KEY } from "@/lib/project-mode-shared"

interface RequestBoardAccessDialogProps {
  onClose: () => void
  onRequested: () => void
}

/**
 * The request half of the Project Mode gate (task dd7172d8).
 *
 * Deliberately one optional free-text field. Every extra required field costs
 * requests, and the count of *people who asked* is the primary signal — the
 * use-case note is the useful-but-secondary half.
 */
export function RequestBoardAccessDialog({ onClose, onRequested }: RequestBoardAccessDialogProps) {
  const { t } = useTranslations()
  const [useCase, setUseCase] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(async () => {
    if (submitting) return
    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch("/api/v1/feature-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ featureKey: PROJECT_MODE_FEATURE_KEY, useCase }),
      })
      if (!response.ok) throw new Error(await response.text())
      onRequested()
      onClose()
    } catch {
      setError(t("projectMode.requestFailed"))
    } finally {
      setSubmitting(false)
    }
  }, [onClose, onRequested, submitting, t, useCase])

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={() => !submitting && onClose()}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-sm mx-4 shadow-xl w-full"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("projectMode.requestDialogTitle")}
      >
        <h3 className="text-lg font-semibold theme-text-primary mb-2">
          {t("projectMode.requestDialogTitle")}
        </h3>
        <p className="text-sm theme-text-secondary mb-4">
          {t("projectMode.requestDialogBody")}
        </p>

        <Label htmlFor="board-access-use-case" className="text-sm theme-text-secondary">
          {t("projectMode.requestDialogUseCaseLabel")}
        </Label>
        <Textarea
          id="board-access-use-case"
          value={useCase}
          onChange={(event) => setUseCase(event.target.value)}
          placeholder={t("projectMode.requestDialogUseCasePlaceholder")}
          rows={3}
          maxLength={1000}
          className="mt-1 mb-4"
          disabled={submitting}
        />

        {error ? <p className="text-xs text-red-500 mb-3">{error}</p> : null}

        <div className="flex space-x-3 justify-end">
          <Button variant="outline" size="sm" disabled={submitting} onClick={onClose}>
            {t("projectMode.requestDialogCancel")}
          </Button>
          <Button size="sm" disabled={submitting} onClick={submit}>
            {t("projectMode.requestDialogSubmit")}
          </Button>
        </div>
      </div>
    </div>
  )
}
