/**
 * PUT /api/v1/projects/:id/goals/:goalId/measure { current, taskId? } — record a goal's new value (ADEV-182)
 *
 * Open to everyone working in the project, agents and scripts included (the statement itself is
 * not: see ../route.ts). Each change keeps who and when in the goal's history, and answers the
 * project's goals like GET. An unchanged value records nothing. Rules: lib/goals-guardrails.ts
 * (`withMeasurement`); permissions: services/project-goals.service.ts.
 */
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { goalsResponse } from '@/lib/api/project-goals-response'
import { recordGoalMeasurement } from '@/services/project-goals.service'

type RouteContext = { params: Promise<{ id: string; goalId: string }> }

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const PUT = withAuth<RouteContext>(
  { scopes: ['projects:write'], tag: 'v1.projects.goals.measure' },
  async (req, auth, { params }) => {
    const { id, goalId } = await params
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Send { current } as JSON' }, { status: 400 })
    }
    // An agent signs with its mailbox, a person with their user id.
    const by = auth.agentUser?.email ?? (auth.isAIAgent ? auth.user.email : auth.user.id)
    return goalsResponse(await recordGoalMeasurement(id, auth.userId, goalId, body, by), auth)
  },
)
