#!/usr/bin/env npx tsx
/**
 * One-time migration: hash any legacy PLAINTEXT OAuth token rows so a DB leak
 * can't expose usable bearer credentials. Safe to run repeatedly — it only
 * touches rows whose value still looks like a plaintext token (astrid_ prefix);
 * already-hashed rows (64 hex, no prefix) are skipped.
 *
 * The app already dual-reads (hash OR plaintext), so running this is not
 * required for correctness — it just closes the residual exposure window for
 * long-lived refresh tokens. Run against prod after deploy:
 *   DATABASE_URL_PROD=... npx tsx scripts/migrate-hash-oauth-tokens.ts --apply
 */
import crypto from 'crypto'
import { PrismaClient } from '@prisma/client'
import { loadScriptEnv } from './lib/load-env'

loadScriptEnv()

const APPLY = process.argv.includes('--apply')
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL_PROD || process.env.DATABASE_URL } },
})
const hash = (t: string) => crypto.createHash('sha256').update(t).digest('hex')
const isPlaintext = (v: string | null) => !!v && v.startsWith('astrid_')

async function main() {
  const rows = await prisma.oAuthToken.findMany({
    select: { id: true, accessToken: true, refreshToken: true },
  })
  let access = 0, refresh = 0
  for (const r of rows) {
    const data: { accessToken?: string; refreshToken?: string } = {}
    if (isPlaintext(r.accessToken)) { data.accessToken = hash(r.accessToken); access++ }
    if (isPlaintext(r.refreshToken)) { data.refreshToken = hash(r.refreshToken!); refresh++ }
    if (Object.keys(data).length && APPLY) {
      await prisma.oAuthToken.update({ where: { id: r.id }, data })
    }
  }
  console.log(`${APPLY ? 'Hashed' : 'Would hash'}: ${access} access + ${refresh} refresh tokens (of ${rows.length} rows)`)
  if (!APPLY && access + refresh > 0) console.log('Re-run with --apply.')
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
