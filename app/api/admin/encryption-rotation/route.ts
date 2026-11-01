import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPI, UnauthorizedError } from '@/lib/api-auth-middleware'
import { requireAdmin, AdminAuthError } from '@/lib/admin-auth'
import { encryptionKeyHexes } from '@/lib/encryption-keys'
import { reencryptAppDatabase } from '@/lib/reencrypt-runner'
import type { RowOutcome } from '@/lib/reencrypt-plan'
import { createLogger } from '@/lib/logger'

const log = createLogger('admin.encryption-rotation')

// ~6k rows at one conditional update each. Re-running after a timeout is safe:
// the pass is idempotent.
export const maxDuration = 300

/** Enough to say which rows to look at; past that, a count. */
const MAX_PROBLEMS = 50

/**
 * /api/admin/encryption-rotation — admin only (task AWTD-1369).
 *
 * Step 3 of the ENCRYPTION_KEY rotation, run where production's keys are:
 * both are write-only Vercel Secrets, so scripts/reencrypt-fields.ts cannot
 * decrypt production's data from any other machine.
 *
 *   GET   dry run — what the rewrite would do. Writes nothing.
 *   POST  rewrite every encrypted value under ENCRYPTION_KEY_NEXT.
 *
 * Verify with GET /api/admin/encryption-census: the rotation is finished when
 * it reports `byKey.ENCRYPTION_KEY: 0` and `noKey: 0` everywhere.
 *
 * The response is counts and row locations only, never a key or a value.
 */
async function run(request: NextRequest, mode: 'dry-run' | 'rewrite') {
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

  let keys: number
  try {
    keys = encryptionKeyHexes().length
  } catch (error) {
    // A misconfigured ring (NEXT identical to the current key, a malformed
    // key). encryption-keys never puts a value in these messages.
    return NextResponse.json({ error: (error as Error).message }, { status: 409 })
  }
  if (mode === 'rewrite' && keys < 2) {
    // Rewriting under the only key would report success having rotated nothing.
    return NextResponse.json(
      { error: 'No rotation in progress: set ENCRYPTION_KEY_NEXT and deploy first' },
      { status: 409 },
    )
  }

  const tables: ({ table: string } & RowOutcome)[] = []
  const problems: string[] = []
  let problemsTruncated = 0
  const totals = await reencryptAppDatabase(
    { dryRun: mode === 'dry-run', verify: false, batchSize: 500 },
    {
      table: (table, outcome) => tables.push({ table, ...outcome }),
      problem: location => {
        if (problems.length < MAX_PROBLEMS) problems.push(location)
        else problemsTruncated++
      },
    },
  )

  log.info({ userId, mode, keys, totals }, 'Encryption rotation pass run')
  return NextResponse.json(
    {
      mode,
      ring: { keys, rotationInProgress: keys > 1 },
      totals,
      tables,
      problems,
      ...(problemsTruncated > 0 ? { problemsTruncated } : {}),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function GET(request: NextRequest) {
  return run(request, 'dry-run')
}

export async function POST(request: NextRequest) {
  return run(request, 'rewrite')
}
