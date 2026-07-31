/**
 * Command palette model (task 8fad4561).
 *
 * `hooks/useKeyboardShortcuts.ts` is already Linear-grade — j/k navigation, n
 * new, x complete, 0–3 priority, p postpone, ←/→ due-date nudge. What was
 * missing is the surface that makes all of it *discoverable*, which is the
 * highest ratio of "feels like Linear" to complexity available.
 *
 * **The palette registers no new behaviour.** Every action entry dispatches an
 * existing shortcut action, and the entries are *generated from*
 * KEYBOARD_SHORTCUTS rather than hand-listed — so adding a shortcut adds it to
 * the palette with no second edit, and the two can never drift.
 */

import { KEYBOARD_SHORTCUTS } from '@/hooks/useKeyboardShortcuts'

export type CommandKind = 'action' | 'navigation' | 'task' | 'create'

export interface Command {
  id: string
  title: string
  kind: CommandKind
  /** Displayed on the right — this is how the palette teaches the shortcuts. */
  shortcut?: string
  /** The KEYBOARD_SHORTCUTS action this dispatches, for kind === 'action'. */
  action?: string
  /** Numeric argument (priority actions carry one). */
  param?: number
  /** Set when the entry can't run right now, with the reason. */
  disabledReason?: string
  /** Free-form payload for navigation/task entries (list id, task id). */
  targetId?: string
}

/**
 * Actions that need a selected task. Derived from the action name rather than
 * a hand-maintained list: everything except "new task" and the help menu
 * operates on the current selection.
 */
const TASKLESS_ACTIONS = new Set(['onNewTask', 'onShowHotkeyMenu'])

export function actionRequiresTask(action: string): boolean {
  return !TASKLESS_ACTIONS.has(action)
}

/**
 * Build the action entries from the shortcut registry.
 *
 * Entries that need a selection are returned *disabled with a reason* rather
 * than hidden: hiding them would make the palette teach a different set of
 * shortcuts depending on state, which defeats the point of it being how people
 * learn them.
 */
export function buildActionCommands(hasSelectedTask: boolean): Command[] {
  // Several actions are bound to more than one key (k/↑, j/↓,
  // Delete/Backspace). The palette shows one entry per *action*, labelled with
  // the first binding — two identical rows differing only in which arrow key
  // they mention would be noise, not discovery.
  const byAction = new Map<string, Command>()

  for (const shortcut of KEYBOARD_SHORTCUTS) {
    const param = 'param' in shortcut ? (shortcut.param as number) : undefined
    const id = `action:${shortcut.action}:${param ?? ''}`
    if (byAction.has(id)) continue

    const requiresTask = actionRequiresTask(shortcut.action)
    byAction.set(id, {
      id,
      title: shortcut.description,
      kind: 'action',
      shortcut: shortcut.key,
      action: shortcut.action,
      ...(param !== undefined ? { param } : {}),
      ...(requiresTask && !hasSelectedTask
        ? { disabledReason: 'Select a task first' }
        : {}),
    })
  }

  return Array.from(byAction.values())
}

/** Distinct action+param combinations in the registry — what the palette covers. */
export function registeredActionIds(): string[] {
  return Array.from(
    new Set(
      KEYBOARD_SHORTCUTS.map(
        shortcut => `action:${shortcut.action}:${'param' in shortcut ? shortcut.param : ''}`
      )
    )
  )
}

/**
 * Rank commands against a query.
 *
 * Deliberately simple and predictable rather than fuzzy: a prefix match beats a
 * word-boundary match beats a substring match. Users learn a predictable
 * ranking; they cannot learn a clever one.
 *
 * Returns -1 for no match.
 */
export function scoreCommand(command: Command, query: string): number {
  if (!query) return 0

  const title = command.title.toLowerCase()
  const needle = query.toLowerCase().trim()
  if (!needle) return 0

  if (title.startsWith(needle)) return 3
  // Word-boundary match: "comp" matches "Complete selected task" but also
  // "Mark complete".
  if (new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(title)) return 2
  if (title.includes(needle)) return 1
  return -1
}

/**
 * Filter and order commands for display.
 *
 * Disabled entries sort after enabled ones at the same score — still visible
 * (so the shortcut is still taught) but never the default selection.
 */
export function filterCommands(commands: Command[], query: string): Command[] {
  return commands
    .map(command => ({ command, score: scoreCommand(command, query) }))
    .filter(entry => entry.score >= 0)
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score
      const aDisabled = a.command.disabledReason ? 1 : 0
      const bDisabled = b.command.disabledReason ? 1 : 0
      if (aDisabled !== bDisabled) return aDisabled - bDisabled
      return a.command.title.localeCompare(b.command.title)
    })
    .map(entry => entry.command)
}

/**
 * Move the highlighted index, wrapping at both ends and skipping nothing.
 *
 * Wrapping matters: arrowing past the last entry landing back at the first is
 * what makes a palette feel keyboard-native.
 */
export function moveSelection(current: number, delta: number, total: number): number {
  if (total <= 0) return 0
  return (((current + delta) % total) + total) % total
}
