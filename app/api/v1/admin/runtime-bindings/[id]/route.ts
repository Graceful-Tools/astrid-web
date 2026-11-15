/**
 * GET   /api/v1/admin/runtime-bindings/:id — one binding with its attached
 *       boards and immutable revision snapshots.
 * PATCH /api/v1/admin/runtime-bindings/:id — change its configuration. Every
 *       change is a new revision; a broadening returns it to `pending` for
 *       re-approval. Body: configuration fields, optional `expectedRevision`.
 *
 * AWTD-1668. Admin only; changes need a browser session and a single-business
 * deployment (lib/runtime-binding/enrollment.ts).
 */
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { getRuntimeBinding, updateRuntimeBinding } from '@/lib/runtime-binding/enrollment'
import {
  enrollmentErrorResponse,
  expectedRevisionOf,
  invalidBody,
  readJsonBody,
  refuseUnlessHumanSession,
} from '@/lib/runtime-binding/admin-route'

type Ctx = { params: Promise<{ id: string }> }

export const GET = withAuth({ tag: 'v1.admin.runtime-bindings' }, async (_req, auth, ctx: Ctx) => {
  const { id } = await ctx.params
  try {
    return NextResponse.json(await getRuntimeBinding({ userId: auth.userId }, id))
  } catch (thrown) {
    return enrollmentErrorResponse(thrown)
  }
})

export const PATCH = withAuth({ tag: 'v1.admin.runtime-bindings' }, async (req, auth, ctx: Ctx) => {
  const refused = refuseUnlessHumanSession(auth)
  if (refused) return refused
  const { id } = await ctx.params
  const body = await readJsonBody(req)
  if (!body) return invalidBody()
  const expectedRevision = expectedRevisionOf(body)
  if (expectedRevision === null) return invalidBody()
  const { expectedRevision: _ignored, ...changes } = body
  try {
    const binding = await updateRuntimeBinding({ userId: auth.userId }, id, changes, expectedRevision)
    return NextResponse.json({ binding })
  } catch (thrown) {
    return enrollmentErrorResponse(thrown)
  }
})
