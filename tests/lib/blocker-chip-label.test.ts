/**
 * AWTD-1028 — a "Waiting on" chip names its blocker the way iOS/Mac do
 * (AITD-438): hidden → the hidden string, never the id; otherwise the short
 * id if there is one, else the title.
 */
import { describe, it, expect } from 'vitest'
import { blockerChipLabel } from '@/lib/task-dependencies'

const HIDDEN = 'A task you cannot see'

describe('blockerChipLabel (AWTD-1028)', () => {
  it('names a visible blocker by its short id', () => {
    expect(blockerChipLabel({ id: 'a', title: 'Fix login', identifier: 'AWTD-12' }, HIDDEN)).toBe('AWTD-12')
  })

  it('falls back to the title when the blocker has no id', () => {
    expect(blockerChipLabel({ id: 'a', title: 'Fix login', identifier: null }, HIDDEN)).toBe('Fix login')
    expect(blockerChipLabel({ id: 'a', title: 'Fix login', identifier: '' }, HIDDEN)).toBe('Fix login')
  })

  it('never shows a hidden blocker\'s id', () => {
    expect(blockerChipLabel({ id: 'a', identifier: 'AWTD-12', hidden: true }, HIDDEN)).toBe(HIDDEN)
  })
})
