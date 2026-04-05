import { describe, it, expect } from 'vitest'
import { parseVirtualChatKey, userCanRequestListChatChannel } from '@/lib/chat-channel-eligibility'

describe('parseVirtualChatKey', () => {
  it('parses standard virtual keys', () => {
    expect(parseVirtualChatKey('virtual-chat:user-1:my-tasks')).toEqual({
      userId: 'user-1',
      type: 'my-tasks',
    })
  })

  it('allows colons in the type segment', () => {
    expect(parseVirtualChatKey('virtual-chat:abc123:weird:type')).toEqual({
      userId: 'abc123',
      type: 'weird:type',
    })
  })

  it('returns null for invalid keys', () => {
    expect(parseVirtualChatKey('nope')).toBeNull()
    expect(parseVirtualChatKey('virtual-chat:only-two')).toBeNull()
  })
})

describe('userCanRequestListChatChannel', () => {
  const list = (over: Partial<Parameters<typeof userCanRequestListChatChannel>[0]>) => ({
    id: 'l1',
    ownerId: 'owner',
    privacy: 'PRIVATE' as const,
    publicListType: null as string | null,
    listMembers: [] as { userId: string }[],
    ...over,
  })

  it('returns false without userId', () => {
    expect(userCanRequestListChatChannel(list({}), undefined)).toBe(false)
  })

  it('returns true when list is unknown', () => {
    expect(userCanRequestListChatChannel(null, 'u1')).toBe(true)
  })

  it('allows owner and members', () => {
    expect(userCanRequestListChatChannel(list({ ownerId: 'u1' }), 'u1')).toBe(true)
    expect(
      userCanRequestListChatChannel(
        list({ ownerId: 'o', listMembers: [{ userId: 'u2' }] }),
        'u2'
      )
    ).toBe(true)
  })

  it('allows collaborative public for non-members', () => {
    expect(
      userCanRequestListChatChannel(
        list({
          ownerId: 'o',
          privacy: 'PUBLIC',
          publicListType: 'collaborative',
          listMembers: [],
        }),
        'stranger'
      )
    ).toBe(true)
    expect(
      userCanRequestListChatChannel(
        list({
          ownerId: 'o',
          privacy: 'PUBLIC',
          publicListType: 'Collaborative',
          listMembers: [],
        }),
        'stranger'
      )
    ).toBe(true)
  })

  it('denies copy-only public for non-members', () => {
    expect(
      userCanRequestListChatChannel(
        list({
          ownerId: 'o',
          privacy: 'PUBLIC',
          publicListType: 'copy_only',
          listMembers: [],
        }),
        'stranger'
      )
    ).toBe(false)
  })
})
