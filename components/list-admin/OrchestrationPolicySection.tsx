"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { ShieldCheck } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useTranslations } from "@/lib/i18n/client"
import { getAllListMembers } from "@/lib/list-member-utils"
import { agentMailboxFromEmail } from "@/lib/brand/agent-emails"
import {
  AUTONOMY_FIELDS,
  AUTONOMY_VALUES,
  autonomyFor,
  defaultOrchestrationPolicy,
  overrideAutonomyFor,
  resolvePolicy,
  withAssignTo,
  withAutonomy,
  withEscalation,
  type Autonomy,
  type AutonomyField,
  type Escalation,
  type OrchestrationPolicy,
  type PolicyOverride,
} from "@/lib/orchestration-policy"
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
                <SelectContent className="theme-bg-primary theme-border z-[10100]">
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
                <SelectContent className="theme-bg-primary theme-border z-[10100]">
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
        </ul>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
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
        <SelectContent className="theme-bg-primary theme-border z-[10100]">
          <SelectItem value={INHERIT}>{props.inheritLabel}</SelectItem>
          {AUTONOMY_VALUES.map(value => (
            <SelectItem key={value} value={value}>{props.autonomyLabel(value)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </PolicyRow>
  )
}
