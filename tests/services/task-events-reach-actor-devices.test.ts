/**
 * AWTD-1497 — a task you create or delete on one device reaches your others live.
 *
 * The live stream left the actor out of every task audience ("they are looking
 * at it"), which is true of the tab that made the change and of no other device
 * that person has open — so a task added on the phone reached the Mac only on
 * the 60-second sync timer (AITD-574). Comments made the same mistake and fixed
 * it in cb1581e0; receivers dedupe by id, so the echo costs one read.
 *
 * An AI-agent actor stays out, as for comments: agents listen on the same
 * stream and have no second device, so an echo could only make one react to
 * its own write.
 *
 * Update and completion are deliberately NOT covered here — see
 * completion-does-not-echo-to-actor.test.ts for why that audience still
 * excludes the actor.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const sse = vi.hoisted(() => ({ broadcastToUsers: vi.fn() }))
vi.mock('@/lib/sse-utils', () => sse)
vi.mock('@/lib/tasks/v1-task-shape', () => ({
  loadV1TaskForEvent: vi.fn(async () => ({ id: 'task-1' })),
  loadV1TasksForEvent: vi.fn(async () => new Map()),
}))
vi.mock('@/lib/agent-protocol', () => ({ enrichTaskForAgent: (t: unknown) => t }))
const db = vi.hoisted(() => ({ user: { findUnique: vi.fn() } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { broadcastTaskCreated } from '@/services/task-create-broadcast'
import { resetActorKindCache } from '@/services/task-event-audience'
import { broadcastBulkCreated } from '@/services/task-bulk-create'

const ACTOR = 'user-actor'
const MATE = 'user-mate'
const task = (assigneeId: string | null = null) => ({
  id: 'task-1',
  title: 'T',
  assigneeId,
  lists: [{ id: 'l1', name: 'Build', ownerId: ACTOR, listMembers: [{ userId: MATE }] }],
}) as never

function recipientsOf(type: string): string[] {
  return sse.broadcastToUsers.mock.calls
    .filter(([, event]) => (event as { type: string }).type === type)
    .flatMap(([ids]) => ids as string[])
}

describe('task events reach the actor\'s other devices (AWTD-1497)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetActorKindCache()
    db.user.findUnique.mockResolvedValue({ isAIAgent: false })
  })

  it('task_created goes to the creator as well as the rest of the list', async () => {
    await broadcastTaskCreated({ task: task(), actorId: ACTOR, creatorName: 'Me' })
    expect(recipientsOf('task_created').sort()).toEqual([ACTOR, MATE].sort())
  })

  it('a task you assign to yourself reaches your devices once, as task_assigned', async () => {
    await broadcastTaskCreated({ task: task(ACTOR), actorId: ACTOR, creatorName: 'Me' })
    expect(recipientsOf('task_assigned')).toEqual([ACTOR])
    expect(recipientsOf('task_created')).toEqual([MATE])
  })

  it('an AI-agent actor still never receives its own task events', async () => {
    db.user.findUnique.mockResolvedValue({ isAIAgent: true })
    await broadcastTaskCreated({ task: task(ACTOR), actorId: ACTOR, creatorName: 'Agent' })
    expect(recipientsOf('task_created')).toEqual([MATE])
    expect(recipientsOf('task_assigned')).toEqual([])
  })

  it('bulk create and copy reach the creator\'s devices too', async () => {
    await broadcastBulkCreated({ tasks: [task()] as never, actorId: ACTOR, creatorName: 'Me', memberIds: new Set() })
    expect(recipientsOf('task_created').sort()).toEqual([ACTOR, MATE].sort())
  })
})
