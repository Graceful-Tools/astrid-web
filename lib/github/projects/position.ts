/**
 * A manual reorder on a GitHub board, as GitHub item moves (AWTD-1116 P5c).
 *
 * GitHub positions an item by the one it follows (updateProjectV2ItemPosition
 * with afterId; none = the top). So the moves are the items whose predecessor
 * changed — a single drag is at most three — applied in the new order, which
 * leaves GitHub in exactly the new order whatever it held for the rest.
 */

export interface ItemMove {
  taskId: string
  /** The task it now follows; null = the top. */
  afterTaskId: string | null
}

export function itemMoves(previous: readonly string[], next: readonly string[]): ItemMove[] {
  const before = new Map(previous.map((id, i) => [id, i > 0 ? previous[i - 1] : null]))
  return next.flatMap((taskId, i) => {
    const after = i > 0 ? next[i - 1] : null
    return before.has(taskId) && before.get(taskId) === after ? [] : [{ taskId, afterTaskId: after }]
  })
}

/** At most this many moves per reorder; a larger reshuffle is left to the next one. */
export const MAX_MOVES = 50

export function planItemMoves(
  projectNodeId: string,
  moves: ItemMove[],
  itemFor: (taskId: string) => string | undefined,
): { document: string; variables: Record<string, unknown> } | null {
  const params: string[] = []
  const fields: string[] = []
  const variables: Record<string, unknown> = { p: projectNodeId }
  for (const [i, move] of moves.slice(0, MAX_MOVES).entries()) {
    const item = itemFor(move.taskId)
    if (!item) continue
    const after = move.afterTaskId ? itemFor(move.afterTaskId) : undefined
    params.push(`$i${i}: ID!`)
    variables[`i${i}`] = item
    if (after) {
      params.push(`$a${i}: ID`)
      variables[`a${i}`] = after
    }
    fields.push(
      `m${i}: updateProjectV2ItemPosition(input: { projectId: $p, itemId: $i${i}${after ? `, afterId: $a${i}` : ''} }) { clientMutationId }`,
    )
  }
  if (fields.length === 0) return null
  return { document: `mutation($p: ID!, ${params.join(', ')}) { ${fields.join(' ')} }`, variables }
}
