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
