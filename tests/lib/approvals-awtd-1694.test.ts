/**
 * AWTD-1694 — an approval is bound to one action and one commit, and only the policy's escalation
 * targets can give it. A reply that says "approved" is not one.
 */
import { describe, expect, it } from 'vitest'
import {
  approvalSummary,
  buildApprovalRequestContent,
  canDecideApproval,
  deployDispatchInputs,
  parseApprovalRequest,
} from '@/lib/approvals'
import { defaultOrchestrationPolicy, resolvePolicy } from '@/lib/orchestration-policy'
import { migrationApprovalSummary } from '@/scripts/lib/land-and-deploy'

const SHA = 'a'.repeat(40)

describe('approval request card (AWTD-1694)', () => {
  it('round-trips the action and the full commit it is bound to', () => {
    const content = buildApprovalRequestContent({ action: 'migrate', sha: SHA }, 'Runs the deploy.')
    expect(parseApprovalRequest(content)).toEqual({ action: 'migrate', sha: SHA })
    expect(approvalSummary(content)).toBe('Runs the deploy.')
  })

  it('binds the Goal signals actions to a snapshot digest (ADEV-284)', () => {
    for (const action of ['promoteIdea', 'experimentStart', 'experimentStop'] as const) {
      const content = buildApprovalRequestContent({ action, sha: SHA }, 'Does it.')
      expect(parseApprovalRequest(content)).toEqual({ action, sha: SHA })
    }
  })

  it('does not read a short sha, an unknown action or a marker that is not the last line', () => {
    expect(parseApprovalRequest('x\n\nAPPROVAL-REQUEST: deploy abc1234')).toBeNull()
    expect(parseApprovalRequest(`x\n\nAPPROVAL-REQUEST: format-disk ${SHA}`)).toBeNull()
    expect(parseApprovalRequest(`APPROVAL-REQUEST: deploy ${SHA}\nand then some more`)).toBeNull()
    expect(parseApprovalRequest('Approved!')).toBeNull()
  })

  it('binds the deploy to the card commit, and only a migration card allows destructive migrations', () => {
    expect(deployDispatchInputs({ action: 'deploy', sha: SHA })).toEqual({
      skip_tests: 'false',
      allow_destructive_migrations: 'false',
      expected_sha: SHA,
    })
    expect(deployDispatchInputs({ action: 'migrate', sha: SHA }).allow_destructive_migrations).toBe('true')
  })
})

describe('who may decide (AWTD-1694)', () => {
  it('is the list owner by default, and nobody else', () => {
    const policy = defaultOrchestrationPolicy()
    expect(canDecideApproval(policy, 'owner', 'owner', 'creator')).toBe(true)
    expect(canDecideApproval(policy, 'creator', 'owner', 'creator')).toBe(false)
    expect(canDecideApproval(policy, 'member', 'owner', 'creator')).toBe(false)
  })

  it('follows the policy: named people, or the task creator', () => {
    const people = resolvePolicy({ escalation: { to: 'people', userIds: ['lead', 'cto'] } }, null)
    expect(canDecideApproval(people, 'cto', 'owner')).toBe(true)
    expect(canDecideApproval(people, 'owner', 'owner')).toBe(false)
    const creator = resolvePolicy({ escalation: { to: 'taskCreator' } }, null)
    expect(canDecideApproval(creator, 'creator', 'owner', 'creator')).toBe(true)
    expect(canDecideApproval(creator, 'owner', 'owner', 'creator')).toBe(false)
  })
})

describe('the migration hold card (AWTD-1694)', () => {
  it('names the commit, the migrations and what approving asserts', () => {
    const text = migrationApprovalSummary({
      sha: SHA,
      hold: 'destructive pending migration — DROP COLUMN',
      pending: [{ name: '20261116_drop_it', sql: 'ALTER TABLE t DROP COLUMN c' }],
    })
    expect(text).toContain(SHA)
    expect(text).toContain('prisma/migrations/20261116_drop_it/migration.sql')
    expect(text).toContain('destructive pending migration')
    expect(text).toContain('allow_destructive_migrations=true')
    expect(text).toContain('already live')
  })
})
