/**
 * AWTD-1393: createScriptPrisma() must build exactly the client each script
 * built for itself, so moving 80 scripts onto it changes no behaviour.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const constructed: unknown[] = []

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    constructor(options?: unknown) {
      constructed.push(options)
    }
  },
}))

import { createScriptPrisma } from '../../scripts/lib/script-prisma'

describe('createScriptPrisma (AWTD-1393)', () => {
  beforeEach(() => {
    constructed.length = 0
  })

  it('with no options is a bare client that reads DATABASE_URL itself', () => {
    createScriptPrisma()
    expect(constructed).toEqual([{}])
  })

  it('passes an explicit URL as the datasource', () => {
    createScriptPrisma({ url: 'postgresql://example/db' })
    expect(constructed).toEqual([{ datasources: { db: { url: 'postgresql://example/db' } } }])
  })

  it('treats an undefined URL as "use the environment", like the scripts it replaced', () => {
    createScriptPrisma({ url: undefined })
    expect(constructed).toEqual([{}])
  })

  it('passes log levels through', () => {
    createScriptPrisma({ log: ['error'] })
    expect(constructed).toEqual([{ log: ['error'] }])
  })
})
