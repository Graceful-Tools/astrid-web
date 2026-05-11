import { describe, expect, it } from 'vitest'
import { getHeaderViewToggle } from '@/lib/header-view-toggle'

const base = {
  isOneColumn: true,
  hasProjectBoard: true,
  chatAvailable: true,
  activeView: 'list' as const,
  isSearching: false,
}

describe('getHeaderViewToggle (task a1e5c0ff: unified 3-way toggle in 1-col)', () => {
  it('1-col + board + chat → unified List / Board / Messages', () => {
    expect(getHeaderViewToggle(base)).toEqual({
      segments: ['list', 'board', 'messages'],
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
