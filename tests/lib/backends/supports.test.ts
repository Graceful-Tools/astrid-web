/**
 * `list.supports` (AWTD-1190, spec §11.2): every key at its classic value on a
 * local list, so a client never has to infer a capability from `backend`.
 */
import { describe, it, expect } from 'vitest'
import { listSupports } from '@/lib/backends/supports'
import { GITHUB_PROJECT_BACKEND } from '@/lib/backends/resolve'

describe('listSupports (AWTD-1190)', () => {
  it('multipleAssignees is true only on a GitHub-backed list', () => {
    expect(listSupports({ backend: GITHUB_PROJECT_BACKEND })).toEqual({ multipleAssignees: true })
  })

  it.each([{ backend: null }, { backend: undefined }, {}, { backend: 'something_else' }])(
    'a classic list (%o) keeps one assignee',
    list => {
      expect(listSupports(list)).toEqual({ multipleAssignees: false })
    },
  )
})
