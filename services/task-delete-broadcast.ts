/**
 * The live event for a deleted task (AWTD-1497).
 *
 * Taken out of services/task.service.ts (the oversized-files ratchet) when the
 * deleter's own devices were added to the audience: the tab that deleted has
 * already dropped the row, so the echo is a no-op there, and every other device
 * that person has open needs it. An AI-agent deleter hears nothing of its own
 * write (services/task-event-audience.ts).
 *
 * Best-effort: a missed nudge costs a refresh, not correctness — the tombstone
 * written before this is what makes the deletion durable for delta sync.
 */

import { broadcastToUsers } from '@/lib/sse-utils'
import { actorHearsOwnChange } from '@/services/task-event-audience'

export async function broadcastTaskDeleted(args: {
  taskId: string
  taskTitle: string
  audience: string[]
  actorId: string
  actorName?: string | null
  listNames: string[]
}): Promise<void> {
  const { taskId, taskTitle, audience, actorId, actorName, listNames } = args
  try {
    const recipients = (await actorHearsOwnChange(actorId))
      ? Array.from(new Set([...audience, actorId]))
      : audience.filter(id => id !== actorId)
    if (recipients.length === 0) return
    broadcastToUsers(recipients, {
      type: 'task_deleted',
      timestamp: new Date().toISOString(),
      data: { taskId, taskTitle, deleterName: actorName ?? null, userId: actorId, listNames },
    })
  } catch {
    // See the header: best-effort by design.
  }
}
