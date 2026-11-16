// @vitest-environment node
/**
 * AWTD-1694 — approvals: the markers and states in lib/approvals.ts.
 */
import { describe, expect, it } from 'vitest'
import {
  APPROVAL_APPROVED,
  APPROVAL_DECLINED,
  approvalRequestMarker,
  approvalStateOf,
  normalizeSha,
  parseApprovalRequest,
} from '@/lib/approvals'

const SHA = 'a'.repeat(40)

describe('approval request marker (AWTD-1694)', () => {
  it('round-trips an action and a full sha', () => {
    expect(parseApprovalRequest(approvalRequestMarker('migrate', SHA))).toEqual({ action: 'migrate', sha: SHA })
  })

  it('is not a request without the marker: ordinary comments and abbreviated shas never parse', () => {
    expect(parseApprovalRequest(null)).toBeNull()
    expect(parseApprovalRequest('COMPLETED')).toBeNull()
    expect(parseApprovalRequest(`APPROVAL_REQUEST:deploy:${SHA.slice(0, 7)}`)).toBeNull()
    expect(parseApprovalRequest(`APPROVAL_REQUEST:merge:${SHA}`)).toBeNull()
    expect(parseApprovalRequest(`APPROVAL_REQUEST:deploy:${SHA}:extra`)).toBeNull()
  })

  it('accepts only a full commit sha', () => {
    expect(normalizeSha(SHA.toUpperCase())).toBe(SHA)
    expect(normalizeSha('abc1234')).toBeNull()
    expect(normalizeSha(undefined)).toBeNull()
  })
})

describe('approvalStateOf (AWTD-1694)', () => {
  const reply = (id: string, type: string | null, at: string, parent = 'req') => ({
    id, parentCommentId: parent, systemEventType: type, authorId: `u-${id}`, content: 'because', createdAt: at,
  })

  it('is pending until a decision reply exists', () => {
    expect(approvalStateOf('req', [])).toEqual({ status: 'pending' })
  })

  it('never reads an ordinary reply as approval', () => {
    expect(approvalStateOf('req', [{ ...reply('r1', null, '2026-01-01T00:00:00Z'), content: 'approved! ship it' }])).toEqual({ status: 'pending' })
  })

  it('ignores a decision on another request', () => {
    expect(approvalStateOf('req', [reply('d', APPROVAL_APPROVED, '2026-01-01T00:00:00Z', 'other')])).toEqual({ status: 'pending' })
  })

  it('the first decision stands', () => {
    const state = approvalStateOf('req', [
      reply('late', APPROVAL_DECLINED, '2026-01-02T00:00:00Z'),
      reply('first', APPROVAL_APPROVED, '2026-01-01T00:00:00Z'),
    ])
    expect(state).toEqual({ status: 'approved', decidedBy: 'u-first', decisionId: 'first' })
  })
})
