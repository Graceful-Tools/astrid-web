/**
 * AWTD-882: who gets told when somebody asks for a gated feature.
 *
 * The email itself has existed since task dd7172d8 and works — a probe through
 * the real transport was accepted by the provider, from noreply@astrid.cc to
 * jon@gracefultools.com. What was missing is a case: asking AGAIN after being
 * declined notified nobody.
 *
 * `POST /api/v1/feature-requests` decided with `if (!existing)`. That was meant
 * to suppress one thing — re-posting to edit the use-case note on a request the
 * admin can already see in the queue — and it does. But the row is the person's
 * only row for that feature and it is never deleted, so ONCE ANY ROW EXISTS the
 * notification is off forever, whatever happens next.
 *
 * The tell is in the route as it stood: it selected `status` from the existing
 * row and never read it. The decision was always meant to depend on where the
 * request had got to; only the `!existing` half was written.
 *
 * A declined person is the case that matters. They see the request button
 * again — `granted` is false, so the affordance is right there — they write a
 * better use case, they submit, the dialog thanks them, and nothing reaches
 * anybody. The queue still shows DECLINED, because a re-request deliberately
 * does not resurrect a decision an admin already made. So the one route back
 * after a "no" was a dead end that looked like it worked.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { shouldNotifyFeatureRequest } from '@/lib/feature-access-requests'

describe('shouldNotifyFeatureRequest (AWTD-882)', () => {
  it('notifies for a genuinely new request', () => {
    expect(shouldNotifyFeatureRequest(null)).toBe(true)
    expect(shouldNotifyFeatureRequest(undefined)).toBe(true)
  })

  it('stays quiet while the request is still PENDING — the admin already has it', () => {
    // This is the case `!existing` was written for: re-posting edits the note,
    // and an edited note on a request already sitting in the queue is not worth
    // an email. Unchanged.
    expect(shouldNotifyFeatureRequest({ status: 'PENDING' })).toBe(false)
  })

  it('NOTIFIES when a declined person asks again — the bug', () => {
    // Their row keeps status DECLINED, so without this they can re-request
    // forever and no one ever hears. The dialog says it worked; nothing did.
    expect(shouldNotifyFeatureRequest({ status: 'DECLINED' })).toBe(true)
  })

  it('stays quiet for someone already GRANTED', () => {
    // They have the feature. A post from here changes nothing worth an email,
    // and the UI does not offer them the button in the first place.
    expect(shouldNotifyFeatureRequest({ status: 'GRANTED' })).toBe(false)
  })

  it('notifies on an unrecognised status rather than swallowing it', () => {
    // `status` is a String column, not an enum, so a value this code has not
    // met is possible. Erring towards telling a human beats a silence nobody
    // can distinguish from "nobody asked" — which is the failure mode this
    // whole task exists to remove.
    expect(shouldNotifyFeatureRequest({ status: 'ESCALATED' })).toBe(true)
    expect(shouldNotifyFeatureRequest({ status: '' })).toBe(true)
  })
})

describe('the route delegates the decision (AWTD-882)', () => {
  // The predicate is only worth having if the route asks it. Source-level
  // because exercising the handler means standing up auth and Prisma to prove
  // one call — and because the specific regression to prevent is someone
  // reinstating the inline `if (!existing)`, which is a textual thing.
  const route = readFileSync(
    join(process.cwd(), 'app/api/v1/feature-requests/route.ts'),
    'utf8',
  )

  it('asks shouldNotifyFeatureRequest rather than deciding inline', () => {
    expect(route).toMatch(/if \(shouldNotifyFeatureRequest\(existing\)\)/)
    expect(route).not.toMatch(/if \(!existing\) \{/)
  })

  it('logs a failed notification loudly enough to find later', () => {
    // The row records nothing about whether anyone was told, so this log line
    // is the only evidence a send ever failed. Diagnosing this task meant
    // probing the live transport by hand precisely because it was not there.
    expect(route).toMatch(/notification FAILED/i)
    expect(route).toMatch(/recipient: featureRequestRecipient\(\)/)
  })
})
