/**
 * AWTD-1408: Prisma 7 pools through node-postgres. The adapter is sized as
 * Prisma 6's engine sized itself, so the upgrade does not change how many
 * connections an instance opens or how long a query waits for one.
 */
import { describe, it, expect } from 'vitest'
import { availableParallelism } from 'os'
import { createPgAdapter, POOL_MAX, POOL_WAIT_MS } from '@/lib/prisma-adapter'

describe('createPgAdapter (AWTD-1408)', () => {
  it("matches Prisma 6's pool: 2 × CPUs + 1 connections, 10 s to get one", () => {
    expect(POOL_MAX).toBe(availableParallelism() * 2 + 1)
    expect(POOL_WAIT_MS).toBe(10_000)
  })

  it('passes the URL, size and wait through to node-postgres', () => {
    const adapter = createPgAdapter('postgresql://u@h/db') as unknown as { config: Record<string, unknown> }
    expect(adapter.config).toMatchObject({
      connectionString: 'postgresql://u@h/db',
      max: POOL_MAX,
      connectionTimeoutMillis: POOL_WAIT_MS,
    })
  })
})
