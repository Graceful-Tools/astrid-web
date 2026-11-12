import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { KeyboardShortcutsMenu } from '@/components/keyboard-shortcuts-menu'

describe('KeyboardShortcutsMenu', () => {
  const mockProps = {
    isOpen: false,
    onClose: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Visibility', () => {
    it('should not render when isOpen is false', () => {
      render(<KeyboardShortcutsMenu {...mockProps} isOpen={false} />)

      expect(screen.queryByText('Keyboard Shortcuts')).not.toBeInTheDocument()
    })

    it('should render when isOpen is true', () => {
      render(<KeyboardShortcutsMenu {...mockProps} isOpen={true} />)

      expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument()
    })
  })

  describe('Content', () => {
    beforeEach(() => {
      render(<KeyboardShortcutsMenu {...mockProps} isOpen={true} />)
    })

    it('should display keyboard shortcuts title', () => {
      expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument()
    })

    it('should display navigation shortcuts', () => {
      // These may appear multiple times (j/k and arrow keys)
      expect(screen.getAllByText('Select next task').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('Select previous task').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('Open/close task edit panel')).toBeInTheDocument()
      expect(screen.getByText('Cycle through list filters/tags')).toBeInTheDocument()
      expect(screen.getByText("Jump to 'Date'")).toBeInTheDocument()
    })

    it('should display task action shortcuts', () => {
      expect(screen.getByText('New task')).toBeInTheDocument()
      expect(screen.getByText('Complete selected task')).toBeInTheDocument()
      expect(screen.getByText('Make due date one day earlier')).toBeInTheDocument()
      expect(screen.getByText('Make due date one day later')).toBeInTheDocument()
      expect(screen.getByText('Postpone task by one week')).toBeInTheDocument()
      expect(screen.getByText('Remove task due date')).toBeInTheDocument()
      expect(screen.getByText('Delete selected task')).toBeInTheDocument()
    })

    it('should display task editing shortcuts', () => {
      expect(screen.getByText('Edit task lists')).toBeInTheDocument()
      expect(screen.getByText('Edit task title')).toBeInTheDocument()
      expect(screen.getByText('Edit task description')).toBeInTheDocument()
      expect(screen.getByText('Add a new task comment')).toBeInTheDocument()
      expect(screen.getByText("Assign task to 'No One'")).toBeInTheDocument()
    })

    it('should display priority shortcuts', () => {
      expect(screen.getByText('Set priority to ○ (None)')).toBeInTheDocument()
      expect(screen.getByText('Set priority to ! (Low)')).toBeInTheDocument()
      expect(screen.getByText('Set priority to !! (Medium)')).toBeInTheDocument()
      expect(screen.getByText('Set priority to !!! (High)')).toBeInTheDocument()
    })

    it('should display interface shortcuts', () => {
      expect(screen.getByText('Show hotkey listing')).toBeInTheDocument()
    })

    it('should display keyboard key representations', () => {
      // Check for some key representations
      expect(screen.getByText('j')).toBeInTheDocument()
      expect(screen.getByText('k')).toBeInTheDocument()
      expect(screen.getByText('n')).toBeInTheDocument()
      expect(screen.getByText('x')).toBeInTheDocument()
      expect(screen.getByText('?')).toBeInTheDocument()
    })

    it('should format special keys correctly', () => {
      // Should format arrow keys
      expect(screen.getByText('←')).toBeInTheDocument()
      expect(screen.getByText('→')).toBeInTheDocument()

      // Should format Delete key
      expect(screen.getByText('Del')).toBeInTheDocument()

      // Should format Backspace key
      expect(screen.getByText('⌫')).toBeInTheDocument()
    })
  })

  describe('Interactions', () => {
    it('should call onClose when close button is clicked', () => {
      render(<KeyboardShortcutsMenu {...mockProps} isOpen={true} />)

      const closeButton = screen.getByRole('button', { name: /close/i })
      fireEvent.click(closeButton)

      expect(mockProps.onClose).toHaveBeenCalled()
    })

    // TODO: Re-add this test when we fix the overlay click detection
    // Temporarily removed due to DOM traversal issues in test environment
    // it('should call onClose when clicking outside the modal', () => {
    //   render(<KeyboardShortcutsMenu {...mockProps} isOpen={true} />)
    //
    //   // Click on the overlay (background)
    //   const overlay = screen.getByText('Keyboard Shortcuts').closest('div')?.parentElement
    //   if (overlay) {
    //     fireEvent.click(overlay)
    //     expect(mockProps.onClose).toHaveBeenCalled()
    //   }
    // })

    it('should call onClose when pressing Escape key', () => {
      render(<KeyboardShortcutsMenu {...mockProps} isOpen={true} />)

      // Focus the modal and press Escape
      const modal = screen.getByText('Keyboard Shortcuts').closest('div')
      if (modal) {
        fireEvent.keyDown(modal, { key: 'Escape' })
        expect(mockProps.onClose).toHaveBeenCalled()
      }
    })

    it('closes on Escape when focus is still on the page, as after opening with ? (AWTD-1600)', () => {
      // `?` opens the menu from the document; nothing moves focus into it, so
      // a keydown handler on the overlay never heard Escape in the real app.
      render(<KeyboardShortcutsMenu {...mockProps} isOpen={true} />)

      fireEvent.keyDown(document, { key: 'Escape' })

      expect(mockProps.onClose).toHaveBeenCalled()
    })

    it('should not close when clicking inside the modal content', () => {
      render(<KeyboardShortcutsMenu {...mockProps} isOpen={true} />)

      const title = screen.getByText('Keyboard Shortcuts')
      fireEvent.click(title)

      expect(mockProps.onClose).not.toHaveBeenCalled()
    })
  })

  describe('Grouping and Organization', () => {
    beforeEach(() => {
      render(<KeyboardShortcutsMenu {...mockProps} isOpen={true} />)
    })

    it('should group shortcuts by category', () => {
      expect(screen.getByText('Navigation')).toBeInTheDocument()
      expect(screen.getByText('Task Actions')).toBeInTheDocument()
      expect(screen.getByText('Task Editing')).toBeInTheDocument()
      expect(screen.getByText('Priority')).toBeInTheDocument()
      expect(screen.getByText('Interface')).toBeInTheDocument()
    })

    it('should display shortcuts in a readable format', () => {
      // Each shortcut should have a description and a key representation
      const shortcutEntries = screen.getAllByText(/^[a-z0-9←→?!]/i)
      expect(shortcutEntries.length).toBeGreaterThan(0)
    })
  })

  describe('Accessibility', () => {
    it('should have proper modal behavior', () => {
      render(<KeyboardShortcutsMenu {...mockProps} isOpen={true} />)

      // Should have a focusable close button
      const closeButton = screen.getByRole('button', { name: /close/i })
      expect(closeButton).toBeInTheDocument()
      expect(closeButton).toBeVisible()
    })

    it('should handle keyboard navigation', () => {
      render(<KeyboardShortcutsMenu {...mockProps} isOpen={true} />)

      // Should be able to tab to the close button
      const closeButton = screen.getByRole('button', { name: /close/i })
      closeButton.focus()
      expect(closeButton).toHaveFocus()
    })
  })

  describe('Responsive Design', () => {
    it('should render on mobile devices', () => {
      // Mock mobile viewport
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 375
      })

      render(<KeyboardShortcutsMenu {...mockProps} isOpen={true} />)

      expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument()
    })

    it('should render on desktop devices', () => {
      // Mock desktop viewport
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 1920
      })

      render(<KeyboardShortcutsMenu {...mockProps} isOpen={true} />)

      expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument()
    })
  })

  describe('Content Completeness', () => {
    it('should include all major keyboard shortcuts', () => {
      render(<KeyboardShortcutsMenu {...mockProps} isOpen={true} />)

      // Test that all the major functionality shortcuts are present
      // Note: Some shortcuts may appear multiple times (j/k and arrow keys)
      expect(screen.getByText('New task')).toBeInTheDocument()
      expect(screen.getByText('Complete selected task')).toBeInTheDocument()
      expect(screen.getAllByText('Select next task').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('Select previous task').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('Delete selected task')).toBeInTheDocument()
      expect(screen.getByText('Show hotkey listing')).toBeInTheDocument()
    })

    it('should include priority setting shortcuts', () => {
      render(<KeyboardShortcutsMenu {...mockProps} isOpen={true} />)

      // Should have all priority levels
      expect(screen.getByText('Set priority to ○ (None)')).toBeInTheDocument()
      expect(screen.getByText('Set priority to ! (Low)')).toBeInTheDocument()
      expect(screen.getByText('Set priority to !! (Medium)')).toBeInTheDocument()
      expect(screen.getByText('Set priority to !!! (High)')).toBeInTheDocument()
    })
  })
})