import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

import { getProjectsBetaEnabled, setProjectsBetaEnabled, requireProjectsBeta } from '@/lib/feature-flags'
import { prisma } from '@/lib/prisma'

const mockFindUnique = vi.mocked(prisma.user.findUnique)
const mockUpdate = vi.mocked(prisma.user.update)

beforeEach(() => vi.clearAllMocks())

describe('getProjectsBetaEnabled', () => {
  it('returns true when the flag is set', async () => {
    mockFindUnique.mockResolvedValue({ projectsBetaEnabled: true } as never)
    expect(await getProjectsBetaEnabled('u1')).toBe(true)
  })

  it('returns false when unset or user missing', async () => {
    mockFindUnique.mockResolvedValue({ projectsBetaEnabled: false } as never)
    expect(await getProjectsBetaEnabled('u1')).toBe(false)
    mockFindUnique.mockResolvedValue(null as never)
    expect(await getProjectsBetaEnabled('u1')).toBe(false)
  })

  it('defaults to false when the column is missing (pre-migration preview DB)', async () => {
    // Simulates Prisma throwing because the column does not exist yet.
    mockFindUnique.mockRejectedValue(new Error('column "projectsBetaEnabled" does not exist'))
    expect(await getProjectsBetaEnabled('u1')).toBe(false)
    expect(await requireProjectsBeta('u1')).toBe(false)
  })
})

describe('setProjectsBetaEnabled', () => {
  it('persists and echoes the value', async () => {
    mockUpdate.mockResolvedValue({} as never)
    expect(await setProjectsBetaEnabled('u1', true)).toBe(true)
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' }, data: { projectsBetaEnabled: true } })
    )
  })

  it('rethrows on write failure (caller decides fallback)', async () => {
    mockUpdate.mockRejectedValue(new Error('db down'))
    await expect(setProjectsBetaEnabled('u1', true)).rejects.toThrow('db down')
  })
})
