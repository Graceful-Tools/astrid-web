/**
 * Who signs a piece of agent-written content.
 *
 * AWTD-878 established the rule for task comments: a comment written by the
 * coding agent must be signed by the coding agent, not by the human who owns
 * the OAuth client. Client-credentials auth resolves `auth.userId` to the
 * client's OWNER, so without this the /fixall loop's strategy comments and
 * completion reports all arrived with the account holder's name and face.
 *
 * The same reasoning applies to list chat: a run summary posted by the
 * scheduled loop must not look like Jon talking to himself. The logic lived
 * inline in POST /api/v1/tasks/:id/comments; it is here so the chat route uses
 * the identical rule rather than a second, drifting copy of it.
 *
 * Precedence, highest first:
 *   1. `auth.agentUser` — the token is itself bound to an agent mailbox, which
 *      is a stronger claim than anything in a request body.
 *   2. `aiAgentId` from the body, validated to name a real AI-agent user.
 *   3. `auth.userId` — an ordinary human write.
 */

import { isBrandAgentEmail } from '@/lib/brand/agent-emails'
import { prisma } from '@/lib/prisma'

export interface AgentAuthorContext {
  userId: string
  agentUser?: { id: string; email: string } | null
}

export type ResolveAgentAuthorResult =
  | { ok: true; authorId: string; agentEmail?: string }
  | { ok: false; error: string }

/**
 * Resolve the author id for agent-authored content.
 *
 * Returns `ok: false` with a caller-facing message when `aiAgentId` is supplied
 * but does not name a real AI agent — a bad id is a 400, never a silent
 * fallback to the human owner. Silently falling back is precisely the bug
 * AWTD-878 fixed, and it is invisible in the response.
 */
export async function resolveAgentAuthor(
  auth: AgentAuthorContext,
  aiAgentId?: string | null
): Promise<ResolveAgentAuthorResult> {
  if (auth.agentUser) {
    return { ok: true, authorId: auth.agentUser.id, agentEmail: auth.agentUser.email }
  }

  if (!aiAgentId) {
    return { ok: true, authorId: auth.userId }
  }

  const aiAgent = await prisma.user.findUnique({
    where: { id: aiAgentId },
    select: { id: true, isAIAgent: true, email: true },
  })

  if (!aiAgent) {
    return { ok: false, error: 'Invalid aiAgentId - user not found' }
  }

  // Brand agent mailboxes (claude@, codex@, …) are agents even when the
  // isAIAgent flag was never set on the row — see lib/brand/agent-emails.ts.
  if (!aiAgent.isAIAgent && !isBrandAgentEmail(aiAgent.email)) {
    return { ok: false, error: 'Invalid aiAgentId - specified user is not an AI agent' }
  }

  return { ok: true, authorId: aiAgent.id, agentEmail: aiAgent.email ?? undefined }
}
