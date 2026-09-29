/**
 * Doing must not be a dead end (2026-09-28).
 *
 * AWTD-1007, AWTD-1024 and AWTD-1025 each sat in Doing after the session that
 * claimed them was gone — work pushed on a branch, the queue saying "not in
 * Ready" every tick, and nothing that would ever move them. These pin who may be
 * released, when a claim counts as abandoned, and where a release sends it.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  RELEASE_MARKER,
  branchesForTask,
  countReleases,
  isAbandonedClaim,
  isAwaitingBuild,
  isReleasableClaim,
  releaseDoingClaim,
  type DoingTask,
} from '@/scripts/lib/doing-release'
import { agentEmail } from '@/lib/brand/agent-emails'

const CLAUDE = agentEmail('claude')
const task = (over: Partial<DoingTask> = {}): DoingTask => ({
  id: 't1',
  identifier: 'AWTD-1025',
  completed: false,
  statusRole: 'doing',
  updatedAt: '2026-09-28T01:00:00Z',
  creatorId: 'jon',
  creator: { id: 'jon', isAIAgent: false },
  assignee: { email: CLAUDE },
  ...over,
})

function fakeApi() {
  return {
    setStatus: vi.fn(async (_task: { id: string }, _role: string) => {}),
    assign: vi.fn(async (_task: { id: string }, _userId: string) => {}),
    comment: vi.fn(async (_task: { id: string }, _content: string) => {}),
  }
}

describe('isReleasableClaim', () => {
  it("takes only this agent's open Doing claims", () => {
    expect(isReleasableClaim(task(), CLAUDE)).toBe(true)
    expect(isReleasableClaim(task(), CLAUDE.toUpperCase())).toBe(true)
    expect(isReleasableClaim(task({ assignee: { email: 'jonparis@gmail.com' } }), CLAUDE)).toBe(false)
    expect(isReleasableClaim(task({ assignee: null }), CLAUDE)).toBe(false)
    expect(isReleasableClaim(task({ statusRole: 'ready' }), CLAUDE)).toBe(false)
    expect(isReleasableClaim(task({ statusRole: 'waiting' }), CLAUDE)).toBe(false)
    expect(isReleasableClaim(task({ completed: true }), CLAUDE)).toBe(false)
  })
})

describe('isAbandonedClaim', () => {
  const now = new Date('2026-09-28T05:00:00Z')

  it('is abandoned once task AND comments have been quiet for the window', () => {
    expect(isAbandonedClaim({ updatedAt: '2026-09-28T01:00:00Z', comments: [], now, staleMinutes: 180 })).toBe(true)
    expect(isAbandonedClaim({ updatedAt: '2026-09-28T03:00:00Z', comments: [], now, staleMinutes: 180 })).toBe(false)
  })

  it('a recent comment keeps a claim alive — a working session comments', () => {
    expect(
      isAbandonedClaim({
        updatedAt: '2026-09-28T01:00:00Z',
        comments: [{ createdAt: '2026-09-28T04:30:00Z' }],
        now,
        staleMinutes: 180,
      }),
    ).toBe(false)
  })

  it('unreadable timestamps read as active, never as abandoned', () => {
    expect(isAbandonedClaim({ updatedAt: null, comments: [], now, staleMinutes: 180 })).toBe(false)
    expect(isAbandonedClaim({ updatedAt: 'garbage', comments: [], now, staleMinutes: 180 })).toBe(false)
  })
})

describe('branchesForTask', () => {
  it('finds the branch carrying the id, and only the whole id', () => {
    const branches = ['main', 'fix/awtd-1025-hide-current-list-chip', 'fix/awtd-10250-other', 'wip/fixall-web-1']
    expect(branchesForTask('AWTD-1025', branches)).toEqual(['fix/awtd-1025-hide-current-list-chip'])
    expect(branchesForTask(null, branches)).toEqual([])
  })
})

describe('releaseDoingClaim', () => {
  it('first release: back to Ready, keeping the assignment, pointing at the branch', async () => {
    const api = fakeApi()
    const outcome = await releaseDoingClaim({
      task: task(),
      comments: [],
      branches: ['fix/awtd-1025-hide-current-list-chip'],
      why: 'The run died.',
      api,
    })
    expect(outcome).toEqual({ action: 'ready' })
    expect(api.setStatus).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }), 'ready')
    expect(api.assign).not.toHaveBeenCalled()
    const text = api.comment.mock.calls[0][1]
    expect(text.startsWith(RELEASE_MARKER)).toBe(true)
    expect(text).toContain('`fix/awtd-1025-hide-current-list-chip`')
    expect(countReleases([{ content: text }])).toBe(1)
  })

  it('second release: handed back to its human creator in Waiting, not retried forever', async () => {
    const api = fakeApi()
    const outcome = await releaseDoingClaim({
      task: task(),
      comments: [{ content: `${RELEASE_MARKER}. earlier` }],
      branches: [],
      why: 'The run died again.',
      api,
    })
    expect(outcome).toEqual({ action: 'handback', to: 'jon' })
    expect(api.assign).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }), 'jon')
    expect(api.setStatus).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }), 'waiting')
    expect(api.setStatus).not.toHaveBeenCalledWith(expect.anything(), 'ready')
  })

  it('does not hand a task back to an agent that filed it', async () => {
    const api = fakeApi()
    const outcome = await releaseDoingClaim({
      task: task({ creatorId: 'bot', creator: { id: 'bot', isAIAgent: true } }),
      comments: [{ content: `${RELEASE_MARKER}. earlier` }],
      branches: [],
      why: 'x',
      api,
    })
    expect(outcome).toEqual({ action: 'handback', to: null })
    expect(api.assign).not.toHaveBeenCalled()
    expect(api.setStatus).toHaveBeenCalledWith(expect.anything(), 'waiting')
  })
})

// AITD-439, 2026-09-29: finished, merged, pushed and commented "Awaiting build" —
// then released to Ready ten seconds later, because a task that is done waits
// for its TestFlight build IN Doing. The next run would have redone it, and a
// second release would have handed finished work back to Jon.
describe('isAwaitingBuild', () => {
  const marker = (createdAt: string) => ({
    content: 'Pushed.\n\n**Awaiting build:** `0862488`',
    createdAt,
  })

  it('a pushed task waiting on its build is finished, not abandoned', () => {
    expect(isAwaitingBuild([marker('2026-09-29T14:44:41Z')])).toBe(true)
  })

  it('no marker: nothing says the work landed', () => {
    expect(isAwaitingBuild([{ content: 'Strategy: …', createdAt: '2026-09-29T14:00:00Z' }])).toBe(false)
    expect(isAwaitingBuild([])).toBe(false)
  })

  it('a marker from before a completion is the fix that missed — reopened work is releasable', () => {
    expect(isAwaitingBuild([
      marker('2026-09-20T10:00:00Z'),
      { content: 'Completed', systemEventType: 'COMPLETED', createdAt: '2026-09-21T10:00:00Z' },
    ])).toBe(false)
  })

  it('a marker from before a release belongs to an earlier attempt', () => {
    expect(isAwaitingBuild([
      marker('2026-09-20T10:00:00Z'),
      { content: `${RELEASE_MARKER}. earlier`, createdAt: '2026-09-21T10:00:00Z' },
    ])).toBe(false)
  })
})
