/**
 * The driver adapter every Prisma 7 client connects through (AWTD-1408), so the
 * app (lib/prisma.ts) and repo scripts (scripts/lib/script-prisma.ts) pool the
 * same way.
 *
 * Sized as Prisma 6's engine sized itself, so the upgrade does not change how
 * many connections an instance opens: `max` is 2 × CPUs + 1 (node-postgres
 * would default to 10), and waiting for a free connection gives up after 10 s,
 * Prisma 6's pool_timeout (node-postgres would wait forever). Measured on a
 * throwaway Postgres: 17 connections at peak under both.
 */
import { availableParallelism } from 'os'
import { PrismaPg } from '@prisma/adapter-pg'

export const POOL_MAX = availableParallelism() * 2 + 1
export const POOL_WAIT_MS = 10_000

export function createPgAdapter(connectionString: string | undefined): PrismaPg {
  return new PrismaPg({ connectionString, max: POOL_MAX, connectionTimeoutMillis: POOL_WAIT_MS })
}
