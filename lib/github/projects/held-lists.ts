/**
 * Serving a mirrored-list lookup from what the replica already holds (AWTD-1315).
 *
 * `applyLabels`, `applyMilestones` and `applyIterationLists` each follow the
 * same three steps: collect the nodes GitHub named on this page, read the lists
 * for those nodes by `remoteNodeId`, then check each for drift and keep its id.
 * That read is unconditional, so an issue whose only change was its title still
 * paid a statement per flavor present — to be told exactly what the held rows
 * had already said.
 *
 * The held rows are the same `TaskList` rows. Since AWTD-1315 they carry `name`,
 * `color` and `description` (services/github-projects-replica.ts →
 * `HELD_LIST_SELECT`), which is everything the three drift checks compare. So a
 * node the task is already on needs no lookup at all, and the query shrinks to
 * the nodes nobody is holding — usually none.
 *
 * It is a split, NOT a skip, and the distinction is the whole safety argument: a
 * renamed label, a retitled milestone or a re-dated iteration is still read and
 * still corrected, because its node IS held and the drift check runs against the
 * held row. What goes away is only the lookup that could not have changed the
 * outcome.
 *
 * Shared rather than written three times because the three passes already drifted
 * once — see the note on `applyMilestones` about differing from `applyLabels` in
 * exactly one way — and "which of these nodes do we have to ask about" is the
 * same question in all three.
 */

/** A held mirrored list, as `HELD_LIST_SELECT` reads it. */
export interface HeldMirroredList {
  id: string
  remoteNodeId: string | null
  listType: string | null
  name: string
  color: string | null
  description: string | null
}

export interface HeldResolution {
  /** Node id → the held list for it. Drift is checked against these. */
  resolved: Map<string, HeldMirroredList>
  /** The node ids nobody holds, which still have to be read. Empty is the good case. */
  unresolved: string[]
}

/**
 * Split the nodes GitHub named into the ones held rows can answer and the rest.
 *
 * `listType` narrows to one flavor: a page can hold labels and milestones at
 * once, and a milestone list must never resolve a label's node id. Node ids are
 * globally unique on GitHub, so a mismatch here could only come from a bug —
 * which is exactly why it is filtered rather than assumed.
 */
export function resolveHeldLists(
  seenNodeIds: Iterable<string>,
  held: Iterable<HeldMirroredList>,
  listType: string,
): HeldResolution {
  const byNode = new Map<string, HeldMirroredList>()
  for (const list of held) {
    if (list.listType !== listType) continue
    if (typeof list.remoteNodeId === 'string' && list.remoteNodeId.length > 0) {
      byNode.set(list.remoteNodeId, list)
    }
  }

  const resolved = new Map<string, HeldMirroredList>()
  const unresolved: string[] = []
  for (const nodeId of seenNodeIds) {
    const list = byNode.get(nodeId)
    if (list) resolved.set(nodeId, list)
    else unresolved.push(nodeId)
  }

  return { resolved, unresolved }
}
