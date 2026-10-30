/**
 * AWTD-1423: prisma.config.ts gives the CLI the DIRECT connection.
 *
 * `migrate deploy` takes an advisory lock, which a pooler cannot hold, so the
 * CLI must reach Postgres directly whenever DATABASE_URL_DIRECT is set. Prisma
 * 7 has one URL in the config where the schema used to carry `directUrl` too;
 * picking DATABASE_URL first would point migrations at the pooler.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

async function configuredUrl(env: { direct: string; pooled: string }): Promise<string | undefined> {
  // '' rather than unset: dotenv never overrides a variable that exists, so
  // the developer's own .env cannot leak into the case under test.
  vi.stubEnv('DATABASE_URL_DIRECT', env.direct)
  vi.stubEnv('DATABASE_URL', env.pooled)
  vi.resetModules()
  const config = (await import('@/prisma.config')).default
  return config.datasource?.url
}

describe('prisma.config.ts datasource (AWTD-1423)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('uses DATABASE_URL_DIRECT over DATABASE_URL', async () => {
    await expect(
      configuredUrl({ direct: 'postgresql://direct/db', pooled: 'postgresql://pooler/db' })
    ).resolves.toBe('postgresql://direct/db')
  })

  it('falls back to DATABASE_URL where only one URL is set', async () => {
    await expect(configuredUrl({ direct: '', pooled: 'postgresql://only/db' })).resolves.toBe(
      'postgresql://only/db'
    )
  })
})
