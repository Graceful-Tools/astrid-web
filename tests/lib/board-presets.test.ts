/**
 * R7 (astrid-core, Jon 2026-11-12): the optional Testing preset column. A board adds it with its
 * FIXED role `testing` (not a minted custom-…), it is offered only until the board has it, and a
 * task may be written into it.
 */
import { describe, expect, it } from 'vitest'
import { addPresetState } from '@/lib/project-custom-states'
import { isWritableStatusRole } from '@/services/task-status-role'
import { boardColumnBlurb, boardColumnLabel } from '@/lib/board-column-labels'
import { availableBoardPresets, offerableBoardPresets } from '@/lib/board-presets'
import { DEFAULT_STATES } from '@/lib/task-status'

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

describe('the Pending results preset column (ADEV-279)', () => {
  it('is added with its fixed role, name and description, like Testing', () => {
    const write = addPresetState([{ role: 'custom-review', name: 'Review', order: 3 }], 'results')
    expect('state' in write && write.state).toEqual({
      role: 'results',
      name: 'Pending results',
      description: 'Built and released; waiting for an experiment or a verification to report.',
      order: 4,
    })
    expect('error' in addPresetState([{ role: 'results', name: 'Pending results', order: 0 }], 'results')).toBe(true)
  })

  it('is a role a task may be written into, and reads in the reader’s language until renamed', () => {
    expect(isWritableStatusRole('results')).toBe(true)
    const t = (key: string) => ({ 'board.status.results': 'Ergebnisse ausstehend' })[key] ?? key
    expect(boardColumnLabel({ id: 'results', name: 'Pending results' }, t)).toBe('Ergebnisse ausstehend')
    expect(boardColumnLabel({ id: 'results', name: 'Proof' }, t)).toBe('Proof')
  })

  it('is offered only while goal signals are on: the gate narrows the core’s list, never widens it', () => {
    const all = availableBoardPresets([])
    expect(all.map(p => p.role)).toEqual(['testing', 'results'])
    expect(offerableBoardPresets(all, true).map(p => p.role)).toEqual(['testing', 'results'])
    expect(offerableBoardPresets(all, false).map(p => p.role)).toEqual(['testing'])
    expect(offerableBoardPresets(availableBoardPresets([{ role: 'results', name: 'Pending results' }]), true).map(p => p.role)).toEqual(['testing'])
  })

  it('is never added by default: no built-in state carries it', () => {
    expect(DEFAULT_STATES.map(state => state.role)).not.toContain('results')
  })
})
