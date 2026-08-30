import {
  FIXALL_CLAIM_AGENT_EMAIL,
  type FixallClaimRequest,
  buildAtomicFixallClaimWhere,
} from "@/lib/fixall-claim"
import { prisma } from "@/lib/prisma"

export type FixallClaimResult =
  | { status: "claimed" }
  | { status: "agent-unavailable" }
  | { status: "conflict" }

export async function claimFixallTask(
  taskId: string,
  claim: FixallClaimRequest,
): Promise<FixallClaimResult> {
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
    return { status: "agent-unavailable" }
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

  return result.count === 1 ? { status: "claimed" } : { status: "conflict" }
}
