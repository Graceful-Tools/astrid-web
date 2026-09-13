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
  isActive: true,
  pendingEmail: null,
  emailVerificationToken: null,
  emailTokenExpiresAt: null,
  password: null
})

const mockOwnerUser: User = buildUser({
  id: 'owner-123',
  name: 'Owner User',
  email: 'owner@example.com',
  image: null,
  createdAt: new Date(),
  isActive: true,
  pendingEmail: null,
  emailVerificationToken: null,
  emailTokenExpiresAt: null,
  password: null
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

    // All three tabs should be present
    expect(screen.getByRole('tab', { name: /sort & filters/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /membership/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /admin settings/i })).toBeInTheDocument()
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

    // Only two tabs should be present
    expect(screen.getByRole('tab', { name: /sort & filters/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /membership/i })).toBeInTheDocument()
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

    // With admin access, should use 3-column grid
    let tabsList = screen.getByRole('tablist')
    expect(tabsList).toHaveClass('grid-cols-3')

    rerender(
      <ListSettingsPopover
        {...defaultProps}
        canEditSettings={false}
      />
    )

    // Without admin access, should use 2-column grid
    tabsList = screen.getByRole('tablist')
    expect(tabsList).toHaveClass('grid-cols-2')
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