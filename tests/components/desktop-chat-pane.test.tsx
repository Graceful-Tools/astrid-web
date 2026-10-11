/**
 * @vitest-environment jsdom
 *
 * AWTD-1178: the messages pane on the right hides and shows from an icon — the
 * mirror image of the sidebar's on the left (AWTD-1163).
 *
 *   - a "Hide messages" button in the pane's own header collapses it;
 *   - collapsed, it is a slim rail holding only "Show messages", and the chat
 *     itself is unmounted;
 *   - the choice is remembered in this browser, separately from the sidebar's,
 *     and survives storage that throws (private windows);
 *   - beside the board the pane is a fixed-width column, so the board's
 *     columns get the room rather than half the window.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

import { DesktopChatPane } from '@/components/TaskManager/DesktopChatPane'
import { CHAT_PANE_COLLAPSED_KEY, setChatPaneCollapsed } from '@/hooks/task-manager/useChatPaneCollapsed'
import { SIDEBAR_COLLAPSED_KEY } from '@/hooks/task-manager/useSidebarCollapsed'

const renderPane = (props: Partial<React.ComponentProps<typeof DesktopChatPane>> = {}) =>
  render(
    <DesktopChatPane boardMode={false} dimmed={false} onDismissOverlay={vi.fn()} {...props}>
      <div data-testid="chat">chat</div>
    </DesktopChatPane>
  )

beforeEach(() => {
  window.localStorage.clear()
  act(() => setChatPaneCollapsed(false))
})

describe('hideable desktop messages pane (AWTD-1178)', () => {
  it('collapses to a rail with only "Show messages", and expands again', () => {
    renderPane()
    expect(screen.getByTestId('chat')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Hide messages' }))
    expect(screen.queryByTestId('chat')).toBeNull()
    expect(screen.getByTestId('chat-pane-rail')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show messages' }))
    expect(screen.getByTestId('chat')).toBeInTheDocument()
  })

  it('remembers the choice in this browser, apart from the sidebar', () => {
    renderPane()
    fireEvent.click(screen.getByRole('button', { name: 'Hide messages' }))
    expect(window.localStorage.getItem(CHAT_PANE_COLLAPSED_KEY)).toBe('1')
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBeNull()
  })

  it('still works when storage throws (a private window)', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded')
    })
    renderPane()
    fireEvent.click(screen.getByRole('button', { name: 'Hide messages' }))
    expect(screen.getByTestId('chat-pane-rail')).toBeInTheDocument()
    spy.mockRestore()
  })

  it('is a fixed-width column beside the board, and shares the row with the list', () => {
    const { unmount } = renderPane({ boardMode: true })
    expect(screen.getByTestId('chat-pane').className).toContain('flex-none')
    unmount()
    renderPane({ boardMode: false })
    expect(screen.getByTestId('chat-pane').className).toContain('flex-1')
  })

  it('dims under an open task, and a click on the dimmer dismisses it', () => {
    const onDismissOverlay = vi.fn()
    renderPane({ dimmed: true, onDismissOverlay })
    fireEvent.click(screen.getByTestId('chat-pane-dimmer'))
    expect(onDismissOverlay).toHaveBeenCalledTimes(1)
  })
})
