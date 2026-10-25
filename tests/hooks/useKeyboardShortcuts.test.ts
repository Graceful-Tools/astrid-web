import { renderHook, act } from '@testing-library/react'
import { buildTask } from '../fixtures/domain'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useKeyboardShortcuts, type KeyboardShortcutHandlers } from '@/hooks/useKeyboardShortcuts'

describe('useKeyboardShortcuts', () => {
  let mockHandlers: KeyboardShortcutHandlers
  let addEventListenerSpy: ReturnType<typeof vi.spyOn>
  let removeEventListenerSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    mockHandlers = {
      onSelectNextTask: vi.fn(),
      onSelectPreviousTask: vi.fn(),
      onToggleTaskPanel: vi.fn(),
      onCycleListFilters: vi.fn(),
      onJumpToDate: vi.fn(),
      onNewTask: vi.fn(),
      onCompleteTask: vi.fn(),
      onDeleteTask: vi.fn(),
      onPostponeTask: vi.fn(),
      onRemoveDueDate: vi.fn(),
      onSetPriority: vi.fn(),
      onMakeDueDateEarlier: vi.fn(),
      onMakeDueDateLater: vi.fn(),
      onEditTaskLists: vi.fn(),
      onEditTaskTitle: vi.fn(),
      onEditTaskDescription: vi.fn(),
      onAddTaskComment: vi.fn(),
      onAssignToNoOne: vi.fn(),
      onShowHotkeyMenu: vi.fn(),
      // Required by KeyboardShortcutHandlers and never supplied (AWTD-916).
      onOutdentTask: vi.fn(),
      onIndentTask: vi.fn(),
      onShowCommandPalette: vi.fn()
    }

    addEventListenerSpy = vi.spyOn(document, 'addEventListener')
    removeEventListenerSpy = vi.spyOn(document, 'removeEventListener')
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Event Listener Management', () => {
    it('should add keydown event listener when enabled', () => {
      renderHook(() => useKeyboardShortcuts({
        handlers: mockHandlers,
        isEnabled: true
      }))

      expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
    })

    it('should not add event listener when disabled', () => {
      renderHook(() => useKeyboardShortcuts({
        handlers: mockHandlers,
        isEnabled: false
      }))

      expect(addEventListenerSpy).not.toHaveBeenCalled()
    })

    it('should remove event listener on unmount', () => {
      const { unmount } = renderHook(() => useKeyboardShortcuts({
        handlers: mockHandlers,
        isEnabled: true
      }))

      unmount()

      expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
    })
  })

  describe('Keyboard Shortcuts', () => {
    const mockTask = buildTask({ id: 'task-1', title: 'Test Task' })

    const simulateKeypress = (key: string, options: Partial<KeyboardEvent> = {}) => {
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ...options
      })

      Object.defineProperty(event, 'preventDefault', {
        value: vi.fn(),
        writable: true
      })

      document.dispatchEvent(event)
      return event
    }

    beforeEach(() => {
      renderHook(() => useKeyboardShortcuts({
        handlers: mockHandlers,
        selectedTask: mockTask,
        isEnabled: true,
        isInputFocused: false
      }))
    })

    it('should handle navigation shortcuts', () => {
      simulateKeypress('j')
      expect(mockHandlers.onSelectNextTask).toHaveBeenCalled()

      simulateKeypress('k')
      expect(mockHandlers.onSelectPreviousTask).toHaveBeenCalled()

      simulateKeypress('o')
      expect(mockHandlers.onToggleTaskPanel).toHaveBeenCalled()

      simulateKeypress('l')
      expect(mockHandlers.onCycleListFilters).toHaveBeenCalled()

      simulateKeypress('d')
      expect(mockHandlers.onJumpToDate).toHaveBeenCalled()
    })

    it('should handle task action shortcuts', () => {
      simulateKeypress('n')
      expect(mockHandlers.onNewTask).toHaveBeenCalled()

      simulateKeypress('x')
      expect(mockHandlers.onCompleteTask).toHaveBeenCalled()

      simulateKeypress('p')
      expect(mockHandlers.onPostponeTask).toHaveBeenCalled()

      simulateKeypress('v')
      expect(mockHandlers.onRemoveDueDate).toHaveBeenCalled()

      simulateKeypress('Delete')
      expect(mockHandlers.onDeleteTask).toHaveBeenCalled()

      simulateKeypress('Backspace')
      expect(mockHandlers.onDeleteTask).toHaveBeenCalled()
    })

    it('should handle due date shortcuts', () => {
      simulateKeypress('ArrowLeft')
      expect(mockHandlers.onMakeDueDateEarlier).toHaveBeenCalled()

      simulateKeypress('ArrowRight')
      expect(mockHandlers.onMakeDueDateLater).toHaveBeenCalled()
    })

    it('should handle priority shortcuts', () => {
      simulateKeypress('0')
      expect(mockHandlers.onSetPriority).toHaveBeenCalledWith(0)

      simulateKeypress('1')
      expect(mockHandlers.onSetPriority).toHaveBeenCalledWith(1)

      simulateKeypress('2')
      expect(mockHandlers.onSetPriority).toHaveBeenCalledWith(2)

      simulateKeypress('3')
      expect(mockHandlers.onSetPriority).toHaveBeenCalledWith(3)
    })

    it('should handle task editing shortcuts', () => {
      simulateKeypress('i')
      expect(mockHandlers.onEditTaskLists).toHaveBeenCalled()

      simulateKeypress('t')
      expect(mockHandlers.onEditTaskTitle).toHaveBeenCalled()

      simulateKeypress('s')
      expect(mockHandlers.onEditTaskDescription).toHaveBeenCalled()

      simulateKeypress('c')
      expect(mockHandlers.onAddTaskComment).toHaveBeenCalled()

      simulateKeypress('e')
      expect(mockHandlers.onAssignToNoOne).toHaveBeenCalled()
    })

    it('should handle help shortcut', () => {
      act(() => {
        simulateKeypress('?')
      })
      expect(mockHandlers.onShowHotkeyMenu).toHaveBeenCalled()
    })
  })

  describe('Conditional Shortcuts', () => {
    it('should only execute task-dependent shortcuts when task is selected', () => {
      renderHook(() => useKeyboardShortcuts({
        handlers: mockHandlers,
        selectedTask: null, // No task selected
        isEnabled: true,
        isInputFocused: false
      }))

      const simulateKeypress = (key: string) => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key }))
      }

      // These should work without a selected task
      simulateKeypress('n')
      expect(mockHandlers.onNewTask).toHaveBeenCalled()

      simulateKeypress('o')
      expect(mockHandlers.onToggleTaskPanel).toHaveBeenCalled()

      // These should NOT work without a selected task
      simulateKeypress('x')
      expect(mockHandlers.onCompleteTask).not.toHaveBeenCalled()

      simulateKeypress('p')
      expect(mockHandlers.onPostponeTask).not.toHaveBeenCalled()

      simulateKeypress('Delete')
      expect(mockHandlers.onDeleteTask).not.toHaveBeenCalled()
    })
  })

  describe('Input Focus Prevention', () => {
    beforeEach(() => {
      // Mock activeElement
      Object.defineProperty(document, 'activeElement', {
        writable: true,
        configurable: true,
        value: null
      })
    })

    afterEach(() => {
      // Drop the own-property override so later suites see the real focused element.
      delete (document as { activeElement?: Element | null }).activeElement
    })

    it('should not execute shortcuts when input is focused', () => {
      renderHook(() => useKeyboardShortcuts({
        handlers: mockHandlers,
        isEnabled: true,
        isInputFocused: true // Input is focused
      }))

      const simulateKeypress = (key: string) => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key }))
      }

      simulateKeypress('n')
      expect(mockHandlers.onNewTask).not.toHaveBeenCalled()
    })

    it('should not execute shortcuts when typing in input element', () => {
      // Mock an input element being focused
      const mockInput = { tagName: 'INPUT' }
      Object.defineProperty(document, 'activeElement', {
        value: mockInput,
        writable: true,
        configurable: true
      })

      renderHook(() => useKeyboardShortcuts({
        handlers: mockHandlers,
        isEnabled: true,
        isInputFocused: false
      }))

      const simulateKeypress = (key: string) => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key }))
      }

      simulateKeypress('n')
      expect(mockHandlers.onNewTask).not.toHaveBeenCalled()
    })

    it('should not execute shortcuts when typing in textarea', () => {
      const mockTextarea = { tagName: 'TEXTAREA' }
      Object.defineProperty(document, 'activeElement', {
        value: mockTextarea,
        writable: true,
        configurable: true
      })

      renderHook(() => useKeyboardShortcuts({
        handlers: mockHandlers,
        isEnabled: true,
        isInputFocused: false
      }))

      const simulateKeypress = (key: string) => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key }))
      }

      simulateKeypress('n')
      expect(mockHandlers.onNewTask).not.toHaveBeenCalled()
    })
  })

  describe('Modifier Key Prevention', () => {
    const press = (key: string, options: KeyboardEventInit = {}) => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }))
    }

    beforeEach(() => {
      renderHook(() => useKeyboardShortcuts({
        handlers: mockHandlers,
        selectedTask: buildTask({ id: 'task-1', title: 'Test Task' }),
        isEnabled: true,
        isInputFocused: false
      }))
    })

    it.each([
      ['Ctrl', { ctrlKey: true }],
      ['Cmd', { metaKey: true }],
      ['Shift', { shiftKey: true }],
    ])('ignores letter shortcuts held with %s (browser/OS combos pass through)', (_name, modifier) => {
      press('n', modifier)
      press('x', modifier)
      press('d', modifier)

      expect(mockHandlers.onNewTask).not.toHaveBeenCalled()
      expect(mockHandlers.onCompleteTask).not.toHaveBeenCalled()
      expect(mockHandlers.onJumpToDate).not.toHaveBeenCalled()
    })

    it('still fires the same letters without a modifier', () => {
      press('n')
      expect(mockHandlers.onNewTask).toHaveBeenCalledTimes(1)
    })

    it('lets arrow keys through with a modifier held', () => {
      press('ArrowRight', { shiftKey: true })
      press('ArrowLeft', { ctrlKey: true })

      expect(mockHandlers.onMakeDueDateLater).toHaveBeenCalledTimes(1)
      expect(mockHandlers.onMakeDueDateEarlier).toHaveBeenCalledTimes(1)
    })

    // AWTD-1349: "?" is Shift+/ on a US layout, so a real browser always sends it with
    // shiftKey set. Dropping every shifted key made the hotkey menu unreachable.
    it('AWTD-1349: opens the hotkey menu for "?" typed with Shift, as a real browser sends it', () => {
      press('?', { shiftKey: true })

      expect(mockHandlers.onShowHotkeyMenu).toHaveBeenCalledTimes(1)
    })

    it('AWTD-1349: still ignores a shifted letter as a real browser sends it ("N", not "n")', () => {
      press('N', { shiftKey: true })
      press('X', { shiftKey: true })

      expect(mockHandlers.onNewTask).not.toHaveBeenCalled()
      expect(mockHandlers.onCompleteTask).not.toHaveBeenCalled()
    })

    it('AWTD-1349: still ignores Shift+Delete / Shift+Backspace', () => {
      press('Delete', { shiftKey: true })
      press('Backspace', { shiftKey: true })

      expect(mockHandlers.onDeleteTask).not.toHaveBeenCalled()
    })

    it('AWTD-1349: still ignores "?" when Ctrl/Cmd is held too', () => {
      press('?', { shiftKey: true, ctrlKey: true })
      press('?', { shiftKey: true, metaKey: true })

      expect(mockHandlers.onShowHotkeyMenu).not.toHaveBeenCalled()
    })

    it('treats Cmd/Ctrl+K as the command palette, not "select previous task"', () => {
      press('k', { metaKey: true })

      expect(mockHandlers.onShowCommandPalette).toHaveBeenCalledTimes(1)
      expect(mockHandlers.onSelectPreviousTask).not.toHaveBeenCalled()
    })
  })

  describe('Return Values', () => {
    it('should return keyboard shortcuts configuration', () => {
      const { result } = renderHook(() => useKeyboardShortcuts({
        handlers: mockHandlers,
        isEnabled: true
      }))

      expect(result.current.shortcuts).toBeDefined()
      expect(Array.isArray(result.current.shortcuts)).toBe(true)
      expect(result.current.shortcuts.length).toBeGreaterThan(0)
    })

    it('should include all expected shortcuts in configuration', () => {
      const { result } = renderHook(() => useKeyboardShortcuts({
        handlers: mockHandlers,
        isEnabled: true
      }))

      const shortcutKeys = result.current.shortcuts.map(s => s.key)

      expect(shortcutKeys).toContain('n')
      expect(shortcutKeys).toContain('x')
      expect(shortcutKeys).toContain('j')
      expect(shortcutKeys).toContain('k')
      expect(shortcutKeys).toContain('?')
      expect(shortcutKeys).toContain('←')
      expect(shortcutKeys).toContain('→')
      expect(shortcutKeys).toContain('0')
      expect(shortcutKeys).toContain('1')
      expect(shortcutKeys).toContain('2')
      expect(shortcutKeys).toContain('3')
    })
  })

  describe('dialog / modal focus guard', () => {
    const dispatchKey = (key: string) => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    }

    it('does NOT fire shortcuts when focus is on a button inside a [role="dialog"]', () => {
      renderHook(() => useKeyboardShortcuts({ handlers: mockHandlers, isEnabled: true }))

      const dialog = document.createElement('div')
      dialog.setAttribute('role', 'dialog')
      const button = document.createElement('button')
      dialog.appendChild(button)
      document.body.appendChild(dialog)
      button.focus()

      try {
        dispatchKey('d')
        expect(mockHandlers.onJumpToDate).not.toHaveBeenCalled()

        dispatchKey('n')
        expect(mockHandlers.onNewTask).not.toHaveBeenCalled()
      } finally {
        document.body.removeChild(dialog)
      }
    })

    it('does NOT fire shortcuts when focus is on the focused element of a [role="dialog"] (e.g., the email input in a list-members invite form)', () => {
      renderHook(() => useKeyboardShortcuts({ handlers: mockHandlers, isEnabled: true }))

      const dialog = document.createElement('div')
      dialog.setAttribute('role', 'dialog')
      const input = document.createElement('input')
      input.type = 'email'
      dialog.appendChild(input)
      document.body.appendChild(dialog)
      input.focus()

      try {
        dispatchKey('d')
        expect(mockHandlers.onJumpToDate).not.toHaveBeenCalled()
      } finally {
        document.body.removeChild(dialog)
      }
    })
  })
})