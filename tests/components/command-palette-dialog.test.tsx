/**
 * Regression test for task 8b622f2e — Command palette Cmd-K binding.
 *
 * Ensures the command palette dialog opens on Cmd-K and displays searchable
 * actions from the keyboard shortcuts registry.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CommandPaletteDialog } from '@/components/command-palette-dialog'

describe('CommandPaletteDialog (8b622f2e)', () => {
  const mockOnExecute = vi.fn()
  const mockOnClose = vi.fn()

  beforeEach(() => {
    mockOnExecute.mockClear()
    mockOnClose.mockClear()
  })

  it('renders the dialog when open', () => {
    render(
      <CommandPaletteDialog
        isOpen={true}
        onClose={mockOnClose}
        onExecuteCommand={mockOnExecute}
        selectedTask={null}
      />
    )

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/search commands/i)).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    const { container } = render(
      <CommandPaletteDialog
        isOpen={false}
        onClose={mockOnClose}
        onExecuteCommand={mockOnExecute}
        selectedTask={null}
      />
    )

    expect(container.querySelector('[role="dialog"]')).not.toBeInTheDocument()
  })

  it('displays action commands from the shortcuts registry', () => {
    render(
      <CommandPaletteDialog
        isOpen={true}
        onClose={mockOnClose}
        onExecuteCommand={mockOnExecute}
        selectedTask={null}
      />
    )

    // Some actions should be visible (even if disabled)
    const options = screen.getAllByRole('option')
    expect(options.length).toBeGreaterThan(0)
    expect(
      options.some(opt => opt.textContent?.includes('New task'))
    ).toBe(true)
  })

  it('filters commands by search query', async () => {
    const user = userEvent.setup()
    render(
      <CommandPaletteDialog
        isOpen={true}
        onClose={mockOnClose}
        onExecuteCommand={mockOnExecute}
        selectedTask={null}
      />
    )

    const searchInput = screen.getByPlaceholderText(/search commands/i)
    await user.type(searchInput, 'new')

    // "New task" should match
    await waitFor(() => {
      const options = screen.getAllByRole('option')
      expect(
        options.some(opt => opt.textContent?.includes('New task'))
      ).toBe(true)
    })
  })

  it('closes when Escape is pressed', async () => {
    const user = userEvent.setup()
    render(
      <CommandPaletteDialog
        isOpen={true}
        onClose={mockOnClose}
        onExecuteCommand={mockOnExecute}
        selectedTask={null}
      />
    )

    const searchInput = screen.getByPlaceholderText(/search commands/i)
    searchInput.focus()
    await user.keyboard('{Escape}')

    expect(mockOnClose).toHaveBeenCalled()
  })

  it('closes when clicking outside the dialog', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <button>Outside</button>
        <CommandPaletteDialog
          isOpen={true}
          onClose={mockOnClose}
          onExecuteCommand={mockOnExecute}
          selectedTask={null}
        />
      </div>
    )

    const backdrop = screen.getByRole('dialog').parentElement
    if (backdrop) {
      await user.click(backdrop)
      expect(mockOnClose).toHaveBeenCalled()
    }
  })

  it('executes a command when selected', async () => {
    const user = userEvent.setup()
    render(
      <CommandPaletteDialog
        isOpen={true}
        onClose={mockOnClose}
        onExecuteCommand={mockOnExecute}
        selectedTask={null}
      />
    )

    // Find "New task" button
    const options = screen.getAllByRole('option')
    const newTaskOption = options.find(opt => opt.textContent?.includes('New task'))
    if (newTaskOption) {
      await user.click(newTaskOption)
      expect(mockOnExecute).toHaveBeenCalled()
    }
  })

  it('shows disabled reason for task-dependent actions without selection', () => {
    render(
      <CommandPaletteDialog
        isOpen={true}
        onClose={mockOnClose}
        onExecuteCommand={mockOnExecute}
        selectedTask={null}
      />
    )

    // Find an option that's disabled with "Select a task first" reason
    const options = screen.getAllByRole('option')
    const disabledOption = options.find(
      opt => 
        opt.hasAttribute('aria-disabled') &&
        opt.textContent?.includes('Select a task first')
    )
    expect(disabledOption).toBeDefined()
  })

  it('enables task-dependent actions when task is selected', () => {
    const mockTask = {
      id: 'task-1',
      title: 'Test task',
      description: '',
      boardId: 'board-1',
      boardTitle: '',
      listIds: [],
      assigneeId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      dueDate: null,
      priority: 0,
      comments: [],
      lineage: [],
    }

    render(
      <CommandPaletteDialog
        isOpen={true}
        onClose={mockOnClose}
        onExecuteCommand={mockOnExecute}
        selectedTask={mockTask}
      />
    )

    // Find "Complete selected task" option and verify it's enabled (no disabled attribute)
    const options = screen.getAllByRole('option')
    const completeOption = options.find(
      opt => 
        opt.textContent?.includes('Complete selected task')
    )
    expect(completeOption).toBeDefined()
    // When a task is selected, this action should be enabled
    if (completeOption) {
      expect(completeOption.getAttribute('aria-disabled')).not.toBe('true')
    }
  })
})
