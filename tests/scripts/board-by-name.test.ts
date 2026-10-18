/**
 * AWTD-1267 — a loop names its board, it does not carry the board's id.
 *
 * astrid-windows keeps no list id anywhere (an id is account data, and a stale
 * one returns an empty board that reads exactly like a quiet day), so the
 * start-of-tick `release-stuck-doing.ts` pass was the one thing its loop could
 * not run. The name → id lookup used to live only inside `ready-tasks.ts`; it
 * is shared now, so the two scripts cannot disagree about which board
 * `windows` means, and a missing board fails loudly in both.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  BOARD_LIST_NAMES,
  findBoardList,
  parseBoardTarget,
  resolveBoardListId,
} from '@/scripts/lib/board-by-name'

const LISTS = [
  { id: 'web-id', name: 'Astrid Web To-do' },
  { id: 'ios-id', name: 'Astrid iOS To-do' },
  { id: 'win-id', name: 'Astrid Windows To-do' },
]

describe('AWTD-1267 board lookup by name', () => {
  it('names every board the ready queue knows', () => {
    expect(BOARD_LIST_NAMES).toEqual({
      web: 'Astrid Web To-do',
      ios: 'Astrid iOS To-do',
      windows: 'Astrid Windows To-do',
      android: 'Astrid Android To-do',
    })
  })

  it('finds the board in either response shape the lists endpoint has used', () => {
    expect(findBoardList({ lists: LISTS }, 'windows')).toEqual(LISTS[2])
    expect(findBoardList(LISTS, 'ios')).toEqual(LISTS[1])
  })

  it('fails LOUDLY when the board is not on the account — never an empty board', () => {
    expect(() => findBoardList({ lists: LISTS }, 'android')).toThrow(
      'No list named "Astrid Android To-do" found',
    )
    expect(() => findBoardList({ error: 'nope' }, 'web')).toThrow('No list named "Astrid Web To-do"')
  })

  it('resolves the id over the API, and refuses on a failed lists read', async () => {
    const ok = vi.fn().mockResolvedValue(new Response(JSON.stringify({ lists: LISTS })))
    await expect(
      resolveBoardListId({ board: 'windows', auth: { 'X-OAuth-Token': 't' }, origin: 'https://x.test', fetchImpl: ok }),
    ).resolves.toBe('win-id')
    expect(ok).toHaveBeenCalledWith('https://x.test/api/v1/lists', { headers: { 'X-OAuth-Token': 't' } })

    const down = vi.fn().mockResolvedValue(new Response('{}', { status: 503 }))
    await expect(
      resolveBoardListId({ board: 'web', auth: {}, origin: 'https://x.test', fetchImpl: down }),
    ).rejects.toThrow('HTTP 503')
  })
})

describe('AWTD-1267 release-stuck-doing --board / --list', () => {
  it('--list keeps working unchanged', () => {
    expect(parseBoardTarget({ list: 'abc' })).toEqual({ kind: 'list', listId: 'abc' })
  })

  it('--board names a known board', () => {
    expect(parseBoardTarget({ board: 'windows' })).toEqual({ kind: 'board', board: 'windows' })
  })

  it('neither is no board pass (claims-file only)', () => {
    expect(parseBoardTarget({})).toBeNull()
  })

  it('an unknown board name or both flags is a usage error', () => {
    expect(() => parseBoardTarget({ board: 'mac' })).toThrow('Unknown board "mac"')
    expect(() => parseBoardTarget({ board: 'web', list: 'abc' })).toThrow('not both')
  })
})
