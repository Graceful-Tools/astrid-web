/**
 * Best-effort identifier minting for the task write verbs (AWTD-1016).
 *
 * Both CREATE and UPDATE mint: a task gets its `AST-142` the first time it
 * lands on a project list, whether it was created there or moved there. Both
 * treat minting the same way — no identifier is bad, a failed write because
 * of one is worse — so the policy lives here once instead of as two
 * try/catch blocks that could disagree.
 */
import { allocateTaskIdentifier } from '@/lib/task-identifier'
import { createLogger } from '@/lib/logger'

const log = createLogger('task-identifier-mint')

/**
 * The `{ identifier, sequence }` fields to write, or null when none of the
 * lists belongs to a project or allocation failed. Never throws.
 */
export async function mintTaskIdentifierBestEffort(
  listIds: string[]
): Promise<{ identifier: string; sequence: number } | null> {
  if (listIds.length === 0) return null
  try {
    return await allocateTaskIdentifier(listIds)
  } catch (err) {
    log.error({ err, listIds }, 'Failed to allocate task identifier')
    return null
  }
}
