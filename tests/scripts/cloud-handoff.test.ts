import { describe, expect, it } from 'vitest'
import { cloudHandoffEligible, claimsCloudHandoff } from '@/scripts/lib/cloud-handoff'
import { automaticDeployHold, landablePullRequests, RUNNER_PR_MARKER } from '@/scripts/lib/land-and-deploy'
import { agentEmail } from '@/lib/brand/agent-emails'

const sha = 'a'.repeat(40)
const task = {
  identifier: 'AWTD-1410', completed: false, statusRole: 'waiting',
  assignee: { id: 'claude-id', email: agentEmail('claude') }, lists: [{ id: 'web' }],
}
const comments = [{ authorId: 'claude-id', content: `Done\nAWAITING-DEPLOY: ${sha}`,
  createdAt: '2026-10-25T10:00:00Z' }]
const input = { branch: 'agent/claude-code/awtd-1410-lifecycle', headSha: sha, listId: 'web', task, comments }

describe('cloud lifecycle release handoff', () => {
  it('accepts an exact, agent-authored deployed-work handoff on its board', () => {
    expect(cloudHandoffEligible(input)).toBe(true)
  })
  it('refuses stale commits, spoofed reports, human handbacks and another board', () => {
    expect(cloudHandoffEligible({ ...input, headSha: 'b'.repeat(40) })).toBe(false)
    expect(cloudHandoffEligible({ ...input, comments: [{ ...comments[0], authorId: 'human' }] })).toBe(false)
    expect(cloudHandoffEligible({ ...input, listId: 'ios' })).toBe(false)
    expect(cloudHandoffEligible({ ...input, task: { ...task, assignee: { id: 'human', email: 'human@example.test' } } })).toBe(false)
    expect(cloudHandoffEligible({ ...input, task: { ...task, completed: true } })).toBe(false)
    expect(cloudHandoffEligible({ ...input, branch: 'feature/awtd-1410' })).toBe(false)
    expect(cloudHandoffEligible({ ...input, branch: 'agent/codex/awtd-1410' })).toBe(false)
    expect(cloudHandoffEligible({ ...input, comments: [...comments, {
      authorId: 'human', content: 'BLOCKED-ON: wait for a decision', createdAt: '2026-10-25T11:00:00Z',
    }] })).toBe(false)
  })
  it('never lands a cloud PR solely because its body carries the legacy runner marker', () => {
    const pr = { number: 1, headRefName: input.branch, body: RUNNER_PR_MARKER,
      checks: [{ name: 'predeploy', bucket: 'pass' }], mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' }
    expect(landablePullRequests([pr]).land).toHaveLength(0)
    expect(landablePullRequests([{ ...pr, cloudHandoffValid: true }]).land).toHaveLength(1)
    expect(landablePullRequests([{ ...pr, cloudHandoffValid: true, isDraft: true }]).land).toHaveLength(0)
  })
  it('bounds deploy attempts and does not duplicate an in-flight or successful run', () => {
    expect(automaticDeployHold([])).toBeNull()
    expect(automaticDeployHold([{ status: 'completed', conclusion: 'failure' }])).toBeNull()
    expect(automaticDeployHold([{ status: 'queued', conclusion: null }])).toMatch(/in progress/)
    expect(automaticDeployHold([{ status: 'completed', conclusion: 'success' }])).toMatch(/successful/)
    expect(automaticDeployHold(Array.from({ length: 2 }, () => ({ status: 'completed', conclusion: 'failure' }))))
      .toMatch(/two deploy attempts/)
  })
  it('AWTD-1416: accepts a branch named for the mailbox as well as the harness', () => {
    // Run 40973959090 pushed agent/claude/AWTD-1372-… and its handoff went unregistered.
    expect(cloudHandoffEligible({ ...input, branch: 'agent/claude/AWTD-1410-lifecycle' })).toBe(true)
    expect(cloudHandoffEligible({ ...input, branch: 'agent/copilot/AWTD-1410-lifecycle' })).toBe(false)
    expect(cloudHandoffEligible({ ...input, branch: 'agent/nobody/AWTD-1410-lifecycle' })).toBe(false)
  })
  it('AWTD-1416: only a task that claims a deploy handoff needs a branch', () => {
    // Run 40883891182 closed AWTD-1412 as already fixed, with no code, and went red.
    expect(claimsCloudHandoff(comments)).toBe(true)
    expect(claimsCloudHandoff([{ authorId: 'claude-id', content: 'Already fixed on main, closing.' }])).toBe(false)
  })
})
