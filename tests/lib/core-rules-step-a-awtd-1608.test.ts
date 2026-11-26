// @vitest-environment node
/**
 * AWTD-1608, step A: the server stops comparing astrid-core with the TypeScript for listAccess,
 * searchParse, nextOccurrence and the board's columns. In decide mode, with the vendored core
 * installed the way instrumentation.ts installs it, the core answers and the TypeScript rule is
 * NOT run, not even on a process's first decision (which the AWTD-1591 sampler always compared).
 * The TypeScript still runs, and its answer is returned, whenever the core cannot answer.
 *
 * Board drops (`boardMove`) are not retired and are not tested here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installListPermissionsCore, createListPermissionsCore, listPermissionsCoreStatus } from '@/lib/core-rules/list-permissions-core'
import { installSearchQueryCore, createSearchQueryCore, searchQueryCoreStatus } from '@/lib/core-rules/search-query-core'
import { installRepeatingCore, createRepeatingCore, repeatingCoreStatus } from '@/lib/core-rules/repeating-core'
import { installBoardCore, createBoardCore, boardCoreStatus } from '@/lib/core-rules/board-core'
import { canUserManageList, setListPermissionsCore, type ListDecisionQuestion } from '@/lib/list-permissions'
import { parseSearchQuery, setSearchQueryCore } from '@/lib/search-query-parser'
import { nextOccurrenceForTask, setRepeatingCore } from '@/lib/repeating-rollover'
import { boardColumnsThroughCore, setBoardCore, type CoreBoardColumn } from '@/lib/board-core-hook'
import { calculateTaskNextOccurrence, type TaskNextOccurrenceInput } from '@/types/repeating'

// Spy on the TypeScript rollover where lib/repeating-rollover.ts calls it.
vi.mock('@/types/repeating', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/types/repeating')>()
  return { ...actual, calculateTaskNextOccurrence: vi.fn(actual.calculateTaskNextOccurrence) }
})

/** An installed hook, called the way the hook layer once called it: with the TypeScript as a getter. */
type Loose = (...args: unknown[]) => unknown
const installed = (name: string) => (globalThis as Record<symbol, unknown>)[Symbol.for(name)]

const failing = () => JSON.stringify({ ok: false, error: { kind: 'badRequest' } })
const quiet = { disagreement: () => {}, failure: () => {} }

const OWNED_LIST = { id: 'l', ownerId: 'me', privacy: 'PRIVATE', listMembers: [] }
const DAILY: TaskNextOccurrenceInput = {
  repeating: 'daily',
  pattern: null,
  currentDueDate: '2026-11-10T09:00:00.000Z',
  completion: '2026-11-10T10:00:00.000Z',
  repeatFrom: 'DUE_DATE',
  occurrenceCount: 0,
  timeZone: 'UTC',
  isAllDay: false,
}

afterEach(() => {
  setListPermissionsCore(null)
  setSearchQueryCore(null)
  setRepeatingCore(null)
  setBoardCore(null)
  vi.mocked(calculateTaskNextOccurrence).mockClear()
})

describe('AWTD-1608: in decide mode with the core loaded, the TypeScript rule is not run', () => {
  it('listAccess', () => {
    expect(installListPermissionsCore('')).toBe(true)
    const decide = installed('astrid.listPermissions.core') as Loose
    const typescript = vi.fn(() => true)
    for (let i = 0; i < 5; i++) {
      const question = { decision: 'canManage', user: { id: 'me' }, list: OWNED_LIST, typescriptAnswer: typescript }
      expect(decide(question as unknown as ListDecisionQuestion)).toBe(true)
    }
    expect(typescript).not.toHaveBeenCalled()
    expect(canUserManageList({ id: 'me' }, OWNED_LIST)).toBe(true)
  })

  it('searchParse', () => {
    expect(installSearchQueryCore('')).toBe(true)
    const parse = installed('astrid.searchQuery.core') as Loose
    const typescript = vi.fn()
    for (let i = 0; i < 5; i++) expect(parse('milk', typescript)).toMatchObject({ text: 'milk' })
    expect(typescript).not.toHaveBeenCalled()
  })

  it('nextOccurrence', () => {
    expect(installRepeatingCore('')).toBe(true)
    for (let i = 0; i < 5; i++) expect(nextOccurrenceForTask(DAILY).nextDueDate).toBe('2026-11-11T09:00:00.000Z')
    expect(calculateTaskNextOccurrence).not.toHaveBeenCalled()
  })

  it('board columns', () => {
    expect(installBoardCore('')).toBe(true)
    const typescript = vi.fn((): CoreBoardColumn[] => [])
    for (let i = 0; i < 5; i++) expect(boardColumnsThroughCore(null, typescript).length).toBeGreaterThan(0)
    expect(typescript).not.toHaveBeenCalled()
  })
})

describe('AWTD-1608: when the core cannot answer, the TypeScript rule IS run', () => {
  it('listAccess', () => {
    const decider = createListPermissionsCore(failing, quiet)
    setListPermissionsCore(decider.decide)
    expect(decider.decide({ decision: 'canManage', user: { id: 'me' }, list: OWNED_LIST })).toBeUndefined()
    expect(canUserManageList({ id: 'me' }, OWNED_LIST)).toBe(true)
    expect(decider.stats.failed).toBe(2)
  })

  it('searchParse', () => {
    const expected = parseSearchQuery('milk priority:high')
    const parser = createSearchQueryCore(failing, quiet)
    setSearchQueryCore(parser.parse)
    expect(parser.parse('milk priority:high')).toBeUndefined()
    expect(parseSearchQuery('milk priority:high')).toEqual(expected)
    expect(parser.stats.failed).toBe(2)
  })

  it('nextOccurrence', () => {
    setRepeatingCore(createRepeatingCore(failing, quiet).next)
    expect(nextOccurrenceForTask(DAILY).nextDueDate).toBe('2026-11-11T09:00:00.000Z')
    expect(calculateTaskNextOccurrence).toHaveBeenCalledTimes(1)
  })

  it('board columns', () => {
    const hook = createBoardCore(failing, quiet)
    setBoardCore({ columns: hook.columns, move: hook.move })
    const typescript = vi.fn((): CoreBoardColumn[] => [])
    expect(boardColumnsThroughCore(null, typescript)).toEqual([])
    expect(typescript).toHaveBeenCalledTimes(1)
  })
})

describe('AWTD-1608: /api/health does not count comparisons for the retired rules', () => {
  it('marks listAccess, searchParse and nextOccurrence retired, with answered and failed totals', () => {
    installListPermissionsCore('')
    installSearchQueryCore('')
    installRepeatingCore('')
    for (const status of [listPermissionsCoreStatus(), searchQueryCoreStatus(), repeatingCoreStatus()]) {
      expect(status).toMatchObject({ mode: 'decide', compare: 'retired', loaded: true })
      expect(status!.stats).toEqual({ answered: 0, skipped: 0, failed: 0 })
    }
  })

  it('splits the board: columns retired, drops still sampled with their own counters', () => {
    installBoardCore('')
    boardColumnsThroughCore(null, () => [])
    expect(boardCoreStatus()).toMatchObject({ compare: { columns: 'retired', drops: 'sampled' }, loaded: true })
    expect(boardCoreStatus()!.stats).toEqual({
      columns: { answered: 1, skipped: 0, failed: 0 },
      drops: { agreed: 0, disagreed: 0, unsampled: 0, skipped: 0, failed: 0 },
    })
  })
})
