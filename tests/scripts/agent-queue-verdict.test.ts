/**
 * The scheduled loop's "is there anything to do?" verdict, where it can be tested.
 *
 * `scripts/agent-queue-status.ts` is what lets a quiet tick cost one HTTP
 * request instead of a Claude session. Until now it answered from `empty`
 * alone, and `empty` describes only the Ready queue. Two things the run is
 * REQUIRED to act on were invisible to it:
 *
 *   - the inbox. On 2026-09-20 Jon asked "Status?" on AWTD-904 and "Should we
 *     close?" on AWTD-976. The endpoint returned both under `attention`, with
 *     `empty: true` beside them, and the loop logged "nothing queued" past
 *     them tick after tick.
 *   - the Waiting lanes. A date-parked task returns to Ready only when the
 *     sweep runs, the sweep runs only inside a session, and a session starts
 *     only when the queue is non-empty. So a parked task could never wake the
 *     loop by itself — its date would arrive and nothing would happen until
 *     some unrelated task landed in Ready.
 *
 * The other half of "token efficient" is that waking must be bounded. An
 * item the agent chose not to answer (the sweep's own parking comment, a
 * "thanks") would otherwise start a session every half hour, forever. So a
 * wake key is spent once: the same comment id, the same lane watermark, never
 * wakes a second run. A NEW comment does.
 */

import { describe, it, expect } from 'vitest'
import {
  decideQueueVerdict,
  wakeKeys,
  type QueueSnapshot,
  type LaneSnapshot,
} from '../../scripts/lib/agent-queue-verdict'

const TASK_904 = 'e586eff1-7198-413c-8cda-0fcdef18505c'
const TASK_976 = '4fd8142e-ced9-4ad2-8db4-8f142617537a'

function snapshot(overrides: Partial<QueueSnapshot> = {}): QueueSnapshot {
  return {
    empty: true,
    queue: [],
    held: { notDueCount: 0, notReadyCount: 0, scheduled: [] },
    attention: { tasks: [], messages: [], truncated: false, skipped: [] },
    hint: 'No incomplete tasks are assigned to claude.',
    ...overrides,
  }
}

const jonAsked: QueueSnapshot['attention'] = {
  tasks: [
    {
      id: TASK_904,
      identifier: 'AWTD-904',
      title: 'Add a web-vitals reporter',
      lastComment: { id: 'cmu9x468v0005l204bnn0yoop', excerpt: 'Status?' },
    },
    {
      id: TASK_976,
      identifier: 'AWTD-976',
      title: 'Drop the "inline markdown only" caveat',
      lastComment: { id: 'cmu9xai95000al204y88xh6qn', excerpt: 'Yes. On my phone. Should we close?' },
    },
  ],
  messages: [],
  truncated: true,
  skipped: [],
}

describe('decideQueueVerdict — the queue', () => {
  it('a Ready task is work, whatever else is true', () => {
    const verdict = decideQueueVerdict({
      snapshot: snapshot({ empty: false, queue: [{ id: TASK_904, identifier: 'AWTD-904', title: 'x' }] }),
      lanes: [],
      seen: new Set(),
    })
    expect(verdict.work).toBe(true)
    expect(verdict.reason).toBe('queue')
    expect(verdict.line).toBe('QUEUE: 1 task ready')
  })

  it('an empty board is idle, and says so the way the log already reads', () => {
    const verdict = decideQueueVerdict({ snapshot: snapshot(), lanes: [], seen: new Set() })
    expect(verdict.work).toBe(false)
    expect(verdict.reason).toBe('idle')
    expect(verdict.line).toBe('QUEUE: empty — No incomplete tasks are assigned to claude.')
  })

  it('a queue held by the clock names when it opens', () => {
    const verdict = decideQueueVerdict({
      snapshot: snapshot({
        held: { notDueCount: 1, notReadyCount: 0, scheduled: [{ id: 'x', title: 'Weekly audit', startsAt: '2026-09-25' }] },
      }),
      lanes: [],
      seen: new Set(),
    })
    expect(verdict.work).toBe(false)
    expect(verdict.line).toBe('QUEUE: empty — next task ("Weekly audit") comes due 2026-09-25')
  })
})

describe('decideQueueVerdict — the inbox (AWTD-963 was deaf on a scheduled tick)', () => {
  it('an unanswered human comment on an EMPTY queue is work', () => {
    // The 2026-09-20 case exactly: empty: true, two questions from Jon.
    const verdict = decideQueueVerdict({
      snapshot: snapshot({ attention: jonAsked }),
      lanes: [],
      seen: new Set(),
    })
    expect(verdict.work).toBe(true)
    expect(verdict.reason).toBe('inbox')
    expect(verdict.line).toBe('QUEUE: empty — 2 unanswered comments (AWTD-904, AWTD-976)')
  })

  it('a list-chat reply is work too', () => {
    const verdict = decideQueueVerdict({
      snapshot: snapshot({
        attention: {
          tasks: [],
          messages: [{ id: 'msg-1', content: 'can you look at the board?' }],
          truncated: false,
          skipped: [],
        },
      }),
      lanes: [],
      seen: new Set(),
    })
    expect(verdict.work).toBe(true)
    expect(verdict.reason).toBe('inbox')
    expect(verdict.line).toBe('QUEUE: empty — 1 unanswered list-chat message')
  })

  it('the same comment never wakes a second run', () => {
    // The agent had its chance. If it chose not to answer, that is the
    // answer — a tick that re-runs on it every half hour is the bill this
    // whole guard exists to avoid.
    const first = decideQueueVerdict({ snapshot: snapshot({ attention: jonAsked }), lanes: [], seen: new Set() })
    const second = decideQueueVerdict({
      snapshot: snapshot({ attention: jonAsked }),
      lanes: [],
      seen: new Set(first.keys),
    })
    expect(second.work).toBe(false)
    expect(second.reason).toBe('idle')
    // ...and the log says WHY it is quiet, so a muted question is not mistaken for a missed one.
    expect(second.line).toMatch(/2 unanswered items already woke a run/)
  })

  it('a NEW comment on an already-seen task wakes it again', () => {
    const first = decideQueueVerdict({ snapshot: snapshot({ attention: jonAsked }), lanes: [], seen: new Set() })
    const followUp = {
      ...jonAsked,
      tasks: [
        { ...jonAsked.tasks[0], lastComment: { id: 'a-newer-comment', excerpt: 'Any update?' } },
        jonAsked.tasks[1],
      ],
    }
    const second = decideQueueVerdict({
      snapshot: snapshot({ attention: followUp }),
      lanes: [],
      seen: new Set(first.keys),
    })
    expect(second.work).toBe(true)
    expect(second.line).toBe('QUEUE: empty — 1 unanswered comment (AWTD-904)')
  })

  it('an inbox the token could not read is not an inbox with nothing in it', () => {
    // `attention` is absent on a response from before AWTD-963. Absent is
    // unknown, and unknown must not read as quiet — but it is not a reason to
    // run either; the run could not read it any better.
    const verdict = decideQueueVerdict({ snapshot: snapshot({ attention: undefined }), lanes: [], seen: new Set() })
    expect(verdict.work).toBe(false)
    expect(verdict.line).toMatch(/inbox not read/)
  })
})

describe('decideQueueVerdict — the Waiting lanes (RECHECK / REVIEW are work)', () => {
  const lanes: LaneSnapshot = [
    { id: TASK_976, action: 'recheck', commentWatermark: '2026-09-19T10:00:00.000Z' },
    { id: TASK_904, action: 'review', commentWatermark: null },
  ]

  it('a due recheck or a condition-less Waiting task wakes the run', () => {
    const verdict = decideQueueVerdict({ snapshot: snapshot(), lanes, seen: new Set() })
    expect(verdict.work).toBe(true)
    expect(verdict.reason).toBe('lanes')
    expect(verdict.line).toBe('QUEUE: empty — RECHECK 1 / REVIEW 1 need the agent')
  })

  it('the same lane item, unchanged, wakes only once', () => {
    const first = decideQueueVerdict({ snapshot: snapshot(), lanes, seen: new Set() })
    const second = decideQueueVerdict({ snapshot: snapshot(), lanes, seen: new Set(first.keys) })
    expect(second.work).toBe(false)
  })

  it('a bumped watermark is a new item', () => {
    const first = decideQueueVerdict({ snapshot: snapshot(), lanes, seen: new Set() })
    const bumped: LaneSnapshot = [{ ...lanes[0], commentWatermark: '2026-09-27T10:00:00.000Z' }]
    const second = decideQueueVerdict({ snapshot: snapshot(), lanes: bumped, seen: new Set(first.keys) })
    expect(second.work).toBe(true)
  })

  it('lanes that could not be read are named, not treated as empty', () => {
    const verdict = decideQueueVerdict({ snapshot: snapshot(), lanes: null, seen: new Set() })
    expect(verdict.work).toBe(false)
    expect(verdict.line).toMatch(/lanes not read/)
  })
})

describe('wakeKeys', () => {
  it('is every wake-able item present now, so the seen file prunes itself', () => {
    const keys = wakeKeys(snapshot({ attention: jonAsked }), [
      { id: TASK_976, action: 'recheck', commentWatermark: null },
    ])
    expect(keys).toEqual([
      `comment:${TASK_904}:cmu9x468v0005l204bnn0yoop`,
      `comment:${TASK_976}:cmu9xai95000al204y88xh6qn`,
      `recheck:${TASK_976}:none`,
    ])
  })

  it('is empty on a quiet board', () => {
    expect(wakeKeys(snapshot(), [])).toEqual([])
  })
})
