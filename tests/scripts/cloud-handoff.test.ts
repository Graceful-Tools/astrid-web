import { describe, expect, it } from 'vitest'
import { cloudHandoffEligible, claimsCloudHandoff, handoffAlreadyOnMain } from '@/scripts/lib/cloud-handoff'
import { automaticDeployHold, landablePullRequests, RUNNER_PR_MARKER } from '@/scripts/lib/land-and-deploy'
import { agentEmail } from '@/lib/brand/agent-emails'

const sha = 'a'.repeat(40)
// R6: finished work awaiting its deploy stays in Doing.
const task: { identifier: string; completed: boolean; statusRole: string | null;
  assignee: { id: string; email: string }; lists: Array<{ id: string }> } = {
  identifier: 'AWTD-1410', completed: false, statusRole: 'doing',
  assignee: { id: 'claude-id', email: agentEmail('claude') }, lists: [{ id: 'web' }],
}
const comments = [{ authorId: 'claude-id', content: `Done\nAWAITING-DEPLOY: ${sha}`,
  createdAt: '2026-10-25T10:00:00Z' }]
const input = { branch: 'agent/claude-code/awtd-1410-lifecycle', headSha: sha, listId: 'web', task, comments }

describe('cloud lifecycle release handoff', () => {
  it('a marker naming a commit already on main needs no branch (run 42615955158)', () => {
    // The fix had merged in an earlier PR, so the agent marked main's commit. With no branch
    // to open, registration called it a broken handoff and the run went red, although the
    // runner completed the task minutes later once production served that commit.
    const onMain = (commit: string) => commit === sha
    expect(handoffAlreadyOnMain(comments, onMain)).toBe(true)
    expect(handoffAlreadyOnMain([{ ...comments[0], content: `Done\nAWAITING-DEPLOY: ${'b'.repeat(40)}` }], onMain)).toBe(false)
    expect(handoffAlreadyOnMain([{ ...comments[0], content: 'Done, no marker' }], onMain)).toBe(false)
  })
  it('accepts an exact, agent-authored deployed-work handoff on its board', () => {
    expect(cloudHandoffEligible(input)).toBe(true)
  })
  it('R6: accepts the handoff in Doing or the optional Testing column, never Waiting, Ready or the Inbox', () => {
    expect(cloudHandoffEligible({ ...input, task: { ...task, statusRole: 'testing' } })).toBe(true)
    expect(cloudHandoffEligible({ ...input, task: { ...task, statusRole: 'waiting' } })).toBe(false)
    expect(cloudHandoffEligible({ ...input, task: { ...task, statusRole: 'ready' } })).toBe(false)
    expect(cloudHandoffEligible({ ...input, task: { ...task, statusRole: null } })).toBe(false)
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
  it('accepts a web-board task whose id kept another board\'s prefix (2026-11-08)', () => {
    // Run 41621632959: "Non repeating tasks say 'never'" moved from the iOS board and
    // kept its id, AITD-582. Its branch agent/claude-code/AITD-582-one-time-only-label
    // was refused for not saying AWTD, so its finished fix (PR #663) never shipped.
    const moved = { ...input, task: { ...task, identifier: 'AITD-582' }, branch: 'agent/claude-code/AITD-582-one-time-only-label' }
    expect(cloudHandoffEligible(moved)).toBe(true)
    // The id in the branch must still be the task's own.
    expect(cloudHandoffEligible({ ...moved, branch: 'agent/claude-code/AITD-583-one-time-only-label' })).toBe(false)
    expect(cloudHandoffEligible({ ...moved, branch: 'agent/claude-code/AWTD-582-one-time-only-label' })).toBe(false)
    expect(cloudHandoffEligible({ ...moved, branch: 'agent/claude-code/AITD-5820-other' })).toBe(false)
  })
})
