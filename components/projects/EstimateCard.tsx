"use client"

/**
 * One estimate, drawn (ADEV-280, spec: docs/specs/GOALS_GUARDRAILS_SIGNALS.md → Surfaces): a range bar per
 * goal and guardrail with the target or limit as a reference line, a risk chip with its factors, tiles for
 * impact, cost and opportunity, and the source, confidence and age, always. A built-in estimate says
 * "rough estimate" and shows ranges only. The numbers come ready from the server; this only draws them.
 *
 * A section the estimator did not give is "not estimated", never a zero.
 */
import React from "react"
import { Badge } from "@/components/ui/badge"
import { useTranslations } from "@/lib/i18n/client"
import { CHART_SERIES_COLORS } from "@/lib/brand/colors"
import type { GoalsAndGuardrails } from "@/lib/goals-guardrails"
import type { EstimateView } from "@/services/task-estimate.service"
import {
  estimateAge,
  formatDollars,
  formatSigned,
  formatSignedCount,
  goalRows,
  guardrailRows,
  opportunity,
  rangeDomain,
  rangePercent,
  sourceKind,
  type RangeRow,
} from "@/lib/estimate-card"

/** The wire shape of an estimate: what GET /api/v1/tasks/:id/estimates sends. */
export type EstimateCardData = Pick<
  EstimateView,
  | "id"
  | "source"
  | "createdAt"
  | "rough"
  | "confidence"
  | "goalImpacts"
  | "guardrailImpacts"
  | "risk"
  | "costMicrocents"
  | "effortHours"
  | "reach"
  | "rationale"
>

/**
 * The range bars are plain SVG, not recharts. The estimate card is the second async consumer of recharts
 * beside the admin analytics page (which loads it statically); that made the bundler split recharts into
 * a chunk of its own, and the extra chunk took the analytics route over its initial-JS ceiling. A range
 * bar with a reference line needs no chart library, and keeps `CHART_SERIES_COLORS` like the charts do.
 */
function RangeBar({ row, domain, color }: { row: RangeRow; domain: [number, number]; color: string }) {
  const low = rangePercent(row.low, domain)
  const high = rangePercent(row.high, domain)
  const zero = rangePercent(0, domain)
  const reference = row.reference === null ? null : rangePercent(row.reference, domain)
  return (
    <svg
      viewBox="0 0 100 10"
      preserveAspectRatio="none"
      className="h-3 w-full"
      role="presentation"
      data-testid="estimate-range-bar"
    >
      <rect x="0" y="4.5" width="100" height="1" className="fill-current opacity-20" />
      <line x1={zero} x2={zero} y1="1" y2="9" stroke="currentColor" strokeOpacity={0.5} strokeWidth={0.4} vectorEffect="non-scaling-stroke" />
      <rect x={low} y="2" width={Math.max(high - low, 0.8)} height="6" rx="1" fill={color} />
      {reference !== null && (
        <line
          data-testid="estimate-reference-line"
          data-reference={row.reference ?? undefined}
          x1={reference}
          x2={reference}
          y1="0"
          y2="10"
          stroke={CHART_SERIES_COLORS[2]}
          strokeWidth={2}
          strokeDasharray="3 2"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  )
}

function RangeBars({ rows, color, testId }: { rows: RangeRow[]; color: string; testId: string }) {
  const { t } = useTranslations()
  const domain = rangeDomain(rows)
  return (
    <div data-testid={testId}>
      <ul className="mb-1 space-y-0.5 text-xs theme-text-secondary">
        {rows.map(row => (
          <li key={row.id} data-testid="estimate-range-row">
            <span className="theme-text-primary">{row.statement}</span>{" "}
            {t("projectMode.estimate.range", {
              low: formatSigned(row.low),
              high: formatSigned(row.high),
              unit: row.unit ?? "",
            })}
            {row.reference !== null && (
              <span className="ml-1 theme-text-muted">
                {t("projectMode.estimate.reference", { value: formatSigned(row.reference), unit: row.unit ?? "" })}
              </span>
            )}
            {row.breachProbability !== undefined && (
              <span className="ml-1 text-danger">
                {t("projectMode.estimate.breach", { pct: String(Math.round(row.breachProbability * 100)) })}
              </span>
            )}
          </li>
        ))}
      </ul>
      <div aria-hidden="true" className="space-y-1 theme-text-muted">
        {rows.map(row => (
          <RangeBar key={row.id} row={row} domain={domain} color={color} />
        ))}
        <div className="flex justify-between text-xs">
          <span>{formatSigned(domain[0])}</span>
          <span>{formatSigned(domain[1])}</span>
        </div>
      </div>
    </div>
  )
}

function Tile({ label, children, testId }: { label: string; children: React.ReactNode; testId: string }) {
  return (
    <div className="rounded-md border theme-border p-2" data-testid={testId}>
      <div className="text-xs theme-text-muted">{label}</div>
      <div className="text-sm font-medium theme-text-primary">{children}</div>
    </div>
  )
}

const NOT_ESTIMATED = "projectMode.estimate.notEstimated"

export function EstimateCard({ estimate, project }: { estimate: EstimateCardData; project: GoalsAndGuardrails }) {
  const { t } = useTranslations()
  const [now] = React.useState(() => new Date())
  const goals = goalRows(estimate.goalImpacts, project, estimate.rough)
  const guardrails = guardrailRows(estimate.guardrailImpacts, project, estimate.rough)
  const primary = goals[0]
  const reach = opportunity(estimate.reach, estimate.goalImpacts)
  const age = estimateAge(estimate.createdAt, now)
  const kind = sourceKind(estimate.source)
  const sourceName =
    kind === "builtin"
      ? t("projectMode.estimate.sourceBuiltin")
      : kind === "human"
        ? t("projectMode.estimate.sourceHuman")
        : estimate.source.replace(/^service:/, "")

  return (
    <div className="space-y-3" data-testid="estimate-card">
      <div className="flex flex-wrap items-center gap-1.5 text-xs" data-testid="estimate-meta">
        {estimate.rough && (
          <Badge variant="outline" title={t("projectMode.estimate.roughHint")} data-testid="estimate-rough">
            {t("projectMode.estimate.rough")}
          </Badge>
        )}
        <span className="theme-text-secondary">{t("projectMode.estimate.source", { source: sourceName })}</span>
        <span className="theme-text-muted">·</span>
        <span className="theme-text-secondary" data-testid="estimate-confidence">
          {t("projectMode.estimate.confidence", { level: t(`projectMode.estimate.level.${estimate.confidence}`) })}
        </span>
        <span className="theme-text-muted">·</span>
        <span className="theme-text-secondary" data-testid="estimate-age">
          {t(`projectMode.estimate.age.${age.unit}`, { n: String(age.n) })}
        </span>
      </div>

      {goals.length > 0 && (
        <section>
          <h4 className="mb-1 text-xs font-medium uppercase theme-text-muted">{t("projectMode.estimate.goalsHeading")}</h4>
          <RangeBars rows={goals} color={CHART_SERIES_COLORS[0]} testId="estimate-goal-bars" />
        </section>
      )}
      {guardrails.length > 0 && (
        <section>
          <h4 className="mb-1 text-xs font-medium uppercase theme-text-muted">{t("projectMode.estimate.guardrailsHeading")}</h4>
          <RangeBars rows={guardrails} color={CHART_SERIES_COLORS[3]} testId="estimate-guardrail-bars" />
        </section>
      )}

      <div className="flex flex-wrap items-center gap-1.5" data-testid="estimate-risk">
        <Badge
          variant={estimate.risk.level === "low" ? "secondary" : "outline"}
          className={estimate.risk.level === "high" ? "border-danger text-danger" : undefined}
          data-testid="estimate-risk-chip"
        >
          {t("projectMode.estimate.risk", { level: t(`projectMode.estimate.level.${estimate.risk.level}`) })}
        </Badge>
        {estimate.risk.factors.map(factor => (
          <Badge key={factor} variant="outline" data-testid="estimate-risk-factor">
            {factor}
          </Badge>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Tile label={t("projectMode.estimate.impact")} testId="estimate-tile-impact">
          {primary
            ? t("projectMode.estimate.range", {
                low: formatSigned(primary.low),
                high: formatSigned(primary.high),
                unit: primary.unit ?? "",
              })
            : t(NOT_ESTIMATED)}
        </Tile>
        <Tile label={t("projectMode.estimate.cost")} testId="estimate-tile-cost">
          {estimate.costMicrocents !== null ? formatDollars(estimate.costMicrocents) : t(NOT_ESTIMATED)}
          {estimate.effortHours !== null && (
            <div className="text-xs font-normal theme-text-muted">
              {t("projectMode.estimate.effort", { hours: String(estimate.effortHours) })}
            </div>
          )}
        </Tile>
        <Tile label={t("projectMode.estimate.opportunity")} testId="estimate-tile-opportunity">
          {reach
            ? t("projectMode.estimate.opportunityRange", {
                low: formatSignedCount(reach.low),
                high: formatSignedCount(reach.high),
                unit: reach.unit,
                period: reach.period,
              })
            : t(NOT_ESTIMATED)}
        </Tile>
      </div>

      {estimate.rationale && (
        <p className="text-xs theme-text-secondary" data-testid="estimate-rationale">
          {estimate.rationale}
        </p>
      )}
    </div>
  )
}
