/**
 * Which Inbox notes still wait on an agent to clarify them (ADEV-227).
 *
 * Jon, 2026-11-23: "The ai can help drive clarity on inbox /ideas. This could
 * be part of the fix all workflow." A /fixall run reads every open Inbox note
 * on its board (no status, not completed). It promotes a clear note to Ready
 * and asks one Decision on an unclear one, handing it back to the person who
 * wrote it (docs/FIXALL_WORKFLOW.md → *Clarifying Inbox ideas*).
 *
 * A note is NOT waiting on the agent when:
 *   - its latest agent comment is an `AGENT-HANDBACK:` question. If nobody has
 *     replied, the person is being asked something and the agent waits. If the
 *     assignee has replied, the existing resume path
 *     (`attention.tasks[].resume`, lib/agent-handback.ts) owns that reply. In
 *     neither case is it a fresh idea, and counting it would make the scheduled
 *     preflight loop on it every tick.
 *   - it is a public-intake copy (`[public-intake:<id>]`, scripts/lib/public-intake.ts).
 *     Those are untrusted text that a person reads and promotes. Clarifying them
 *     would let an anonymous submitter's words reach Ready without that person.
 */

import { prisma } from '@/lib/prisma'
import { getTaskUrl } from '@/lib/base-url'
/** How many Inbox notes one poll reads for `inbox.ideas` (ADEV-227); the bound is reported. */
const IDEAS_LIMIT = 50

/** The tag every public-intake copy carries (scripts/lib/public-intake.ts `INTAKE_TAG`). */
const PUBLIC_INTAKE_TAG = '[public-intake:'

/** An exact marker line, as lib/agent-handback.ts matches it — a quoted marker is not one. */
const HANDBACK_LINE = /^AGENT-HANDBACK:\s*\S+$/

export interface IdeaComment {
  authorId: string | null
  author?: { isAIAgent: boolean } | null
  content: string
  createdAt: Date | string
}

function time(value: Date | string): number {
  return value instanceof Date ? value.getTime() : Date.parse(value)
}

/** Does this comment end a handback — an exact `AGENT-HANDBACK: <mailbox>` line? */
export function carriesHandbackMarker(content: string): boolean {
  return content.split(/\r?\n/).some(line => HANDBACK_LINE.test(line.trim()))
}

/** True when an open Inbox note still waits on an agent to clarify it. */
export function awaitsClarification(note: { description: string | null; comments: IdeaComment[] }): boolean {
  if (note.description?.includes(PUBLIC_INTAKE_TAG)) return false
  const latestAgent = note.comments
    .filter(comment => comment.authorId && comment.author?.isAIAgent)
    .sort((a, b) => time(b.createdAt) - time(a.createdAt))[0]
  return !latestAgent || !carriesHandbackMarker(latestAgent.content)
}

/**
 * An open Inbox note on the named board that still waits on an agent to
 * clarify it (ADEV-227, lib/inbox-ideas.ts). The run promotes a clear one to
 * Ready, or asks one Decision and hands it back to `creatorId`.
 */
export interface AgentInboxIdea {
  id: string
  identifier: string | null
  title: string
  /** Who wrote the note — the person a Decision is handed back to. */
  creatorId: string | null
  assigneeId: string | null
  /** Part of the preflight's seen-key: an edited note wakes another run. */
  updatedAt: string
  url: string
}

export interface AgentInbox {
  ideas: AgentInboxIdea[]
  /** True when more notes are waiting than one poll reads. */
  truncated: boolean
}

/**
 * Open Inbox notes on the named board that still wait on an agent (ADEV-227).
 *
 * The queue leaves these out on purpose — an unassigned task with no status is
 * a person's note, not a hand-off — so they need their own read. Bounded to a
 * board the caller owns or belongs to AND the agent belongs to (or a public
 * one): no question is ever posted on a private board the agent is not on.
 * A note assigned to an agent is not a person's idea.
 */
export async function buildInboxIdeas({
  agentId,
  userId,
  listId,
  boundScope,
}: {
  agentId: string
  userId: string
  listId: string
  boundScope: object
}): Promise<AgentInbox> {
  const rows = await prisma.task.findMany({
    where: {
      completed: false,
      statusRole: null,
      OR: [{ assigneeId: null }, { assignee: { isAIAgent: false } }],
      lists: {
        some: {
          id: listId,
          AND: [
            { OR: [{ ownerId: userId }, { listMembers: { some: { userId } } }] },
            { OR: [{ listMembers: { some: { userId: agentId } } }, { privacy: 'PUBLIC' as const }] },
          ],
        },
        ...boundScope,
      },
    },
    select: {
      id: true,
      identifier: true,
      title: true,
      description: true,
      creatorId: true,
      assigneeId: true,
      updatedAt: true,
      comments: {
        where: { authorId: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { authorId: true, content: true, createdAt: true, author: { select: { isAIAgent: true } } },
      },
    },
    // Oldest first: an idea that has waited longest is clarified first.
    orderBy: { createdAt: 'asc' },
    take: IDEAS_LIMIT,
  })

  return {
    ideas: rows
      .filter(row => awaitsClarification({ description: row.description, comments: row.comments ?? [] }))
      .map(row => ({
        id: row.id,
        identifier: row.identifier,
        title: row.title,
        creatorId: row.creatorId,
        assigneeId: row.assigneeId,
        updatedAt: row.updatedAt.toISOString(),
        url: getTaskUrl(row.id),
      })),
    truncated: rows.length >= IDEAS_LIMIT,
  }
}
