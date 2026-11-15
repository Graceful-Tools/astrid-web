/**
 * The HTTP answer for a runtime-binding denial (AWTD-1667 / AWTD-1669), one
 * shape for the queue and both claim routes: `{ error, reason, bindingId,
 * boardId }`. Never a credential or payer reference — the denial carries none.
 *
 * `capacity-exhausted` is a 409: the binding is busy, like a lost race, and
 * scripts/claim-fixall-task.ts already exits 2 ("move to the next task") on a
 * 409. Every other reason is a 403 the caller must surface, never retry around.
 */
import { NextResponse } from 'next/server'
import type { RuntimeBindingDenial } from '@/lib/ai/runtime-binding-resolver'

export function runtimeBindingDenialStatus(denial: Pick<RuntimeBindingDenial, 'reason'>): number {
  return denial.reason === 'capacity-exhausted' ? 409 : 403
}

export function runtimeBindingDenialResponse(
  denial: Pick<RuntimeBindingDenial, 'reason' | 'bindingId' | 'boardId' | 'message'>,
  extra: Record<string, unknown> = {},
) {
  return NextResponse.json(
    { ...extra, error: denial.message, reason: denial.reason, bindingId: denial.bindingId, boardId: denial.boardId },
    { status: runtimeBindingDenialStatus(denial) },
  )
}
