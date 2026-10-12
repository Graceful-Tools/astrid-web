/**
 * `list.supports` (AWTD-1190, spec §11.2): every key at its classic value on a
 * local list, so a client never has to infer a capability from `backend`.
 */
import { describe, it, expect } from 'vitest'
import { listSupports } from '@/lib/backends/supports'
import { GITHUB_PROJECT_BACKEND } from '@/lib/backends/resolve'

describe('listSupports (AWTD-1190)', () => {
  it('multipleAssignees is true only on a GitHub-backed list', () => {
    expect(listSupports({ backend: GITHUB_PROJECT_BACKEND })).toMatchObject({ multipleAssignees: true })
  })

  it.each([{ backend: null }, { backend: undefined }, {}, { backend: 'something_else' }])(
    'a classic list (%o) keeps one assignee',
    list => {
      expect(listSupports(list)).toMatchObject({ multipleAssignees: false })
    },
  )
})

/**
 * AWTD-1118 (P6b): a GitHub board SPAWNS the next occurrence as a new issue;
 * a personal list rolls the same row forward, as it always has (spec §10).
 * Clients read this key to decide whether to roll forward locally.
 */
describe('listSupports.repeatMode (AWTD-1118)', () => {
  it('is spawn on a GitHub-backed list', () => {
    expect(listSupports({ backend: GITHUB_PROJECT_BACKEND }).repeatMode).toBe('spawn')
  })

  it.each([{ backend: null }, { backend: undefined }, {}, { backend: 'something_else' }])(
    'a classic list (%o) rolls forward',
    list => {
      expect(listSupports(list).repeatMode).toBe('roll_forward')
    },
  )
})
