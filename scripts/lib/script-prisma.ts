/**
 * The one place a repo script builds a PrismaClient (AWTD-1393).
 *
 * Prisma 7 no longer connects by itself: every client takes a driver adapter
 * in its constructor. With this factory that change is made here and in
 * lib/prisma.ts, not in every script. tests/rules/scripts-build-prisma-through-the-factory.test.ts
 * keeps it that way.
 *
 * THE CALLER CHOOSES THE DATABASE. Operational scripts point at production,
 * staging or a throwaway cluster on purpose (scripts/lib/database-target.ts), so
 * this never imports the lib/prisma app singleton and never picks a URL of its
 * own. Omit `url` and the client reads DATABASE_URL when it connects, exactly as
 * a bare `new PrismaClient()` did.
 *
 * The caller owns the lifetime: `await prisma.$disconnect()` when done.
 */
import { PrismaClient, type Prisma } from '@prisma/client'

export interface ScriptPrismaOptions {
  /** Connection string. Undefined means DATABASE_URL from the environment. */
  url?: string
  log?: Prisma.LogLevel[]
}

export function createScriptPrisma({ url, log }: ScriptPrismaOptions = {}): PrismaClient {
  return new PrismaClient({
    ...(url !== undefined ? { datasources: { db: { url } } } : {}),
    ...(log ? { log } : {}),
  })
}
