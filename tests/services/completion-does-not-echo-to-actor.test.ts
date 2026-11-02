/**
 * Task 8ef93fb9, incident B — a completion toggle does not echo back to the
 * client that made it. Rewritten for AWTD-1497.
 *
 * Between 2026-09-08 14:06 and 14:38 UTC, complete/incomplete flipped
 * repeatedly across nearly every open task on the Astrid Web board. The
 * investigation ruled out a server-side echo loop because the actor was
 * excluded from the update fan-out: the client that toggled never received its
 * own `task_completed`, so there was nothing for it to re-send into. The
 * alternating pattern pointed at a client bug instead (AITD-360).
 *
 * That exclusion also kept the actor's OTHER devices waiting for the 60-second
 * sync. AWTD-1497 (Jon, 2026-11-02: "track per device/application") narrows it
 * from "the actor" to "the client that made the write":
 *
 * - A write that names its client (lib/realtime/client-id.ts) reaches the
 *   actor's other devices, tagged so the originating stream drops it
 *   (tests/lib/sse-client-echo.test.ts pins that drop).
 * - A write with no client id leaves the actor out, exactly as before.
 * - An AI-agent actor is always left out.
 *
 * If either the tag or the drop stops being true, the amplifier the
 * investigation ruled out becomes possible again. These go red first.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const sse = vi.hoisted(() => ({ broadcastToUsers: vi.fn() }))
vi.mock('@/lib/sse-utils', () => sse)
vi.mock('@/lib/tasks/v1-task-shape', () => ({ loadV1TaskForEvent: vi.fn(async () => ({ id: 't1' })) }))
vi.mock('@/lib/agent-protocol', () => ({ enrichTaskForAgent: (t: unknown) => t }))
const db = vi.hoisted(() => ({ user: { findUnique: vi.fn() } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { broadcastTaskUpdated, updateEventRecipients } from '@/services/task-update-broadcast'
import { resetActorKindCache } from '@/services/task-event-audience'

const ACTOR = 'user-actor'
const MATE = 'user-mate'
const TAB = 'web_tab_that_toggled'

function completion(originClientId?: string, actorType?: 'user' | 'agent') {
  const task = { id: 't1', title: 'T', assigneeId: null, creatorId: ACTOR, completed: true, lists: [] }
  return broadcastTaskUpdated({
    task,
    existingTask: { ...task, completed: false },
    assigneeWritten: false,
    justCompleted: true,
    audience: new Set([ACTOR, MATE]),
    viewers: new Set([ACTOR, MATE]),
    actorId: ACTOR,
    legacySsePayload: false,
    actorType,
    originClientId,
  })
}

describe('a task update never echoes to the client that made it (8ef93fb9, AWTD-1497)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetActorKindCache()
    db.user.findUnique.mockResolvedValue({ isAIAgent: false })
  })

  it('without a client id the actor is left out entirely, as before', async () => {
    await completion()
    const [ids, event, opts] = sse.broadcastToUsers.mock.calls[0]
    expect(event.type).toBe('task_completed')
    expect(ids).toEqual([MATE])
    expect(opts?.originClientId ?? null).toBeNull()
  })

  it('with a client id the actor\'s devices hear it, tagged so the originating tab drops it', async () => {
    await completion(TAB)
    const [ids, event, opts] = sse.broadcastToUsers.mock.calls[0]
    expect(event.type).toBe('task_completed')
    expect([...ids].sort()).toEqual([ACTOR, MATE].sort())
    expect(opts).toEqual({ originClientId: TAB, originUserId: ACTOR })
  })

  it('every event the update sends carries the tag', async () => {
    await completion(TAB)
    for (const call of sse.broadcastToUsers.mock.calls) {
      expect(call[2]).toEqual({ originClientId: TAB, originUserId: ACTOR })
    }
  })

  it('an AI-agent actor never hears its own update, client id or not', async () => {
    db.user.findUnique.mockResolvedValue({ isAIAgent: true })
    expect(await updateEventRecipients({ audience: [ACTOR, MATE], actorId: ACTOR, originClientId: TAB })).toEqual([MATE])
  })

  it('an agent the route resolved as one is left out even when its row is not flagged (review on #637)', async () => {
    // resolveAgentAuthor accepts agent mailboxes whose isAIAgent flag is false.
    db.user.findUnique.mockResolvedValue({ isAIAgent: false })
    await completion(TAB, 'agent')
    const [ids, , opts] = sse.broadcastToUsers.mock.calls[0]
    expect(ids).toEqual([MATE])
    expect(opts).toBeUndefined()
  })
})
