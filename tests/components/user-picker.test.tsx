import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { UserPicker } from '@/components/user-picker'
import type { User } from '@/types/task'

// Mock fetch
global.fetch = vi.fn()

describe('UserPicker', () => {
  const mockUser: User = {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    image: null,
    createdAt: new Date()
  }

  const mockOnUserSelect = vi.fn()
  const mockOnInviteUser = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ users: [] })
    })
  })

  describe('Inline Mode', () => {
    it('should hide selected user display when inline=true', () => {
      const { container } = render(
        <UserPicker
          selectedUser={mockUser}
          onUserSelect={mockOnUserSelect}
          inline={true}
        />
      )

      // Should NOT show the selected user display card
      expect(container.querySelector('.bg-gray-700.rounded-lg.border')).toBeNull()

      // Should still show the search input
      const input = screen.getByPlaceholderText('Search users or enter email...')
      expect(input).toBeDefined()
    })

    it('should show selected user display when inline=false', () => {
      const { container } = render(
        <UserPicker
          selectedUser={mockUser}
          onUserSelect={mockOnUserSelect}
          inline={false}
        />
      )

      // Should show the selected user display card
      expect(screen.getByText('Test User')).toBeDefined()
      expect(container.querySelector('.bg-gray-700.rounded-lg.border')).not.toBeNull()
    })

    it('should show selected user display by default (inline defaults to false)', () => {
      const { container } = render(
        <UserPicker
          selectedUser={mockUser}
          onUserSelect={mockOnUserSelect}
        />
      )

      // Should show the selected user display card
      expect(screen.getByText('Test User')).toBeDefined()
      expect(container.querySelector('.bg-gray-700.rounded-lg.border')).not.toBeNull()
    })

    it('should allow unassigning user in inline mode', () => {
      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          users: [
            {
              id: 'unassigned',
              name: 'Unassigned',
              email: '',
              image: null
            }
          ]
        })
      })

      render(
        <UserPicker
          selectedUser={mockUser}
          onUserSelect={mockOnUserSelect}
          inline={true}
        />
      )

      const input = screen.getByPlaceholderText('Search users or enter email...')

      // Focus the input to show suggestions
      fireEvent.focus(input)

      // Wait for suggestions to appear and click unassigned
      waitFor(() => {
        const unassignedOption = screen.getByText('Unassigned')
        fireEvent.click(unassignedOption)
        expect(mockOnUserSelect).toHaveBeenCalledWith(null)
      })
    })
  })

  describe('User Selection', () => {
    it('should call onUserSelect when user is selected from dropdown', async () => {
      const searchUser = {
        id: 'user-2',
        name: 'Selected User',
        email: 'selected@example.com',
        image: null,
        isListMember: true
      }

      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ users: [searchUser] })
      })

      render(
        <UserPicker
          selectedUser={null}
          onUserSelect={mockOnUserSelect}
          inline={true}
          debounceMs={0}
        />
      )

      const input = screen.getByPlaceholderText('Search users or enter email...')

      // Type to search
      fireEvent.change(input, { target: { value: 'Selected' } })
      fireEvent.focus(input)

      // Wait for search results
      await waitFor(() => {
        expect(screen.getByText('Selected User')).toBeDefined()
      })

      // Click on the user
      const userOption = screen.getByText('Selected User')
      fireEvent.click(userOption)

      // Verify onUserSelect was called
      expect(mockOnUserSelect).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'user-2',
          name: 'Selected User',
          email: 'selected@example.com'
        })
      )
    })

    it('should show "Unassigned" option when search is empty', async () => {
      render(
        <UserPicker
          selectedUser={null}
          onUserSelect={mockOnUserSelect}
          taskId="task-1"
          inline={true}
        />
      )

      const input = screen.getByPlaceholderText('Search users or enter email...')
      fireEvent.focus(input)

      // Should show unassigned option
      await waitFor(() => {
        expect(screen.getByText('Unassigned')).toBeDefined()
      })
    })

    it('should handle keyboard navigation', async () => {
      const searchUser = {
        id: 'user-2',
        name: 'Keyboard User',
        email: 'keyboard@example.com',
        image: null
      }

      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ users: [searchUser] })
      })

      render(
        <UserPicker
          selectedUser={null}
          onUserSelect={mockOnUserSelect}
          inline={true}
          debounceMs={0}
        />
      )

      const input = screen.getByPlaceholderText('Search users or enter email...')

      // Focus and trigger search
      fireEvent.focus(input)
      fireEvent.change(input, { target: { value: 'Key' } })

      // Wait for results
      await waitFor(() => {
        expect(screen.getByText('Keyboard User')).toBeDefined()
      })

      // Press arrow down to select first item
      fireEvent.keyDown(input, { key: 'ArrowDown' })

      // Press enter to select
      fireEvent.keyDown(input, { key: 'Enter' })

      // Verify selection
      await waitFor(() => {
        expect(mockOnUserSelect).toHaveBeenCalled()
      })
    })
  })

  describe('Email Validation and Invitation', () => {
    it('should show invite option for valid email', async () => {
      render(
        <UserPicker
          selectedUser={null}
          onUserSelect={mockOnUserSelect}
          onInviteUser={mockOnInviteUser}
          inline={true}
          debounceMs={0}
        />
      )

      const input = screen.getByPlaceholderText('Search users or enter email...')

      // Type a valid email
      fireEvent.change(input, { target: { value: 'newuser@example.com' } })
      fireEvent.focus(input)

      // Should show invite option
      await waitFor(() => {
        expect(screen.getByText(/Invite newuser@example.com/)).toBeDefined()
      })
    })

    it('should not show invite option for invalid email', async () => {
      // Was synchronous, and therefore a FALSE PASS (AWTD-918): it asserted the
      // absence of the invite option immediately after typing, before the 300ms
      // debounce had fired or anything had rendered. Nothing was on screen yet,
      // so it passed whether or not the component gated the invite correctly.
      //
      // Now it waits for the search to actually complete before asserting, so
      // "absent" means "the component decided not to offer it" rather than
      // "the component had not got round to rendering".
      render(
        <UserPicker
          selectedUser={null}
          onUserSelect={mockOnUserSelect}
          onInviteUser={mockOnInviteUser}
          inline={true}
          debounceMs={0}
        />
      )

      const input = screen.getByPlaceholderText('Search users or enter email...')

      // Type an invalid email
      fireEvent.change(input, { target: { value: 'notanemail' } })
      fireEvent.focus(input)

      // The search for this term has to have happened first — otherwise the
      // assertion below is measuring an empty render.
      await waitFor(() => {
        expect((global.fetch as any).mock.calls.some((c: any[]) => String(c[0]).includes('q=notanemail'))).toBe(true)
      })

      // Should NOT show invite option
      expect(screen.queryByText(/Invite notanemail/)).toBeNull()
    })
  })

  describe('List Member Filtering', () => {
    it('should search with taskId parameter when provided', async () => {
      render(
        <UserPicker
          selectedUser={null}
          onUserSelect={mockOnUserSelect}
          taskId="task-123"
          inline={true}
          debounceMs={0}
        />
      )

      const input = screen.getByPlaceholderText('Search users or enter email...')
      fireEvent.change(input, { target: { value: 'test' } })

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('taskId=task-123')
        )
      })
    })

    it('should search with listIds parameter when provided', async () => {
      render(
        <UserPicker
          selectedUser={null}
          onUserSelect={mockOnUserSelect}
          listIds={['list-1', 'list-2']}
          inline={true}
          debounceMs={0}
        />
      )

      const input = screen.getByPlaceholderText('Search users or enter email...')
      fireEvent.change(input, { target: { value: 'test' } })

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('listIds=list-1%2Clist-2')
        )
      })
    })
  })

  describe('AutoFocus Behavior', () => {
    it('should auto-focus input when autoFocus=true', async () => {
      const { container } = render(
        <UserPicker
          selectedUser={null}
          onUserSelect={mockOnUserSelect}
          taskId="task-1"
          inline={true}
          autoFocus={true}
        />
      )

      const input = screen.getByPlaceholderText('Search users or enter email...') as HTMLInputElement

      // Input should be focused
      await waitFor(() => {
        expect(document.activeElement).toBe(input)
      })
    })

    it('should show suggestions immediately when autoFocus=true', async () => {
      const mockUsers = [
        {
          id: 'user-1',
          name: 'Auto User',
          email: 'auto@example.com',
          image: null,
          isListMember: true
        }
      ]

      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ users: mockUsers })
      })

      render(
        <UserPicker
          selectedUser={null}
          onUserSelect={mockOnUserSelect}
          taskId="task-1"
          inline={true}
          autoFocus={true}
        />
      )

      // Suggestions should be visible immediately without additional interaction
      await waitFor(() => {
        expect(screen.getByText('Auto User')).toBeDefined()
      })
    })

    it('should trigger initial search for list members when autoFocus=true', async () => {
      render(
        <UserPicker
          selectedUser={null}
          onUserSelect={mockOnUserSelect}
          taskId="task-123"
          listIds={['list-1']}
          inline={true}
          autoFocus={true}
        />
      )

      // Should have triggered search with empty query
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('q=')
        )
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('taskId=task-123')
        )
      })
    })

    it('should not auto-focus when autoFocus=false', () => {
      render(
        <UserPicker
          selectedUser={null}
          onUserSelect={mockOnUserSelect}
          taskId="task-1"
          inline={true}
          autoFocus={false}
        />
      )

      const input = screen.getByPlaceholderText('Search users or enter email...') as HTMLInputElement

      // Input should NOT be focused
      expect(document.activeElement).not.toBe(input)
    })

    it('should not auto-focus by default (when autoFocus not specified)', () => {
      render(
        <UserPicker
          selectedUser={null}
          onUserSelect={mockOnUserSelect}
          taskId="task-1"
          inline={true}
        />
      )

      const input = screen.getByPlaceholderText('Search users or enter email...') as HTMLInputElement

      // Input should NOT be focused (autoFocus defaults to false)
      expect(document.activeElement).not.toBe(input)
    })

    it('should fix the two-tap issue - dropdown opens on first tap with autoFocus', async () => {
      // This test simulates the bug fix: previously required two taps, now only one

      const mockUsers = [
        {
          id: 'user-1',
          name: 'First Tap User',
          email: 'firsttap@example.com',
          image: null,
          isListMember: true
        }
      ]

      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ users: mockUsers })
      })

      // Simulate the TaskFieldEditors behavior: when user clicks assignee field,
      // it sets editingAssignee=true and renders UserPicker with autoFocus=true
      render(
        <UserPicker
          selectedUser={null}
          onUserSelect={mockOnUserSelect}
          taskId="task-1"
          inline={true}
          autoFocus={true}
        />
      )

      // With autoFocus=true, suggestions should appear immediately
      // WITHOUT requiring a second tap/focus on the input
      await waitFor(() => {
        expect(screen.getByText('First Tap User')).toBeDefined()
      })

      // User can now select immediately on first interaction
      const userOption = screen.getByText('First Tap User')
      fireEvent.click(userOption)

      expect(mockOnUserSelect).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'user-1',
          name: 'First Tap User'
        })
      )
    })
  })

  describe('search debounce is injectable (AWTD-918)', () => {
    // The flake this fixes: `should handle keyboard navigation` failed one
    // predeploy run with "Unable to find an element with the text: Keyboard
    // User" while passing 8/8 in isolation. The component debounced the search
    // by a hardcoded 300ms (components/user-picker.tsx) and the assertions used
    // waitFor's default 1000ms timeout, so the margin was ~700ms of scheduler
    // slack. A full run — 668 files across parallel workers, emitting
    // MaxListenersExceededWarning — can eat that.
    //
    // The load-dependent failure cannot be reproduced on demand, so this pins
    // the DEFECT instead: the delay must be injectable, so a test never has to
    // out-wait a real timer. The budget below is deliberately under 300ms — it
    // fails against the old hardcoded debounce and passes once the prop is
    // honoured. Raising this timeout to make a failure go away would restore
    // exactly the bug being fixed here.
    const UNDER_THE_DEFAULT_DEBOUNCE = 150

    it('resolves a search faster than the production debounce would allow', async () => {
      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ users: [{ id: 'u-fast', name: 'Fast User', email: 'fast@example.com', image: null }] }),
      })

      render(
        <UserPicker
          selectedUser={null}
          onUserSelect={mockOnUserSelect}
          inline={true}
          debounceMs={0}
        />
      )

      const input = screen.getByPlaceholderText('Search users or enter email...')
      fireEvent.focus(input)
      fireEvent.change(input, { target: { value: 'Fast' } })

      await waitFor(
        () => { expect(screen.getByText('Fast User')).toBeDefined() },
        { timeout: UNDER_THE_DEFAULT_DEBOUNCE }
      )
    })

    it('still debounces by default, so production behaviour is unchanged', async () => {
      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ users: [] }),
      })

      render(
        <UserPicker
          selectedUser={null}
          onUserSelect={mockOnUserSelect}
          inline={true}
        />
      )

      const input = screen.getByPlaceholderText('Search users or enter email...')
      fireEvent.focus(input)
      fireEvent.change(input, { target: { value: 'ab' } })

      // Immediately after typing, the debounce has not elapsed, so no request
      // has gone out. This is what keeps the fix from silently becoming
      // "debounce removed".
      expect((global.fetch as any).mock.calls.filter((c: any[]) => String(c[0]).includes('q=ab'))).toHaveLength(0)

      await waitFor(() => {
        expect((global.fetch as any).mock.calls.some((c: any[]) => String(c[0]).includes('q=ab'))).toBe(true)
      })
    })
  })
})
