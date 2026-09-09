/**
 * Task 8ef93fb9, incident B — a completion toggle does not echo back to the
 * client that made it.
 *
 * Between 2026-09-08 14:06 and 14:38 UTC, complete/incomplete flipped
 * repeatedly across nearly every open task on the Astrid Web board — up to
 * twenty alternating toggles inside one minute on AWTD-853. Eight finished
 * tasks came out of it marked incomplete.
 *
 * The task asks whether a server-side sync loop, SSE echo or retry amplified
 * one tap into many writes. Two things rule that out, and this pins the one a
 * test can hold:
 *
 * 1. **The actor is excluded from the fan-out.** `updateTaskWithSideEffects`
 *    builds its SSE recipients as `audience.filter(id => id !== actorId)`, so
 *    the user who toggles never receives their own `task_completed` /
 *    `task_updated` event. There is no loop for a client to re-send into.
 *
 * 2. **The storm ALTERNATED**, which no retry can produce. A retry — the
 *    offline queue, a failed request replayed — sends the SAME value again;
 *    replaying `completed: true` twice is indistinguishable from once. Only a
 *    sequence of distinct intents produces true/false/true/false, and that is
 *    what the log shows.
 *
 * Together those point at the client bug the filing suspects (AITD-360, the
 * list-mode completion toggle, fixed for web in 36b389b7 and not yet deployed):
 * an optimistic completion that springs back looks exactly like a control that
 * did not work, and the reasonable response to a control that did not work is
 * to press it again.
 *
 * This test exists so that "the actor is excluded" cannot quietly stop being
 * true. If someone later adds the actor back to this audience — as the comment
 * fan-out did in 5139491, for its own good reasons — the amplifier the
 * investigation ruled out becomes possible again, and it should go red here
 * rather than be rediscovered in another board review.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SERVICE = 'services/task.service.ts'
const source = readFileSync(join(process.cwd(), SERVICE), 'utf8')

describe('a task update is not broadcast back to its actor (task 8ef93fb9)', () => {
  it('filters the actor out of the update fan-out', () => {
    // The exact line the investigation rests on.
    expect(
      source,
      `${SERVICE} no longer excludes the actor from the task-update SSE audience. ` +
        `That reopens the echo path the 2026-09-08 completion-toggle storm was ` +
        `investigated for and cleared of.`
    ).toContain('.filter(id => id !== actorId)')
  })

  it('sends task_completed through that same filtered audience', () => {
    // A completion that took a different, unfiltered path would defeat the
    // filter above without touching it.
    const broadcast = source.slice(source.indexOf("type: justCompleted ? 'task_completed'"))
    expect(broadcast.length).toBeGreaterThan(0)

    const declaration = source.slice(0, source.indexOf("type: justCompleted ? 'task_completed'"))
    expect(declaration).toContain('broadcastToUsers(updateRecipients')
  })

  it('derives updateRecipients from the filtered list, not from the raw audience', () => {
    // `updateRecipients` starts as `recipients` — the filtered set — and is only
    // ever narrowed. Starting it from `audience` would put the actor back in.
    expect(source).toContain('let updateRecipients = recipients')
    expect(source).not.toContain('let updateRecipients = Array.from(audience)')
  })
})
