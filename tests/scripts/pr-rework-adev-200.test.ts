/**
 * ADEV-200: finished agent work stuck in Doing because its PR conflicted with main
 * (or went red) and the ship workflow only ever logged "held back". Such a PR now
 * goes back to its agent, and the rework comment supersedes the old marker so the
 * task is not sent back twice or treated as still awaiting its deploy.
 */
import { describe, it, expect } from 'vitest'
import { reworkReason, reworkComment, REWORK_MARKER, type ReworkCandidate } from '@/scripts/lib/pr-rework'
import { isAwaitingDeploy } from '@/scripts/lib/doing-release'

const HEAD = 'f508b649'.padEnd(40, '0')

function pr(overrides: Partial<ReworkCandidate> = {}): ReworkCandidate {
  return {
    number: 942,
    headRefName: 'agent/claude-code/ADEV-180-decisions-process',
    headRefOid: HEAD,
    isDraft: false,
    mergeable: 'MERGEABLE',
    cloudHandoffValid: true,
    handoffCurrent: true,
    checks: [{ name: 'build', bucket: 'pass' }],
    ...overrides,
  }
}

describe('reworkReason (ADEV-200)', () => {
  it('sends back a live handoff whose PR conflicts with main', () => {
    expect(reworkReason(pr({ mergeable: 'CONFLICTING' }))).toBe('it conflicts with main')
  })

  it('sends back a live handoff whose checks finished red', () => {
    expect(reworkReason(pr({ checks: [{ name: 'build', bucket: 'pass' }, { name: 'authenticated-critical', bucket: 'fail' }] })))
      .toBe('its checks finished red (authenticated-critical)')
  })

  it('waits while checks are still running, even with one already red', () => {
    expect(reworkReason(pr({ checks: [{ name: 'e2e', bucket: 'fail' }, { name: 'build', bucket: 'pending' }] }))).toBeNull()
  })

  it('leaves a green, mergeable PR to land', () => {
    expect(reworkReason(pr())).toBeNull()
  })

  it('treats UNKNOWN mergeability as a wait, not a conflict', () => {
    expect(reworkReason(pr({ mergeable: 'UNKNOWN' }))).toBeNull()
  })

  it('never sends back a PR without a live handoff: already sent back, being reworked, or not the board\'s', () => {
    expect(reworkReason(pr({ mergeable: 'CONFLICTING', cloudHandoffValid: false }))).toBeNull()
    expect(reworkReason(pr({ mergeable: 'CONFLICTING', handoffCurrent: false }))).toBeNull()
  })

  it('ignores drafts and branches that are not agent branches', () => {
    expect(reworkReason(pr({ mergeable: 'CONFLICTING', isDraft: true }))).toBeNull()
    expect(reworkReason(pr({ mergeable: 'CONFLICTING', headRefName: 'fix/ADEV-180-by-hand' }))).toBeNull()
  })
})

describe('reworkComment (ADEV-200)', () => {
  const text = reworkComment({ number: 942, branch: 'agent/claude-code/ADEV-180-decisions-process', headSha: HEAD, reason: 'it conflicts with main' })

  it('names the PR, the branch, the head and the reason', () => {
    expect(text.startsWith(REWORK_MARKER)).toBe(true)
    expect(text).toContain('PR #942')
    expect(text).toContain('agent/claude-code/ADEV-180-decisions-process')
    expect(text).toContain(HEAD.slice(0, 8))
    expect(text).toContain('it conflicts with main')
    expect(text).toContain('AWAITING-DEPLOY: <new head sha>')
  })

  it('supersedes the AWAITING-DEPLOY marker it answers', () => {
    const marker = { content: `Done.\n\nAWAITING-DEPLOY: ${HEAD}`, createdAt: '2026-11-21T23:07:49.000Z' }
    expect(isAwaitingDeploy([marker])).toBe(true)
    expect(isAwaitingDeploy([marker, { content: text, createdAt: '2026-11-22T08:00:00.000Z' }])).toBe(false)
  })

  it('is itself superseded by the fresh marker the rework run posts', () => {
    const fresh = 'a'.repeat(40)
    expect(isAwaitingDeploy([
      { content: `AWAITING-DEPLOY: ${HEAD}`, createdAt: '2026-11-21T23:07:49.000Z' },
      { content: text, createdAt: '2026-11-22T08:00:00.000Z' },
      { content: `Rebased.\n\nAWAITING-DEPLOY: ${fresh}`, createdAt: '2026-11-22T09:00:00.000Z' },
    ])).toBe(true)
  })
})
