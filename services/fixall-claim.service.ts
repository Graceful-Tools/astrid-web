import {
  type FixallClaimRequest,
  buildAtomicFixallClaimWhere,
  buildFixallClaimData,
  fixallClaimAgentEmail,
} from "@/lib/fixall-claim"
import { prisma } from "@/lib/prisma"

export type FixallClaimResult =
  | { status: "claimed"; assigneeEmail: string }
  | { status: "agent-unavailable" }
  | { status: "conflict" }

/**
 * Take a task for the harness that asked, in ONE conditional update.
 *
 * The identity comes from the claim rather than a constant: a Claude Code loop
 * claiming as Copilot would hand its own work to a different harness, which is
 * why the local loops could not use this endpoint at all before.
 *
 * Exclusivity lives in the pairing of `buildAtomicFixallClaimWhere` (requires
 * Ready) with `buildFixallClaimData` (writes Doing) — see the comment on the
 * latter. `updateMany` reports how many rows matched, so a count of 0 is a
 * genuine "someone else got there first" rather than an error to retry.
 */
export async function claimFixallTask(
  taskId: string,
  claim: FixallClaimRequest,
): Promise<FixallClaimResult> {
  const expectedEmail = fixallClaimAgentEmail(claim.agent)
  const agent = await prisma.user.findUnique({
    where: { email: expectedEmail },
    select: { id: true, email: true, isAIAgent: true, isActive: true },
  })
  if (
    !agent ||
    agent.email.toLowerCase() !== expectedEmail.toLowerCase() ||
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
    data: buildFixallClaimData({ agentId: agent.id, claim }),
  })

  return result.count === 1
    ? { status: "claimed", assigneeEmail: agent.email }
    : { status: "conflict" }
}
