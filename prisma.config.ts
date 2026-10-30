/**
 * Prisma CLI configuration (AWTD-1408). Prisma 7 moved connection URLs out of
 * schema.prisma and stopped loading env files by itself.
 *
 * The CLI connects only for migrate, db and introspection commands, and those
 * need the DIRECT connection: `migrate deploy` takes an advisory lock, which
 * a pooler cannot hold. The schema used to say so with `directUrl`; Prisma 7
 * has one URL here, so it is the direct one, falling back to DATABASE_URL where
 * only one is set (local dev, CI's throwaway Postgres).
 *
 * process.env rather than Prisma's env(): env() throws on a missing variable,
 * and `prisma generate` runs in builds that have no database at all.
 */
import 'dotenv/config'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url: process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL,
  },
})
