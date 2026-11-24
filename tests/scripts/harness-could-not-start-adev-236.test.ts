/**
 * ADEV-236: a cloud run whose harness could not start (the Claude Code token was revoked)
 * was released as "ended before finishing it", twice, and the task was handed back to Jon as
 * "failed twice" although no work was ever attempted. A could-not-start release returns the
 * task to Ready, says why, and never counts toward the two-release handback.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  countReleases,
  releaseDoingClaim,
  isAwaitingDeploy,
  RELEASE_MARKER,
  START_FAILURE_MARKER,
  type DoingTask,
} from '@/scripts/lib/doing-release'
import { harnessStartFailure } from '@/scripts/lib/harness-start'
import { agentEmail } from '@/lib/brand/agent-emails'

const task: DoingTask = {
  id: 't1',
  identifier: 'ADEV-182',
  completed: false,
  statusRole: 'doing',
  updatedAt: '2026-11-22T21:21:00Z',
  creatorId: 'jon',
  creator: { id: 'jon', isAIAgent: false },
  assignee: { email: agentEmail('claude') },
}

function fakeApi() {
  return {
    setStatus: vi.fn(async (_task: { id: string }, _role: string) => {}),
    handBack: vi.fn(async (_task: { id: string }, _personId: string | null) => {}),
    comment: vi.fn(async (_task: { id: string }, _content: string) => {}),
  }
}

describe('a run that could not start (ADEV-236)', () => {
  it('goes back to Ready, says why, and does not count as a release', async () => {
    const api = fakeApi()
    const outcome = await releaseDoingClaim({
      task, comments: [], branches: [], why: 'unused', api,
      couldNotStart: 'the harness exited before producing any output',
    })
    expect(outcome).toEqual({ action: 'ready' })
    expect(api.setStatus).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }), 'ready')
    const text = api.comment.mock.calls[0][1]
    expect(text.startsWith(START_FAILURE_MARKER)).toBe(true)
    expect(text).toContain('the harness exited before producing any output')
    expect(countReleases([{ content: text }])).toBe(0)
  })

  it('is never the second release, even after a real one', async () => {
    const api = fakeApi()
    const outcome = await releaseDoingClaim({
      task, comments: [{ content: `${RELEASE_MARKER}. earlier` }], branches: [], why: 'unused', api,
      couldNotStart: 'the harness exited before producing any output',
    })
    expect(outcome).toEqual({ action: 'ready' })
    expect(api.handBack).not.toHaveBeenCalled()
  })

  it('keeps the two-release rule for runs that did start', async () => {
    const api = fakeApi()
    const outcome = await releaseDoingClaim({
      task, comments: [{ content: `${RELEASE_MARKER}. earlier` }], branches: [], why: 'The run died.', api,
    })
    expect(outcome).toEqual({ action: 'handback', to: 'jon' })
  })

  it('starts a new attempt, like a release: an older AWAITING-DEPLOY is no longer current', () => {
    const sha = 'a'.repeat(40)
    expect(isAwaitingDeploy([
      { content: `AWAITING-DEPLOY: ${sha}`, createdAt: '2026-11-22T20:00:00Z' },
      { content: `${START_FAILURE_MARKER}: x`, createdAt: '2026-11-22T21:00:00Z' },
    ])).toBe(false)
  })
})

describe('harnessStartFailure (ADEV-236)', () => {
  it('a failed harness step with an empty transcript could not start', () => {
    expect(harnessStartFailure({ outcome: 'failure', transcript: '' })).toMatch(/before producing any output/)
    expect(harnessStartFailure({ outcome: 'failure', transcript: '  \n' })).toMatch(/before producing any output/)
  })

  it('a harness that produced output started, whatever happened next', () => {
    expect(harnessStartFailure({ outcome: 'failure', transcript: 'Working on ADEV-182…' })).toBeNull()
  })

  it('a successful, skipped or cancelled step is not a start failure', () => {
    expect(harnessStartFailure({ outcome: 'success', transcript: '' })).toBeNull()
    expect(harnessStartFailure({ outcome: 'skipped', transcript: '' })).toBeNull()
    expect(harnessStartFailure({ outcome: 'cancelled', transcript: '' })).toBeNull()
  })
})

describe('the token renewal task (ADEV-236)', () => {
  it('files one task at a time: an open one stops the next, a completed one does not', async () => {
    const { openRenewalTask, RENEW_TOKEN_TITLE } = await import('@/scripts/lib/harness-start')
    expect(openRenewalTask([{ title: `${RENEW_TOKEN_TITLE} (it was revoked)`, completed: false }])).not.toBeNull()
    expect(openRenewalTask([{ title: RENEW_TOKEN_TITLE, completed: true }])).toBeNull()
    expect(openRenewalTask([{ title: 'Something else', completed: false }])).toBeNull()
  })

  it('names the secret, the repo and the run', async () => {
    const { renewalDescription } = await import('@/scripts/lib/harness-start')
    const text = renewalDescription({ runUrl: 'https://github.com/o/r/actions/runs/1', repo: 'o/r' })
    expect(text).toContain('CLAUDE_CODE_OAUTH_TOKEN')
    expect(text).toContain('gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo o/r')
    expect(text).toContain('https://github.com/o/r/actions/runs/1')
  })

  // ADEV-235: agent-run.yml's jobs run in the `agent` environment, whose own
  // CLAUDE_CODE_OAUTH_TOKEN overrides the repo secret. Jon renewed the repo
  // secret twice and the runs kept reading the revoked environment copy.
  it('ADEV-235: tells the owner to set the agent environment secret, not the repo one', async () => {
    const { renewalDescription } = await import('@/scripts/lib/harness-start')
    const text = renewalDescription({ runUrl: 'https://github.com/o/r/actions/runs/1', repo: 'o/r' })
    expect(text).toContain('gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo o/r --env agent')
  })

  it('ADEV-235: agent-run.yml really reads the token from the agent environment', async () => {
    const { readFileSync } = await import('node:fs')
    const workflow = readFileSync('.github/workflows/agent-run.yml', 'utf8')
    expect(workflow).toMatch(/^\s+environment:\s*agent\s*$/m)
    expect(workflow).toContain('secrets.CLAUDE_CODE_OAUTH_TOKEN')
  })
})
