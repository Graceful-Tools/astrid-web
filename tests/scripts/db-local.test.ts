/**
 * npm run db:local must never run Prisma against a non-local database.
 */

import { describe, expect, it } from 'vitest'

import { assertLocalDatabaseUrls } from '../../scripts/db-local'

const LOCAL = 'postgresql://me:pw@localhost:5432/astrid_dev'
const NEON = 'postgresql://me:pw@ep-x-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require'

describe('db:local guard', () => {
  it('allows localhost, 127.0.0.1 and ::1', () => {
    expect(() => assertLocalDatabaseUrls({ DATABASE_URL: LOCAL })).not.toThrow()
    expect(() => assertLocalDatabaseUrls({ DATABASE_URL: 'postgresql://me@127.0.0.1:5432/x' })).not.toThrow()
    expect(() => assertLocalDatabaseUrls({ DATABASE_URL_DIRECT: 'postgresql://me@[::1]:5432/x' })).not.toThrow()
  })

  it('refuses a remote URL in either key, even when the other is local', () => {
    expect(() => assertLocalDatabaseUrls({ DATABASE_URL: LOCAL, DATABASE_URL_DIRECT: NEON }))
      .toThrow(/DATABASE_URL_DIRECT does not point at localhost/)
    expect(() => assertLocalDatabaseUrls({ DATABASE_URL: NEON }))
      .toThrow(/DATABASE_URL does not point at localhost/)
  })

  it('is not fooled by "localhost" appearing outside the host', () => {
    expect(() => assertLocalDatabaseUrls({ DATABASE_URL: 'postgresql://localhost:pw@db.example.com/localhost' }))
      .toThrow(/does not point at localhost/)
  })

  it('refuses when no database URL is set, or one is malformed', () => {
    expect(() => assertLocalDatabaseUrls({})).toThrow(/neither/)
    expect(() => assertLocalDatabaseUrls({ DATABASE_URL: 'not a url' })).toThrow(/not a valid URL/)
  })

  it('never puts the URL in its error', () => {
    try {
      assertLocalDatabaseUrls({ DATABASE_URL: NEON })
    } catch (error) {
      expect((error as Error).message).not.toContain('neon.tech')
      expect((error as Error).message).not.toContain('pw')
    }
  })
})
