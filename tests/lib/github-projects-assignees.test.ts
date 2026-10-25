/**
 * GitHub's assignees → Astrid's assigneeIds (AWTD-1190, P6c-4). Inbound only;
 * the outbound difference is tests/lib/github-projects-write.test.ts.
 */
import { describe, it, expect } from 'vitest'
import { remoteAssignees, planAssignees } from '@/lib/github/projects/assignees'
import { PROJECT_ITEM_FRAGMENT } from '@/lib/github/projects/hydrate'
import type { RemoteProjectItem } from '@/lib/github/projects/apply'

function item(typename: 'Issue' | 'DraftIssue' | 'PullRequest', assignees?: string[]): RemoteProjectItem {
  return {
    id: 'PVTI_1',
    isArchived: false,
    type: typename === 'Issue' ? 'ISSUE' : typename === 'DraftIssue' ? 'DRAFT_ISSUE' : 'PULL_REQUEST',
    updatedAt: '2026-10-10T00:00:00Z',
    content: {
      __typename: typename,
      id: 'C_1',
      title: 't',
      body: '',
      updatedAt: '2026-10-10T00:00:00Z',
      ...(assignees ? { assignees: { nodes: assignees.map(id => ({ id })) } } : {}),
    },
    fieldValues: { nodes: [] },
  }
}

describe('the hydration fragment reads assignees (AWTD-1190)', () => {
  it('on issues, pull requests and drafts — a draft has its own', () => {
    expect(PROJECT_ITEM_FRAGMENT.match(/assignees\(first: 10\) \{ nodes \{ id \} \}/g)).toHaveLength(3)
  })
})

describe('remoteAssignees (AWTD-1190)', () => {
  it.each(['Issue', 'DraftIssue', 'PullRequest'] as const)('reads a %s’s assignees in GitHub’s order', typename => {
    expect(remoteAssignees(item(typename, ['U_b', 'U_a']))).toEqual(['U_b', 'U_a'])
  })

  it('an item hydrated without the field says nothing about its assignees', () => {
    expect(remoteAssignees(item('Issue'))).toBeNull()
  })

  it('a redacted item says nothing', () => {
    expect(remoteAssignees({ ...item('Issue', ['U_a']), type: 'REDACTED' })).toBeNull()
    expect(remoteAssignees({ ...item('Issue'), content: null })).toBeNull()
  })
})

describe('planAssignees (AWTD-1190)', () => {
  const users = new Map([
    ['U_a', 'a'],
    ['U_b', 'b'],
    ['U_c', 'c'],
  ])
  const plan = (remote: string[], held: string[], primaryIsAgent = false) =>
    planAssignees({ remote, held, primaryIsAgent, userIdByNodeId: users })

  it('a first import stores them in GitHub’s order', () => {
    expect(plan(['U_b', 'U_a'], [])).toEqual(['b', 'a'])
  })

  it('someone with no Astrid identity is skipped, not invented', () => {
    expect(plan(['U_stranger', 'U_a'], [])).toEqual(['a'])
    expect(plan(['U_stranger'], [])).toBeNull()
  })

  it('the same people is no change, whatever order GitHub lists them in', () => {
    // GitHub orders by when each was assigned; Astrid's order says who is primary.
    expect(plan(['U_a', 'U_b'], ['b', 'a'])).toBeNull()
  })

  it('a newcomer goes after the people already assigned, and the primary stays', () => {
    expect(plan(['U_c', 'U_a', 'U_b'], ['b', 'a'])).toEqual(['b', 'a', 'c'])
  })

  it('someone unassigned on GitHub leaves; if that was the primary, the next is promoted', () => {
    expect(plan(['U_b'], ['a', 'b'])).toEqual(['b'])
    expect(plan([], ['a'])).toEqual([])
  })

  it('an agent is never a GitHub assignee, so GitHub not naming it does not unassign it', () => {
    expect(plan([], ['ai-agent-claude'], true)).toBeNull()
    expect(plan(['U_a'], ['ai-agent-claude'], true)).toEqual(['ai-agent-claude', 'a'])
  })
})
