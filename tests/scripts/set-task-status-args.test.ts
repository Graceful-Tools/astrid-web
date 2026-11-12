/**
 * Waiting carries its condition in the same write (Waiting redesign, Jon 2026-11-12).
 *
 * "All waiting should be either waiting on a task or waiting on a date." The rule is
 * astrid-core's and the server refuses a condition-less move (WAITING_NEEDS_CONDITION);
 * `set-task-status.ts <id> Waiting` refuses it first, with a message that says what to pass.
 */
import { describe, expect, it } from 'vitest'
import { parseSetTaskStatusArgs, WAITING_NEEDS_CONDITION_MESSAGE } from '@/scripts/lib/task-status-args'

const TASK = '11111111-1111-4111-8111-111111111111'
const NOW = new Date('2026-11-12T12:00:00.000Z')
const parse = (argv: string[]) => parseSetTaskStatusArgs(argv, NOW)

describe('set-task-status.ts Waiting', () => {
  it('refuses Waiting with no condition, saying what to pass', () => {
    expect(() => parse([TASK, 'Waiting'])).toThrow(WAITING_NEEDS_CONDITION_MESSAGE)
    expect(() => parse([TASK, 'waiting', '--agent', 'claude'])).toThrow(/--until <ISO date.*--blocked-by/)
    expect(() => parse([TASK, 'Waiting', '--keep-assignee'])).toThrow(/--until/)
  })

  it('sends a recheck date with the move, in one body', () => {
    expect(parse([TASK, 'Waiting', '--until', '2026-12-01T09:00:00Z', '--agent', 'claude'])).toEqual({
      taskId: TASK, role: 'waiting', name: 'Waiting',
      body: { statusRole: 'waiting', dueDateTime: '2026-12-01T09:00:00.000Z' },
    })
  })

  it('sends a blocking task with the move, and keep-assignee only when asked', () => {
    expect(parse([TASK, 'Waiting', '--blocked-by', 'AWTD-1234', '--keep-assignee']).body).toEqual({
      statusRole: 'waiting', waitOnTaskId: 'AWTD-1234', keepAssignee: true,
    })
    expect(parse([TASK, 'Waiting', '--blocked-by', 'AWTD-1234']).body).not.toHaveProperty('keepAssignee')
  })

  it('refuses a date that is unreadable or not in the future', () => {
    expect(() => parse([TASK, 'Waiting', '--until', 'next week'])).toThrow(/not an ISO date/)
    expect(() => parse([TASK, 'Waiting', '--until', '2026-11-01T00:00:00Z'])).toThrow(/not in the future/)
  })

  it('a flag missing its value is fatal, never swallowed as a positional (AWTD-922)', () => {
    expect(() => parse([TASK, 'Waiting', '--until'])).toThrow(/--until requires a value/)
    expect(() => parse([TASK, 'Waiting', '--blocked-by', '--keep-assignee'])).toThrow(/requires a value/)
  })
})

describe('set-task-status.ts other lanes', () => {
  it('Ready and Doing take no condition flags', () => {
    expect(parse([TASK, 'Doing', '--agent', 'codex']).body).toEqual({ statusRole: 'doing' })
    expect(() => parse([TASK, 'Ready', '--until', '2026-12-01T09:00:00Z'])).toThrow(/apply only to Waiting/)
    expect(() => parse([TASK, 'Doing', '--keep-assignee'])).toThrow(/apply only to Waiting/)
  })

  it('rejects unknown statuses and options', () => {
    expect(() => parse([TASK, 'Blocked'])).toThrow(/Unknown status/)
    expect(() => parse([TASK, 'Doing', '--force'])).toThrow(/Unknown option/)
    expect(() => parse([TASK])).toThrow(/Usage/)
  })
})
