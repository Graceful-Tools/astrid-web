/**
 * The canonical, repository-agnostic Astrid queue skill (AWTD-759).
 *
 * ONE source of truth for how a coding harness works its agent queue —
 * explicit mailbox and board selection, the assignment/Ready handshake,
 * due-date holds, comment and completion expectations, `empty:true`
 * termination, and fail-visibly error behavior. The per-harness adapters
 * below embed the canonical body verbatim, so they cannot drift from it;
 * tests/lib/astrid-queue-skill.test.ts asserts the parity anyway.
 *
 * Adapters are generated at render time rather than committed as files:
 * `AgentLoopRecipes` serves each harness its adapter, and any future
 * download surface (Phase 7) consumes the same functions. Bump
 * QUEUE_SKILL_VERSION when the canonical behavior changes — the stamp is
 * how an installed copy in someone's repository can be recognized as stale.
 */

import { BRAND } from '@/lib/brand/config'

export const QUEUE_SKILL_VERSION = '1.0.0'

export interface QueueSkillOptions {
  /** Agent mailbox this loop polls, e.g. "claude". Required — never guessed. */
  mailbox: string
  /** Scope the loop to one board. Omitted, the skill instructs an explicit get_lists choice. */
  listId?: string | null
}

export type QueueSkillHarness = 'claude-code' | 'copilot' | 'codex' | 'generic'

export interface QueueSkillAdapter {
  harness: QueueSkillHarness
  /** Where the artifact lives in the consuming repository. */
  installPath: string
  /** Complete file content, canonical body embedded verbatim. */
  content: string
}

function requireMailbox(mailbox: string): string {
  if (!mailbox || !mailbox.trim()) {
    throw new Error(
      'astrid-queue-skill: mailbox is required — a queue skill without an explicit agent identity would claim another harness\'s work',
    )
  }
  return mailbox.trim()
}

/**
 * The one-sentence queue contract. Also used verbatim as the prompt in cron
 * one-liners, so keep it a single line.
 */
export function queueContractLine({ mailbox, listId }: QueueSkillOptions): string {
  const agent = requireMailbox(mailbox)
  const listClause = listId ? ` and listId "${listId}"` : ''
  return `Call get_agent_queue with agent "${agent}"${listClause}. Work every task it returns to completion, commenting progress on each one. If it answers empty:true, stop and say nothing is queued.`
}

/** The repository-agnostic skill body every adapter embeds. */
export function canonicalQueueSkill(options: QueueSkillOptions): string {
  const agent = requireMailbox(options.mailbox)
  const boardRule = options.listId
    ? `always pass listId "${options.listId}" so this loop never takes another board's work.`
    : 'pick ONE board with get_lists and pass its listId on every queue call — an unscoped queue mixes boards worked by different harnesses.'

  return `${BRAND.appName} queue skill v${QUEUE_SKILL_VERSION}

${queueContractLine(options)}

Mailbox and board are explicit choices, never defaults:
- Mailbox: this loop is agent "${agent}" — never poll another identity's queue.
- Board: ${boardRule}

Per task, in queue order:
1. Read the task AND its comments (get_task, get_task_comments) before changing anything.
2. Post a short strategy comment (add_comment), then work the task to completion.
3. Finish with a completion report in plain language, then update_task completed:true.
4. Re-check the queue with the same call before the next task — new or reopened tasks arrive mid-run.

Boundaries:
- Only tasks assigned to "${agent}" in Ready status are yours. get_agent_queue already filters for this; never work around it. An unassigned task is someone's untriaged note.
- A task with a future date is held automatically (held.scheduled) — report it, do not start it early.
- empty:true means the run is DONE: stop and say nothing is queued.
- If a tool call fails or a task is blocked, say so visibly on the task and stop or move on — never retry silently in a loop, and never invent adjacent work to fill a quiet run.`
}

/** File name shared by every adapter artifact, e.g. "astrid-queue". */
export function queueSkillSlug(): string {
  return `${BRAND.wordmark.toLowerCase()}-queue`
}

/** Render one harness's thin adapter around the canonical body. */
export function queueSkillAdapter(
  harness: QueueSkillHarness,
  options: QueueSkillOptions,
): QueueSkillAdapter {
  const body = canonicalQueueSkill(options)
  const slug = queueSkillSlug()

  switch (harness) {
    case 'claude-code':
      return {
        harness,
        installPath: `.claude/commands/${slug}.md`,
        content: body,
      }
    case 'copilot':
      return {
        harness,
        installPath: `.github/agents/${slug}.agent.md`,
        content: `---
name: ${BRAND.appName} Queue
description: Work the correctly scoped ${BRAND.appName} agent queue.
---
${body}`,
      }
    case 'codex':
      return {
        harness,
        installPath: 'AGENTS.md',
        content: `## ${BRAND.appName} queue
When asked to work the ${BRAND.appName} queue:

${body}`,
      }
    case 'generic':
      return {
        harness,
        installPath: 'AGENTS.md',
        content: `## ${BRAND.appName} queue (any MCP-capable coding agent)
When asked to work the ${BRAND.appName} queue:

${body}`,
      }
  }
}

/** Every generated adapter, for parity tests and future download surfaces. */
export function queueSkillAdapters(options: QueueSkillOptions): QueueSkillAdapter[] {
  return (['claude-code', 'copilot', 'codex', 'generic'] as const).map(harness =>
    queueSkillAdapter(harness, options),
  )
}
