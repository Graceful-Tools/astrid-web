"use client"

/**
 * The picker for what a task waits on (ADEV-282): link an experiment, or "verify for N days". Used by
 * the experiment row in task details, and by the dialog that answers a 422 `RESULTS_NEEDS_CONDITION`.
 *
 * Experiment connectors are listed from `GET /api/v1/projects/:id/connectors`, which only an owner or
 * admin may read. When that read is refused the picker offers verification alone, which any member
 * who can edit the task may start.
 */
import React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { apiGet, refusalReason } from "@/lib/api"
import { useTranslations } from "@/lib/i18n/client"
import { linkTaskExperiment } from "@/hooks/use-task-experiments"
import { VERIFICATION_MAX_DAYS } from "@/lib/task-experiment"

interface ExperimentConnector {
  id: string
  name: string
}

type Mode = "verification" | "experiment"

interface ExperimentLinkFormProps {
  taskId: string
  projectId: string
  onLinked: () => void
  onCancel?: () => void
}

const DEFAULT_VERIFY_DAYS = 7

export function ExperimentLinkForm({ taskId, projectId, onLinked, onCancel }: ExperimentLinkFormProps) {
  const { t } = useTranslations()
  const [connectors, setConnectors] = React.useState<ExperimentConnector[]>([])
  const [mode, setMode] = React.useState<Mode>("verification")
  const [connectorId, setConnectorId] = React.useState("")
  const [externalKey, setExternalKey] = React.useState("")
  const [days, setDays] = React.useState(String(DEFAULT_VERIFY_DAYS))
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let active = true
    apiGet(`/api/v1/projects/${encodeURIComponent(projectId)}/connectors`)
      .then(response => response.json())
      .then((body: { connectors?: Array<ExperimentConnector & { kind?: string }> }) => {
        if (!active) return
        const experiments = (body.connectors ?? []).filter(connector => connector.kind === "experiment")
        setConnectors(experiments)
        if (experiments.length) {
          setMode("experiment")
          setConnectorId(experiments[0].id)
        }
      })
      .catch(() => {
        // Not an owner or admin, or no connectors: verification stays the only choice.
      })
    return () => { active = false }
  }, [projectId])

  const daysNumber = Number(days)
  const daysValid = Number.isInteger(daysNumber) && daysNumber >= 1 && daysNumber <= VERIFICATION_MAX_DAYS
  const canSubmit = mode === "verification" ? daysValid : Boolean(connectorId && externalKey.trim())

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!canSubmit || busy) return
    setBusy(true)
    setError(null)
    try {
      await linkTaskExperiment(
        taskId,
        mode === "verification"
          ? { kind: "verification", days: daysNumber, projectId }
          : { kind: "experiment", connectorId, externalKey: externalKey.trim(), projectId },
      )
      onLinked()
    } catch (failure) {
      setError(refusalReason(failure) ?? t("projectMode.experiment.linkFailed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="space-y-2" onSubmit={submit} data-testid="experiment-link-form">
      {connectors.length > 0 && (
        <div className="flex gap-1.5" role="group" aria-label={t("projectMode.experiment.linkKind")}>
          <Button type="button" size="sm" variant={mode === "experiment" ? "default" : "outline"} onClick={() => setMode("experiment")} data-testid="experiment-mode-experiment">
            {t("projectMode.experiment.linkExperiment")}
          </Button>
          <Button type="button" size="sm" variant={mode === "verification" ? "default" : "outline"} onClick={() => setMode("verification")} data-testid="experiment-mode-verification">
            {t("projectMode.experiment.verifyFor")}
          </Button>
        </div>
      )}
      {mode === "experiment" ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {connectors.length > 1 && (
            <Select value={connectorId} onValueChange={setConnectorId}>
              <SelectTrigger className="h-8 w-auto gap-1 px-2 text-xs" aria-label={t("projectMode.experiment.connectorLabel")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {connectors.map(connector => (
                  <SelectItem key={connector.id} value={connector.id}>{connector.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Input
            value={externalKey}
            onChange={event => setExternalKey(event.target.value)}
            placeholder={t("projectMode.experiment.keyPlaceholder")}
            aria-label={t("projectMode.experiment.keyLabel")}
            className="h-8 w-48 text-xs"
            data-testid="experiment-key-input"
          />
        </div>
      ) : (
        <label className="flex items-center gap-1.5 text-xs">
          <span>{t("projectMode.experiment.verifyFor")}</span>
          <Input
            type="number"
            min={1}
            max={VERIFICATION_MAX_DAYS}
            value={days}
            onChange={event => setDays(event.target.value)}
            className="h-8 w-16 text-xs"
            aria-label={t("projectMode.experiment.daysLabel")}
            data-testid="experiment-days-input"
          />
          <span>{t("projectMode.experiment.days")}</span>
        </label>
      )}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      <div className="flex gap-1.5">
        <Button type="submit" size="sm" disabled={!canSubmit || busy} data-testid="experiment-link-submit">
          {t("projectMode.experiment.add")}
        </Button>
        {onCancel && (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel} data-testid="experiment-link-cancel">
            {t("actions.cancel")}
          </Button>
        )}
      </div>
    </form>
  )
}
