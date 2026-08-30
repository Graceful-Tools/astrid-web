import { NextResponse } from "next/server"
import { withAuth } from "@/lib/api-auth-wrapper"
import { requireTaskAccess } from "@/lib/api-auth-middleware"
import {
  FIXALL_CLAIM_AGENT_EMAIL,
  buildAtomicFixallClaimWhere,
  parseFixallClaimRequest,
} from "@/lib/fixall-claim"
import { prisma } from "@/lib/prisma"

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth<RouteContext>(
  { scopes: ["tasks:write"], tag: "v1.tasks.claim-fixall" },
  async (request, auth, { params }) => {
    const { id: taskId } = await params
    await requireTaskAccess(auth.userId, taskId)

    let claim
    try {
      claim = parseFixallClaimRequest(await request.json())
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid claim request" },
        { status: 400 },
      )
    }

    const agent = await prisma.user.findUnique({
      where: { email: FIXALL_CLAIM_AGENT_EMAIL },
      select: { id: true, email: true, isAIAgent: true, isActive: true },
    })
    if (
      !agent ||
      agent.email.toLowerCase() !== FIXALL_CLAIM_AGENT_EMAIL ||
      !agent.isAIAgent ||
      !agent.isActive
    ) {
      return NextResponse.json({ error: "Configured fixall agent is unavailable" }, { status: 409 })
    }

    const result = await prisma.task.updateMany({
      where: buildAtomicFixallClaimWhere({
        taskId,
        agentId: agent.id,
        claim,
        now: new Date(),
      }),
      data: { assigneeId: agent.id },
    })

    if (result.count !== 1) {
      return NextResponse.json(
        { error: "Task changed after queue selection and was not claimed" },
        { status: 409 },
      )
    }

    return NextResponse.json({
      claimed: true,
      taskId,
      assigneeEmail: FIXALL_CLAIM_AGENT_EMAIL,
      action: claim.action,
    })
  },
)
