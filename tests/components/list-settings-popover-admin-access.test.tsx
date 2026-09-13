import { describe, it, expect, vi } from 'vitest'
import { buildUser } from '../fixtures/domain'
import { buildTaskList } from '../fixtures/domain'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ListSettingsPopover } from '@/components/list-settings-popover'
import type { TaskList, User } from '@/types/task'

// Mock the ListAdminSettings component
vi.mock('@/components/list-admin-settings', () => ({
  ListAdminSettings: () => <div data-testid="admin-settings-content">Admin Settings Content</div>
}))

// Mock the other tab components
vi.mock('@/components/list-sort-and-filters', () => ({
  ListSortAndFilters: () => <div data-testid="sort-filters-content">Sort & Filters Content</div>
}))

vi.mock('@/components/list-membership', () => ({
  ListMembership: () => <div data-testid="membership-content">Membership Content</div>
}))

const mockList: TaskList = buildTaskList({
  id: 'test-list-123',
  name: 'Test List',
  description: 'A test list',
  privacy: 'PRIVATE',
  ownerId: 'owner-123',
  createdAt: new Date(),
  updatedAt: new Date(),
  members: [],
  tasks: [],
  isVirtual: false,
  filterCompletion: 'incomplete',
  defaultPriority: 0,
  defaultIsPrivate: true,
  defaultRepeating: 'never',
  defaultDueDate: 'none'
})

const mockUser: User = buildUser({
  id: 'user-123',
  name: 'Test User',
  email: 'test@example.com',
  image: null,
  createdAt: new Date(),
})

const mockOwnerUser: User = buildUser({
  id: 'owner-123',
  name: 'Owner User',
  email: 'owner@example.com',
  image: null,
  createdAt: new Date(),
})

const defaultProps = {
  list: mockList,
  currentUser: mockUser,
  availableUsers: [mockUser, mockOwnerUser],
  onUpdate: vi.fn(),
  onDelete: vi.fn(),
  onLeave: vi.fn(),
  onEditName: vi.fn(),
  onEditImage: vi.fn(),
  open: true,
  onOpenChange: vi.fn(),
  children: <div>Trigger</div>
}

describe('ListSettingsPopover Admin Access Control', () => {
  it('should show Admin Settings tab for users with admin access', () => {
    render(
      <ListSettingsPopover
        {...defaultProps}
        canEditSettings={true}
      />
    )

    // Admin Settings tab should be visible
    expect(screen.getByRole('tab', { name: /admin settings/i })).toBeInTheDocument()

    // Both remaining tabs. Sort & Filters is no longer one of them — it moved
    // to its own control when it became per-user (task aa4e7eb0).
    expect(screen.getByRole('tab', { name: /membership/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /admin settings/i })).toBeInTheDocument()
  })

  it('does not offer Sort & Filters here — it is not the list\u2019s, it is yours', () => {
    // Task aa4e7eb0. Sort and filters became per-user, so they moved out to
    // their own control. Everything left in this modal changes the list for
    // everyone who can see it, which is what makes the modal legible. If this
    // tab ever comes back, the modal is lying about ownership again.
    render(<ListSettingsPopover {...defaultProps} canEditSettings={true} />)

    expect(screen.queryByRole('tab', { name: /sort & filters/i })).not.toBeInTheDocument()
  })

  it('should hide Admin Settings tab for users without admin access', () => {
    render(
      <ListSettingsPopover
        {...defaultProps}
        canEditSettings={false}
      />
    )

    // Admin Settings tab should NOT be visible
    expect(screen.queryByRole('tab', { name: /admin settings/i })).not.toBeInTheDocument()

    // Membership is all that is left for a viewer who cannot edit settings,
    // now that Sort & Filters has its own control (task aa4e7eb0).
    expect(screen.getByRole('tab', { name: /membership/i })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /sort & filters/i })).not.toBeInTheDocument()
  })

  it('should not render AdminSettings component for non-admin users', () => {
    render(
      <ListSettingsPopover
        {...defaultProps}
        canEditSettings={false}
      />
    )

    // AdminSettings content should not be rendered
    expect(screen.queryByTestId('admin-settings-content')).not.toBeInTheDocument()
  })

  it('should render AdminSettings component for admin users', async () => {
    const user = userEvent.setup()

    render(
      <ListSettingsPopover
        {...defaultProps}
        canEditSettings={true}
      />
    )

    // Click on Admin Settings tab
    const adminTab = screen.getByRole('tab', { name: /admin settings/i })
    await user.click(adminTab)

    // AdminSettings content should be rendered
    expect(screen.getByTestId('admin-settings-content')).toBeInTheDocument()
  })

  it('should adjust grid layout based on number of available tabs', () => {
    const { rerender } = render(
      <ListSettingsPopover
        {...defaultProps}
        canEditSettings={true}
      />
    )

    // Membership + Admin Settings. One fewer than before, since Sort &
    // Filters moved out (task aa4e7eb0).
    let tabsList = screen.getByRole('tablist')
    expect(tabsList).toHaveClass('grid-cols-2')

    rerender(
      <ListSettingsPopover
        {...defaultProps}
        canEditSettings={false}
      />
    )

    // Membership alone, rendered full width rather than as a stranded half.
    tabsList = screen.getByRole('tablist')
    expect(tabsList).toHaveClass('grid-cols-1')
  })

  it('should show correct header title based on admin access', () => {
    const { rerender } = render(
      <ListSettingsPopover
        {...defaultProps}
        canEditSettings={true}
      />
    )

    // With admin access, should show "List Settings"
    expect(screen.getByText('List Settings')).toBeInTheDocument()

    rerender(
      <ListSettingsPopover
        {...defaultProps}
        canEditSettings={false}
      />
    )

    // Without admin access, should show "List Details"
    expect(screen.getByText('List Details')).toBeInTheDocument()
  })
})