import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { mockPrisma } from '../setup'

const authOptions = vi.hoisted(() => [] as Array<{ scopes: string[] }>)
vi.mock('@/lib/api-auth-wrapper', () => ({
  withAuth: (options: { scopes: string[] }, handler: (...args: unknown[]) => unknown) => {
    authOptions.push(options)
    return (req: NextRequest) => handler(req, { userId: 'account-owner', source: 'oauth' })
  },
}))

import { GET, PUT } from '@/app/api/v1/users/me/webhook-delivery-policy/route'

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.user.findUnique.mockResolvedValue({ mcpSettings: null })
  mockPrisma.user.updateMany.mockResolvedValue({ count: 1 })
})

const put = (body: unknown) => PUT(new NextRequest('http://localhost/api/v1/users/me/webhook-delivery-policy', {
  method: 'PUT', body: JSON.stringify(body),
}), undefined as never)

describe('AWTD-1561 account delivery policy API', () => {
  it('requires user read for inspection and user write for opt-in', () => {
    expect(authOptions.map(options => options.scopes)).toEqual([['user:read'], ['user:write']])
  })
  it('reports fallback with no stored setting', async () => {
    const response = await GET(new NextRequest('http://localhost/api/v1/users/me/webhook-delivery-policy'), undefined as never)
    expect(await response.json()).toMatchObject({ policy: 'fallback', agents: {} })
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'account-owner' }, select: { mcpSettings: true },
    })
  })

  it('changes only the authenticated account setting and preserves credentials and unknown JSON', async () => {
    const previous = { apiKeys: { claude: { encrypted: 'test-ciphertext' } }, agentModes: { claude: 'webhook' }, extra: 42 }
    mockPrisma.user.findUnique.mockResolvedValue({ mcpSettings: JSON.stringify(previous) })
    expect((await put({ policy: 'strict' })).status).toBe(200)
    expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'account-owner', mcpSettings: JSON.stringify(previous) },
      data: { mcpSettings: JSON.stringify({ ...previous, webhookDeliveryPolicy: 'strict' }) },
    })
  })

  it('sets an independent mailbox override without replacing the account policy', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ mcpSettings: JSON.stringify({
      webhookDeliveryPolicy: 'strict', agentWebhookDeliveryPolicies: { gemini: 'strict' },
    }) })
    const response = await put({ agent: 'claude', policy: 'fallback' })
    expect(await response.json()).toMatchObject({
      policy: 'strict', agents: { claude: 'fallback', gemini: 'strict' },
    })
  })

  it.each([{ policy: 'silent' }, { policy: 'strict', userId: 'someone-else' }, { policy: 'strict', agent: '__proto__' }])(
    'rejects invalid input without writing settings: %j', async body => {
      expect((await put(body)).status).toBe(400)
      expect(mockPrisma.user.updateMany).not.toHaveBeenCalled()
    },
  )

  it('does not overwrite malformed existing settings', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ mcpSettings: '{broken-json' })
    expect((await put({ policy: 'strict' })).status).toBe(500)
    expect(mockPrisma.user.updateMany).not.toHaveBeenCalled()
  })

  it('refuses a concurrent credential/settings edit rather than overwriting it', async () => {
    mockPrisma.user.updateMany.mockResolvedValue({ count: 0 })
    expect((await put({ policy: 'strict' })).status).toBe(409)
  })
})
