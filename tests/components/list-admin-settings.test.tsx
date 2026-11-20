/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildUser } from '../fixtures/domain'
import { buildTaskList } from '../fixtures/domain'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  const mockCurrentUser: User = buildUser({
    id: 'user-1',
    name: 'Test User',
    email: 'test@example.com',
    image: null,
    createdAt: new Date(),
  })

  const mockList: TaskList = buildTaskList({
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
  })

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

      // The confirm is the shared ConfirmDialog since ADEV-159, portalled out of the section.
      await waitFor(() => {
        expect(within(screen.getByTestId('list-delete-confirm')).getByRole('heading', { name: 'Delete List' })).toBeInTheDocument()
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
        expect(screen.getByTestId('list-delete-confirm')).toHaveTextContent('My Custom List')
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
      expect(screen.queryByTestId('list-delete-confirm')).not.toBeInTheDocument()
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
      const confirmDeleteButton = within(screen.getByTestId('list-delete-confirm')).getByRole('button', { name: 'Delete' })
      expect(confirmDeleteButton).toBeInTheDocument()
      fireEvent.click(confirmDeleteButton!)

      // Should call onDelete with list ID
      expect(mockOnDelete).toHaveBeenCalledWith(mockList.id)
      expect(mockOnDelete).toHaveBeenCalledTimes(1)

      // Modal should be closed
      expect(screen.queryByTestId('list-delete-confirm')).not.toBeInTheDocument()
    })

    it('should close modal when backdrop is clicked', async () => {
      const user = userEvent.setup()
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
      const dialog = screen.getByTestId('list-delete-confirm')

      // Click backdrop (the dialog primitive's scrim, a sibling of the dialog)
      const backdrop = Array.from(document.querySelectorAll('.fixed.inset-0')).find(el => !el.contains(dialog) && el.getAttribute('data-state') === 'open')
      expect(backdrop).toBeInTheDocument()
      await user.click(backdrop!)

      // Modal should be closed
      expect(screen.queryByTestId('list-delete-confirm')).not.toBeInTheDocument()
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
      expect(screen.getByTestId('list-delete-confirm')).toBeInTheDocument()
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
      const modalTitle = within(screen.getByTestId('list-delete-confirm')).getByRole('heading', { name: 'Delete List' })
      expect(modalTitle).toHaveClass('text-lg', 'font-semibold')

      // Check buttons
      const dontDeleteButton = screen.getByText("Don't Delete")
      const confirmDeleteButton = within(screen.getByTestId('list-delete-confirm')).getByRole('button', { name: 'Delete' })

      expect(dontDeleteButton).toBeInTheDocument()
      expect(confirmDeleteButton).toBeInTheDocument()

      // Verify destructive button styling
      expect(confirmDeleteButton).toHaveClass('bg-destructive', 'text-destructive-foreground')
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
      const confirmDeleteButton = within(screen.getByTestId('list-delete-confirm')).getByRole('button', { name: 'Delete' })
      fireEvent.click(confirmDeleteButton!)

      // Modal should be closed
      expect(screen.queryByTestId('list-delete-confirm')).not.toBeInTheDocument()

      // Verify delete was called
      expect(mockOnDelete).toHaveBeenCalledWith(mockList.id)
    })
  })
})
