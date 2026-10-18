/**
 * The PUT /api/v1/tasks/[id] body for a whole edited task (AWTD-1269).
 *
 * The detail pane edits a copy of the task it READ, so `assigneeIds` rides
 * along unchanged when only `assigneeId` was edited. Sending both would say
 * "B is primary" next to "[A] is the list", which `nextAssigneeIds` refuses as
 * `assignee_ids_mismatch`. An untouched list is therefore left out, and the
 * server applies plain `assigneeId` semantics: replace the primary, keep the
 * others.
 */

type EditedTask = {
  lists?: readonly { id: string }[] | null
  assignee?: { id: string } | null
  assigneeIds?: readonly string[] | null
}

const sameIds = (a?: readonly string[] | null, b?: readonly string[] | null) =>
  (a ?? []).length === (b ?? []).length && (a ?? []).every((id, i) => id === b?.[i])

export function v1TaskUpdateBody<T extends EditedTask>(
  updated: T,
  original?: EditedTask | null,
): Record<string, unknown> {
  const { lists, assignee, assigneeIds, ...rest } = updated
  const body: Record<string, unknown> = {
    ...rest,
    listIds: lists?.map(list => list.id) ?? [],
    assigneeId: assignee?.id ?? null,
  }
  if (assigneeIds !== undefined && !sameIds(assigneeIds, original?.assigneeIds)) {
    body.assigneeIds = assigneeIds
  }
  return body
}
