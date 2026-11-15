/**
 * GET  /api/v1/admin/runtime-bindings — every runtime binding, its attached
 *      boards and the lifecycle actions available now, plus whether this
 *      deployment allows enrollment at all.
 * POST /api/v1/admin/runtime-bindings — enroll a new binding (state `pending`).
 *
 * Admin enrollment of business runtime bindings (AWTD-1668,
 * docs/architecture/BUSINESS_RUNTIME_BINDING_RFC.md §6). Admin only; changes
 * need a browser session. Refused unless ASTRID_RUNTIME_BINDING_SINGLE_BUSINESS
 * is on (lib/runtime-binding/enrollment.ts).
 */
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { createRuntimeBinding, listRuntimeBindings } from '@/lib/runtime-binding/enrollment'
import {
  enrollmentErrorResponse,
  invalidBody,
  readJsonBody,
  refuseUnlessHumanSession,
} from '@/lib/runtime-binding/admin-route'

export const GET = withAuth({ tag: 'v1.admin.runtime-bindings' }, async (_req, auth) => {
  try {
    return NextResponse.json(await listRuntimeBindings({ userId: auth.userId }))
  } catch (thrown) {
    return enrollmentErrorResponse(thrown)
  }
})

export const POST = withAuth({ tag: 'v1.admin.runtime-bindings' }, async (req, auth) => {
  const refused = refuseUnlessHumanSession(auth)
  if (refused) return refused
  const body = await readJsonBody(req)
  if (!body) return invalidBody()
  try {
    const binding = await createRuntimeBinding({ userId: auth.userId }, body)
    return NextResponse.json({ binding }, { status: 201 })
  } catch (thrown) {
    return enrollmentErrorResponse(thrown)
  }
})
