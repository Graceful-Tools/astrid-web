import { NextResponse } from "next/server"
import { withAuth } from "@/lib/api-auth-wrapper"
import { requireTaskAccess } from "@/lib/api-auth-middleware"
import {
  FIXALL_CLAIM_AGENT_EMAIL,
  parseFixallClaimRequest,
} from "@/lib/fixall-claim"
import { claimFixallTask } from "@/services/fixall-claim.service"

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

    const result = await claimFixallTask(taskId, claim)
    if (result.status === "agent-unavailable") {
      return NextResponse.json({ error: "Configured fixall agent is unavailable" }, { status: 409 })
    }
    if (result.status === "conflict") {
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
