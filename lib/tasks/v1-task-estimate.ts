/**
 * `estimate` on a v1 task: the label and sort key its latest estimate earned under the project's
 * trade-off policy (ADEV-281, docs/specs/GOALS_GUARDRAILS_SIGNALS.md → 6).
 *
 * Opt-in on the list route (`?include=estimate`), for the reason `fields` is (lib/tasks/v1-task-fields.ts):
 * the full task response is already near its wire budget, and only the policy sort reads these keys.
 * There is **no key at all** on a task whose latest estimate has no label, which is every task on a
 * project that states no policy, so nothing changes for anyone until a policy is stored. A client
 * compares `sortKey` and never evaluates it (astrid-core `filters::sort_by_setting`, the `policy` arm).
 */

/** What a client reads of a task's estimate. */
export interface V1TaskEstimate {
  label: string
  /** A code and the values behind it, worded by the client. */
  labelReasons: { code: string }[]
  /** Compared lexicographically, smaller first. */
  sortKey: number[]
}

/** The columns the summary is read from. */
export interface TaskEstimateRow {
  label: string | null
  labelReasons: unknown
  sortKey: unknown
}

/**
 * The `estimates` select to spread into a task query, or `{}` when the caller did not ask. Only the
 * latest row: an older one is history, and a cleared label on the latest must not fall back to it.
 */
export function taskEstimateSelect(wanted: boolean = true) {
  if (!wanted) return {} as const
  return {
    estimates: {
      select: { label: true, labelReasons: true, sortKey: true },
      orderBy: { createdAt: 'desc' as const },
      take: 1,
    },
  } as const
}

const isNumbers = (value: unknown): value is number[] =>
  Array.isArray(value) && value.length > 0 && value.every(n => typeof n === 'number' && Number.isFinite(n))

/** The summary for one task, or undefined when there is nothing to say (no estimate, no label or no key). */
export function v1TaskEstimate(rows: TaskEstimateRow[] | undefined | null): V1TaskEstimate | undefined {
  const latest = rows?.[0]
  if (!latest?.label || !isNumbers(latest.sortKey)) return undefined
  const reasons = Array.isArray(latest.labelReasons) ? (latest.labelReasons as { code: string }[]) : []
  return { label: latest.label, labelReasons: reasons, sortKey: latest.sortKey }
}

/** `{ estimate }` or `{}`, ready to spread into a task payload (never `estimate: undefined`: see v1TaskFieldsPatch). */
export function v1TaskEstimatePatch(rows: TaskEstimateRow[] | undefined | null): { estimate?: V1TaskEstimate } {
  const estimate = v1TaskEstimate(rows)
  return estimate ? { estimate } : {}
}
