/**
 * Which Ready tasks an autonomous loop may take.
 *
 * The rule is one line, but it decides whether the loop rewrites work a person
 * is already doing — so the edges are worth pinning, particularly the ones
 * where the data is incomplete and "assume it is free" would be the expensive
 * guess.
 */

import { describe, it, expect } from 'vitest'
import {
  describeAssignee,
  FIXALL_HARNESS_MAILBOXES,
  describeSchedule,
  hasReadyStatus,
  isQueueableStatusRole,
  isClaimableByAgent,
  isDueToStart,
  resolveReadyQueueOptions,
} from '@/lib/ready-queue-scope'
import { agentEmail } from '@/lib/brand/agent-emails'
import { BRAND } from '@/lib/brand/config'

describe('isClaimableByAgent', () => {
  it('takes an UNASSIGNED task', () => {
    expect(isClaimableByAgent({ assigneeId: null }, 'claude-code')).toBe(true)
    expect(isClaimableByAgent({}, 'claude-code')).toBe(true)
    expect(isClaimableByAgent({ assigneeId: '' }, 'claude-code')).toBe(true)
  })

  it('takes a task assigned to the agent itself', () => {
    expect(isClaimableByAgent({
      assigneeId: 'agent-1',
      assignee: { email: `claude@${BRAND.agentEmailDomain}`, name: 'Claude Agent' },
    }, 'claude-code')).toBe(true)
  })

  it('leaves a task assigned to a person alone', () => {
    expect(isClaimableByAgent({
      assigneeId: 'user-1',
      assignee: { email: 'jonparis@gmail.com', name: 'Jon' },
    }, 'claude-code')).toBe(false)
  })

  it('regression for cross-harness fixall routing: each harness takes only its exact identity', () => {
    for (const [harness, mailbox] of Object.entries(FIXALL_HARNESS_MAILBOXES)) {
      expect(isClaimableByAgent({
        assigneeId: `${mailbox}-agent`,
        assignee: { email: agentEmail(mailbox) },
      }, harness)).toBe(true)

      for (const otherMailbox of Object.values(FIXALL_HARNESS_MAILBOXES)) {
        if (otherMailbox === mailbox) continue
        expect(isClaimableByAgent({
          assigneeId: `${otherMailbox}-agent`,
          assignee: { email: agentEmail(otherMailbox) },
        }, harness)).toBe(false)
      }
    }
  })

  it('does not accept the right mailbox on the wrong domain', () => {
    expect(isClaimableByAgent({
      assigneeId: 'agent-1',
      assignee: { email: 'claude@acme.example' },
    }, 'claude-code')).toBe(false)
  })

  it('is case-insensitive about the address', () => {
    expect(isClaimableByAgent({
      assigneeId: 'agent-1',
      assignee: { email: 'Claude@Astrid.CC' },
    }, 'claude-code')).toBe(true)
  })

  it('skips an assigned task whose assignee could not be resolved', () => {
    // The conservative direction. A task IS claimed; we just cannot see by
    // whom, because the serialisation omitted the relation. Taking it on the
    // assumption it is free is the guess that duplicates someone's work.
    expect(isClaimableByAgent({ assigneeId: 'user-1' }, 'claude-code')).toBe(false)
    expect(isClaimableByAgent({ assigneeId: 'user-1', assignee: null }, 'claude-code')).toBe(false)
    expect(isClaimableByAgent({ assigneeId: 'user-1', assignee: { email: null } }, 'claude-code')).toBe(false)
    expect(isClaimableByAgent({ assigneeId: 'user-1', assignee: { name: 'Jon' } }, 'claude-code')).toBe(false)
  })
})

describe('hasReadyStatus', () => {
  // AWTD-562 moved board status off list membership and onto the task. The loops
  // kept reading the old model, so a task Jon marked Ready in the app — which now
  // only sets the field — never reached the queue, and a task left in the legacy
  // `Ready` list stayed queued after it had been moved on. Both directions are the
  // same bug: the queue was reading a shadow of the state.
  it('queues a task whose status FIELD is ready', () => {
    expect(hasReadyStatus({ statusRole: 'ready' })).toBe(true)
  })

  it('does not queue the other columns, or a task with no status at all', () => {
    expect(hasReadyStatus({ statusRole: 'doing' })).toBe(false)
    expect(hasReadyStatus({ statusRole: 'waiting' })).toBe(false)
    expect(hasReadyStatus({ statusRole: null })).toBe(false)
    expect(hasReadyStatus({})).toBe(false)
  })

  // The handback in /fixall is "assign to Jon AND set Waiting", and its whole point
  // is that the next run stops re-reading the task. That only holds if the queue
  // reads the same field the handback wrote.
  it('drops a task the loop handed back to Waiting', () => {
    expect(hasReadyStatus({ statusRole: 'waiting', completed: false })).toBe(false)
  })

  // Done carries no status by construction — the server nulls the field on
  // completion. Belt and braces: a stale role on a completed task must not queue
  // work that is already finished.
  it('never queues a completed task, whatever the field says', () => {
    expect(hasReadyStatus({ statusRole: 'ready', completed: true })).toBe(false)
  })

  it('tolerates the casing and padding a hand-written value arrives with', () => {
    expect(hasReadyStatus({ statusRole: 'Ready' })).toBe(true)
    expect(hasReadyStatus({ statusRole: ' ready ' })).toBe(true)
  })

  // A project's custom state is a column on that project's board, not this queue.
  it('ignores a custom project state that merely sounds ready', () => {
    expect(hasReadyStatus({ statusRole: 'ready-for-review' })).toBe(false)
  })
})

describe('resolveReadyQueueOptions', () => {
  it('requires an explicit harness selector and fails closed on unknown identities', () => {
    expect(() => resolveReadyQueueOptions([], {})).toThrow(/ASTRID_FIXALL_HARNESS/)
    expect(() => resolveReadyQueueOptions(['--harness', 'openai'], {})).toThrow(/Unknown harness/)
    expect(() => isClaimableByAgent({
      assigneeId: 'agent-1',
      assignee: { email: `openai@${BRAND.agentEmailDomain}` },
    }, 'openai')).toThrow(/Unknown harness/)
  })

  it('accepts the CLI forms, defaults only the board, and lets CLI override the environment', () => {
    expect(resolveReadyQueueOptions(
      ['--harness', 'github-copilot'],
      { ASTRID_FIXALL_HARNESS: 'claude-code' },
    )).toEqual({ board: 'web', harness: 'github-copilot', dryRun: false, format: 'human' })

    expect(resolveReadyQueueOptions(
      ['ios', '--harness=codex'],
      {},
    )).toEqual({ board: 'ios', harness: 'codex', dryRun: false, format: 'human' })

    // Each client repo runs its own loop against its own board. A board the parser does not know
    // is rejected below, so a new one has to be added here before its workflow can select it.
    expect(resolveReadyQueueOptions(
      ['windows', '--harness=github-copilot'],
      {},
    )).toEqual({ board: 'windows', harness: 'github-copilot', dryRun: false, format: 'human' })
  })

  it('uses ASTRID_FIXALL_HARNESS when the CLI selector is absent', () => {
    expect(resolveReadyQueueOptions(
      ['ios'],
      { ASTRID_FIXALL_HARNESS: 'astrid-server' },
    )).toEqual({ board: 'ios', harness: 'astrid-server', dryRun: false, format: 'human' })
  })

  it('enables authoritative JSON output explicitly', () => {
    expect(resolveReadyQueueOptions(
      ['--json', '--harness', 'github-copilot'],
      {},
    ).format).toBe('json')
  })

  it('rejects unknown boards and extra positional arguments rather than widening scope', () => {
    expect(() => resolveReadyQueueOptions(
      ['android', '--harness', 'claude-code'],
      {},
    )).toThrow(/Unknown board/)
    expect(() => resolveReadyQueueOptions(
      ['web', 'ios', '--harness', 'claude-code'],
      {},
    )).toThrow(/Unexpected argument/)
  })
})

describe('describeAssignee', () => {
  it('prefers a name, falls back to email, then to the raw id', () => {
    expect(describeAssignee({ assigneeId: 'u1', assignee: { name: 'Jon', email: 'j@x.com' } })).toBe('Jon')
    expect(describeAssignee({ assigneeId: 'u1', assignee: { email: 'j@x.com' } })).toBe('j@x.com')
    expect(describeAssignee({ assigneeId: 'u1' })).toBe('u1')
  })

  it('never returns an empty string, so the skip line always says something', () => {
    expect(describeAssignee({})).not.toBe('')
    expect(describeAssignee({ assigneeId: 'u1' })).not.toBe('')
  })

  // Unassigned still has to render clearly in queue reporting.
  it('says unassigned rather than unknown when nobody has it', () => {
    expect(describeAssignee({})).toBe('unassigned')
    expect(describeAssignee({ assigneeId: null })).toBe('unassigned')
  })
})

/**
 * A task with a date is not work for today.
 *
 * Jon, 2026-08-19: "If a task has a date don't start until the date or time of
 * the task. Therefore we can have fixall respond to recurring tasks and track
 * them in Astrid."
 *
 * Recurrence needs nothing else: completing a repeating task rolls it forward to
 * its next occurrence, which is in the future, and this rule then holds it until
 * that moment arrives. So "check recurring tasks" and "respect the date" are the
 * same rule seen twice.
 */
describe('isDueToStart', () => {
  const now = new Date('2026-08-19T18:00:00.000Z')

  it('starts a task with no date at all — the ordinary case, unchanged', () => {
    expect(isDueToStart({}, now)).toBe(true)
    expect(isDueToStart({ dueDateTime: null }, now)).toBe(true)
  })

  it('holds a task whose time has not arrived', () => {
    expect(isDueToStart({ dueDateTime: '2026-08-19T18:00:01.000Z' }, now)).toBe(false)
    expect(isDueToStart({ dueDateTime: '2026-12-25T09:00:00.000Z' }, now)).toBe(false)
  })

  it('starts a task once its time has arrived, and keeps starting it after', () => {
    expect(isDueToStart({ dueDateTime: '2026-08-19T18:00:00.000Z' }, now)).toBe(true)
    expect(isDueToStart({ dueDateTime: '2026-08-19T17:59:59.000Z' }, now)).toBe(true)
    expect(isDueToStart({ dueDateTime: '2026-01-01T00:00:00.000Z' }, now)).toBe(true)
  })

  it('starts an all-day task from the beginning of its day, not the end', () => {
    // An all-day task carries midnight, so "due today" is due already by 18:00.
    expect(isDueToStart({ dueDateTime: '2026-08-19T00:00:00.000Z', isAllDay: true }, now)).toBe(true)
    expect(isDueToStart({ dueDateTime: '2026-08-20T00:00:00.000Z', isAllDay: true }, now)).toBe(false)
  })

  /**
   * A value that cannot be parsed must not stall the task forever. Silence is the
   * failure mode to avoid: an unreadable date would look exactly like an empty
   * queue, every run, with nothing saying why.
   */
  it('starts a task whose date is unreadable rather than stranding it', () => {
    expect(isDueToStart({ dueDateTime: 'not-a-date' }, now)).toBe(true)
    expect(isDueToStart({ dueDateTime: '' }, now)).toBe(true)
  })
})

describe('describeSchedule', () => {
  const now = new Date('2026-08-19T18:00:00.000Z')

  it('says when a held task becomes workable, so a waiting queue is not a silent one', () => {
    expect(describeSchedule({ dueDateTime: '2026-08-20T09:30:00.000Z' }, now)).toContain('2026-08-20')
  })

  it('has nothing to say about a task with no date', () => {
    expect(describeSchedule({}, now)).toBe('')
  })
})

/**
 * AWTD-871 — a queue for people who do not use the board.
 *
 * `Ready` is a board state, and the board is a Project-Mode-shaped feature. Someone
 * who never opens one never sets a status, so every task they own is
 * `statusRole: null` and a queue that requires Ready answers `empty: true` forever.
 * The only advice the queue could give them was "go and use the feature you do not
 * use".
 *
 * So the requirement is relaxable — but only by exactly one notch. `requireReady:
 * false` makes the ABSENCE of a status stop disqualifying a task. It does not make a
 * status you have set mean less than it says: `waiting` is a task paused on a named
 * condition, `doing` is a task somebody is on, and a project's custom state belongs
 * to that project's own workflow. If any of those queued, the Waiting lane would
 * stop working as a brake, which is the one thing keeping a scheduled loop from
 * re-reading a blocked task every fifteen minutes forever.
 */
describe('isQueueableStatusRole', () => {
  it('queues Ready under either rule — the strict one is not being replaced', () => {
    expect(isQueueableStatusRole('ready', true)).toBe(true)
    expect(isQueueableStatusRole('ready', false)).toBe(true)
  })

  it('queues an unstatused task ONLY when Ready is not required', () => {
    // The whole point of the flag: Inbox is where a non-board user's work lives.
    expect(isQueueableStatusRole(null, false)).toBe(true)
    expect(isQueueableStatusRole(undefined, false)).toBe(true)
    expect(isQueueableStatusRole('', false)).toBe(true)
    expect(isQueueableStatusRole('   ', false)).toBe(true)

    expect(isQueueableStatusRole(null, true)).toBe(false)
    expect(isQueueableStatusRole(undefined, true)).toBe(false)
  })

  it('never queues Waiting or Doing, however the flag is set', () => {
    // A status that IS set means what it says. Waiting is the brake the loop
    // relies on; if relaxing the Ready requirement also swept up Waiting, a
    // blocked task would be re-read on every run — the no-op loop the whole
    // Waiting lane exists to prevent.
    for (const requireReady of [true, false]) {
      expect(isQueueableStatusRole('waiting', requireReady)).toBe(false)
      expect(isQueueableStatusRole('doing', requireReady)).toBe(false)
    }
  })

  it("never queues a project's custom state, however the flag is set", () => {
    // Same reason hasReadyStatus matches the default role exactly: a state that
    // merely READS as ready belongs to the workflow that defined it.
    for (const requireReady of [true, false]) {
      expect(isQueueableStatusRole('ready-for-review', requireReady)).toBe(false)
      expect(isQueueableStatusRole('triage', requireReady)).toBe(false)
    }
  })

  it('is case- and whitespace-insensitive about Ready, like hasReadyStatus', () => {
    expect(isQueueableStatusRole('  Ready  ', true)).toBe(true)
    expect(isQueueableStatusRole('READY', false)).toBe(true)
  })
})
