import { describe, expect, it } from 'vitest'
import { getHeaderViewToggle, nextHeaderSegment, type HeaderToggleSegment } from '@/lib/header-view-toggle'

const base = {
  isOneColumn: true,
  hasProjectBoard: true,
  chatAvailable: true,
  activeView: 'list' as const,
  isSearching: false,
}

describe('getHeaderViewToggle (task a1e5c0ff: unified 3-way toggle in 1-col)', () => {
  // AWTD-1183: the one-column control is the iPhone's view rotator, so the
  // segments are in the order it steps through them — list, messages, board.
  it('1-col + board + chat → unified List / Messages / Board, in rotation order', () => {
    expect(getHeaderViewToggle(base)).toEqual({
      segments: ['list', 'messages', 'board'],
      unified: true,
    })
  })

  it('1-col + no board + chat → unified List / Messages (still segmented)', () => {
    expect(getHeaderViewToggle({ ...base, hasProjectBoard: false })).toEqual({
      segments: ['list', 'messages'],
      unified: true,
    })
  })

  it('1-col + board + no chat → unified List / Board (Messages dropped)', () => {
    expect(getHeaderViewToggle({ ...base, chatAvailable: false })).toEqual({
      segments: ['list', 'board'],
      unified: true,
    })
  })

  it('1-col + no board + no chat → empty (no toggle to render)', () => {
    expect(
      getHeaderViewToggle({ ...base, hasProjectBoard: false, chatAvailable: false }),
    ).toEqual({ segments: [], unified: false })
  })

  it('wider layout + board → legacy split (segments: list+board, unified=false)', () => {
    expect(getHeaderViewToggle({ ...base, isOneColumn: false })).toEqual({
      segments: ['list', 'board'],
      unified: false,
    })
  })

  it('wider layout + no board → empty list-only segments (caller renders nothing)', () => {
    expect(
      getHeaderViewToggle({ ...base, isOneColumn: false, hasProjectBoard: false }),
    ).toEqual({ segments: ['list'], unified: false })
  })

  it('suppressed entirely when activeView is not "list"', () => {
    expect(getHeaderViewToggle({ ...base, activeView: 'settings' })).toEqual({
      segments: [],
      unified: false,
    })
  })

  it('suppressed when the user is searching (search input owns the header chrome)', () => {
    expect(getHeaderViewToggle({ ...base, isSearching: true })).toEqual({
      segments: [],
      unified: false,
    })
  })
})

describe('nextHeaderSegment (AWTD-1183: one tap steps to the next view)', () => {
  const all: HeaderToggleSegment[] = ['list', 'messages', 'board']

  it('steps list → messages → board → list', () => {
    expect(nextHeaderSegment(all, 'list')).toBe('messages')
    expect(nextHeaderSegment(all, 'messages')).toBe('board')
    expect(nextHeaderSegment(all, 'board')).toBe('list')
  })

  it('flips between two views when there are only two', () => {
    expect(nextHeaderSegment(['list', 'messages'], 'list')).toBe('messages')
    expect(nextHeaderSegment(['list', 'messages'], 'messages')).toBe('list')
  })

  it('starts over from the first view when the current one is not offered', () => {
    expect(nextHeaderSegment(['list', 'messages'], 'board')).toBe('list')
  })
})
