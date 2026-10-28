import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPI, UnauthorizedError } from '@/lib/api-auth-middleware'
import { requireAdmin, AdminAuthError } from '@/lib/admin-auth'
import { runEncryptionCensus } from '@/lib/encryption-census'
import { createLogger } from '@/lib/logger'

const log = createLogger('admin.encryption-census')

/**
 * GET /api/admin/encryption-census — admin only, read-only (task AWTD-1369).
 *
 * Reports, per field-encrypted column, how many stored values each key on
 * production's ring decrypts and how many none does. It is the only way to
 * learn that: the keys are Vercel Secrets, and no machine outside production
 * holds them. Run it before every step of an ENCRYPTION_KEY rotation.
 *
 * Accepts a session or an OAuth token (authenticateAPI), so an operator's
 * script can call it; admin is required either way. The response is counts and
 * variable names only — see lib/encryption-census.ts.
 */
export async function GET(request: NextRequest) {
  let userId: string
  try {
    ;({ userId } = await authenticateAPI(request))
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    throw error
  }

  try {
    await requireAdmin(userId)
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    throw error
  }

  const census = await runEncryptionCensus()
  log.info({ userId, ring: census.ring, totals: census.totals }, 'Encryption census run')
  return NextResponse.json(census, { headers: { 'Cache-Control': 'no-store' } })
}
