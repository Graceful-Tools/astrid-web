/**
 * AWTD-1393: createScriptPrisma() must build exactly the client each script
 * built for itself, so moving 80 scripts onto it changes no behaviour.
 *
 * AWTD-1408: Prisma 7 connects through a driver adapter, so the URL now goes
 * to PrismaPg rather than `datasources`. Which URL is unchanged: the caller's,
 * or DATABASE_URL when the caller names none.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const constructed: Array<{ adapter?: { connectionString?: string }; log?: unknown }> = []

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    constructor(options: (typeof constructed)[number]) {
      constructed.push(options)
    }
  },
}))
vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: class {
    connectionString?: string
    constructor(config: { connectionString?: string }) {
      this.connectionString = config.connectionString
    }
  },
}))

import { createScriptPrisma } from '../../scripts/lib/script-prisma'

const saved = process.env.DATABASE_URL

describe('createScriptPrisma (AWTD-1393, AWTD-1408)', () => {
  beforeEach(() => {
    constructed.length = 0
    process.env.DATABASE_URL = 'postgresql://from-env/db'
  })
  afterEach(() => {
    process.env.DATABASE_URL = saved
  })

  it('with no options connects to DATABASE_URL', () => {
    createScriptPrisma()
    expect(constructed).toHaveLength(1)
    expect(constructed[0].adapter?.connectionString).toBe('postgresql://from-env/db')
    expect(constructed[0]).not.toHaveProperty('log')
  })

  it('connects to an explicit URL, not the environment', () => {
    createScriptPrisma({ url: 'postgresql://example/db' })
    expect(constructed[0].adapter?.connectionString).toBe('postgresql://example/db')
  })

  it('treats an undefined URL as "use the environment", like the scripts it replaced', () => {
    createScriptPrisma({ url: undefined })
    expect(constructed[0].adapter?.connectionString).toBe('postgresql://from-env/db')
  })

  it('passes log levels through', () => {
    createScriptPrisma({ log: ['error'] })
    expect(constructed[0].log).toEqual(['error'])
  })

  it('never passes the removed `datasources` option', () => {
    createScriptPrisma({ url: 'postgresql://example/db' })
    expect(constructed[0]).not.toHaveProperty('datasources')
  })
})
