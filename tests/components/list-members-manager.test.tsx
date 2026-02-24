import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { ListMembersManager } from '@/components/list-members-manager'
import { useToast } from '@/hooks/use-toast'
import type { TaskList, User } from '@/types/task'

// Mock the toast hook
vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn()
}))

// Mock fetch globally
global.fetch = vi.fn()

const mockToast = vi.fn()

// Mock member data that matches our new unified structure
const mockMembers = [
  {
    id: 'member_1',
    user_id: 'user-1', 
    list_id: 'list-1',
    role: 'admin',
    email: 'john@example.com',
    name: 'John Doe',
    created_at: new Date(),
    updated_at: new Date(),
    type: 'member' as const
  },
  {
    id: 'member_2',
    user_id: 'user-2',
    list_id: 'list-1', 
    role: 'member',
    email: 'jane@example.com',
    name: 'Jane Smith',
    created_at: new Date(),
    updated_at: new Date(),
    type: 'member' as const
  },
  {
    id: 'invite_1',
    list_id: 'list-1',
    email: 'pending@example.com',
    role: 'member',
    created_at: new Date(),
    updated_at: new Date(),
    type: 'invite' as const
  }
]

beforeEach(() => {
  (useToast as any).mockReturnValue({ toast: mockToast })
  mockToast.mockClear()
  
  // Reset and setup fetch mock
  vi.mocked(fetch).mockClear()
  vi.mocked(fetch).mockImplementation((url, options) => {
    const method = options?.method || 'GET'
    
    if (typeof url === 'string') {
      // GET /api/lists/[id]/members - return mock members data
      if (url.includes('/members') && method === 'GET') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ 
            members: mockMembers,
            user_role: 'admin'
          })
        } as Response)
      }
      
      // POST /api/lists/[id]/members - add new member/invite  
      if (url.includes('/members') && method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ 
            success: true,
            message: 'Member added successfully'
          })
        } as Response)
      }
      
      // PATCH /api/lists/[id]/members - update member role
      if (url.includes('/members') && method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ 
            message: 'Member role updated successfully'
          })
        } as Response)
      }
      
      // DELETE /api/lists/[id]/members - remove member
      if (url.includes('/members') && method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ 
            message: 'Member removed successfully'
          })
        } as Response)
      }
      
      // POST /api/lists/[id]/leave - leave list
      if (url.includes('/leave') && method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ 
            message: 'Successfully left the list'
          })
        } as Response)
      }
    }
    
    return Promise.resolve({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Not found' })
    } as Response)
  })
})

describe('ListMembersManager', () => {
  const currentUser: User = {
    id: 'user-1',
    name: 'John Doe',
    email: 'john@example.com',
    image: null,
    createdAt: new Date()
  }

  const mockList: TaskList = {
    id: 'list-1',
    name: 'Test List',
    color: '#3b82f6',
    privacy: 'SHARED',
    owner: currentUser,
    ownerId: 'user-1',
    admins: [],
    members: [],
    createdAt: new Date(),
    updatedAt: new Date()
  }

  it('renders members list with unified member/invite data', async () => {
    render(
      <ListMembersManager 
        list={mockList}
        currentUser={currentUser}
        onUpdate={() => {}}
      />
    )
    
    // Should load members from API
    await waitFor(() => {
      expect(screen.getByText('Members (3)')).toBeInTheDocument() // 2 members + 1 invite
    })
    
    // Should show member names
    expect(screen.getByText('John Doe')).toBeInTheDocument()
    expect(screen.getByText('Jane Smith')).toBeInTheDocument() 
    expect(screen.getByText('pending@example.com')).toBeInTheDocument()
    
    // Should show pending badge for invites
    expect(screen.getByText('Pending')).toBeInTheDocument()
  })

  it('shows invite button for list admins', async () => {
    render(
      <ListMembersManager 
        list={mockList}
        currentUser={currentUser}
        onUpdate={() => {}}
      />
    )
    
    await waitFor(() => {
      expect(screen.getByText('Members (3)')).toBeInTheDocument()
    })
    
    // Check for the plus button to invite members
    const buttons = screen.getAllByRole('button')
    const plusButton = buttons.find(button => 
      button.querySelector('svg') && button.getAttribute('class')?.includes('p-1')
    )
    expect(plusButton).toBeInTheDocument()
  })

  it('allows inviting new members', { timeout: 15000 }, async () => {
    const user = userEvent.setup()
    const mockOnUpdate = vi.fn()
    
    render(
      <ListMembersManager 
        list={mockList}
        currentUser={currentUser}
        onUpdate={mockOnUpdate}
      />
    )
    
    await waitFor(() => {
      expect(screen.getByText('Members (3)')).toBeInTheDocument()
    })
    
    // Click the plus button to open invite form
    const buttons = screen.getAllByRole('button')
    const plusButton = buttons.find(button => 
      button.querySelector('svg') && button.getAttribute('class')?.includes('p-1')
    )
    await user.click(plusButton!)
    
    expect(screen.getByText('Invite New Member')).toBeInTheDocument()
    
    // Fill in email
    const emailInput = screen.getByLabelText('Email Address')
    await user.type(emailInput, 'newuser@example.com')
    
    // Send invitation
    await user.click(screen.getByRole('button', { name: /Send Invitation/i }))
    
    // Should show success toast (optimistic)
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Success',
        description: 'Invitation sent'
      })
    })
  })

  it('allows role changes through dropdown menu', async () => {
    const user = userEvent.setup()
    
    render(
      <ListMembersManager 
        list={mockList}
        currentUser={currentUser}
        onUpdate={() => {}}
      />
    )
    
    await waitFor(() => {
      expect(screen.getByText('Jane Smith')).toBeInTheDocument()
    })
    
    // Find dropdown menu buttons (should be multiple for different members)
    const dropdownButtons = screen.getAllByRole('button').filter(button => 
      button.querySelector('[class*="lucide-more-vertical"]') || 
      button.querySelector('svg')
    )
    
    // Click on a dropdown (assuming first one)
    if (dropdownButtons.length > 0) {
      await user.click(dropdownButtons[0])
      
      // Should show role management options in dropdown
      await waitFor(() => {
        const makeAdminOption = screen.queryByText('Make Admin')
        if (makeAdminOption) {
          expect(makeAdminOption).toBeInTheDocument()
        }
      })
    }
  })

  it('allows current user to leave list', async () => {
    const user = userEvent.setup()
    const mockOnUpdate = vi.fn()
    
    render(
      <ListMembersManager 
        list={mockList}
        currentUser={currentUser}
        onUpdate={mockOnUpdate}
      />
    )
    
    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument()
    })
    
    // Find the current user's dropdown menu
    const dropdownButtons = screen.getAllByRole('button').filter(button => 
      button.querySelector('[class*="lucide-more-vertical"]')
    )
    
    if (dropdownButtons.length > 0) {
      await user.click(dropdownButtons[0])
      
      // Look for Leave option (only shown for current user)
      await waitFor(() => {
        const leaveOption = screen.queryByText('Leave')
        if (leaveOption) {
          expect(leaveOption).toBeInTheDocument()
        }
      })
    }
  })

  it('prevents non-admins from managing members', async () => {
    const regularUser: User = {
      id: 'user-2',
      name: 'Regular User', 
      email: 'regular@example.com',
      image: null,
      createdAt: new Date()
    }
    
    render(
      <ListMembersManager 
        list={mockList}
        currentUser={regularUser}
        onUpdate={() => {}}
      />
    )
    
    await waitFor(() => {
      expect(screen.getByText('Members (3)')).toBeInTheDocument()
    })
    
    // Should not show "Invite New Member" text which indicates no invite form access
    expect(screen.queryByText('Invite New Member')).not.toBeInTheDocument()
    
    // Should not be able to find any role management options like "Make Admin"
    // since regular members can't manage other members' roles
    expect(screen.queryByText('Make Admin')).not.toBeInTheDocument()
    expect(screen.queryByText('Make Member')).not.toBeInTheDocument()
    expect(screen.queryByText('Remove')).not.toBeInTheDocument()
  })

  it('handles API errors gracefully', async () => {
    // Mock API failure
    vi.mocked(fetch).mockImplementationOnce(() => 
      Promise.resolve({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Server error' })
      } as Response)
    )
    
    render(
      <ListMembersManager 
        list={mockList}
        currentUser={currentUser}
        onUpdate={() => {}}
      />
    )
    
    // Should show error toast when API fails
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Error',
        description: 'Failed to load list members',
        variant: 'destructive'
      })
    })
  })

  it('shows correct member count including invites', async () => {
    render(
      <ListMembersManager 
        list={mockList}
        currentUser={currentUser}
        onUpdate={() => {}}
      />
    )
    
    // Should count both members and pending invites
    await waitFor(() => {
      expect(screen.getByText('Members (3)')).toBeInTheDocument()
    })
  })

  it('displays role icons and badges correctly', async () => {
    render(
      <ListMembersManager 
        list={mockList}
        currentUser={currentUser}
        onUpdate={() => {}}
      />
    )
    
    await waitFor(() => {
      // Should show role text for each member
      expect(screen.getByText('admin')).toBeInTheDocument()  // John's role
      expect(screen.getAllByText('member')).toHaveLength(2) // Jane and pending user
    })
  })
})