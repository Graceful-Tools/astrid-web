/**
 * The v1 envelope the two goals routes share (ADEV-179):
 * app/api/v1/projects/[id]/goals and app/api/v1/lists/[id]/goals.
 */
import { NextResponse } from 'next/server'
import type { AuthContext } from '@/lib/api-auth-middleware'
import type { GoalsResult } from '@/services/goals-guardrails.service'

/**
 * Goals and guardrails bound what agents may do, so an agent may read them but never change them,
 * even with a token that could otherwise write the project. A person changes them.
 */
export function agentGoalsWriteRefusal(auth: AuthContext): NextResponse | null {
  if (!auth.isAIAgent && !auth.agentUser && !auth.user?.isAIAgent) return null
  return NextResponse.json(
    { error: 'An agent cannot change a project\'s goals and guardrails; its owner or an admin changes them in settings' },
    { status: 403 },
  )
}

export function goalsResponse<T extends object>(result: GoalsResult<T>, auth: AuthContext): NextResponse {
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ...result.value, meta: { apiVersion: 'v1' as const, authSource: auth.source } })
}
