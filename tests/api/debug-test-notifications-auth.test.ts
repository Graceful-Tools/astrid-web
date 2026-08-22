import { describe, it, expect, vi, beforeEach } from 'vitest'

const requireAdmin = vi.hoisted(() => vi.fn())
const sendTestNotification = vi.hoisted(() => vi.fn())
const findUser = vi.hoisted(() => vi.fn())

class AdminAuthError extends Error {}

vi.mock('@/lib/session-utils', () => ({
  getUnifiedSession: vi.fn(async () => ({
    user: { id: 'user-1', email: 'caller@example.com' },
  })),
}))

vi.mock('@/lib/admin-auth', () => ({
  requireAdmin,
  AdminAuthError,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: findUser },
    task: { findMany: vi.fn() },
    pushSubscription: { findMany: vi.fn() },
  },
}))

vi.mock('@/lib/push-notification-service', () => ({
  PushNotificationService: vi.fn(() => ({
    sendTestNotification,
  })),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn() }),
}))

describe('POST /api/debug/test-notifications auth guard (task a5949504)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAdmin.mockRejectedValue(new AdminAuthError('Admin access required'))
    findUser.mockResolvedValue({
      id: 'target-1',
      name: 'Target User',
      email: 'target@example.com',
      defaultDueTime: '09:00',
    })
  })

  it('rejects a non-admin targeting another account and never sends push', async () => {
    const { POST } = await import('@/app/api/debug/test-notifications/route')
    const request = {
      json: async () => ({
        type: 'push_notification',
        targetUserEmail: 'target@example.com',
      }),
    } as Request

    const response = await POST(request as never)
    expect(response.status).toBe(403)
    expect(requireAdmin).toHaveBeenCalledWith('user-1')
    expect(sendTestNotification).not.toHaveBeenCalled()
  })
})
