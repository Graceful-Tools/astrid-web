/**
 * The agent picker must not depend on someone having run the seed script
 * (AWTD-992): every offerable agent identity gets its User row on demand.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() } },
}))

import { prisma } from '@/lib/prisma'
import { ensureOfferedAgentUsers } from '@/lib/ai/ensure-agent-user'
import { agentEmail } from '@/lib/brand/agent-emails'

const mockPrisma = vi.mocked(prisma, true)
const CLAUDE = agentEmail('claude')
const MUSE = agentEmail('muse')

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.user.findFirst.mockResolvedValue(null as never)
  mockPrisma.user.create.mockImplementation(async ({ data }: any) => ({ id: `id-${data.email}`, ...data }) as never)
})

describe('ensureOfferedAgentUsers (AWTD-992)', () => {
  it('creates only the offered agents that have no User row yet', async () => {
    mockPrisma.user.findMany.mockResolvedValue([{ email: CLAUDE }] as never)

    await ensureOfferedAgentUsers([CLAUDE, MUSE])

    expect(mockPrisma.user.create).toHaveBeenCalledTimes(1)
    expect(mockPrisma.user.create.mock.calls[0][0]).toMatchObject({
      data: { email: MUSE, isAIAgent: true, isActive: true },
    })
  })

  it('costs one query and creates nothing when every row exists', async () => {
    mockPrisma.user.findMany.mockResolvedValue([{ email: CLAUDE }, { email: MUSE }] as never)

    await ensureOfferedAgentUsers([CLAUDE, MUSE])

    expect(mockPrisma.user.findMany).toHaveBeenCalledTimes(1)
    expect(mockPrisma.user.create).not.toHaveBeenCalled()
  })

  it('does nothing at all for an empty offer list', async () => {
    await ensureOfferedAgentUsers([])

    expect(mockPrisma.user.findMany).not.toHaveBeenCalled()
  })
})
