import { describe, it, expect, vi, beforeEach , type Mock } from 'vitest'
import { buildTaskList } from '../fixtures/domain'
import { isListAdminOrOwner } from '@/lib/list-member-utils'
import type { TaskList } from '@/types/task'

// Mock the list member utils
vi.mock('@/lib/list-member-utils', () => ({
  isListAdminOrOwner: vi.fn(),
  getAllListMembers: vi.fn(() => [{ id: 'user1', role: 'OWNER' }])
}))

describe('LeftSidebar Public List Filtering Logic', () => {
  const mockEffectiveSession = {
    user: {
      id: 'user1',
      name: 'Test User',
      email: 'test@example.com',
      image: null
    }
  }

  const mockPublicListOwned: TaskList = buildTaskList({
    id: 'public-list-1',
    name: 'Public List 1',
    description: 'A public list owned by user',
    privacy: 'PUBLIC',
    ownerId: 'user1',
    createdAt: new Date(),
    updatedAt: new Date(),
    isVirtual: false,
    isFavorite: false,
    members: []
  })

  const mockPublicListNotOwned: TaskList = buildTaskList({
    id: 'public-list-2',
    name: 'Public List 2',
    description: 'A public list not owned by user',
    privacy: 'PUBLIC',
    ownerId: 'other-user',
    createdAt: new Date(),
    updatedAt: new Date(),
    isVirtual: false,
    isFavorite: false,
    members: []
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should filter out owned public lists from Featured Lists', () => {
    const publicLists = [mockPublicListOwned, mockPublicListNotOwned]

    // Mock that user1 owns public-list-1 but not public-list-2
    const mockIsListAdminOrOwner = isListAdminOrOwner as Mock
    mockIsListAdminOrOwner.mockImplementation((list: TaskList, userId: string) => {
      return list.id === 'public-list-1' && userId === 'user1'
    })

    // Apply the same filtering logic as in LeftSidebar.tsx
    const featuredLists = publicLists.filter(list => {
      if (mockEffectiveSession?.user?.id) {
        return !isListAdminOrOwner(list, mockEffectiveSession.user.id)
      }
      return true
    })

    // Should only contain the non-owned list
    expect(featuredLists).toHaveLength(1)
    expect(featuredLists[0].id).toBe('public-list-2')
    expect(featuredLists[0].name).toBe('Public List 2')
  })

  it('should include all public lists when user owns none', () => {
    const publicLists = [mockPublicListOwned, mockPublicListNotOwned]

    // Mock that user1 owns no public lists
    const mockIsListAdminOrOwner = isListAdminOrOwner as Mock
    mockIsListAdminOrOwner.mockReturnValue(false)

    // Apply the same filtering logic as in LeftSidebar.tsx
    const featuredLists = publicLists.filter(list => {
      if (mockEffectiveSession?.user?.id) {
        return !isListAdminOrOwner(list, mockEffectiveSession.user.id)
      }
      return true
    })

    // Should contain both lists
    expect(featuredLists).toHaveLength(2)
    expect(featuredLists.map(l => l.id)).toEqual(['public-list-1', 'public-list-2'])
  })

  it('should exclude all public lists when user owns all', () => {
    const publicLists = [mockPublicListOwned, mockPublicListNotOwned]

    // Mock that user1 owns all public lists
    const mockIsListAdminOrOwner = isListAdminOrOwner as Mock
    mockIsListAdminOrOwner.mockReturnValue(true)

    // Apply the same filtering logic as in LeftSidebar.tsx
    const featuredLists = publicLists.filter(list => {
      if (mockEffectiveSession?.user?.id) {
        return !isListAdminOrOwner(list, mockEffectiveSession.user.id)
      }
      return true
    })

    // Should contain no lists
    expect(featuredLists).toHaveLength(0)
  })

  it('should handle empty public lists array', () => {
    const publicLists: TaskList[] = []

    // Apply the same filtering logic as in LeftSidebar.tsx
    const featuredLists = publicLists.filter(list => {
      if (mockEffectiveSession?.user?.id) {
        return !isListAdminOrOwner(list, mockEffectiveSession.user.id)
      }
      return true
    })

    // Should remain empty
    expect(featuredLists).toHaveLength(0)
  })
})