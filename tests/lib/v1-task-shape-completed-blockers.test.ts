import { describe, expect, it } from 'vitest'
import { shapeV1Task } from '@/lib/tasks/v1-task-shape'

// ADEV-45: a blocker that already finished must not read as a live block. The
// caller may not be able to read the blocker's list, so the wire has to carry
// the answer itself.
describe('ADEV-45 shapeV1Task completed blockers', () => {
  const row = (blockedBy: Array<{ blockingTaskId: string; blockingTask: { completed: boolean } }>) =>
    ({ id: 't1', lists: [], blockedBy, blocks: [] }) as unknown as Parameters<typeof shapeV1Task>[0]

  it('drops completed blockers from blockedBy', () => {
    const shaped = shapeV1Task(
      row([
        { blockingTaskId: 'done-on-private-board', blockingTask: { completed: true } },
        { blockingTaskId: 'still-open', blockingTask: { completed: false } },
      ]),
    )
    expect(shaped.blockedBy).toEqual(['still-open'])
  })

  it('reports no blockers when every blocker is completed', () => {
    const shaped = shapeV1Task(row([{ blockingTaskId: 'x', blockingTask: { completed: true } }]))
    expect(shaped.blockedBy).toEqual([])
  })
})
