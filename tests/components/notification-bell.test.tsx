import React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NotificationBell } from "@/components/notification-bell"

const notificationResponse = {
  notifications: [
    {
      id: "n1",
      kind: "assigned",
      readAt: null,
      createdAt: "2026-08-21T23:00:00.000Z",
      task: {
        id: "task-1",
        identifier: "AST-1",
        title: "Ship the thing",
        completed: false,
      },
    },
  ],
  unreadCount: 1,
}

describe('NotificationBell', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads unread notifications and marks them read', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'PUT') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ updated: 1 }),
        } as Response
      }

      expect(url).toContain('/api/v1/notifications')
      return {
        ok: true,
        status: 200,
        json: async () => notificationResponse,
      } as Response
    })

    const user = userEvent.setup()
    render(<NotificationBell />)

    await waitFor(() => expect(screen.getByTitle('Notifications')).toHaveTextContent('1'))

    await user.click(screen.getByTitle('Notifications'))
    expect(await screen.findByText(/Ship the thing/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /mark all read/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/notifications',
      expect.objectContaining({ method: 'PUT' })
    ))
  })
})
