/**
 * The retirement coverage map (task 641a7615, step 4).
 *
 * This exists because I got the same question wrong twice by hand in one
 * session: I reported `/api/secure-files` and `/api/chat` as having no v1
 * successor when both had full coverage, and both times that hid the easiest
 * remaining work rather than creating any visible error.
 *
 * What matters is the classification, because it separates the two reasons a
 * legacy route is still here — waiting on TRAFFIC EVIDENCE (successor exists,
 * nothing calls it) versus waiting on a DECISION (no successor, clients depend
 * on it). Conflating those is what makes this task look perpetually startable.
 */

import { describe, it, expect } from 'vitest'
import {
  routeFileToApiPath,
  v1PathFor,
  classifyRoute,
  summarize,
  matchLiteralToRoute,
  type RouteCoverage,
} from '@/lib/legacy-api-coverage'

describe('routeFileToApiPath (task 641a7615)', () => {
  it('reads the api path out of a route file', () => {
    expect(routeFileToApiPath('app/api/lists/route.ts')).toBe('/api/lists')
  })

  it('keeps dynamic segments as written', () => {
    // They stay bracketed on purpose: the report is read against the source
    // tree, and `[id]` is what someone greps for.
    expect(routeFileToApiPath('app/api/lists/[id]/members/route.ts')).toBe(
      '/api/lists/[id]/members'
    )
  })

  it('handles a nested dynamic route', () => {
    expect(routeFileToApiPath('app/api/lists/[id]/members/[userId]/route.ts')).toBe(
      '/api/lists/[id]/members/[userId]'
    )
  })

  it('handles a catch-all segment', () => {
    expect(routeFileToApiPath('app/api/auth/[...nextauth]/route.ts')).toBe(
      '/api/auth/[...nextauth]'
    )
  })
})

describe('v1PathFor (task 641a7615)', () => {
  it('inserts the version segment', () => {
    expect(v1PathFor('/api/lists/[id]')).toBe('/api/v1/lists/[id]')
  })

  it('only rewrites the leading /api/, not a later occurrence', () => {
    // Contrived, but a blanket replace would corrupt any path repeating the
    // segment, and this map is only useful if its paths are exact.
    expect(v1PathFor('/api/proxy/api/thing')).toBe('/api/v1/proxy/api/thing')
  })
})

describe('classifyRoute (task 641a7615)', () => {
  it('separates "waiting on evidence" from "waiting on a decision"', () => {
    // The whole point. Both are "still here", for completely different reasons.
    expect(classifyRoute({ apiPath: '/api/lists', hasV1: true, callerCount: 0 })).toBe(
      'awaiting-traffic-evidence'
    )
    expect(classifyRoute({ apiPath: '/api/account', hasV1: false, callerCount: 8 })).toBe(
      'needs-decision'
    )
  })

  it('flags a successor that clients have not moved onto yet', () => {
    expect(classifyRoute({ apiPath: '/api/tasks', hasV1: true, callerCount: 3 })).toBe(
      'callers-remain'
    )
  })

  it('flags a route nothing calls and nothing replaces', () => {
    expect(
      classifyRoute({ apiPath: '/api/user/mcp-settings', hasV1: false, callerCount: 0 })
    ).toBe('unused-no-successor')
  })

  it('excludes internal infrastructure regardless of callers', () => {
    // cron/admin/mcp are not part of the retirement at all; counting them would
    // inflate the very census this feeds.
    expect(classifyRoute({ apiPath: '/api/cron/reminders', hasV1: false, callerCount: 3 })).toBe(
      'out-of-scope'
    )
    expect(classifyRoute({ apiPath: '/api/admin/users', hasV1: false, callerCount: 9 })).toBe(
      'out-of-scope'
    )
  })

  it('excludes the permanently exempt auth routes', () => {
    // decision 2: NextAuth's mount and the passkey routes can never be deleted.
    expect(
      classifyRoute({ apiPath: '/api/auth/[...nextauth]', hasV1: false, callerCount: 5 })
    ).toBe('out-of-scope')
    expect(
      classifyRoute({ apiPath: '/api/auth/webauthn/passkeys', hasV1: false, callerCount: 2 })
    ).toBe('out-of-scope')
  })

  it('keeps a migratable auth route in scope', () => {
    // The exemption is per-route, not the whole /api/auth/ prefix.
    expect(classifyRoute({ apiPath: '/api/auth/apple', hasV1: true, callerCount: 0 })).toBe(
      'awaiting-traffic-evidence'
    )
  })

  it('never classifies a v1 path as legacy', () => {
    expect(classifyRoute({ apiPath: '/api/v1/tasks', hasV1: false, callerCount: 4 })).toBe(
      'out-of-scope'
    )
  })
})

describe('summarize (task 641a7615)', () => {
  it('counts every status, including the ones with no routes', () => {
    // A zero has to render as a zero — an absent key reads as "not measured",
    // which is the opposite of what an empty bucket means here.
    const routes: RouteCoverage[] = [
      { apiPath: '/api/a', v1Path: '/api/v1/a', hasV1: true, callerCount: 0, status: 'awaiting-traffic-evidence' },
      { apiPath: '/api/b', v1Path: '/api/v1/b', hasV1: false, callerCount: 2, status: 'needs-decision' },
      { apiPath: '/api/c', v1Path: '/api/v1/c', hasV1: false, callerCount: 1, status: 'needs-decision' },
    ]

    expect(summarize(routes)).toEqual({
      'needs-decision': 2,
      'callers-remain': 0,
      'unused-no-successor': 0,
      'awaiting-traffic-evidence': 1,
      'out-of-scope': 0,
    })
  })
})

/**
 * Attributing a URL literal to the route that serves it.
 *
 * The naive version of this counted wrong twice while I was building it. First
 * `/api/lists` swallowed every sub-route because `/` was allowed to terminate
 * a match; then `/api/lists/public` was credited to `/api/lists/[id]`, because
 * a static sibling matches a dynamic pattern perfectly well. Both inflated the
 * "still has callers" column, which is the column that decides whether a route
 * can be deleted.
 */
describe('matchLiteralToRoute (task 641a7615)', () => {
  const routes = [
    '/api/lists',
    '/api/lists/public',
    '/api/lists/[id]',
    '/api/lists/[id]/members',
    '/api/lists/[id]/members/[userId]',
    '/api/auth/[...nextauth]',
  ]

  it('prefers the static route over a dynamic one that also matches', () => {
    expect(matchLiteralToRoute('/api/lists/public', routes)).toBe('/api/lists/public')
  })

  it('attributes a real id to the dynamic route', () => {
    expect(matchLiteralToRoute('/api/lists/abc123', routes)).toBe('/api/lists/[id]')
  })

  it('does not let a parent swallow its sub-routes', () => {
    expect(matchLiteralToRoute('/api/lists/abc/members', routes)).toBe('/api/lists/[id]/members')
  })

  it('picks the deeper route when both could match', () => {
    expect(matchLiteralToRoute('/api/lists/abc/members/u1', routes)).toBe(
      '/api/lists/[id]/members/[userId]'
    )
  })

  it('matches the collection route exactly', () => {
    expect(matchLiteralToRoute('/api/lists', routes)).toBe('/api/lists')
  })

  it('lets a catch-all take the remainder', () => {
    expect(matchLiteralToRoute('/api/auth/callback/google', routes)).toBe('/api/auth/[...nextauth]')
  })

  it('returns null when nothing serves it', () => {
    expect(matchLiteralToRoute('/api/nope', routes)).toBeNull()
  })
})
