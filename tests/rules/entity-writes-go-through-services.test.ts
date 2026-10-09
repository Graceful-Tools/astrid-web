/**
 * RULE — spec §5.2 step 7 (docs/specs/GITHUB_PROJECTS_WHITELABEL.md §5.1).
 *
 * Every write to a Task, Comment or ListMember goes through services/. That is
 * where a write gets what it MEANS — the completion stamp and board lane,
 * blocked dependents, repeating roll-forward, the list broadcast, in-app
 * notifications, cache invalidation, agent dispatch, the assignee rules — and
 * where a remote-first backend can be put in front of it.
 *
 * The client-facing surfaces already did. The side doors did not: agent
 * webhooks, the coding workflow, invitations, email-to-task, sync and copy
 * wrote straight to the rows, and that is where the bugs this review found
 * lived (AWTD-1089 … AWTD-1093). Steps 2–6 moved them; this keeps them moved.
 *
 * NOT A FREE PASS. Every entry below says why that write may stay where it is.
 * A new entry needs the same — and the slack check fails when an entry stops
 * being needed, so the list only shrinks.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SCANNED = ['app', 'lib', 'mcp']

const ALLOWED: Record<string, string> = {
  // ── Inside the services' own machinery ─────────────────────────────────
  'lib/comments/create-comment.ts': "the comment service's idempotent insert",
  'lib/task-update-handler.ts': 'state-change system comments written by updateTaskWithSideEffects',
  'lib/repeating-task-handler.ts': 'roll-forward, called only from services/task.service.ts',

  // ── Astrid-only bookkeeping that is not a task change ──────────────────
  'lib/reminder-dismiss.ts': 'reminderSent only',
  'lib/reminder-service.ts': 'reminderSent only, from the reminder cron',

  // ── Writes that carry their own rules, announced via the member service ─
  'lib/list-leave.ts': 'the leave rule (last admin, invites); announced with announceListMemberRemoved',
  'lib/list-ownership-transfer.ts': 'one transaction with the owner change; announced with announceListMemberRemoved',
  'app/api/invitations/[token]/route.ts': 'membership upserted in the transaction that consumes the invitation; announced after commit',
  'app/api/lists/[id]/route.ts':
    'roster replace inside the image-ownership transaction, announced with announceRosterChanges',

  // ── A new list's initial roster: nobody can be viewing it yet ──────────
  'app/api/lists/route.ts': 'members of a list being created',
  'lib/email-to-task-service.ts': 'members of the shared list an email creates',

  // ── Bulk or system creates, deliberately outside the per-task path ─────
  'lib/copy-utils.ts': 'list/task copies: per-task side effects would multiply past the function budget; history copied verbatim',
  'lib/task-batch-copy.ts': 'copy into several lists; assignee gated by authorizeNewTaskAssignee',
  'lib/system-tasks.ts': 'system-authored verify-email task (no creator), shared with the weekly batch insert',
  'lib/projects-service.ts': 'a deleted board column clears its lane across the board in one statement',
}

const ENTITY_WRITE =
  /\b(?:prisma|tx|client|this\.prisma)\.(?:task|comment|listMember)\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\(/

function sourceFiles(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

const writers = SCANNED.flatMap(dir => sourceFiles(join(ROOT, dir)))
  .map(file => relative(ROOT, file))
  .filter(file => ENTITY_WRITE.test(readFileSync(join(ROOT, file), 'utf8')))

describe('Task, Comment and ListMember writes go through services/', () => {
  it('recognises a write when one is planted — the scan is not vacuously green', () => {
    for (const planted of [
      'await prisma.task.update({ where: { id }, data })',
      'await tx.comment.create({ data })',
      'await client.listMember.deleteMany({ where })',
      'await this.prisma.task.updateMany({ where, data })',
    ]) {
      expect(ENTITY_WRITE.test(planted), planted).toBe(true)
    }
    expect(ENTITY_WRITE.test('await prisma.task.findMany({ where })')).toBe(false)
  })

  it('has no unlisted writer outside services/', () => {
    const offenders = writers.filter(file => !(file in ALLOWED))
    expect(
      offenders,
      `These write Task/Comment/ListMember rows directly:\n${offenders.map(f => `  ${f}`).join('\n')}\n\n` +
        'Go through services/ (task.service, comment.service, list-member.service, complete-task, ' +
        'post-comment-as). If the write genuinely cannot, add it to ALLOWED with the reason.',
    ).toEqual([])
  })

  it('leaves no allow-list entry slack — remove one the moment its file stops writing', () => {
    const slack = Object.keys(ALLOWED).filter(file => !writers.includes(file))
    expect(slack, `No longer write directly — delete from ALLOWED: ${slack.join(', ')}`).toEqual([])
  })
})
