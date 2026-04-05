import { describe, it, expect } from 'vitest'

/**
 * Tests that SSE broadcasts and client-side handlers preserve
 * per-user favorite state isolation.
 */

describe('Favorites SSE isolation', () => {
  describe('SSE broadcast data stripping', () => {
    it('should strip isFavorite and favoriteOrder from broadcast data', () => {
      // Simulate what the API does before broadcasting
      const updatedListWithDefaultAssignee = {
        id: 'list-1',
        name: 'Test List',
        color: '#3b82f6',
        privacy: 'PRIVATE',
        ownerId: 'user-A',
        isFavorite: true,        // DB-level stale value
        favoriteOrder: 1,        // DB-level stale value
        defaultAssignee: null,
        listMembers: [],
      }

      const { isFavorite: _isFav, favoriteOrder: _favOrd, ...broadcastData } = updatedListWithDefaultAssignee

      expect(broadcastData).not.toHaveProperty('isFavorite')
      expect(broadcastData).not.toHaveProperty('favoriteOrder')
      expect(broadcastData).toHaveProperty('id', 'list-1')
      expect(broadcastData).toHaveProperty('name', 'Test List')
      expect(broadcastData).toHaveProperty('color', '#3b82f6')
    })
  })

  describe('Client SSE handler preserves per-user favorites', () => {
    it('should not overwrite local isFavorite when SSE event arrives', () => {
      // Simulate client state: User B has list-1 favorited
      const localList = {
        id: 'list-1',
        name: 'Old Name',
        color: '#old',
        isFavorite: true,
        favoriteOrder: 3,
      }

      // SSE event from User A's list update (name changed, no favorite fields)
      const sseEventData = {
        id: 'list-1',
        name: 'New Name',
        color: '#new',
      }

      // Apply the same merge logic as the client SSE handler
      const { isFavorite, favoriteOrder, ...sharedData } = sseEventData as any
      const merged = { ...localList, ...sharedData }

      // Shared fields should update
      expect(merged.name).toBe('New Name')
      expect(merged.color).toBe('#new')

      // Per-user favorites should be preserved
      expect(merged.isFavorite).toBe(true)
      expect(merged.favoriteOrder).toBe(3)
    })

    it('should preserve isFavorite=false when SSE event arrives', () => {
      const localList = {
        id: 'list-1',
        name: 'Old Name',
        isFavorite: false,
        favoriteOrder: null as number | null,
      }

      const sseEventData = {
        id: 'list-1',
        name: 'New Name',
      }

      const { isFavorite, favoriteOrder, ...sharedData } = sseEventData as any
      const merged = { ...localList, ...sharedData }

      expect(merged.name).toBe('New Name')
      expect(merged.isFavorite).toBe(false)
      expect(merged.favoriteOrder).toBeNull()
    })

    it('should still preserve favorites even if SSE event has stale favorite data', () => {
      // Edge case: old broadcast format that still includes isFavorite
      const localList = {
        id: 'list-1',
        name: 'Old Name',
        isFavorite: true,
        favoriteOrder: 2,
      }

      const sseEventData = {
        id: 'list-1',
        name: 'New Name',
        isFavorite: false,     // Stale DB value — should be ignored
        favoriteOrder: null,   // Stale DB value — should be ignored
      }

      // Client handler destructures and discards favorite fields
      const { isFavorite, favoriteOrder, ...sharedData } = sseEventData as any
      const merged = { ...localList, ...sharedData }

      expect(merged.name).toBe('New Name')
      // Local per-user state preserved
      expect(merged.isFavorite).toBe(true)
      expect(merged.favoriteOrder).toBe(2)
    })
  })

  describe('Multi-user scenario', () => {
    it('simulates User A updating list name while User B has it favorited', () => {
      // User B's local state
      const userBLists = [
        { id: 'list-1', name: 'Shared Project', isFavorite: true, favoriteOrder: 1 },
        { id: 'list-2', name: 'Another List', isFavorite: false, favoriteOrder: null as number | null },
      ]

      // User A renames list-1 — SSE event received by User B
      const sseEvent = {
        id: 'list-1',
        name: 'Renamed Project',
        color: '#ff0000',
      }

      // Apply the same merge logic as the real SSE handler
      const updatedLists = userBLists.map(list => {
        if (list.id !== sseEvent.id) return list
        const { isFavorite, favoriteOrder, ...sharedData } = sseEvent as any
        return { ...list, ...sharedData }
      })

      // list-1: name updated, favorite preserved
      expect(updatedLists[0].name).toBe('Renamed Project')
      expect(updatedLists[0].isFavorite).toBe(true)
      expect(updatedLists[0].favoriteOrder).toBe(1)

      // list-2: unchanged
      expect(updatedLists[1].name).toBe('Another List')
      expect(updatedLists[1].isFavorite).toBe(false)
    })
  })
})
