"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { ShieldCheck } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useTranslations } from "@/lib/i18n/client"
import { useProjectGoals } from "@/hooks/use-project-goals"
import { getAllListMembers } from "@/lib/list-member-utils"
import { agentMailboxFromEmail } from "@/lib/brand/agent-emails"
import {
  AUTONOMY_FIELDS,
  AUTONOMY_VALUES,
  autonomyFor,
  LEVELS,
  TRADEOFF_LEVEL_FIELDS,
  TRADEOFF_PROBABILITY_FIELDS,
  defaultOrchestrationPolicy,
  defaultTradeoffPolicy,
  overrideAutonomyFor,
  overrideTradeoffFor,
  resolvePolicy,
  tradeoffFor,
  withAssignTo,
  withAutonomy,
  withEscalation,
  withGoalOrder,
  withTradeoffField,
  withTradeoffStated,
  type Autonomy,
  type AutonomyField,
  type Escalation,
  type Level,
  type OrchestrationPolicy,
  type PolicyOverride,
  type TradeoffField,
  type TradeoffPolicy,
} from "@/lib/orchestration-policy"
import type { ProjectGoal } from "@/lib/goals-guardrails"
import type { TaskList } from "@/types/task"

/** GET /api/v1/lists/:id/orchestration-policy (services/orchestration-policy.service.ts). */
interface PolicyView {
  listId: string
  projectId: string | null
  list: PolicyOverride | null
  project: PolicyOverride | null
  effective: OrchestrationPolicy
  canEdit: { list: boolean; project: boolean }
}

type Scope = "project" | "list"

const INHERIT = "__inherit"
const ANY_AGENT = "__any"
const PERSON = "person:"

interface OrchestrationPolicySectionProps {
  list: TaskList
}

/**
 * The orchestration policy in list settings (AWTD-1693): who takes this board's unassigned Ready
 * work, what an agent may do alone, and who it asks. One policy per project, which this list may
 * override field by field; a list with no project has only its own.
 *
 * Every choice saves at once, like the switches beside it. The server resolves and answers the
 * effective policy (the browser has no core build for these rules); "inherit" labels show what
 * the field falls back to, from the same rules in TypeScript.
 *
 * Loaded lazily from list-admin-settings.tsx, so it costs no route its first load.
 */
/** A response that is not the policy view (an error body, an older server) hides the section. */
function isPolicyView(data: unknown): data is PolicyView {
  if (!data || typeof data !== "object") return false
  const view = data as Partial<PolicyView>
  return !!view.effective && !!view.canEdit && typeof view.canEdit === "object"
}

export default function OrchestrationPolicySection({ list }: OrchestrationPolicySectionProps) {
  const { t } = useTranslations()
  const [view, setView] = useState<PolicyView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<Scope | null>(null)

  const url = `/api/v1/lists/${encodeURIComponent(list.id)}/orchestration-policy`

  useEffect(() => {
    let cancelled = false
    fetch(url, { credentials: "include" })
      .then(response => (response.ok ? response.json() : null))
      .then(data => { if (!cancelled && isPolicyView(data)) setView(data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [url])

  // The project's goals, for the trade-off's goal order.
  const { state: goals } = useProjectGoals(view?.projectId ?? undefined)

  const members = useMemo(() => getAllListMembers(list as never), [list])
  const agents = useMemo(
    () => [...new Set(members.map(member => agentMailboxFromEmail(member.email)).filter((m): m is string => !!m))],
    [members],
  )
  const people = useMemo(() => members.filter(member => !agentMailboxFromEmail(member.email)), [members])

  const save = useCallback(async (scope: Scope, policy: PolicyOverride | null) => {
    if (!view) return
    setSaving(scope)
    setError(null)
    try {
      const target = scope === "project" && view.projectId
        ? `/api/v1/projects/${encodeURIComponent(view.projectId)}/orchestration-policy`
        : url
      const response = await fetch(target, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policy }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : t("orchestrationPolicy.saveFailed"))
      // A project write answers the project's view; re-read the list's so its effective policy follows.
      const fresh = scope === "project" ? await fetch(url, { credentials: "include" }).then(r => r.json()) : data
      if (isPolicyView(fresh)) setView(fresh)
    } catch (err) {
      setError(err instanceof Error ? err.message : t("orchestrationPolicy.saveFailed"))
    } finally {
      setSaving(null)
    }
  }, [t, url, view])

  if (!view) return null
  const scopes: Scope[] = view.projectId ? ["project", "list"] : ["list"]
  if (!view.canEdit.list && !view.canEdit.project) return null

  const autonomyLabel = (value: Autonomy) => t(`orchestrationPolicy.autonomy.${value}`)
  const escalationLabel = (escalation: Escalation) => {
    if (escalation.to !== "people") return t(`orchestrationPolicy.escalation.${escalation.to}`)
    const names = escalation.userIds.map(id => {
      const person = members.find(member => member.id === id)
      return person?.name || person?.email || id
    })
    return names.join(", ")
  }
  const routingLabel = (assignTo: string | null) => assignTo ?? t("orchestrationPolicy.routing.anyAgent")

  return (
    <div className="border-t theme-border pt-4 space-y-3" data-testid="orchestration-policy">
      <div className="flex items-center space-x-2">
        <ShieldCheck className="w-4 h-4 text-brand" />
        <Label className="text-sm font-medium theme-text-primary">{t("orchestrationPolicy.title")}</Label>
      </div>
      <p className="text-xs theme-text-muted">{t("orchestrationPolicy.help")}</p>

      {scopes.map(scope => {
        const override = scope === "project" ? view.project : view.list
        // What an unset field falls back to: the default for a project, the project's policy for a list.
        const inherited = scope === "project" ? defaultOrchestrationPolicy() : resolvePolicy(view.project, null)
        const editable = scope === "project" ? view.canEdit.project : view.canEdit.list
        const disabled = !editable || saving !== null
        const inheritLabel = (value: string) =>
          t(scope === "project" ? "orchestrationPolicy.default" : "orchestrationPolicy.inherit", { value })

        const assignTo = override?.routing && Object.hasOwn(override.routing, "assignTo") ? override.routing.assignTo ?? null : undefined
        const routingValue = assignTo === undefined ? INHERIT : assignTo === null ? ANY_AGENT : assignTo
        const routingOptions = [...new Set([...agents, ...(assignTo ? [assignTo] : [])])]

        const escalation = override?.escalation
        const escalationValue = !escalation
          ? INHERIT
          : escalation.to === "people" ? `${PERSON}${escalation.userIds[0] ?? ""}` : escalation.to
        const personOptions = [
          ...people.map(person => ({ id: person.id, label: person.name || person.email })),
          ...(escalation?.to === "people" && escalation.userIds[0] && !people.some(p => p.id === escalation.userIds[0])
            ? [{ id: escalation.userIds[0], label: escalationLabel(escalation) }]
            : []),
        ]

        return (
          <div key={scope} className="space-y-2" data-testid={`orchestration-policy-${scope}`}>
            <div className="space-y-0.5">
              <Label className="text-sm theme-text-secondary">{t(`orchestrationPolicy.scope.${scope}`)}</Label>
              <p className="text-xs theme-text-muted">{t(`orchestrationPolicy.scope.${scope}Help`)}</p>
            </div>

            <PolicyRow label={t("orchestrationPolicy.routing.label")}>
              <Select
                value={routingValue}
                disabled={disabled}
                onValueChange={value => save(scope, withAssignTo(override, value === INHERIT ? undefined : value === ANY_AGENT ? null : value))}
              >
                <SelectTrigger className="theme-bg-tertiary theme-border theme-text-primary" data-testid={`orchestration-${scope}-routing`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="theme-bg-primary theme-border z-above-modal">
                  <SelectItem value={INHERIT}>{inheritLabel(routingLabel(inherited.routing.assignTo))}</SelectItem>
                  <SelectItem value={ANY_AGENT}>{t("orchestrationPolicy.routing.anyAgent")}</SelectItem>
                  {routingOptions.map(mailbox => (
                    <SelectItem key={mailbox} value={mailbox}>{mailbox}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PolicyRow>

            {AUTONOMY_FIELDS.map(field => (
              <AutonomyRow
                key={field}
                scope={scope}
                field={field}
                value={overrideAutonomyFor(override, field)}
                inheritLabel={inheritLabel(autonomyLabel(autonomyFor(inherited, field)))}
                autonomyLabel={autonomyLabel}
                label={t(`orchestrationPolicy.action.${field}`)}
                disabled={disabled}
                onChange={value => save(scope, withAutonomy(override, field, value))}
              />
            ))}

            <TradeoffEditor
              scope={scope}
              override={override}
              inherited={inherited.tradeoff ?? defaultTradeoffPolicy()}
              inheritedStated={!!inherited.tradeoff}
              disabled={disabled}
              goals={goals?.goals ?? []}
              inheritLabel={inheritLabel}
              onSave={next => save(scope, next)}
            />

            <PolicyRow label={t("orchestrationPolicy.escalation.label")}>
              <Select
                value={escalationValue}
                disabled={disabled}
                onValueChange={value =>
                  save(scope, withEscalation(
                    override,
                    value === INHERIT ? undefined
                      : value.startsWith(PERSON) ? { to: "people", userIds: [value.slice(PERSON.length)] }
                      : { to: value as "listOwner" | "taskCreator" },
                  ))
                }
              >
                <SelectTrigger className="theme-bg-tertiary theme-border theme-text-primary" data-testid={`orchestration-${scope}-escalation`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="theme-bg-primary theme-border z-above-modal">
                  <SelectItem value={INHERIT}>{inheritLabel(escalationLabel(inherited.escalation))}</SelectItem>
                  <SelectItem value="listOwner">{t("orchestrationPolicy.escalation.listOwner")}</SelectItem>
                  <SelectItem value="taskCreator">{t("orchestrationPolicy.escalation.taskCreator")}</SelectItem>
                  {personOptions.map(person => (
                    <SelectItem key={person.id} value={`${PERSON}${person.id}`}>{person.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PolicyRow>
          </div>
        )
      })}

      <div className="space-y-1" data-testid="orchestration-policy-effective">
        <Label className="text-sm theme-text-secondary">{t("orchestrationPolicy.effective")}</Label>
        <ul className="text-xs theme-text-muted space-y-0.5">
          <li>{t("orchestrationPolicy.line", { label: t("orchestrationPolicy.routing.label"), value: routingLabel(view.effective.routing.assignTo) })}</li>
          {AUTONOMY_FIELDS.map(field => (
            <li key={field}>{t("orchestrationPolicy.line", { label: t(`orchestrationPolicy.action.${field}`), value: autonomyLabel(autonomyFor(view.effective, field)) })}</li>
          ))}
          <li>{t("orchestrationPolicy.line", { label: t("orchestrationPolicy.escalation.label"), value: escalationLabel(view.effective.escalation) })}</li>
          <li data-testid="orchestration-effective-tradeoff">
            {t("orchestrationPolicy.line", {
              label: t("orchestrationPolicy.tradeoff.title"),
              value: view.effective.tradeoff ? t("orchestrationPolicy.tradeoff.stated") : t("orchestrationPolicy.tradeoff.none"),
            })}
          </li>
        </ul>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  )
}

/** The breach probabilities offered for a guardrail threshold; a stored one outside this list is added so it can be read. */
const PROBABILITY_CHOICES = [0.05, 0.1, 0.25, 0.5, 0.75, 0.9]

/**
 * The trade-off policy (ADEV-281, docs/specs/GOALS_GUARDRAILS_SIGNALS.md → 6): thresholds, not a rule
 * language. A switch states a policy (every threshold then takes its default until set); with none
 * stated nothing is labelled and the Policy sort is not offered. Each field saves at once like the
 * rows above it, and the server validates the values with the core's own vocabulary.
 */
function TradeoffEditor(props: {
  scope: Scope
  override: PolicyOverride | null
  inherited: TradeoffPolicy
  inheritedStated: boolean
  disabled: boolean
  goals: ProjectGoal[]
  inheritLabel: (value: string) => string
  onSave: (next: PolicyOverride | null) => void
}) {
  const { t } = useTranslations()
  const { scope, override, inherited, disabled } = props
  const stated = override?.tradeoff !== undefined
  const levelLabel = (level: Level) => t(`projectMode.estimate.level.${level}`)
  const probabilityLabel = (value: number) => t("orchestrationPolicy.tradeoff.probability", { pct: String(Math.round(value * 100)) })

  const ranked = override?.tradeoff?.goalOrder
  const orderedGoals = [
    ...(ranked ?? inherited.goalOrder).flatMap(id => props.goals.filter(goal => goal.id === id)),
    ...props.goals.filter(goal => !(ranked ?? inherited.goalOrder).includes(goal.id)),
  ]
  const move = (index: number, by: -1 | 1) => {
    const ids = orderedGoals.map(goal => goal.id)
    const target = index + by
    if (target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    props.onSave(withGoalOrder(override, ids))
  }

  return (
    <div className="space-y-2" data-testid={`orchestration-${scope}-tradeoff`}>
      <PolicyRow label={t("orchestrationPolicy.tradeoff.title")}>
        <div className="flex items-center justify-end gap-2">
          <span className="text-xs theme-text-muted">
            {stated ? t("orchestrationPolicy.tradeoff.stated") : props.inheritedStated ? props.inheritLabel(t("orchestrationPolicy.tradeoff.stated")) : t("orchestrationPolicy.tradeoff.none")}
          </span>
          <Switch
            checked={stated}
            disabled={disabled}
            aria-label={t("orchestrationPolicy.tradeoff.switch")}
            onCheckedChange={checked => props.onSave(withTradeoffStated(override, checked))}
            data-testid={`orchestration-${scope}-tradeoff-switch`}
          />
        </div>
      </PolicyRow>
      <p className="text-xs theme-text-muted">{t("orchestrationPolicy.tradeoff.help")}</p>

      {stated && (
        <>
          {TRADEOFF_LEVEL_FIELDS.map(field => (
            <TradeoffSelect
              key={field}
              scope={scope}
              field={field}
              label={t(`orchestrationPolicy.tradeoff.field.${field}`)}
              value={overrideTradeoffFor(override, field) as Level | undefined}
              inheritLabel={props.inheritLabel(levelLabel(tradeoffFor(inherited, field)))}
              options={LEVELS.map(level => ({ value: level, label: levelLabel(level) }))}
              disabled={disabled}
              onChange={value => props.onSave(withTradeoffField(override, field, value as Level | undefined))}
            />
          ))}
          {TRADEOFF_PROBABILITY_FIELDS.map(field => {
            const current = overrideTradeoffFor(override, field) as number | undefined
            const choices = [...new Set([...PROBABILITY_CHOICES, ...(current === undefined ? [] : [current])])].sort((a, b) => a - b)
            return (
              <TradeoffSelect
                key={field}
                scope={scope}
                field={field}
                label={t(`orchestrationPolicy.tradeoff.field.${field}`)}
                value={current === undefined ? undefined : String(current)}
                inheritLabel={props.inheritLabel(probabilityLabel(tradeoffFor(inherited, field)))}
                options={choices.map(value => ({ value: String(value), label: probabilityLabel(value) }))}
                disabled={disabled}
                onChange={value => props.onSave(withTradeoffField(override, field, value === undefined ? undefined : Number(value)))}
              />
            )
          })}

          {orderedGoals.length > 1 && (
            <div className="space-y-1" data-testid={`orchestration-${scope}-goal-order`}>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm theme-text-primary">{t("orchestrationPolicy.tradeoff.goalOrder")}</span>
                {ranked && (
                  <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" disabled={disabled} onClick={() => props.onSave(withGoalOrder(override, undefined))}>
                    {t("orchestrationPolicy.tradeoff.goalOrderReset")}
                  </Button>
                )}
              </div>
              <p className="text-xs theme-text-muted">{t("orchestrationPolicy.tradeoff.goalOrderHelp")}</p>
              <ol className="space-y-0.5">
                {orderedGoals.map((goal, index) => (
                  <li key={goal.id} className="flex items-center justify-between gap-2 text-xs theme-text-secondary">
                    <span className="truncate">{index + 1}. {goal.statement}</span>
                    <span className="flex shrink-0 gap-1">
                      <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" disabled={disabled || index === 0} aria-label={t("orchestrationPolicy.tradeoff.moveUp", { goal: goal.statement })} onClick={() => move(index, -1)}>↑</Button>
                      <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" disabled={disabled || index === orderedGoals.length - 1} aria-label={t("orchestrationPolicy.tradeoff.moveDown", { goal: goal.statement })} onClick={() => move(index, 1)}>↓</Button>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function TradeoffSelect(props: {
  scope: Scope
  field: TradeoffField
  label: string
  value: string | undefined
  inheritLabel: string
  options: { value: string; label: string }[]
  disabled: boolean
  onChange: (value: string | undefined) => void
}) {
  return (
    <PolicyRow label={props.label}>
      <Select value={props.value ?? INHERIT} disabled={props.disabled} onValueChange={value => props.onChange(value === INHERIT ? undefined : value)}>
        <SelectTrigger className="theme-bg-tertiary theme-border theme-text-primary" data-testid={`orchestration-${props.scope}-tradeoff-${props.field}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="theme-bg-primary theme-border z-above-modal">
          <SelectItem value={INHERIT}>{props.inheritLabel}</SelectItem>
          {props.options.map(option => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </PolicyRow>
  )
}

function PolicyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm theme-text-primary">{label}</span>
      <div className="w-44 shrink-0">{children}</div>
    </div>
  )
}

function AutonomyRow(props: {
  scope: Scope
  field: AutonomyField
  value: Autonomy | undefined
  inheritLabel: string
  autonomyLabel: (value: Autonomy) => string
  label: string
  disabled: boolean
  onChange: (value: Autonomy | undefined) => void
}) {
  return (
    <PolicyRow label={props.label}>
      <Select
        value={props.value ?? INHERIT}
        disabled={props.disabled}
        onValueChange={value => props.onChange(value === INHERIT ? undefined : (value as Autonomy))}
      >
        <SelectTrigger className="theme-bg-tertiary theme-border theme-text-primary" data-testid={`orchestration-${props.scope}-${props.field}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="theme-bg-primary theme-border z-above-modal">
          <SelectItem value={INHERIT}>{props.inheritLabel}</SelectItem>
          {AUTONOMY_VALUES.map(value => (
            <SelectItem key={value} value={value}>{props.autonomyLabel(value)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </PolicyRow>
  )
}
