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
 *
 * (The Waiting lanes were a third input — the client-side sweep's RECHECK/REVIEW
 * items. The server's settle job wakes Waiting tasks now, so a woken task simply
 * arrives in the queue and the verdict no longer reads lanes at all.)
 *
 * The other half of "token efficient" is that waking must be bounded. An
 * item the agent chose not to answer (a "thanks") would otherwise start a
 * session every half hour, forever. So a wake key is spent once: the same
 * comment id never wakes a second run. A NEW comment does.
 */

import { describe, it, expect } from 'vitest'
import {
  decideQueueVerdict,
  wakeKeys,
  type QueueSnapshot,
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
      seen: new Set(),
    })
    expect(verdict.work).toBe(true)
    expect(verdict.reason).toBe('queue')
    expect(verdict.line).toBe('QUEUE: 1 task ready')
  })

  it('an empty board is idle, and says so the way the log already reads', () => {
    const verdict = decideQueueVerdict({ snapshot: snapshot(), seen: new Set() })
    expect(verdict.work).toBe(false)
    expect(verdict.reason).toBe('idle')
    expect(verdict.line).toBe('QUEUE: empty — No incomplete tasks are assigned to claude.')
  })

  it('a queue held by the clock names when it opens', () => {
    const verdict = decideQueueVerdict({
      snapshot: snapshot({
        held: { notDueCount: 1, notReadyCount: 0, scheduled: [{ id: 'x', title: 'Weekly audit', startsAt: '2026-09-25' }] },
      }),
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
    const first = decideQueueVerdict({ snapshot: snapshot({ attention: jonAsked }), seen: new Set() })
    const second = decideQueueVerdict({
      snapshot: snapshot({ attention: jonAsked }),
      seen: new Set(first.keys),
    })
    expect(second.work).toBe(false)
    expect(second.reason).toBe('idle')
    // ...and the log says WHY it is quiet, so a muted question is not mistaken for a missed one.
    expect(second.line).toMatch(/2 unanswered items already woke a run/)
  })

  it('a NEW comment on an already-seen task wakes it again', () => {
    const first = decideQueueVerdict({ snapshot: snapshot({ attention: jonAsked }), seen: new Set() })
    const followUp = {
      ...jonAsked,
      tasks: [
        { ...jonAsked.tasks[0], lastComment: { id: 'a-newer-comment', excerpt: 'Any update?' } },
        jonAsked.tasks[1],
      ],
    }
    const second = decideQueueVerdict({
      snapshot: snapshot({ attention: followUp }),
      seen: new Set(first.keys),
    })
    expect(second.work).toBe(true)
    expect(second.line).toBe('QUEUE: empty — 1 unanswered comment (AWTD-904)')
  })

  it('an inbox the token could not read is not an inbox with nothing in it', () => {
    // `attention` is absent on a response from before AWTD-963. Absent is
    // unknown, and unknown must not read as quiet — but it is not a reason to
    // run either; the run could not read it any better.
    const verdict = decideQueueVerdict({ snapshot: snapshot({ attention: undefined }), seen: new Set() })
    expect(verdict.work).toBe(false)
    expect(verdict.line).toMatch(/inbox not read/)
  })
})

describe('wakeKeys', () => {
  it('is every wake-able item present now, so the seen file prunes itself', () => {
    const keys = wakeKeys(snapshot({ attention: jonAsked }))
    expect(keys).toEqual([
      `comment:${TASK_904}:cmu9x468v0005l204bnn0yoop`,
      `comment:${TASK_976}:cmu9xai95000al204y88xh6qn`,
    ])
  })

  it('is empty on a quiet board', () => {
    expect(wakeKeys(snapshot())).toEqual([])
  })
})
