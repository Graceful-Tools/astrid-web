#!/usr/bin/env npx tsx
/**
 * Hash MCP tokens at rest — run AFTER deploying the dual-read MCP code.
 *
 * ORDER MATTERS: the app must be on the dual-read code (validate by
 * { in: [hash, plaintext] }, return via decrypt(tokenEncrypted)) BEFORE this
 * runs, or a plaintext-lookup build would stop matching the hashed rows.
 *
 * For each row it sets tokenEncrypted = encryptField(plaintext) (if missing)
 * and token = sha256(plaintext). Idempotent — already-hashed rows (token is
 * 64-hex AND tokenEncrypted present) are skipped. Uses ENCRYPTION_KEY, which
 * must match the app's.
 *
 *   DATABASE_URL_PROD=... npx tsx scripts/migrate-hash-mcp-tokens.ts          # dry run
 *   DATABASE_URL_PROD=... npx tsx scripts/migrate-hash-mcp-tokens.ts --apply
 */
import { PrismaClient } from '@prisma/client'
import { hashMCPToken } from '../lib/mcp-token'
import { encryptField, decryptField } from '../lib/field-encryption'
import { loadScriptEnv } from './lib/load-env'

loadScriptEnv()
const APPLY = process.argv.includes('--apply')
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL_PROD || process.env.DATABASE_URL } },
})

async function main() {
  if (decryptField(encryptField('probe')) !== 'probe') throw new Error('ENCRYPTION_KEY round-trip failed')
  const rows = await prisma.mCPToken.findMany({ select: { id: true, token: true, tokenEncrypted: true } })
  let hashed = 0, skipped = 0
  for (const r of rows) {
    const alreadyHashed = /^[0-9a-f]{64}$/.test(r.token) && !!r.tokenEncrypted &&
      decryptField(r.tokenEncrypted) !== r.token // encrypted plaintext differs from the hashed column
    if (alreadyHashed) { skipped++; continue }
    // Current plaintext is in `token`; keep an encrypted copy, then hash `token`.
    if (APPLY) {
      await prisma.mCPToken.update({
        where: { id: r.id },
        data: { tokenEncrypted: r.tokenEncrypted ?? encryptField(r.token), token: hashMCPToken(r.token) },
      })
    }
    hashed++
  }
  console.log(`${APPLY ? 'Hashed' : 'Would hash'}: ${hashed}; already-hashed skipped: ${skipped}`)
  if (!APPLY && hashed > 0) console.log('Re-run with --apply (only after the dual-read code is deployed).')
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
