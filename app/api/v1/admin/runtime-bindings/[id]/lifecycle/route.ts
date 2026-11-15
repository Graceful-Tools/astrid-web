/**
 * POST /api/v1/admin/runtime-bindings/:id/lifecycle
 *   { action: "verify" | "approve" | "activate" | "suspend" | "revoke", expectedRevision? }
 *
 * Moves a binding through pending → verified → (approve) → active ⇄ suspended,
 * or to revoked. Approval covers exactly the current revision's immutable
 * snapshot. Suspend and revoke work even where enrollment is gated off.
 *
 * AWTD-1668. Admin only, browser session only (lib/runtime-binding/enrollment.ts).
 */
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { transitionRuntimeBinding } from '@/lib/runtime-binding/enrollment'
import { RUNTIME_BINDING_ACTIONS, type RuntimeBindingAction } from '@/lib/runtime-binding/enrollment-rules'
import {
  enrollmentErrorResponse,
  expectedRevisionOf,
  invalidBody,
  readJsonBody,
  refuseUnlessHumanSession,
} from '@/lib/runtime-binding/admin-route'

type Ctx = { params: Promise<{ id: string }> }

const isAction = (value: unknown): value is RuntimeBindingAction =>
  typeof value === 'string' && (RUNTIME_BINDING_ACTIONS as readonly string[]).includes(value)

export const POST = withAuth({ tag: 'v1.admin.runtime-bindings' }, async (req, auth, ctx: Ctx) => {
  const refused = refuseUnlessHumanSession(auth)
  if (refused) return refused
  const { id } = await ctx.params
  const body = await readJsonBody(req)
  if (!body || !isAction(body.action)) {
    return NextResponse.json(
      { error: `action must be one of ${RUNTIME_BINDING_ACTIONS.join(', ')}.`, code: 'invalid-input' },
      { status: 400 },
    )
  }
  const expectedRevision = expectedRevisionOf(body)
  if (expectedRevision === null) return invalidBody()
  try {
    const binding = await transitionRuntimeBinding({ userId: auth.userId }, id, body.action, expectedRevision)
    return NextResponse.json({ binding })
  } catch (thrown) {
    return enrollmentErrorResponse(thrown)
  }
})
