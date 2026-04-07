import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import AppearanceSettings from '@/components/Settings/AppearanceSettings'

// Mock theme context
vi.mock('@/contexts/theme-context', () => ({
  useTheme: () => ({
    theme: 'light',
    setTheme: vi.fn()
  })
}))

// Mock keyboard shortcuts menu
vi.mock('@/components/keyboard-shortcuts-menu', () => ({
  KeyboardShortcutsMenu: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => (
    <div data-testid="keyboard-shortcuts-modal" style={{ display: isOpen ? 'block' : 'none' }}>
      <div>Keyboard Shortcuts Modal</div>
      <button onClick={onClose} data-testid="close-shortcuts">Close</button>
    </div>
  )
}))

describe('Appearance Settings - Keyboard Shortcuts', () => {
  const mockOnNavigate = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    // Mock fetch for user settings API call
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ smartTaskCreationEnabled: true })
    })
  })

  it('should display keyboard shortcuts section in appearance settings', () => {
    render(<AppearanceSettings onNavigate={mockOnNavigate} />)

    // Check that keyboard shortcuts section is present
    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument()
    expect(screen.getByText('View and learn keyboard shortcuts to navigate faster')).toBeInTheDocument()
  })

  it('should show view shortcuts button', () => {
    render(<AppearanceSettings onNavigate={mockOnNavigate} />)

    // Check for the view shortcuts button
    const viewButton = screen.getByRole('button', { name: /view shortcuts/i })
    expect(viewButton).toBeInTheDocument()
  })

  it('should display quick access tip about ? key', () => {
    render(<AppearanceSettings onNavigate={mockOnNavigate} />)

    // Check for the tip about pressing ? key
    expect(screen.getByText('💡 Quick Access')).toBeInTheDocument()
    // The ? key is now part of the translation text, not a separate kbd element
    expect(screen.getByText(/Press \? anywhere in the task manager to open keyboard shortcuts/)).toBeInTheDocument()
  })

  it('should open keyboard shortcuts modal when view button is clicked', () => {
    render(<AppearanceSettings onNavigate={mockOnNavigate} />)

    // Modal should not be visible initially
    const modal = screen.getByTestId('keyboard-shortcuts-modal')
    expect(modal).toHaveStyle({ display: 'none' })

    // Click the view shortcuts button
    const viewButton = screen.getByRole('button', { name: /view shortcuts/i })
    fireEvent.click(viewButton)

    // Modal should now be visible
    expect(modal).toHaveStyle({ display: 'block' })
    expect(screen.getByText('Keyboard Shortcuts Modal')).toBeInTheDocument()
  })

  it('should close keyboard shortcuts modal when close button is clicked', () => {
    render(<AppearanceSettings onNavigate={mockOnNavigate} />)

    // Open the modal
    const viewButton = screen.getByRole('button', { name: /view shortcuts/i })
    fireEvent.click(viewButton)

    // Verify modal is open
    const modal = screen.getByTestId('keyboard-shortcuts-modal')
    expect(modal).toHaveStyle({ display: 'block' })

    // Close the modal
    const closeButton = screen.getByTestId('close-shortcuts')
    fireEvent.click(closeButton)

    // Modal should be hidden
    expect(modal).toHaveStyle({ display: 'none' })
  })

  it('should have proper accessibility attributes for keyboard shortcuts section', () => {
    render(<AppearanceSettings onNavigate={mockOnNavigate} />)

    // Check for proper heading structure
    const keyboardShortcutsHeading = screen.getByText('Keyboard Shortcuts')
    expect(keyboardShortcutsHeading).toBeInTheDocument()

    // Check for descriptive text
    expect(screen.getByText('View Keyboard Shortcuts')).toBeInTheDocument()
    expect(screen.getByText('See all available keyboard shortcuts for efficient task management')).toBeInTheDocument()
  })

  it('should maintain modal state independently from other settings', () => {
    render(<AppearanceSettings onNavigate={mockOnNavigate} />)

    // Open keyboard shortcuts modal
    const viewButton = screen.getByRole('button', { name: /view shortcuts/i })
    fireEvent.click(viewButton)

    // Modal should be open
    const modal = screen.getByTestId('keyboard-shortcuts-modal')
    expect(modal).toHaveStyle({ display: 'block' })

    // Theme settings should still be accessible
    expect(screen.getByText('Light Mode')).toBeInTheDocument()
    expect(screen.getByText('Dark Mode')).toBeInTheDocument()
  })
})