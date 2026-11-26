"use client"

/**
 * The one Pending results picker host (lib/results-prompt.ts). components/providers.tsx loads it with
 * next/dynamic after hydration, so neither it nor the dialog costs a route any first-load JavaScript;
 * a request made before it arrives waits for it.
 */
import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ExperimentLinkForm } from "@/components/projects/ExperimentLinkForm"
import { useTranslations } from "@/lib/i18n/client"
import { subscribeResultsPrompt, type ResultsPromptRequest } from "@/lib/results-prompt"

export function ResultsPromptHost() {
  const { t } = useTranslations()
  const [request, setRequest] = useState<ResultsPromptRequest | null>(null)
  useEffect(() => subscribeResultsPrompt(setRequest), [])
  if (!request) return null
  const projectId = request.task.lists?.find(list => list.projectId)?.projectId
  return (
    <Dialog open onOpenChange={open => { if (!open) request.resolve(false) }}>
      <DialogContent data-testid="results-prompt">
        <DialogHeader>
          <DialogTitle>{t("projectMode.experiment.promptTitle")}</DialogTitle>
          <DialogDescription>{t("projectMode.experiment.promptBody")}</DialogDescription>
        </DialogHeader>
        {projectId ? (
          // Keyed by task, so a new request starts from a clean form.
          <ExperimentLinkForm
            key={request.task.id}
            taskId={request.task.id}
            projectId={projectId}
            onLinked={() => request.resolve(true)}
            onCancel={() => request.resolve(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
