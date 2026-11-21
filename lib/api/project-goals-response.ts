/**
 * The v1 envelope the goals routes share (ADEV-179): app/api/v1/projects/[id]/goals and
 * app/api/v1/lists/[id]/goals.
 */
import { NextResponse } from 'next/server'
import type { AuthContext } from '@/lib/api-auth-middleware'
import type { GoalsResult } from '@/services/project-goals.service'
import { isAgentCaller } from '@/lib/api/orchestration-policy-response'

/**
 * Guardrails bound what agents do, so an agent may read them but never change them, even with a
 * token that could otherwise write the project. A person changes them, in settings or with their own token.
 */
export function agentGoalsWriteRefusal(auth: AuthContext): NextResponse | null {
  if (!isAgentCaller(auth)) return null
  return NextResponse.json(
    { error: "An agent cannot change a project's goals and guardrails; propose them to the project owner, who saves them in settings" },
    { status: 403 },
  )
}

export function goalsResponse<T extends object>(result: GoalsResult<T>, auth: AuthContext): NextResponse {
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ...result.value, meta: { apiVersion: 'v1' as const, authSource: auth.source } })
}
