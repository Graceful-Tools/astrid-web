/**
 * ADEV-26: N cloud workers start from the same preflight snapshot, so all of them see the
 * same top task. The loser's 409 must move it on to the next Ready task, and no worker may
 * end SKIPPED while unclaimed Ready work remains.
 */
import { describe, expect, it, vi } from 'vitest'
import { claimNextReady, isCoreCandidate, runnerClaimedTask, type ClaimCandidate } from '@/scripts/lib/claim-next'
import { ASTRID_API, recordClaim, requestFixallClaim } from '@/scripts/lib/fixall-claim-request'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const t = (id: string, title = `Task ${id}`): ClaimCandidate => ({ id, identifier: `ADEV-${id}`, title })

/** A board where `taken` are already claimed; a claim succeeds once per id, like the server's. */
function board(taken: string[] = []) {
  const owned = new Set(taken)
  const calls: string[] = []
  const claim = vi.fn(async (task: ClaimCandidate) => {
    calls.push(task.id)
    if (owned.has(task.id)) return 'conflict' as const
    owned.add(task.id)
    return 'claimed' as const
  })
  return { claim, calls, owned }
}

describe('ADEV-26: claim the next Ready task nobody else has', () => {
  it('ADEV-26: takes the top task when it is free', async () => {
    const { claim } = board()
    const refresh = vi.fn(async () => [])
    const result = await claimNextReady({ initial: [t('1'), t('2')], claim, refresh })
    expect(result.claimed?.id).toBe('1')
    expect(result.conflicts).toEqual([])
    expect(refresh).not.toHaveBeenCalled()
  })

  it('ADEV-26: a 409 on the top task moves on to the next, in priority order', async () => {
    const { claim, calls } = board(['1'])
    const result = await claimNextReady({ initial: [t('1'), t('2'), t('3')], claim, refresh: async () => [] })
    expect(result.claimed?.id).toBe('2')
    expect(result.conflicts).toEqual(['1'])
    expect(calls).toEqual(['1', '2'])
  })

  it('ADEV-26: three workers sharing one snapshot claim three different tasks', async () => {
    const { claim } = board()
    const snapshot = [t('1'), t('2'), t('3'), t('4')]
    const results = await Promise.all([1, 2, 3].map(() =>
      claimNextReady({ initial: snapshot, claim, refresh: async () => snapshot })))
    const ids = results.map(r => r.claimed?.id)
    expect(new Set(ids).size).toBe(3)
    expect(ids.sort()).toEqual(['1', '2', '3'])
  })

  it('ADEV-26: re-reads the live queue when the snapshot is exhausted, and takes a task that arrived since', async () => {
    const { claim } = board(['1', '2'])
    const refresh = vi.fn(async () => [t('1'), t('2'), t('5')])
    const result = await claimNextReady({ initial: [t('1'), t('2')], claim, refresh })
    expect(result.claimed?.id).toBe('5')
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('ADEV-26: reports nothing left only after a fresh read holds nothing untried', async () => {
    const { claim } = board(['1', '2'])
    const refresh = vi.fn(async () => [t('2'), t('1')])
    const result = await claimNextReady({ initial: [t('1'), t('2')], claim, refresh })
    expect(result.claimed).toBeNull()
    expect(result.conflicts).toEqual(['1', '2'])
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('ADEV-26: an empty snapshot still reads the live queue (a wake that beat the preflight)', async () => {
    const { claim } = board()
    const result = await claimNextReady({ initial: [], claim, refresh: async () => [t('9')] })
    expect(result.claimed?.id).toBe('9')
  })

  it('ADEV-26: bounds the fresh reads, so a board that keeps changing cannot spin a worker', async () => {
    let n = 100
    const claim = vi.fn(async () => 'conflict' as const)
    const refresh = vi.fn(async () => [t(String(n++))])
    const result = await claimNextReady({ initial: [], claim, refresh, maxRefreshes: 2 })
    expect(result.claimed).toBeNull()
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('ADEV-26: passes over a skipped task (core without push access) and never claims it', async () => {
    const { claim, calls } = board()
    const result = await claimNextReady({
      initial: [t('1', '[core] Recurrence for Sundays'), t('2', 'Settings spacing')],
      claim, refresh: async () => [], skip: isCoreCandidate,
    })
    expect(result.claimed?.id).toBe('2')
    expect(result.skipped).toEqual(['1'])
    expect(calls).toEqual(['2'])
  })

  it('ADEV-26: a claim that errors (not a 409) is not swallowed as "nothing left"', async () => {
    const claim = vi.fn(async () => { throw new Error('Claim failed with HTTP 500') })
    await expect(claimNextReady({ initial: [t('1')], claim, refresh: async () => [] })).rejects.toThrow('HTTP 500')
  })

  it.each([
    ['[core] rule', true], ['[CORE] rule', true], ['Bump the astrid-core pin', true],
    ['Settings page', false], ['', false],
  ])('ADEV-26: isCoreCandidate(%j) is %s, the same test as the workflow', (title, expected) => {
    expect(isCoreCandidate({ id: 'x', title })).toBe(expected)
  })
})

describe('ADEV-26: the shared claim request', () => {
  const response = (status: number, body = '') => new Response(body, { status })

  it('ADEV-26: a 409 is a conflict value carrying the server reason, not an error', async () => {
    const fetchImpl = vi.fn(async () => response(409, 'already claimed')) as unknown as typeof fetch
    await expect(requestFixallClaim({ token: 'x', taskId: 't1', action: 'ready', agent: 'claude', fetchImpl }))
      .resolves.toEqual({ status: 'conflict', reason: 'already claimed' })
  })

  it('ADEV-26: sends the mailbox and board, and a 200 is a claim', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => response(200, '{}'))
    await expect(requestFixallClaim({
      token: 'x', taskId: 't1', action: 'ready', agent: 'claude', listId: 'board', fetchImpl: fetchImpl as unknown as typeof fetch,
    })).resolves.toEqual({ status: 'claimed' })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(`${ASTRID_API}/api/v1/tasks/t1/claim-fixall`)
    expect((init.headers as Record<string, string>)['X-OAuth-Token']).toBe('x')
    expect(JSON.parse(String(init.body))).toEqual({ action: 'ready', commentWatermark: null, agent: 'claude', listId: 'board' })
  })

  it('ADEV-26: any other failure throws', async () => {
    const fetchImpl = vi.fn(async () => response(500, 'boom')) as unknown as typeof fetch
    await expect(requestFixallClaim({ token: 'x', taskId: 't1', action: 'ready', fetchImpl })).rejects.toThrow('HTTP 500')
  })

  it('ADEV-26: records only Ready and resume claims, in the worker\'s own claims file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'claims-'))
    try {
      const file = join(dir, 'claims.txt')
      writeFileSync(file, '')
      recordClaim('a', 'ready', file)
      recordClaim('b', 'resume', file)
      recordClaim('c', 'comment', file)
      expect(readFileSync(file, 'utf8')).toBe('a\nb\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('ADEV-75: a task the runner already claimed for this worker', () => {
  it('is answered as this worker\'s claim instead of re-walking the queue to NO_READY_TASK', () => {
    expect(runnerClaimedTask({ ASTRID_CLAIMED_TASK: '07824c1f-9e53-432e-abb5-7edcd6516e47' }))
      .toBe('07824c1f-9e53-432e-abb5-7edcd6516e47')
  })

  it('is absent for slot 1, a local session, or a malformed value', () => {
    expect(runnerClaimedTask({})).toBeUndefined()
    expect(runnerClaimedTask({ ASTRID_CLAIMED_TASK: '' })).toBeUndefined()
    expect(runnerClaimedTask({ ASTRID_CLAIMED_TASK: 'abc; rm -rf /' })).toBeUndefined()
  })
})
