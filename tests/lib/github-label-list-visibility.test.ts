/**
 * AWTD-1193 (P6c-2b): a board member can OPEN a GitHub label's list.
 *
 * A label list is owned by whoever's board met the label first, is in no
 * project, and has no members — so before this, everyone who could see a task
 * saw its label chip, and only the owner could open the list behind it.
 *
 * Access is DERIVED rather than materialised as ListMember rows. A repo can
 * feed several boards, so access is the union over them, and detaching one
 * board must not revoke access another still grants — a stored row would have
 * to get that right on every detach, and a derived clause cannot get it wrong.
 *
 * Pinned here:
 *   - the clause exists, and reaches a label list through a task the viewer
 *     can already see;
 *   - it is limited to lists that MIRROR a GitHub label (`remoteNodeId`), so a
 *     label list someone converted from their own regular list is never shared
 *     out by it;
 *   - the direct ways of seeing a list are unchanged.
 */

import { describe, it, expect } from 'vitest'
import { listVisibilityWhere } from '@/lib/list-permissions'
import { LIST_TYPE_LABEL } from '@/lib/list-flavors'

type Clause = Record<string, any>

const clauses = (userId = 'u1'): Clause[] => listVisibilityWhere(userId, { includePublic: false }).OR as Clause[]

const labelClause = (userId = 'u1') => clauses(userId).find(c => c.listType === LIST_TYPE_LABEL)

describe('a GitHub label list is visible through its tasks (AWTD-1193)', () => {
  it('adds a clause for label lists', () => {
    expect(labelClause()).toBeDefined()
  })

  it('only for lists that mirror a GitHub label, never a converted one', () => {
    // A person may convert their own regular list to a label list
    // (canConvertListFlavor). Those have no remoteNodeId and must not become
    // visible to everyone who can see a task on them.
    expect(labelClause()?.remoteNodeId).toEqual({ not: null })
  })

  it('reaches the label through a task on a list the viewer can already see', () => {
    const inner = labelClause()?.tasks?.some?.lists?.some
    expect(inner).toBeDefined()
    expect(inner.OR).toEqual(
      expect.arrayContaining([
        { ownerId: 'u1' },
        { listMembers: { some: { userId: 'u1' } } },
        { project: { ownerId: 'u1' } },
        { project: { members: { some: { userId: 'u1' } } } },
      ]),
    )
  })

  it('carries the viewer through, so it cannot match for everyone', () => {
    const inner = labelClause('someone-else')?.tasks?.some?.lists?.some
    expect(JSON.stringify(inner)).not.toContain('u1')
    expect(JSON.stringify(inner)).toContain('someone-else')
  })

  it('does not widen the label clause to any list at all', () => {
    // Without the inner OR this would read "any label list with any task",
    // which is every label list in the deployment.
    expect(labelClause()?.tasks?.some?.lists?.some?.OR?.length).toBeGreaterThan(0)
  })
})

describe('the existing ways of seeing a list are untouched (AWTD-1193)', () => {
  it('still covers owner, member, and project owner and member', () => {
    expect(clauses()).toEqual(
      expect.arrayContaining([
        { ownerId: 'u1' },
        { listMembers: { some: { userId: 'u1' } } },
        { project: { ownerId: 'u1' } },
        { project: { members: { some: { userId: 'u1' } } } },
      ]),
    )
  })

  it('still covers a board’s status lists via its shared domain lists', () => {
    expect(clauses()).toEqual(
      expect.arrayContaining([
        { listType: 'status', project: { lists: { some: { listMembers: { some: { userId: 'u1' } } } } } },
      ]),
    )
  })

  it('still adds PUBLIC only when asked', () => {
    const withPublic = listVisibilityWhere('u1', { includePublic: true }).OR as Clause[]
    expect(withPublic).toEqual(expect.arrayContaining([{ privacy: 'PUBLIC' }]))
    expect(clauses()).not.toEqual(expect.arrayContaining([{ privacy: 'PUBLIC' }]))
  })
})
