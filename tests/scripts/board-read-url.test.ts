/**
 * AWTD-1237 — the lane sweeps read the board without its descriptions.
 *
 * `description` is 80% of that response (443.3 of 551.8 KiB over a thousand
 * tasks, measured 2026-10-12), and a sweep sorting tasks into lanes never reads
 * one. The parameter is free to send — opt-out, absent rather than null — so
 * what needs pinning is that it IS sent, and that nothing else about the read
 * changed while it was.
 */
import { describe, it, expect } from 'vitest'
import { boardTasksUrl } from '@/scripts/lib/board-read-url'
import { BRAND } from '@/lib/brand/config'

const BOARD = 'a623f322-4c3c-49b5-8a94-d2d9f00c82ba'

function params(url: string) {
  return new URL(url).searchParams
}

describe('boardTasksUrl', () => {
  it('asks the server to leave descriptions out', () => {
    expect(params(boardTasksUrl({ boardId: BOARD, limit: 200 })).get('omit')).toBe('description')
  })

  it('keeps every filter the sweep depends on', () => {
    // A sweep that loses its scope reads every board on the account; one that
    // loses `completed=false` fills its page with finished work and reports an
    // empty queue behind a truncation warning.
    const got = params(boardTasksUrl({ boardId: BOARD, limit: 200 }))

    expect(got.get('listId')).toBe(BOARD)
    expect(got.get('completed')).toBe('false')
    expect(got.get('leanListMembers')).toBe('1')
    expect(got.get('limit')).toBe('200')
  })

  it('carries the caller’s limit rather than a default of its own', () => {
    // The caller compares the page it got against meta.total and warns when it
    // truncated, so the number has to be the caller's.
    expect(params(boardTasksUrl({ boardId: BOARD, limit: 500 })).get('limit')).toBe('500')
  })

  it('escapes a board id instead of pasting it into the query', () => {
    const got = boardTasksUrl({ boardId: 'a b&limit=1', limit: 10 })

    expect(params(got).get('listId')).toBe('a b&limit=1')
    expect(params(got).get('limit')).toBe('10')
  })

  it('points at the brand unless told otherwise', () => {
    expect(new URL(boardTasksUrl({ boardId: BOARD, limit: 1 })).origin).toBe(`https://${BRAND.domain}`)
    expect(new URL(boardTasksUrl({ boardId: BOARD, limit: 1, origin: 'http://localhost:3000' })).origin)
      .toBe('http://localhost:3000')
  })
})
