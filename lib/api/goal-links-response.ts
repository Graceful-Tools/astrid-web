/**
 * The v1 envelope the goal-link routes share (ADEV-271): app/api/v1/tasks/[id]/goals and
 * app/api/v1/lists/[id]/goal-links.
 */
import { NextResponse, type NextRequest } from 'next/server'
import type { AuthContext } from '@/lib/api-auth-middleware'
import type { GoalLinkResult, GoalLinkSource } from '@/services/goal-link.service'
import { isAgentCaller } from '@/lib/api/orchestration-policy-response'

export function goalLinkResponse<T extends object>(result: GoalLinkResult<T>, auth: AuthContext): NextResponse {
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ...result.value, meta: { apiVersion: 'v1' as const, authSource: auth.source } })
}

/** Who made the link, as the row records it. */
export function goalLinkSource(auth: AuthContext): GoalLinkSource {
  return isAgentCaller(auth) ? 'agent' : 'person'
}

/** The JSON body, or a 400 response when it is missing or unreadable. */
export async function readGoalLinkBody(req: NextRequest): Promise<{ body: unknown } | { error: NextResponse }> {
  const text = await req.text()
  try {
    return { body: text ? JSON.parse(text) : undefined }
  } catch {
    return { error: NextResponse.json({ error: 'Send { goalIds } as JSON' }, { status: 400 }) }
  }
}
