/**
 * ADEV-304: list permissions have no TypeScript rule, so in the browser nothing answers them until
 * astrid-core's browser door has loaded. The app shell (AuthenticatedApp, which every page with
 * permission affordances goes through) keeps its loading skeleton while the door is pending, so no
 * edit, share or delete control is ever drawn from a refusal that only means "not loaded yet".
 * Unavailable (flag off, load failed, no listAccess) draws the app with a notice saying why
 * editing is off.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import React from 'react'

const door = vi.hoisted(() => ({
  state: 'pending' as 'pending' | 'ready' | 'unavailable',
  listeners: new Set<() => void>(),
  load: vi.fn(() => Promise.resolve(null)),
}))

vi.mock('@/lib/core-rules/browser', () => ({
  browserListPermissionsState: () => door.state,
  subscribeBrowserListPermissions: (listener: () => void) => {
    door.listeners.add(listener)
    return () => door.listeners.delete(listener)
  },
  loadBrowserCoreRules: door.load,
  scheduleBrowserCoreRules: () => () => {},
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: () => {}, push: () => {} }) }))
vi.mock('@/lib/offline-db', () => ({ offlineDB: { forceRefresh: () => Promise.resolve() } }))
vi.mock('@/components/TaskManager', () => ({ TaskManager: () => <div data-testid="task-manager" /> }))

import { AuthenticatedApp } from '@/components/authenticated-app'

function settle(next: typeof door.state) {
  act(() => {
    door.state = next
    for (const listener of door.listeners) listener()
  })
}

beforeEach(() => {
  door.state = 'pending'
  door.listeners.clear()
  door.load.mockClear()
})
afterEach(() => door.listeners.clear())

describe('ADEV-304: the app shell waits for the browser permission rules', () => {
  it('starts loading the door at mount and shows no app while it is pending', () => {
    render(<AuthenticatedApp />)
    expect(door.load).toHaveBeenCalled()
    expect(screen.queryByTestId('task-manager')).toBeNull()
  })

  it('draws the app once permissions are ready, with no notice', () => {
    render(<AuthenticatedApp />)
    settle('ready')
    expect(screen.getByTestId('task-manager')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('draws the app read-only with a notice when permissions are unavailable', () => {
    render(<AuthenticatedApp />)
    settle('unavailable')
    expect(screen.getByTestId('task-manager')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toMatch(/permission rules/)
  })
})
