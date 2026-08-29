import { describe, it, expect, beforeEach, vi, Mock } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { useParams, useRouter } from 'next/navigation'
import { useSession, signIn } from 'next-auth/react'
import InvitePage from '@/app/[locale]/invite/[token]/page'

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useParams: vi.fn(),
  useRouter: vi.fn(),
}))

// Mock next-auth/react
vi.mock('next-auth/react', () => ({
  useSession: vi.fn(),
  signIn: vi.fn(),
}))

// Mock fetch
global.fetch = vi.fn()

// Mock LoadingScreen component
vi.mock('@/components/loading-screen', () => ({
  LoadingScreen: () => <div data-testid="loading-screen">Loading...</div>,
}))

const mockPush = vi.fn()
const mockRouter = { push: mockPush }

const mockSession = {
  user: {
    id: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
  },
}

const mockInvitation = {
  id: 'invitation-123',
  email: 'test@example.com',
  type: 'LIST_SHARING',
  sender: {
    name: 'John Doe',
    email: 'john@example.com',
  },
  message: 'Join my awesome task list!',
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
}

describe('InvitePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(useParams as Mock).mockReturnValue({ token: 'test-token-123' })
    ;(useRouter as Mock).mockReturnValue(mockRouter)
    ;(useSession as Mock).mockReturnValue({
      data: null,
      status: 'unauthenticated',
    })
    ;(global.fetch as Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ invitation: mockInvitation }),
    })

    // Mock window.location.href
    Object.defineProperty(window, 'location', {
      value: {
        href: 'http://localhost:3000/invite/test-token-123'
      },
      writable: true
    })
  })

  describe('Loading States', () => {
    it('shows loading screen while session is loading', () => {
      ;(useSession as Mock).mockReturnValue({
        data: null,
        status: 'loading',
      })

      render(<InvitePage />)
      expect(screen.getByTestId('loading-screen')).toBeInTheDocument()
    })

    it('shows loading screen while fetching invitation', async () => {
      ;(useSession as Mock).mockReturnValue({
        data: null,
        status: 'unauthenticated',
      })

      // Delay the fetch response
      ;(global.fetch as Mock).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({
          ok: true,
          json: async () => ({ invitation: mockInvitation }),
        }), 100))
      )

      render(<InvitePage />)
      expect(screen.getByTestId('loading-screen')).toBeInTheDocument()
    })
  })

  describe('Error Handling - Invitation Not Found', () => {
    it('redirects to signin when not logged in and invitation not found', async () => {
      ;(useSession as Mock).mockReturnValue({
        data: null,
        status: 'unauthenticated',
      })
      ;(global.fetch as Mock).mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Invitation not found' }),
      })

      render(<InvitePage />)

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/auth/signin')
      })
    })

    it('redirects to home when logged in and invitation not found', async () => {
      ;(useSession as Mock).mockReturnValue({
        data: mockSession,
        status: 'authenticated',
      })
      ;(global.fetch as Mock).mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Invitation not found' }),
      })

      render(<InvitePage />)

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/')
      })
    })

    it('shows error UI for other errors', async () => {
      ;(useSession as Mock).mockReturnValue({
        data: null,
        status: 'unauthenticated',
      })
      ;(global.fetch as Mock).mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Invitation expired' }),
      })

      render(<InvitePage />)

      await waitFor(() => {
        expect(screen.getByText('Invitation Error')).toBeInTheDocument()
        expect(screen.getByText('Invitation expired')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument()
      })
    })

    it('shows error UI when fetch fails', async () => {
      ;(useSession as Mock).mockReturnValue({
        data: null,
        status: 'unauthenticated',
      })
      ;(global.fetch as Mock).mockRejectedValue(new Error('Network error'))

      render(<InvitePage />)

      await waitFor(() => {
        expect(screen.getByText('Invitation Error')).toBeInTheDocument()
        expect(screen.getByText('Failed to load invitation')).toBeInTheDocument()
      })
    })
  })

  describe('Valid Invitation Display', () => {
    beforeEach(() => {
      ;(useSession as Mock).mockReturnValue({
        data: null,
        status: 'unauthenticated',
      })
      ;(global.fetch as Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ invitation: mockInvitation }),
      })
    })

    it('displays invitation details correctly', async () => {
      render(<InvitePage />)

      await waitFor(() => {
        expect(screen.getByText('List Sharing')).toBeInTheDocument()
        expect(screen.getByText('John Doe has shared a task list with you.')).toBeInTheDocument()
        expect(screen.getByText('John Doe')).toBeInTheDocument()
        expect(screen.getByText('john@example.com')).toBeInTheDocument()
        expect(screen.getByText('"Join my awesome task list!"')).toBeInTheDocument()
      })
    })

    it('shows sign in button for unauthenticated users', async () => {
      render(<InvitePage />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Sign In to Accept' })).toBeInTheDocument()
        expect(screen.getByText("You'll be redirected to sign in with test@example.com")).toBeInTheDocument()
      })
    })

    it('shows accept button for authenticated users with matching email', async () => {
      ;(useSession as Mock).mockReturnValue({
        data: mockSession,
        status: 'authenticated',
      })

      render(<InvitePage />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Accept Invitation' })).toBeInTheDocument()
      })
    })

    it('shows email mismatch warning for authenticated users with different email', async () => {
      ;(useSession as Mock).mockReturnValue({
        data: {
          ...mockSession,
          user: { ...mockSession.user, email: 'different@example.com' },
        },
        status: 'authenticated',
      })

      render(<InvitePage />)

      await waitFor(() => {
        expect(screen.getByText(/This invitation was sent to test@example.com, but you're signed in as different@example.com/)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Sign In with Correct Account' })).toBeInTheDocument()
      })
    })

    it('shows expired state for expired invitations', async () => {
      const expiredInvitation = {
        ...mockInvitation,
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
      }

      ;(global.fetch as Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ invitation: expiredInvitation }),
      })

      render(<InvitePage />)

      await waitFor(() => {
        expect(screen.getByText('Expired')).toBeInTheDocument()
        expect(screen.getByText('This invitation has expired.')).toBeInTheDocument()
      })
    })

    it('hides the decline button from unauthenticated users', async () => {
      render(<InvitePage />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Sign In to Accept' })).toBeInTheDocument()
      })
      expect(screen.queryByRole('button', { name: 'Decline' })).not.toBeInTheDocument()
    })
  })

  describe('User Actions', () => {
    beforeEach(() => {
      ;(global.fetch as Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ invitation: mockInvitation }),
      })
    })

    it('redirects to signin when unauthenticated user clicks accept', async () => {
      ;(useSession as Mock).mockReturnValue({
        data: null,
        status: 'unauthenticated',
      })

      render(<InvitePage />)

      await waitFor(() => {
        const acceptButton = screen.getByRole('button', { name: 'Sign In to Accept' })
        fireEvent.click(acceptButton)
      })

      expect(mockPush).toHaveBeenCalledWith('/auth/signin?email=test%40example.com&callbackUrl=' + encodeURIComponent('http://localhost:3000/invite/test-token-123'))
    })

    it('accepts invitation when authenticated user with matching email clicks accept', async () => {
      ;(useSession as Mock).mockReturnValue({
        data: mockSession,
        status: 'authenticated',
      })

      const acceptMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      })
      ;(global.fetch as Mock)
        .mockResolvedValueOnce({ // First call for fetching invitation
          ok: true,
          json: async () => ({ invitation: mockInvitation }),
        })
        .mockImplementation(acceptMock) // Subsequent calls for accepting

      render(<InvitePage />)

      await waitFor(() => {
        const acceptButton = screen.getByRole('button', { name: 'Accept Invitation' })
        fireEvent.click(acceptButton)
      })

      await waitFor(() => {
        expect(acceptMock).toHaveBeenCalledWith('/api/invitations/test-token-123', {
          method: 'POST'
        })
      })
    })

    it('shows success state after accepting invitation', async () => {
      ;(useSession as Mock).mockReturnValue({
        data: mockSession,
        status: 'authenticated',
      })

      ;(global.fetch as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ invitation: mockInvitation }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        })

      render(<InvitePage />)

      await waitFor(() => {
        const acceptButton = screen.getByRole('button', { name: 'Accept Invitation' })
        fireEvent.click(acceptButton)
      })

      await waitFor(() => {
        expect(screen.getByText('Invitation Accepted!')).toBeInTheDocument()
        expect(screen.getByText("You've successfully joined the collaboration. Redirecting to the app...")).toBeInTheDocument()
      })

      // Should redirect after 2 seconds
      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/')
      }, { timeout: 3000 })
    })

    it('signs in with different account when email mismatch', async () => {
      ;(useSession as Mock).mockReturnValue({
        data: {
          ...mockSession,
          user: { ...mockSession.user, email: 'different@example.com' },
        },
        status: 'authenticated',
      })

      // Mock window.location.href
      Object.defineProperty(window, 'location', {
        value: { href: 'http://localhost:3000/invite/test-token-123' },
        writable: true,
      })

      render(<InvitePage />)

      await waitFor(() => {
        const signInButton = screen.getByRole('button', { name: 'Sign In with Correct Account' })
        fireEvent.click(signInButton)
      })

      expect(signIn).toHaveBeenCalledWith(undefined, {
        callbackUrl: 'http://localhost:3000/invite/test-token-123',
        email: 'test@example.com'
      })
    })

    it('declines invitation when decline button is clicked', async () => {
      ;(useSession as Mock).mockReturnValue({
        data: mockSession,
        status: 'authenticated',
      })

      const declineMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      })

      ;(global.fetch as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ invitation: mockInvitation }),
        })
        .mockImplementation(declineMock)

      render(<InvitePage />)

      await waitFor(() => {
        const declineButton = screen.getByRole('button', { name: 'Decline' })
        fireEvent.click(declineButton)
      })

      await waitFor(() => {
        expect(declineMock).toHaveBeenCalledWith('/api/invitations/test-token-123', {
          method: 'DELETE'
        })
      })
    })

    it('shows error when accepting invitation fails', async () => {
      ;(useSession as Mock).mockReturnValue({
        data: mockSession,
        status: 'authenticated',
      })

      ;(global.fetch as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ invitation: mockInvitation }),
        })
        .mockResolvedValueOnce({
          ok: false,
          json: async () => ({ error: 'Failed to accept invitation' }),
        })

      render(<InvitePage />)

      await waitFor(() => {
        const acceptButton = screen.getByRole('button', { name: 'Accept Invitation' })
        fireEvent.click(acceptButton)
      })

      await waitFor(() => {
        expect(screen.getByText('Invitation Error')).toBeInTheDocument()
        expect(screen.getByText('Failed to accept invitation')).toBeInTheDocument()
      })
    })

    it('shows loading state while accepting', async () => {
      let resolveAccept: (value: any) => void
      const acceptPromise = new Promise(resolve => {
        resolveAccept = resolve
      })

      act(() => {
        ;(useSession as Mock).mockReturnValue({
          data: mockSession,
          status: 'authenticated',
        })

        ;(global.fetch as Mock)
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ invitation: mockInvitation }),
          })
          .mockReturnValue(acceptPromise)
      })

      await act(async () => {
        render(<InvitePage />)
      })

      await waitFor(async () => {
        const acceptButton = screen.getByRole('button', { name: 'Accept Invitation' })
        await act(async () => {
          fireEvent.click(acceptButton)
        })
      })

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Accepting...' })).toBeInTheDocument()
      })

      // Resolve the promise
      await act(async () => {
        resolveAccept!({
          ok: true,
          json: async () => ({ success: true }),
        })
      })
    })
  })

  describe('Different Invitation Types', () => {
    it('displays task assignment invitation correctly', async () => {
      const taskInvitation = {
        ...mockInvitation,
        type: 'TASK_ASSIGNMENT',
      }

      ;(global.fetch as Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ invitation: taskInvitation }),
      })

      render(<InvitePage />)

      await waitFor(() => {
        expect(screen.getByText('Task Assignment')).toBeInTheDocument()
        expect(screen.getByText('John Doe has assigned you a task and wants you to collaborate.')).toBeInTheDocument()
      })
    })

    it('displays workspace invitation correctly', async () => {
      const workspaceInvitation = {
        ...mockInvitation,
        type: 'WORKSPACE_INVITE',
      }

      ;(global.fetch as Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ invitation: workspaceInvitation }),
      })

      render(<InvitePage />)

      await waitFor(() => {
        expect(screen.getByText('Workspace Invitation')).toBeInTheDocument()
        expect(screen.getByText('John Doe has invited you to join their workspace.')).toBeInTheDocument()
      })
    })
  })
})