/**
 * A task's assignees, primary first (AWTD-1190).
 *
 * Spec: docs/specs/GITHUB_PROJECTS_WHITELABEL.md §9.5. `assigneeId` is always
 * `assigneeIds[0]`. Pure, so the rule is the same wherever a task is read or
 * written:
 *
 *   assigneeIdsOf(row)        the list a client sees
 *   nextAssigneeIds(...)      what a write makes of it, or why it is refused
 *
 * The column is not backfilled and `assigneeId` is still written directly in
 * places, so the list is DERIVED: `assigneeId` is the primary whatever the
 * stored array says, and the array supplies the others.
 */

/** GitHub's own limit on an issue's assignees. */
export const MAX_ASSIGNEES = 10

export function assigneeIdsOf(row: { assigneeId?: string | null; assigneeIds?: readonly string[] | null }): string[] {
  const primary = row.assigneeId
  if (!primary) return []
  return [primary, ...(row.assigneeIds ?? []).filter(id => id !== primary)]
}

export type AssigneeWrite =
  | { ok: true; assigneeIds: string[]; /** Who was not assigned before. */ added: string[] }
  | {
      ok: false
      error: 'invalid_assignee_ids' | 'too_many_assignees' | 'multiple_assignees_not_supported' | 'assignee_ids_mismatch'
    }

/**
 * `assigneeIds` replaces the whole list. `assigneeId` alone — every client
 * older than the field — replaces ONLY the first entry, so nobody else is
 * unassigned by a client that cannot see them; clearing it promotes the next.
 * A list that does not support several keeps at most one.
 */
export function nextAssigneeIds(args: {
  current: readonly string[]
  intent: { assigneeId?: string | null; assigneeIds?: unknown }
  multiple: boolean
}): AssigneeWrite {
  const { intent, multiple } = args
  const current = multiple ? [...args.current] : args.current.slice(0, 1)
  const done = (assigneeIds: string[]): AssigneeWrite => ({
    ok: true,
    assigneeIds,
    added: assigneeIds.filter(id => !args.current.includes(id)),
  })

  if (intent.assigneeIds !== undefined) {
    const requested = intent.assigneeIds
    if (!Array.isArray(requested) || requested.some(id => typeof id !== 'string' || id === '')) {
      return { ok: false, error: 'invalid_assignee_ids' }
    }
    const assigneeIds = [...new Set(requested as string[])]
    if (assigneeIds.length > MAX_ASSIGNEES) return { ok: false, error: 'too_many_assignees' }
    if (assigneeIds.length > 1 && !multiple) return { ok: false, error: 'multiple_assignees_not_supported' }
    if (intent.assigneeId !== undefined && (intent.assigneeId || null) !== (assigneeIds[0] ?? null)) {
      return { ok: false, error: 'assignee_ids_mismatch' }
    }
    return done(assigneeIds)
  }

  if (intent.assigneeId !== undefined) {
    const primary = intent.assigneeId || null
    const others = current.slice(1).filter(id => id !== primary)
    return done(primary ? [primary, ...others] : others)
  }

  return done([...args.current])
}
