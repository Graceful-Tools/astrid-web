"use client"

/**
 * The one-tap offer to add the Pending results column (ADEV-282, spec: docs/specs/GOALS_GUARDRAILS_SIGNALS.md
 * → 7). Shown in the experiment row, once a task on a board without the column has a link or a
 * verification, and only to the board's owner (the same person the statuses route accepts). Dismissal
 * is remembered per board, and a board that has the column is never offered it.
 */
import React from "react"
import { useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { apiPost, refusalReason } from "@/lib/api"
import { BOARD_PRESETS, RESULTS_STATUS_ROLE, availableBoardPresets } from "@/lib/board-presets"
import { addLoadedProjectCustomState } from "@/lib/client-projects"
import { useTranslations } from "@/lib/i18n/client"
import { getUserRoleInProject } from "@/lib/list-permissions"
import { dismissOffer, isOfferDismissed } from "@/lib/task-experiment-client"
import { useLoadedProjects } from "@/hooks/use-loaded-projects"

export function ResultsColumnOffer({ projectId }: { projectId: string }) {
  const { t } = useTranslations()
  const { data: session } = useSession()
  const projects = useLoadedProjects()
  const [dismissed, setDismissed] = React.useState(() => isOfferDismissed(projectId))
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const project = projects.find(candidate => candidate.id === projectId)
  if (!project || dismissed) return null
  // Who may edit a board's columns is the owner (lib/list-permissions.ts); members never see the offer.
  if (getUserRoleInProject({ id: session?.user?.id ?? "" }, { ownerId: project.ownerId ?? "", members: (project.members ?? []).map(member => ({ userId: member.userId, role: member.role ?? "member" })) }) !== "owner") return null
  if (!availableBoardPresets(project.customStates).some(preset => preset.role === RESULTS_STATUS_ROLE)) return null

  const add = async () => {
    setBusy(true)
    setError(null)
    try {
      await apiPost(`/api/v1/projects/${encodeURIComponent(projectId)}/statuses`, { preset: RESULTS_STATUS_ROLE })
      const preset = BOARD_PRESETS.find(candidate => candidate.role === RESULTS_STATUS_ROLE)
      if (preset) addLoadedProjectCustomState(projectId, { role: preset.role, name: preset.name, description: preset.description })
    } catch (failure) {
      setError(refusalReason(failure) ?? t("projectMode.experiment.offerFailed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 space-y-1 text-xs theme-text-muted" data-testid="results-column-offer">
      <p>{t("projectMode.experiment.offer")}</p>
      <div className="flex gap-1.5">
        <Button type="button" size="sm" disabled={busy} onClick={add} data-testid="results-column-offer-add">
          {t("projectMode.experiment.offerAdd")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            dismissOffer(projectId)
            setDismissed(true)
          }}
          data-testid="results-column-offer-dismiss"
        >
          {t("projectMode.experiment.offerDismiss")}
        </Button>
      </div>
      {error && <p role="alert" className="text-danger">{error}</p>}
    </div>
  )
}
