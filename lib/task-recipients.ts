/**
 * Collect the user ids that should be notified about a task change — the
 * owner and members of every list the task belongs to. Callers pass lists that
 * were ALREADY fetched with the task (ownerId + listMembers), so this replaces
 * the per-list `taskList.findUnique` refetch loops that ran on every task
 * mutation (N+1 on the hottest write endpoints).
 */
export function collectListRecipientUserIds(
  lists: Array<{ ownerId: string; listMembers: Array<{ userId: string }> }>
): Set<string> {
  const ids = new Set<string>()
  for (const list of lists) {
    ids.add(list.ownerId)
    for (const m of list.listMembers) ids.add(m.userId)
  }
  return ids
}
