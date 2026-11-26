"use client"

/**
 * The Estimate button, and the estimate it brings (ADEV-280, spec: docs/specs/GOALS_GUARDRAILS_SIGNALS.md
 * → Surfaces). On an idea card (`compact`) it is a small button whose card opens in a popover; on task
 * detail the card sits under the button. One button, and a picker only when the deployment offers more
 * than one estimator. With no key for the built-in estimator it says how to add one.
 *
 * Draws nothing outside Project Mode, when the capability is off or refused, or when the project states no
 * goals or guardrails to estimate against. Asking is `POST /api/v1/tasks/:id/estimates`; the latest is
 * read from `GET` (a card reads it only once someone opens it, so a board of cards makes no extra calls).
 */
import React from "react"
import { Gauge } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ApiError, apiGet, apiPost } from "@/lib/api"
import { useTranslations } from "@/lib/i18n/client"
import { useProjectGoals } from "@/hooks/use-project-goals"
import { useProjectMode } from "@/hooks/use-project-mode"
import { EstimateCard, type EstimateCardData } from "./EstimateCard"
import { EstimateLabelChip } from "./EstimateLabelChip"

interface EstimatorChoice {
  key: string
  name: string
}

/** One read of what the deployment offers, shared by every control on the page. */
let estimatorsRead: Promise<EstimatorChoice[]> | null = null
function readEstimators(): Promise<EstimatorChoice[]> {
  estimatorsRead ??= apiGet("/api/v1/capabilities")
    .then(response => response.json())
    .then((body: { goalSignals?: { estimators?: EstimatorChoice[] } }) =>
      Array.isArray(body?.goalSignals?.estimators) ? body.goalSignals.estimators : [],
    )
    .catch(() => {
      estimatorsRead = null
      return []
    })
  return estimatorsRead
}

/** Forget the cached offering (tests, and a sign-out). */
export function resetEstimatorOffering() {
  estimatorsRead = null
}

type Failure = "noKey" | "failed" | null

interface EstimateControlProps {
  taskId: string
  /** The project whose goals the estimate is read against. Nothing is drawn without one. */
  projectId: string | null | undefined
  /** An idea card's small button, with the card in a popover. */
  compact?: boolean
  /** Asking writes a row, which needs write access to the task. */
  canEdit?: boolean
}

export function EstimateControl({ taskId, projectId, compact = false, canEdit = true }: EstimateControlProps) {
  const { t } = useTranslations()
  const projectMode = useProjectMode()
  const { state: project } = useProjectGoals(projectMode ? projectId : undefined)
  const [estimators, setEstimators] = React.useState<EstimatorChoice[] | null>(null)
  const [chosen, setChosen] = React.useState<string>("")
  const [latest, setLatest] = React.useState<EstimateCardData | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [pending, setPending] = React.useState<string | null>(null)
  const [failure, setFailure] = React.useState<Failure>(null)
  const [open, setOpen] = React.useState(false)
  const loaded = React.useRef(false)

  React.useEffect(() => {
    if (!projectMode || !projectId) return
    let active = true
    readEstimators().then(list => { if (active) setEstimators(list) })
    return () => { active = false }
  }, [projectMode, projectId])

  const loadLatest = React.useCallback(async () => {
    if (loaded.current || !projectId) return
    loaded.current = true
    try {
      const response = await apiGet(`/api/v1/tasks/${encodeURIComponent(taskId)}/estimates?projectId=${encodeURIComponent(projectId)}`)
      const body = (await response.json()) as { latest?: EstimateCardData | null }
      setLatest(body.latest ?? null)
    } catch {
      loaded.current = false
    }
  }, [taskId, projectId])

  // The detail view shows the standing estimate as soon as it is there; a card waits to be opened.
  React.useEffect(() => {
    if (!compact && projectMode && estimators?.length) void loadLatest()
  }, [compact, projectMode, estimators, loadLatest])

  if (!projectMode || !projectId || !estimators || !project) return null
  if (project.goals.length === 0 && project.guardrails.length === 0) return null
  if (!estimators.length && !latest) return null

  const selected = chosen || estimators[0]?.key || ""

  const ask = async () => {
    setBusy(true)
    setFailure(null)
    setPending(null)
    try {
      const response = await apiPost(`/api/v1/tasks/${encodeURIComponent(taskId)}/estimates`, {
        estimator: selected,
        projectId,
      })
      const body = (await response.json()) as { estimate?: EstimateCardData; pending?: boolean; estimator?: string }
      if (response.status === 202 || body.pending) {
        setPending(estimators.find(e => e.key === selected)?.name ?? selected)
      } else if (body.estimate) {
        loaded.current = true
        setLatest(body.estimate)
        setOpen(true)
      }
    } catch (error) {
      const reason = error instanceof ApiError ? (error.detail as { reason?: string } | null)?.reason : undefined
      setFailure(reason === "no_api_key" ? "noKey" : "failed")
    } finally {
      setBusy(false)
    }
  }

  const asking = canEdit && estimators.length > 0
  const label = busy ? t("projectMode.estimate.busy") : latest ? t("projectMode.estimate.again") : t("projectMode.estimate.button")

  const controls = (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="estimate-control">
      {asking && estimators.length > 1 && (
        <Select value={selected} onValueChange={setChosen}>
          <SelectTrigger className="h-7 w-auto gap-1 px-2 text-xs" aria-label={t("projectMode.estimate.pickerLabel")} data-testid="estimate-picker">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {estimators.map(estimator => (
              <SelectItem key={estimator.key} value={estimator.key}>
                {estimator.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {asking && (
        <Button type="button" variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" disabled={busy} onClick={ask} data-testid="estimate-button">
          <Gauge className="h-3.5 w-3.5" aria-hidden="true" />
          {label}
        </Button>
      )}
      {pending && (
        <span role="status" className="text-xs theme-text-muted" data-testid="estimate-pending">
          {t("projectMode.estimate.pending", { name: pending })}
        </span>
      )}
      {failure && (
        <span role="alert" className="text-xs text-danger" data-testid="estimate-error">
          {failure === "noKey" ? t("projectMode.estimate.noKey") : t("projectMode.estimate.failed")}
        </span>
      )}
    </div>
  )

  if (!compact) {
    return (
      <div className="space-y-2">
        {controls}
        {latest && <EstimateCard estimate={latest} project={project} />}
      </div>
    )
  }

  // A card is a button that opens task details: nothing in here may reach it.
  const stop = (event: React.SyntheticEvent) => event.stopPropagation()
  return (
    <div onClick={stop} onKeyDown={stop} onPointerDown={stop} data-testid="estimate-compact">
      <Popover
        open={open}
        onOpenChange={next => {
          setOpen(next)
          if (next) void loadLatest()
        }}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {controls}
          {latest?.label && (
            <EstimateLabelChip estimate={{ label: latest.label, labelReasons: latest.labelReasons ?? null }} project={project} />
          )}
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" data-testid="estimate-show">
              {t("projectMode.estimate.show")}
            </Button>
          </PopoverTrigger>
        </div>
        <PopoverContent className="w-96 max-w-[90vw]" align="start">
          {latest ? (
            <EstimateCard estimate={latest} project={project} />
          ) : (
            <p className="text-xs theme-text-muted" data-testid="estimate-none">
              {t("projectMode.estimate.none")}
            </p>
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}
