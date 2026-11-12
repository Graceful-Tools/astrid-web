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
  isAwaitingDeploy,
  isFinishedOccurrence,
  isOrphanedDoing,
  parkFinishedOccurrence,
  isReleasableClaim,
  releaseDoingClaim,
  type DoingTask,
} from '@/scripts/lib/doing-release'
import { agentEmail } from '@/lib/brand/agent-emails'
import { REDO_CLAIM_MARKER } from '@/lib/fixall-claim'

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
    handBack: vi.fn(async (_task: { id: string }, _personId: string | null) => {}),
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

// AWTD-1409: an unassigned task in Doing was released by nothing and queued by nothing.
describe('isOrphanedDoing', () => {
  it('AWTD-1409: an open, unassigned Doing task is orphaned', () => {
    expect(isOrphanedDoing(task({ assignee: null }))).toBe(true)
    expect(isOrphanedDoing(task({ assignee: { email: '' } }))).toBe(true)
  })

  it('AWTD-1409: assigned, finished or non-Doing tasks are not', () => {
    expect(isOrphanedDoing(task())).toBe(false)
    expect(isOrphanedDoing(task({ assignee: null, completed: true }))).toBe(false)
    expect(isOrphanedDoing(task({ assignee: null, statusRole: 'ready' }))).toBe(false)
    expect(isOrphanedDoing(task({ assignee: null, statusRole: 'waiting' }))).toBe(false)
  })

  it('AWTD-1409: an orphan is released to Ready without being assigned', async () => {
    const api = fakeApi()
    const outcome = await releaseDoingClaim({ task: task({ assignee: null }), comments: [], branches: [], why: 'x', api })
    expect(outcome).toEqual({ action: 'ready' })
    expect(api.handBack).not.toHaveBeenCalled()
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
    expect(api.handBack).not.toHaveBeenCalled()
    const text = api.comment.mock.calls[0][1]
    expect(text.startsWith(RELEASE_MARKER)).toBe(true)
    expect(text).toContain('`fix/awtd-1025-hide-current-list-chip`')
    expect(countReleases([{ content: text }])).toBe(1)
  })

  it('second release: handed back to its human creator in the Inbox (R4), not retried forever', async () => {
    const api = fakeApi()
    const outcome = await releaseDoingClaim({
      task: task(),
      comments: [{ content: `${RELEASE_MARKER}. earlier` }],
      branches: [],
      why: 'The run died again.',
      api,
    })
    expect(outcome).toEqual({ action: 'handback', to: 'jon' })
    expect(api.handBack).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }), 'jon')
    // Never Waiting: waiting on a person has no date or task to wake on.
    expect(api.setStatus).not.toHaveBeenCalled()
    expect(api.comment.mock.calls[0][1]).toContain('handed back to its creator in the Inbox')
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
    expect(api.handBack).toHaveBeenCalledWith(expect.anything(), null)
    expect(api.setStatus).not.toHaveBeenCalled()
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

// R6 (2026-11-12): web finished work stays in Doing with `AWAITING-DEPLOY: <sha>` until
// production serves it. The release must leave it there, or the next run redoes it.
describe('isAwaitingDeploy', () => {
  const sha = '3d0392a40187c84be7d91e77048de22c429c09ea'
  const marker = (createdAt: string) => ({ content: `PR: #601\n\nAWAITING-DEPLOY: ${sha}`, createdAt })

  it('finished work awaiting its deploy is not an abandoned claim', () => {
    expect(isAwaitingDeploy([{ content: 'Strategy', createdAt: '2026-11-12T09:00:00Z' }, marker('2026-11-12T10:00:00Z')])).toBe(true)
    // A later plain comment does not replace the marker (latest MARKER comment wins).
    expect(isAwaitingDeploy([marker('2026-11-12T10:00:00Z'), { content: 'thanks', createdAt: '2026-11-12T11:00:00Z' }])).toBe(true)
  })

  it('no marker, or a prose line that is not a sha, is not a handoff', () => {
    expect(isAwaitingDeploy([])).toBe(false)
    expect(isAwaitingDeploy([{ content: 'AWAITING-DEPLOY: soon', createdAt: '2026-11-12T10:00:00Z' }])).toBe(false)
  })

  it('a redo claim starts a new attempt, so a retry that dies is released, not skipped', () => {
    expect(isAwaitingDeploy([
      marker('2026-11-10T10:00:00Z'),
      { content: 'Redo it.', createdAt: '2026-11-11T09:00:00Z' },
      { content: `${REDO_CLAIM_MARKER}: the earlier handoff no longer counts.`, createdAt: '2026-11-11T09:01:00Z' },
    ])).toBe(false)
    // ...until the retry posts its own handoff.
    expect(isAwaitingDeploy([
      { content: `${REDO_CLAIM_MARKER}: x`, createdAt: '2026-11-11T09:01:00Z' },
      marker('2026-11-11T12:00:00Z'),
    ])).toBe(true)
  })

  it('a marker older than a completion or a release is stale', () => {
    expect(isAwaitingDeploy([
      marker('2026-11-10T10:00:00Z'),
      { content: 'Completed', systemEventType: 'COMPLETED', createdAt: '2026-11-11T10:00:00Z' },
    ])).toBe(false)
    expect(isAwaitingDeploy([
      marker('2026-11-10T10:00:00Z'),
      { content: `${RELEASE_MARKER}. earlier`, createdAt: '2026-11-11T10:00:00Z' },
    ])).toBe(false)
  })
})

/**
 * AWTD-1471 — name the WIP the loop saved, and never a merged branch.
 *
 * An interrupted run saves its work on `wip/fixall-…`, which carries no task id, so
 * the release comment never named it. Worse, it named whatever old branch did carry
 * the id: on 2026-11-01 it told the next run to "continue from" fix/aitd-559-pr-exit3,
 * already merged into main.
 */
describe('AWTD-1471: saved branch and merged branches', () => {
  const release = async (input: { branches: string[]; savedBranch?: string | null; merged?: string[] }) => {
    const api = fakeApi()
    await releaseDoingClaim({ task: task(), comments: [], why: 'The run died.', api, ...input })
    return api.comment.mock.calls[0][1] as string
  }

  it('names the saved branch first', async () => {
    const text = await release({
      branches: ['fix/awtd-1025-hide-current-list-chip', 'wip/fixall-web-20261101-0820'],
      savedBranch: 'wip/fixall-web-20261101-0820',
    })
    expect(text).toContain('`wip/fixall-web-20261101-0820`, `fix/awtd-1025-hide-current-list-chip`')
  })

  it('names the saved branch once when it also carries the id', async () => {
    const text = await release({
      branches: ['fix/awtd-1025-hide-current-list-chip'],
      savedBranch: 'fix/awtd-1025-hide-current-list-chip',
    })
    expect(text.split('fix/awtd-1025-hide-current-list-chip').length - 1).toBe(1)
  })

  it('does not name an id branch already merged into main', async () => {
    const text = await release({
      branches: ['fix/awtd-1025-old-merged', 'fix/awtd-1025-still-open'],
      merged: ['fix/awtd-1025-old-merged'],
    })
    expect(text).not.toContain('fix/awtd-1025-old-merged')
    expect(text).toContain('`fix/awtd-1025-still-open`')
  })

  it('no saved branch and only a merged id branch: nothing to continue from', async () => {
    const text = await release({ branches: ['fix/awtd-1025-old-merged'], merged: ['fix/awtd-1025-old-merged'] })
    expect(text).toContain('No branch carrying its id was found')
    expect(text).not.toContain('fix/awtd-1025-old-merged')
  })
})

/**
 * AWTD-1510 — search every checkout the board's workflow can touch.
 *
 * The Windows board's [core] work is done in the sibling astrid-core checkout, but the
 * release searched only astrid-windows and then said the task "starts fresh" — a claim
 * about work it never looked for. A branch found anywhere is named with its repo; when
 * none is found the comment says where it looked, and asserts nothing about a fresh start.
 */
describe('AWTD-1510: branches in every checkout the board can touch', () => {
  const release = async (input: Partial<Parameters<typeof releaseDoingClaim>[0]>) => {
    const api = fakeApi()
    await releaseDoingClaim({
      task: task({ identifier: 'AWTD-1510' }),
      comments: [],
      branches: [],
      why: 'The run died.',
      api,
      ...input,
    })
    return api.comment.mock.calls[0][1] as string
  }

  it('AWTD-1510: names a branch that lives only in the sibling astrid-core checkout, with its repo', async () => {
    const text = await release({
      checkouts: [
        { name: 'astrid-windows', branches: ['main', 'fix/awtd-15100-other'] },
        { name: 'astrid-core', branches: ['main', 'fix/awtd-1510-core-rule'] },
      ],
    })
    expect(text).toContain('`fix/awtd-1510-core-rule` in astrid-core')
    expect(text).toContain('continue from there')
    expect(text).not.toContain('No branch carrying its id')
  })

  it('AWTD-1510: the saved branch is named in the first checkout, alongside a core branch', async () => {
    const text = await release({
      savedBranch: 'wip/fixall-windows-1',
      checkouts: [
        { name: 'astrid-windows', branches: ['wip/fixall-windows-1'] },
        { name: 'astrid-core', branches: ['fix/awtd-1510-core-rule'], merged: [] },
      ],
    })
    expect(text).toContain('`wip/fixall-windows-1` in astrid-windows, `fix/awtd-1510-core-rule` in astrid-core')
  })

  it('AWTD-1510: a merged branch in the core checkout is not named', async () => {
    const text = await release({
      checkouts: [
        { name: 'astrid-windows', branches: [] },
        { name: 'astrid-core', branches: ['fix/awtd-1510-done'], merged: ['fix/awtd-1510-done'] },
      ],
    })
    expect(text).not.toContain('fix/awtd-1510-done')
  })

  it('AWTD-1510: nothing found names the checkouts searched and never asserts a fresh start', async () => {
    const text = await release({
      checkouts: [
        { name: 'astrid-windows', branches: ['main'] },
        { name: 'astrid-core', branches: ['main'] },
      ],
    })
    expect(text).toContain(
      'No branch carrying its id was found in the checkouts this loop can see (astrid-windows, astrid-core).',
    )
    expect(text).not.toMatch(/starts? fresh/)
  })

  it('AWTD-1510: the second-release handback carries the same conditional wording', async () => {
    const text = await release({
      comments: [{ content: `${RELEASE_MARKER}. earlier`, createdAt: '2026-09-28T00:00:00Z' }],
      checkouts: [{ name: 'astrid-windows', branches: [] }],
    })
    expect(text).toContain('in the checkouts this loop can see (astrid-windows)')
    expect(text).not.toMatch(/starts? fresh/)
  })
})

describe('a finished recurring occurrence is not an unfinished claim (2026-11-04)', () => {
  // AWTD-914, 2026-10-30: the weekly audit posted its clean result and moved its date to
  // Nov 6, but stayed in Doing; a minute later the release said "ended before finishing it…
  // continue from the branch" and sent it to Ready.
  const NOW = new Date('2026-10-30T03:00:00Z')
  const weekly = (over: Partial<DoingTask> = {}) =>
    task({ identifier: 'AWTD-914', repeating: 'weekly', dueDateTime: '2026-11-06T00:00:00.000Z', isAllDay: true, ...over })

  it('recognises a repeating task whose date has already moved past now', () => {
    expect(isFinishedOccurrence(weekly(), NOW)).toBe(true)
  })

  it('a repeating task that is still due is an ordinary claim', () => {
    expect(isFinishedOccurrence(weekly({ dueDateTime: '2026-10-30T00:00:00.000Z' }), NOW)).toBe(false)
  })

  it('a one-off task with a future date is an ordinary claim', () => {
    expect(isFinishedOccurrence(weekly({ repeating: 'never' }), NOW)).toBe(false)
    expect(isFinishedOccurrence(weekly({ repeating: null }), NOW)).toBe(false)
  })

  it('parks it in Waiting until its date (the date is its condition), without a release marker', async () => {
    const api = fakeApi()
    await parkFinishedOccurrence({ task: weekly(), now: NOW, api })
    expect(api.setStatus).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }), 'waiting')
    const text = api.comment.mock.calls[0][1]
    expect(text).toContain('📅 Scheduled for 2026-11-06 — parked in Waiting.')
    expect(text).not.toContain(RELEASE_MARKER)
    expect(text).not.toMatch(/before finishing|continue from/)
    expect(countReleases([{ content: text }])).toBe(0)
  })
})
