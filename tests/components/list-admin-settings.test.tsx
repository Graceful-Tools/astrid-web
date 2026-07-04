/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ListAdminSettings } from '@/components/list-admin-settings'
import type { TaskList, User } from '@/types/task'

// Mock fetch globally
global.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ repositories: [], cached: true })
  } as Response)
)

// Mock the layout detection module
vi.mock('@/lib/layout-detection', () => ({
  shouldPreventAutoFocus: () => false,
  shouldIgnoreTouchDuringKeyboard: () => false,
  needsAggressiveKeyboardProtection: () => false,
  getFocusProtectionThreshold: () => 300,
  isMobileDevice: () => false
}))

describe('ListAdminSettings - Delete List Modal', () => {
  const mockCurrentUser: User = {
    id: 'user-1',
    name: 'Test User',
    email: 'test@example.com',
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    emailVerified: null,
    isActive: true,
    pendingEmail: null,
    emailVerificationToken: null,
    emailTokenExpiresAt: null,
    password: null
  }

  const mockList: TaskList = {
    id: 'list-1',
    name: 'Test List',
    color: '#3b82f6',
    ownerId: 'user-1',
    privacy: 'PRIVATE',
    createdAt: new Date(),
    updatedAt: new Date(),
    members: [],
    admins: [],
    tasks: []
  }

  const mockOnUpdate = vi.fn()
  const mockOnDelete = vi.fn()
  const mockOnEditName = vi.fn()
  const mockOnEditImage = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Delete Confirmation Modal', () => {
    it('should show delete list button when user has edit settings permission', () => {
      render(
        <ListAdminSettings
          list={mockList}
          currentUser={mockCurrentUser}
          canEditSettings={true}
          onUpdate={mockOnUpdate}
          onDelete={mockOnDelete}
          onEditName={mockOnEditName}
          onEditImage={mockOnEditImage}
        />
      )

      expect(screen.getByText('Delete List')).toBeInTheDocument()
    })

    it('should not show delete list button when user lacks edit settings permission', () => {
      render(
        <ListAdminSettings
          list={mockList}
          currentUser={mockCurrentUser}
          canEditSettings={false}
          onUpdate={mockOnUpdate}
          onDelete={mockOnDelete}
          onEditName={mockOnEditName}
          onEditImage={mockOnEditImage}
        />
      )

      expect(screen.queryByText('Delete List')).not.toBeInTheDocument()
    })

    it('should open modal dialog when delete list button is clicked', async () => {
      const { container } = render(
        <ListAdminSettings
          list={mockList}
          currentUser={mockCurrentUser}
          canEditSettings={true}
          onUpdate={mockOnUpdate}
          onDelete={mockOnDelete}
          onEditName={mockOnEditName}
          onEditImage={mockOnEditImage}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Delete List')).toBeInTheDocument()
      })

      const deleteButton = screen.getByText('Delete List')
      fireEvent.click(deleteButton)

      // Modal should appear - check by looking for h3 with "Delete List"
      await waitFor(() => {
        const modalHeading = Array.from(container.querySelectorAll('h3'))
          .find(h => h.textContent === 'Delete List')
        expect(modalHeading).toBeInTheDocument()
      })
    })

    it('should display correct list name in confirmation modal', async () => {
      const customList = { ...mockList, name: 'My Custom List' }

      const { container } = render(
        <ListAdminSettings
          list={customList}
          currentUser={mockCurrentUser}
          canEditSettings={true}
          onUpdate={mockOnUpdate}
          onDelete={mockOnDelete}
          onEditName={mockOnEditName}
          onEditImage={mockOnEditImage}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Delete List')).toBeInTheDocument()
      })

      const deleteButton = screen.getByText('Delete List')
      fireEvent.click(deleteButton)

      // Check that modal contains the custom list name
      await waitFor(() => {
        const modalContent = container.querySelector('.fixed')
        expect(modalContent?.textContent).toContain('My Custom List')
      })
    })

    it('should close modal when "Don\'t Delete" button is clicked', () => {
      render(
        <ListAdminSettings
          list={mockList}
          currentUser={mockCurrentUser}
          canEditSettings={true}
          onUpdate={mockOnUpdate}
          onDelete={mockOnDelete}
          onEditName={mockOnEditName}
          onEditImage={mockOnEditImage}
        />
      )

      // Open modal
      const deleteButton = screen.getByText('Delete List')
      fireEvent.click(deleteButton)

      // Click "Don't Delete"
      const dontDeleteButton = screen.getByText("Don't Delete")
      fireEvent.click(dontDeleteButton)

      // Modal should be closed
      expect(screen.queryByText('Delete List', { selector: 'h3' })).not.toBeInTheDocument()
      expect(mockOnDelete).not.toHaveBeenCalled()
    })

    it('should call onDelete and close modal when "Delete" button is clicked', () => {
      render(
        <ListAdminSettings
          list={mockList}
          currentUser={mockCurrentUser}
          canEditSettings={true}
          onUpdate={mockOnUpdate}
          onDelete={mockOnDelete}
          onEditName={mockOnEditName}
          onEditImage={mockOnEditImage}
        />
      )

      // Open modal
      const deleteButton = screen.getByText('Delete List')
      fireEvent.click(deleteButton)

      // Click "Delete" in modal - get all buttons with "Delete" text
      const allDeleteButtons = screen.getAllByRole('button', { name: /delete/i })
      const confirmDeleteButton = allDeleteButtons.find(
        button => button.className.includes('bg-red-600')
      )
      expect(confirmDeleteButton).toBeInTheDocument()
      fireEvent.click(confirmDeleteButton!)

      // Should call onDelete with list ID
      expect(mockOnDelete).toHaveBeenCalledWith(mockList.id)
      expect(mockOnDelete).toHaveBeenCalledTimes(1)

      // Modal should be closed
      expect(screen.queryByText('Delete List', { selector: 'h3' })).not.toBeInTheDocument()
    })

    it('should close modal when backdrop is clicked', () => {
      render(
        <ListAdminSettings
          list={mockList}
          currentUser={mockCurrentUser}
          canEditSettings={true}
          onUpdate={mockOnUpdate}
          onDelete={mockOnDelete}
          onEditName={mockOnEditName}
          onEditImage={mockOnEditImage}
        />
      )

      // Open modal
      const deleteButton = screen.getByText('Delete List')
      fireEvent.click(deleteButton)

      // Modal should be visible
      const modalTitle = screen.getByText('Delete List', { selector: 'h3' })
      expect(modalTitle).toBeInTheDocument()

      // Click backdrop (the overlay div)
      const backdrop = modalTitle.closest('.fixed')
      expect(backdrop).toBeInTheDocument()
      fireEvent.click(backdrop!)

      // Modal should be closed
      expect(screen.queryByText('Delete List', { selector: 'h3' })).not.toBeInTheDocument()
      expect(mockOnDelete).not.toHaveBeenCalled()
    })

    it('should not close modal when clicking inside the modal content', () => {
      render(
        <ListAdminSettings
          list={mockList}
          currentUser={mockCurrentUser}
          canEditSettings={true}
          onUpdate={mockOnUpdate}
          onDelete={mockOnDelete}
          onEditName={mockOnEditName}
          onEditImage={mockOnEditImage}
        />
      )

      // Open modal
      const deleteButton = screen.getByText('Delete List')
      fireEvent.click(deleteButton)

      // Click inside modal content
      const modalContent = screen.getByText(/This action cannot be undone/)
      fireEvent.click(modalContent)

      // Modal should still be visible
      expect(screen.getByText('Delete List', { selector: 'h3' })).toBeInTheDocument()
      expect(mockOnDelete).not.toHaveBeenCalled()
    })

    it('should display modal with proper styling and structure', () => {
      render(
        <ListAdminSettings
          list={mockList}
          currentUser={mockCurrentUser}
          canEditSettings={true}
          onUpdate={mockOnUpdate}
          onDelete={mockOnDelete}
          onEditName={mockOnEditName}
          onEditImage={mockOnEditImage}
        />
      )

      // Open modal
      const deleteButton = screen.getByText('Delete List')
      fireEvent.click(deleteButton)

      // Check modal structure
      const modalTitle = screen.getByText('Delete List', { selector: 'h3' })
      expect(modalTitle).toHaveClass('text-lg', 'font-semibold')

      // Check buttons
      const dontDeleteButton = screen.getByText("Don't Delete")
      const allDeleteButtons = screen.getAllByRole('button', { name: /delete/i })
      const confirmDeleteButton = allDeleteButtons.find(
        button => button.className.includes('bg-red-600')
      )

      expect(dontDeleteButton).toBeInTheDocument()
      expect(confirmDeleteButton).toBeInTheDocument()

      // Verify destructive button styling
      expect(confirmDeleteButton).toHaveClass('bg-red-600', 'hover:bg-red-700', 'text-white')
    })

    it('should prevent reopening modal after successful delete', () => {
      render(
        <ListAdminSettings
          list={mockList}
          currentUser={mockCurrentUser}
          canEditSettings={true}
          onUpdate={mockOnUpdate}
          onDelete={mockOnDelete}
          onEditName={mockOnEditName}
          onEditImage={mockOnEditImage}
        />
      )

      // Open modal
      const deleteButton = screen.getByText('Delete List')
      fireEvent.click(deleteButton)

      // Confirm delete
      const allDeleteButtons = screen.getAllByRole('button', { name: /delete/i })
      const confirmDeleteButton = allDeleteButtons.find(
        button => button.className.includes('bg-red-600')
      )
      fireEvent.click(confirmDeleteButton!)

      // Modal should be closed
      expect(screen.queryByText('Delete List', { selector: 'h3' })).not.toBeInTheDocument()

      // Verify delete was called
      expect(mockOnDelete).toHaveBeenCalledWith(mockList.id)
    })
  })
})
