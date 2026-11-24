"use client"

/**
 * A project's decisions on its board (ADEV-188, the UI half of ADEV-180), for everyone working
 * there. "New decision" starts one from the project's goals (a task holding the Decision and a
 * trade-off grid) and opens it. "Decisions" opens the project's open and decided decisions, each
 * with the choice, and records a choice after a confirmation. Mirrors ProjectGoalsStrip and its hook.
 */
import React from "react"
import { CheckCircle2, Plus, Scale } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { useTranslations } from "@/lib/i18n/client"
import { decisionReply } from "@/lib/comment-formats"
import { useProjectDecisions, type ProjectDecision } from "@/hooks/use-project-decisions"

interface ProjectDecisionsProps {
  projectId: string
  /** Opens a task's details, as a card tap does. */
  onOpenTask?: (taskId: string) => void
}

interface PendingChoice {
  decision: ProjectDecision
  option: ProjectDecision["options"][number]
}

export function ProjectDecisions({ projectId, onOpenTask }: ProjectDecisionsProps) {
  const { t } = useTranslations()
  const { decisions, create, decide } = useProjectDecisions(projectId)
  const [open, setOpen] = React.useState(false)
  const [creating, setCreating] = React.useState(false)
  const [pending, setPending] = React.useState<PendingChoice | null>(null)
  const [deciding, setDeciding] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const openOnes = (decisions ?? []).filter(d => d.status === "open")
  const decidedOnes = (decisions ?? []).filter(d => d.status === "decided")

  const startDecision = async () => {
    if (creating) return
    setCreating(true)
    setError(null)
    try {
      const taskId = await create()
      setOpen(false)
      onOpenTask?.(taskId)
    } catch {
      setError(t("projectMode.decisions.newFailed"))
    } finally {
      setCreating(false)
    }
  }

  const recordChoice = async () => {
    if (!pending || deciding) return
    setDeciding(true)
    setError(null)
    try {
      await decide(pending.decision.id, pending.option.number)
      setPending(null)
    } catch {
      setError(t("projectMode.decisions.decideFailed"))
    } finally {
      setDeciding(false)
    }
  }

  const openTask = (taskId: string) => {
    setOpen(false)
    onOpenTask?.(taskId)
  }

  const row = (decision: ProjectDecision) => (
    <li key={decision.id} className="rounded-md border theme-border p-2" data-testid={`project-decision-${decision.id}`}>
      <button
        type="button"
        className="block w-full text-left hover:underline"
        data-testid={`project-decision-open-${decision.id}`}
        onClick={() => openTask(decision.id)}
      >
        {decision.identifier && <span className="mr-2 text-xs theme-text-secondary">{decision.identifier}</span>}
        <span className="font-medium">{decision.title}</span>
      </button>
      {decision.prompt && decision.prompt !== decision.title && (
        <p className="mt-0.5 text-xs theme-text-secondary">{decision.prompt}</p>
      )}
      {decision.chosen ? (
        <p className="mt-1 flex items-center gap-1 text-sm">
          <CheckCircle2 className="h-4 w-4 text-brand" aria-hidden="true" />
          {t("projectMode.decisions.chose", { option: decisionReply(decision.chosen) })}
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label={t("projectMode.decisions.decide")}>
          {decision.options.map(option => (
            <Button
              key={option.number}
              variant="outline"
              size="sm"
              data-testid={`project-decision-choose-${decision.id}-${option.number}`}
              onClick={() => setPending({ decision, option })}
            >
              {option.recommended && <span aria-hidden="true">★ </span>}
              {decisionReply(option)}
            </Button>
          ))}
        </div>
      )}
    </li>
  )

  return (
    <div className="flex shrink-0 items-center gap-2" data-testid="project-decisions">
      {decisions && decisions.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          title={t("projectMode.decisions.title")}
          data-testid="project-decisions-toggle"
          onClick={() => setOpen(true)}
        >
          <Scale className="mr-1 h-4 w-4" aria-hidden="true" />
          {t("projectMode.decisions.openCount", { count: String(openOnes.length) })}
        </Button>
      )}
      <Button
        variant="outline"
        size="sm"
        disabled={creating}
        data-testid="project-new-decision"
        onClick={() => void startDecision()}
      >
        <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
        {t("projectMode.decisions.new")}
      </Button>
      {error && !open && <span className="text-xs text-danger" role="alert">{error}</span>}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg" data-testid="project-decisions-view">
          <DialogTitle>{t("projectMode.decisions.title")}</DialogTitle>
          <DialogDescription>{t("projectMode.decisions.intro")}</DialogDescription>
          {error && <p className="text-xs text-danger" role="alert">{error}</p>}
          <section data-testid="project-decisions-open">
            <h3 className="mb-1 text-sm font-medium">{t("projectMode.decisions.openHeading")}</h3>
            {openOnes.length ? (
              <ul className="flex flex-col gap-2">{openOnes.map(row)}</ul>
            ) : (
              <p className="text-sm theme-text-secondary">{t("projectMode.decisions.noneOpen")}</p>
            )}
          </section>
          {decidedOnes.length > 0 && (
            <section data-testid="project-decisions-decided">
              <h3 className="mb-1 text-sm font-medium">{t("projectMode.decisions.decidedHeading")}</h3>
              <ul className="flex flex-col gap-2">{decidedOnes.map(row)}</ul>
            </section>
          )}
          <div className="flex justify-end">
            <Button size="sm" disabled={creating} onClick={() => void startDecision()}>
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
              {t("projectMode.decisions.new")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pending !== null}
        title={t("projectMode.decisions.confirmTitle")}
        detail={pending ? pending.decision.title : ""}
        confirmLabel={pending ? t("projectMode.decisions.confirmChoose", { option: decisionReply(pending.option) }) : ""}
        destructive={false}
        busy={deciding}
        testId="project-decision-confirm"
        confirmTestId="project-decision-confirm-confirm"
        onCancel={() => setPending(null)}
        onConfirm={() => void recordChoice()}
      />
    </div>
  )
}
