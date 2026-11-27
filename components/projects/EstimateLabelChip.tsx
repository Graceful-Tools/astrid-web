"use client"

/**
 * The trade-off label on an idea (ADEV-281, docs/specs/GOALS_GUARDRAILS_SIGNALS.md → Surfaces), with
 * the reason lines that earned it. The chip is a button: hover shows the lines as a tooltip, and a tap
 * opens them, so touch screens get them too. The label and its numbers come ready from the server;
 * this only words them. Draws nothing when no policy is stated (the server stores no label then).
 *
 * A label is a recommendation. A person may move any idea anywhere regardless of it.
 */
import React from "react"
import { Badge } from "@/components/ui/badge"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useTranslations } from "@/lib/i18n/client"
import type { GoalsAndGuardrails } from "@/lib/goals-guardrails"
import { knownLabel, labelReasonLines } from "@/lib/estimate-card"

export interface EstimateLabelData {
  label: string | null
  labelReasons: { code: string; [key: string]: unknown }[] | null
}

/** The reasons as plain sentences, for the tooltip and the popover alike. */
export function useReasonSentences(data: EstimateLabelData, project: GoalsAndGuardrails): string[] {
  const { t } = useTranslations()
  return labelReasonLines(data.labelReasons, project).map(line => {
    const values = { ...line.values }
    for (const name of line.levels) values[name] = t(`projectMode.estimate.level.${values[name]}`)
    return t(`projectMode.estimate.reason.${line.code}`, values)
  })
}

export function EstimateLabelChip({ estimate, project }: { estimate: EstimateLabelData; project: GoalsAndGuardrails }) {
  const { t } = useTranslations()
  const label = knownLabel(estimate.label)
  const sentences = useReasonSentences(estimate, project)
  if (!label) return null
  const name = t(`projectMode.estimate.label.${label}`)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex rounded-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          title={sentences.join("\n")}
          aria-label={t("projectMode.estimate.label.chipAria", { label: name })}
          data-testid="estimate-label-chip"
          data-label={label}
        >
          <Badge
            variant={label === "do-now" ? "secondary" : "outline"}
            className={label === "dont" ? "border-danger text-danger" : undefined}
          >
            {name}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 max-w-[90vw] space-y-1" align="start" data-testid="estimate-label-reasons">
        <h4 className="text-xs font-medium uppercase theme-text-muted">{t("projectMode.estimate.label.reasonsHeading")}</h4>
        <ul className="list-disc space-y-0.5 pl-4 text-xs theme-text-secondary">
          {sentences.map(sentence => (
            <li key={sentence} data-testid="estimate-label-reason">
              {sentence}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
