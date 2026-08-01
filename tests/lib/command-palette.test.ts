/**
 * Regression tests for task 8fad4561 — the command palette.
 *
 * The load-bearing requirement is the anti-drift one: palette entries are
 * GENERATED from KEYBOARD_SHORTCUTS, so adding a shortcut adds it to the
 * palette with no second edit. A test fails if someone breaks that link.
 */

import { describe, it, expect } from 'vitest'
import {
  buildActionCommands,
  filterCommands,
  scoreCommand,
  moveSelection,
  actionRequiresTask,
  registeredActionIds,
  type Command,
} from '@/lib/command-palette'
import { KEYBOARD_SHORTCUTS } from '@/hooks/useKeyboardShortcuts'

describe('palette entries stay in sync with the shortcut registry (8fad4561)', () => {
  it('covers every registered action exactly once', () => {
    // If this fails, someone added a shortcut and hand-listed palette entries
    // instead of generating them — the drift this design exists to prevent.
    const ids = buildActionCommands(true).map(c => c.id).sort()
    expect(ids).toEqual(registeredActionIds().sort())
  })

  it('collapses aliased keys into one entry', () => {
    // k and ↑ are the same action; two rows differing only in which key they
    // mention would be noise, not discovery.
    const commands = buildActionCommands(true)
    const previous = commands.filter(c => c.action === 'onSelectPreviousTask')
    expect(previous).toHaveLength(1)
    expect(previous[0].shortcut).toBe('k')
  })

  it('carries a key through for every action, so the palette teaches the binding', () => {
    const commands = buildActionCommands(true)
    for (const shortcut of KEYBOARD_SHORTCUTS) {
      const match = commands.find(c => c.action === shortcut.action)
      expect(match, `missing entry for ${shortcut.action}`).toBeDefined()
      expect(match!.shortcut, `no key shown for ${shortcut.action}`).toBeTruthy()
    }
  })

  it('preserves the numeric argument on priority actions', () => {
    const priorityCommands = buildActionCommands(true).filter(c => c.action === 'onSetPriority')
    expect(priorityCommands.length).toBeGreaterThan(0)
    expect(priorityCommands.map(c => c.param).sort()).toEqual([0, 1, 2, 3])
  })

  it('gives every entry a distinct id', () => {
    const ids = buildActionCommands(true).map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('selection requirements (8fad4561)', () => {
  it('lets "new task" and the help menu run with nothing selected', () => {
    expect(actionRequiresTask('onNewTask')).toBe(false)
    expect(actionRequiresTask('onShowHotkeyMenu')).toBe(false)
  })

  it('requires a selection for actions that operate on one', () => {
    expect(actionRequiresTask('onCompleteTask')).toBe(true)
    expect(actionRequiresTask('onSetPriority')).toBe(true)
  })

  it('disables — but does not hide — entries needing a selection', () => {
    // Hiding them would make the palette teach a different set of shortcuts
    // depending on state, defeating the point of it being how people learn them.
    const commands = buildActionCommands(false)
    const complete = commands.find(c => c.action === 'onCompleteTask')!
    expect(complete.disabledReason).toBe('Select a task first')

    const newTask = commands.find(c => c.action === 'onNewTask')!
    expect(newTask.disabledReason).toBeUndefined()
  })
})

describe('scoreCommand (8fad4561)', () => {
  const command = (title: string): Command => ({ id: title, title, kind: 'action' })

  it('ranks prefix above word-boundary above substring', () => {
    expect(scoreCommand(command('Complete selected task'), 'comp')).toBe(3)
    expect(scoreCommand(command('Mark complete'), 'comp')).toBe(2)
    expect(scoreCommand(command('Incomplete items'), 'comp')).toBe(1)
  })

  it('returns -1 when there is no match', () => {
    expect(scoreCommand(command('New task'), 'zzz')).toBe(-1)
  })

  it('matches everything on an empty query', () => {
    expect(scoreCommand(command('Anything'), '')).toBe(0)
    expect(scoreCommand(command('Anything'), '   ')).toBe(0)
  })

  it('is case-insensitive', () => {
    expect(scoreCommand(command('New task'), 'NEW')).toBe(3)
  })

  it('does not blow up on regex metacharacters in the query', () => {
    // Users type punctuation. An unescaped needle would throw here.
    expect(() => scoreCommand(command('New task'), 'a(b')).not.toThrow()
    expect(scoreCommand(command('New task'), 'a(b')).toBe(-1)
  })
})

describe('filterCommands (8fad4561)', () => {
  const commands: Command[] = [
    { id: '1', title: 'Complete selected task', kind: 'action' },
    { id: '2', title: 'Mark complete', kind: 'action' },
    { id: '3', title: 'New task', kind: 'action' },
    { id: '4', title: 'Copy task', kind: 'action', disabledReason: 'Select a task first' },
  ]

  it('drops non-matches and orders by score', () => {
    const filtered = filterCommands(commands, 'comp')
    expect(filtered.map(c => c.id)).toEqual(['1', '2'])
  })

  it('sorts disabled entries after enabled ones at the same score', () => {
    const filtered = filterCommands(
      [
        { id: 'disabled', title: 'Task thing', kind: 'action', disabledReason: 'nope' },
        { id: 'enabled', title: 'Task other', kind: 'action' },
      ],
      'task'
    )
    expect(filtered[0].id).toBe('enabled')
  })

  it('returns everything for an empty query', () => {
    expect(filterCommands(commands, '')).toHaveLength(commands.length)
  })
})

describe('moveSelection (8fad4561)', () => {
  it('wraps at both ends — what makes it feel keyboard-native', () => {
    expect(moveSelection(0, -1, 3)).toBe(2)
    expect(moveSelection(2, 1, 3)).toBe(0)
  })

  it('moves normally in the middle', () => {
    expect(moveSelection(0, 1, 3)).toBe(1)
    expect(moveSelection(2, -1, 3)).toBe(1)
  })

  it('stays at zero for an empty list', () => {
    expect(moveSelection(0, 1, 0)).toBe(0)
  })
})
