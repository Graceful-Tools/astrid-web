/**
 * The v1 envelope the two orchestration-policy routes share (AWTD-1693):
 * app/api/v1/lists/[id]/orchestration-policy and app/api/v1/projects/[id]/orchestration-policy.
 */
import { NextResponse } from 'next/server'
import type { AuthContext } from '@/lib/api-auth-middleware'
import type { PolicyResult } from '@/services/orchestration-policy.service'

/**
 * The policy decides what agents may do, so an agent may read it but never change it, even with a
 * token that could otherwise write the list. A person changes it, in settings or with their own token.
 */
export function agentPolicyWriteRefusal(auth: AuthContext): NextResponse | null {
  if (!auth.isAIAgent && !auth.agentUser && !auth.user?.isAIAgent) return null
  return NextResponse.json(
    { error: 'An agent cannot change an orchestration policy; a list or project owner or admin changes it in settings' },
    { status: 403 },
  )
}

export function policyResponse<T extends object>(result: PolicyResult<T>, auth: AuthContext): NextResponse {
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ...result.value, meta: { apiVersion: 'v1' as const, authSource: auth.source } })
}
