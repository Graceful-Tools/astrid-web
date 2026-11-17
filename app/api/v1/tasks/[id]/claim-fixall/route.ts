import { NextResponse } from "next/server"
import { withAuth } from "@/lib/api-auth-wrapper"
import { requireTaskAccess } from "@/lib/api-auth-middleware"
import { parseFixallClaimRequest } from "@/lib/fixall-claim"
import { claimFixallTask } from "@/services/fixall-claim.service"
import { runtimePrincipalOf } from "@/lib/runtime-binding/task-runtime"
import { runtimeBindingDenialResponse } from "@/lib/runtime-binding/denial-response"

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

    const result = await claimFixallTask(taskId, claim, {
      principal: runtimePrincipalOf(auth),
      actorUserId: auth.userId,
    })
    // A bound board refused the claim (AWTD-1669): capacity is a 409 like a
    // lost race, so a loop moves on; every other reason is a 403 it must report.
    if (result.status === "binding-denied") return runtimeBindingDenialResponse(result.denial)
    if (result.status === "agent-unavailable") {
      return NextResponse.json(
        { error: `No active agent account for ${claim.agent}` },
        { status: 409 },
      )
    }
    if (result.status === "policy-denied") {
      return NextResponse.json({ error: result.message, reason: result.reason }, { status: 403 })
    }
    if (result.status === "handed-off") {
      return NextResponse.json(
        { error: `Already handed off: waiting for production to serve ${result.sha}. Moved back to Doing.` },
        { status: 409 },
      )
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
      // The identity actually written, not a constant — the claimant varies by
      // harness now, and a caller that trusted a hardcoded answer would report
      // the wrong owner.
      assigneeEmail: result.assigneeEmail,
      agent: claim.agent,
      action: claim.action,
    })
  },
)
