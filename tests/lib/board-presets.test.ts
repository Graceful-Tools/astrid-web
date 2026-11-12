/**
 * R7 (astrid-core, Jon 2026-11-12): the optional Testing preset column. A board adds it with its
 * FIXED role `testing` (not a minted custom-…), it is offered only until the board has it, and a
 * task may be written into it.
 */
import { describe, expect, it } from 'vitest'
import { addPresetState } from '@/lib/project-custom-states'
import { isWritableStatusRole } from '@/services/task-status-role'
import { boardColumnBlurb, boardColumnLabel } from '@/lib/board-column-labels'

describe('the Testing preset column', () => {
  it('is added with its fixed role, name and description, after every column', () => {
    const write = addPresetState([{ role: 'custom-review', name: 'Review', order: 3 }], 'testing')
    expect('state' in write && write.state).toEqual({
      role: 'testing',
      name: 'Testing',
      description: 'Deploying, in canary, or in an experiment.',
      order: 4,
    })
  })

  it('is refused once the board has it, by role or by name', () => {
    expect('error' in addPresetState([{ role: 'testing', name: 'Testing', order: 0 }], 'testing')).toBe(true)
    expect('error' in addPresetState([{ role: 'custom-testing', name: 'testing', order: 0 }], 'testing')).toBe(true)
    expect('error' in addPresetState([], 'nope')).toBe(true)
  })

  it('is a role a task may be written into', () => {
    expect(isWritableStatusRole('testing')).toBe(true)
    expect(isWritableStatusRole('nonsense')).toBe(false)
  })

  it('reads in the reader’s language until renamed', () => {
    const t = (key: string) => ({ 'board.status.testing': 'Test', 'board.blurb.testing': 'Wird ausgerollt.' })[key] ?? key
    expect(boardColumnLabel({ id: 'testing', name: 'Testing' }, t)).toBe('Test')
    expect(boardColumnBlurb({ id: 'testing', description: 'Deploying, in canary, or in an experiment.' }, t)).toBe('Wird ausgerollt.')
    expect(boardColumnLabel({ id: 'testing', name: 'Canary' }, t)).toBe('Canary')
  })
})
