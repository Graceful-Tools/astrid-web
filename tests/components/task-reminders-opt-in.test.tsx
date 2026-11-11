/**
 * @vitest-environment jsdom
 */

/**
 * AWTD-1577 — the Reminder row in task details is opt-in.
 *
 * Jon: "Remove reminders from task details on web (and anywhere else) unless a
 * user opts in to it in a appearance setting". The row AWTD-1418 added is the
 * only per-task reminder control on web, and it is mounted by
 * TaskActivitySection. The choice is kept per machine beside the theme and the
 * "Task titles" setting, and is off until someone turns it on.
 *
 * Hiding the row is all this does: a reminder already on a task stays on it and
 * still fires.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'

import AppearanceSettings from '@/components/Settings/AppearanceSettings'
import { TaskActivitySection } from '@/components/task-detail/TaskActivitySection'
import { ThemeProvider, useTheme } from '@/contexts/theme-context'
import { SHOW_TASK_REMINDERS_STORAGE_KEY } from '@/lib/design/task-reminders'
import type { Task } from '@/types/task'

vi.mock('@/lib/i18n/client', () => ({ useTranslations: () => ({ t: (k: string) => k }) }))
vi.mock('@/components/keyboard-shortcuts-menu', () => ({ KeyboardShortcutsMenu: () => null }))
vi.mock('@/components/secure-attachment-viewer', () => ({ SecureAttachmentViewer: () => <div /> }))
vi.mock('@/components/task-timer', () => ({ TaskTimer: () => <div /> }))

function makeTask(overrides: Partial<Task> = {}): Task {
  return { id: 't1', title: 'Test', comments: [], ...overrides } as unknown as Task
}

function renderSection(task: Task = makeTask()) {
  return render(
    <ThemeProvider>
      <TaskActivitySection task={task} showTimer={false} setShowTimer={vi.fn()} onUpdate={vi.fn()} />
    </ThemeProvider>,
  )
}

function Probe() {
  const { showTaskReminders, setShowTaskReminders } = useTheme()
  return (
    <button data-shown={String(showTaskReminders)} onClick={() => setShowTaskReminders(true)}>
      probe
    </button>
  )
}

const LABEL = 'settingsPages.appearancePage.taskReminders.label'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.className = ''
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as never
})

describe('AWTD-1577: the task details Reminder row is opt-in', () => {
  it('AWTD-1577: hides the Reminder row when nothing is stored', () => {
    renderSection()
    expect(screen.queryByTestId('reminder-time')).not.toBeInTheDocument()
  })

  it('AWTD-1577: shows the Reminder row once the device has opted in', () => {
    localStorage.setItem(SHOW_TASK_REMINDERS_STORAGE_KEY, 'true')
    renderSection()
    expect(screen.getByTestId('reminder-time')).toBeInTheDocument()
  })

  it('AWTD-1577: keeps the row hidden for a task that already has a reminder', () => {
    renderSection(makeTask({ reminderTime: new Date(2026, 10, 30, 9, 0) }))
    expect(screen.queryByTestId('reminder-time')).not.toBeInTheDocument()
  })

  it('AWTD-1577: treats any stored value this build does not know as off', () => {
    localStorage.setItem(SHOW_TASK_REMINDERS_STORAGE_KEY, 'yes please')
    renderSection()
    expect(screen.queryByTestId('reminder-time')).not.toBeInTheDocument()
  })
})

describe('AWTD-1577: the setting is kept per machine, off by default', () => {
  it('AWTD-1577: is off when nothing is stored, and does not write on load', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(screen.getByRole('button')).toHaveAttribute('data-shown', 'false')
    expect(localStorage.getItem(SHOW_TASK_REMINDERS_STORAGE_KEY)).toBeNull()
  })

  it('AWTD-1577: reads a stored opt-in and does not overwrite it on load', () => {
    localStorage.setItem(SHOW_TASK_REMINDERS_STORAGE_KEY, 'true')
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(screen.getByRole('button')).toHaveAttribute('data-shown', 'true')
    expect(localStorage.getItem(SHOW_TASK_REMINDERS_STORAGE_KEY)).toBe('true')
  })

  it('AWTD-1577: stores a new choice', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>)
    act(() => screen.getByRole('button').click())
    expect(screen.getByRole('button')).toHaveAttribute('data-shown', 'true')
    expect(localStorage.getItem(SHOW_TASK_REMINDERS_STORAGE_KEY)).toBe('true')
  })
})

describe('AWTD-1577: the Appearance control', () => {
  it('AWTD-1577: renders a switch named by its visible label, off by default', () => {
    render(<ThemeProvider><AppearanceSettings onNavigate={vi.fn()} /></ThemeProvider>)
    expect(screen.getByText(LABEL)).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: LABEL })).toHaveAttribute('aria-checked', 'false')
  })

  it('AWTD-1577: turning it on persists, and turning it off again persists', () => {
    render(<ThemeProvider><AppearanceSettings onNavigate={vi.fn()} /></ThemeProvider>)
    const control = screen.getByRole('switch', { name: LABEL })

    act(() => control.click())
    expect(control).toHaveAttribute('aria-checked', 'true')
    expect(localStorage.getItem(SHOW_TASK_REMINDERS_STORAGE_KEY)).toBe('true')

    act(() => control.click())
    expect(control).toHaveAttribute('aria-checked', 'false')
    expect(localStorage.getItem(SHOW_TASK_REMINDERS_STORAGE_KEY)).toBe('false')
  })

  it('AWTD-1577: shows a stored opt-in as on', () => {
    localStorage.setItem(SHOW_TASK_REMINDERS_STORAGE_KEY, 'true')
    render(<ThemeProvider><AppearanceSettings onNavigate={vi.fn()} /></ThemeProvider>)
    expect(screen.getByRole('switch', { name: LABEL })).toHaveAttribute('aria-checked', 'true')
  })
})

describe('AWTD-1577: the copy exists in every locale', () => {
  const dir = join(process.cwd(), 'lib', 'i18n', 'locales')
  const locales = readdirSync(dir).filter((file) => file.endsWith('.json'))

  it('AWTD-1577: there are twelve locales', () => {
    expect(locales).toHaveLength(12)
  })

  it.each(locales)('AWTD-1577: %s has the four taskReminders strings', (file) => {
    const messages = JSON.parse(readFileSync(join(dir, file), 'utf8'))
    const copy = messages.settingsPages.appearancePage.taskReminders
    for (const key of ['title', 'description', 'label', 'labelDesc']) {
      expect(copy?.[key], `${file} → taskReminders.${key}`).toEqual(expect.any(String))
      expect(copy[key].trim()).not.toBe('')
    }
  })
})
