/**
 * The available-agents list must offer what can WORK, not what the server can
 * bill (task 9dbe0b17).
 *
 * The route gated every built-in agent on hasValidApiKey alone — the world
 * before execution modes. A keyless claude@ set to polling is a fully working
 * agent (the user's own harness runs the queue) and one set to webhook is run
 * by the user's own server, yet neither ever appeared. Conversely an agent
 * turned "off" kept appearing as long as its key survived — and the key
 * surviving is exactly what makes "off" a one-click return.
 *
 * Offered = polling ∪ webhook ∪ (api WITH key) − off.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-auth-wrapper', () => ({
  withAuth: (_opts: unknown, handler: (...args: unknown[]) => unknown) =>
    (req: NextRequest, ctx: unknown) =>
      handler(req, { userId: 'user-1', scopes: ['user:read'], source: 'oauth' }, ctx),
}))

const hasValidApiKey = vi.hoisted(() => vi.fn(async () => false))
vi.mock('@/lib/api-key-cache', () => ({ hasValidApiKey }))

const getAgentExecutionModes = vi.hoisted(() => vi.fn(async () => ({}) as Record<string, string>))
vi.mock('@/lib/ai/agent-execution-mode', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/agent-execution-mode')>(
    '@/lib/ai/agent-execution-mode'
  )
  return { ...actual, getAgentExecutionModes }
})

vi.mock('@/lib/ai/ensure-agent-user', () => ({
  ensureAgentUser: vi.fn(async (email: string) => ({ id: `uid-${email}` })),
}))
vi.mock('@/lib/astrid-agent', () => ({
  ensureAstridAgent: vi.fn(async () => ({ id: 'uid-astrid', image: null })),
  ASTRID_EMAIL: 'astrid@astrid.cc',
  ASTRID_NAME: 'Astrid',
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findMany: vi.fn(async () => []) } },
}))

import { GET } from '@/app/api/v1/users/me/available-agents/route'

const emailsOf = async () => {
  const response = await GET(
    new NextRequest('http://localhost/api/v1/users/me/available-agents'),
    undefined as never
  )
  const body = await response.json()
  return (body.agents as Array<{ email: string }>).map(a => a.email)
}

beforeEach(() => {
  vi.clearAllMocks()
  hasValidApiKey.mockResolvedValue(false)
  getAgentExecutionModes.mockResolvedValue({})
})

describe('available-agents by execution mode (task 9dbe0b17)', () => {
  it('offers a keyless agent whose mode is polling', async () => {
    getAgentExecutionModes.mockResolvedValue({ claude: 'polling' })

    const emails = await emailsOf()
    expect(emails).toContain('claude@astrid.cc')
  })

  it('offers a keyless agent whose mode is webhook', async () => {
    getAgentExecutionModes.mockResolvedValue({ claude: 'webhook' })

    const emails = await emailsOf()
    expect(emails).toContain('claude@astrid.cc')
  })

  it('hides an off agent even when its key is still saved', async () => {
    hasValidApiKey.mockImplementation(async (_userId: string, service: string) => service === 'claude')
    getAgentExecutionModes.mockResolvedValue({ claude: 'off' })

    const emails = await emailsOf()
    expect(emails).not.toContain('claude@astrid.cc')
  })

  it('still requires the key for api mode', async () => {
    getAgentExecutionModes.mockResolvedValue({ claude: 'api' })

    const emails = await emailsOf()
    expect(emails).not.toContain('claude@astrid.cc')
  })

  it('keyed api-mode agents keep appearing, with Astrid first', async () => {
    hasValidApiKey.mockImplementation(async (_userId: string, service: string) => service === 'claude')
    getAgentExecutionModes.mockResolvedValue({ claude: 'api' })

    const emails = await emailsOf()
    expect(emails[0]).toBe('astrid@astrid.cc')
    expect(emails).toContain('claude@astrid.cc')
  })
})
