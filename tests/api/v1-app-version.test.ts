/**
 * AWTD-920 (backend half of iOS AITD-383): GET /api/v1/app-version.
 *
 * The iOS and Mac Update card is already merged and deliberately INVISIBLE
 * until this endpoint answers — the clients treat every failure, and every
 * response without a `latestVersion` and an `updateUrl`, as "no update known".
 * So this is the switch, and lib/app-version.ts is what it switches on.
 *
 * The two properties worth pinning hardest:
 *
 *  1. PLATFORM IS NEVER GUESSED. iOS and Mac version independently, so
 *     answering the wrong one's number nags whichever app is behind the other,
 *     once per launch, forever. A missing or unknown platform must fail, not
 *     fall back.
 *  2. AN UNOPENABLE updateUrl IS DROPPED. The value ends up in `openURL` on
 *     the client, which accepts only four schemes. A card the user cannot be
 *     sent anywhere from is worse than no card, so a bad URL degrades to "no
 *     update known" rather than shipping a dead button.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {
    constructor(msg = 'Unauthorized') { super(msg); this.name = 'UnauthorizedError' }
  }
  class ForbiddenError extends Error {
    constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError' }
  }
  return {
    authenticateAPI: vi.fn(),
    requireScopes: vi.fn(),
    getDeprecationWarning: vi.fn(() => null),
    UnauthorizedError,
    ForbiddenError,
  }
})

/**
 * Mac resolves from GitHub Releases at request time (AWTD-942), so the route
 * would otherwise make a real network call. Mocked to a known release so the
 * assertions are about the SHAPE the endpoint serves, not about what happens
 * to be published today.
 */
const fetchLatestMacRelease = vi.hoisted(() => vi.fn())
vi.mock('@/lib/mac-release', () => ({
  fetchLatestMacRelease,
  MAC_RELEASE_REPO: 'Graceful-Tools/astrid-ios',
  MAC_RELEASES_FALLBACK_URL: 'https://github.com/Graceful-Tools/astrid-ios/releases/latest',
}))

import { GET } from '@/app/api/v1/app-version/route'
import { brandOrigin } from '@/lib/brand/config'
import { authenticateAPI, UnauthorizedError } from '@/lib/api-auth-middleware'
import {
  APP_PLATFORMS,
  appVersionFor,
  isAllowedUpdateUrl,
  parseAppPlatform,
  RELEASED_APP_VERSIONS,
  shapeAppVersionInfo,
} from '@/lib/app-version'

const mockAuth = vi.mocked(authenticateAPI)

const sessionCaller = (userId: string) => ({
  userId, source: 'session' as const, scopes: ['*'], isAIAgent: false,
  user: { id: userId, email: 'u@example.com', name: null, isAIAgent: false },
})

function get(query: string) {
  return GET(new NextRequest(`http://localhost/api/v1/app-version${query}`) as never, {} as never)
}

describe('GET /api/v1/app-version (AWTD-920)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(sessionCaller('user-1') as never)
    fetchLatestMacRelease.mockResolvedValue({
      version: '1.0.3',
      url: 'https://github.com/Graceful-Tools/astrid-ios/releases/download/mac-v1.0.3/Astrid-Mac-1.0.3.dmg',
      size: '42 MB',
      published: 'July 29, 2026',
    })
  })

  it('requires authentication, like the rest of /api/v1', async () => {
    mockAuth.mockRejectedValue(new UnauthorizedError('no session'))
    expect((await get('?platform=ios')).status).toBe(401)
  })

  it('answers 200 for platform=ios, from the static store table', async () => {
    const response = await get('?platform=ios')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(appVersionFor('ios'))
  })

  it('answers 200 for platform=mac, from the resolved GitHub release', async () => {
    const response = await get('?platform=mac')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      latestVersion: '1.0.3',
      updateUrl: `${brandOrigin()}/download`,
    })
  })

  it('sends Mac users to the download page, never to the iOS App Store', async () => {
    // The bug this replaces: a Mac update card that opened an iOS listing with
    // no Mac download on it (AWTD-942).
    const body = await (await get('?platform=mac')).json()
    expect(body.updateUrl).not.toMatch(/apps\.apple\.com/)
  })

  it('shows no Mac card at all when GitHub cannot be reached', async () => {
    // Degrade to silence, never to a guess: the clients read a missing
    // latestVersion as "no update known".
    fetchLatestMacRelease.mockResolvedValue(null)
    const response = await get('?platform=mac')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({})
  })

  describe('an unknown or missing platform fails safely (AWTD-920)', () => {
    // "never a wrong platform's version" — the acceptance criterion that
    // protects users from being nagged to downgrade.
    it.each([
      ['missing', ''],
      ['empty', '?platform='],
      ['unknown', '?platform=android'],
      ['almost right', '?platform=iOS'],
      ['a near miss', '?platform=macos'],
    ])('%s -> 400', async (_label, query) => {
      const response = await get(query)
      expect(response.status).toBe(400)
    })

    it('never falls back to the other platform', async () => {
      const body = await (await get('?platform=android')).json()
      expect(body.latestVersion).toBeUndefined()
      expect(body.updateUrl).toBeUndefined()
    })
  })
})

describe('the released-version table (AWTD-920)', () => {
  /**
   * This case used to assert the table shipped EMPTY — a deliberate tripwire so
   * that filling it in could not happen without someone reading the warnings
   * above it. AWTD-924 filled it in, so the tripwire has done its job and is
   * replaced by assertions about the real row.
   *
   * iOS is verified against the iTunes lookup API for id 6755752694: trackName
   * `Astrid Tasks`, sellerName `Graceful Tools LLC`, version 1.9.2.
   *
   * That the lookup could not corroborate a Mac number was the tell AWTD-924
   * missed — not a gap to fill from App Store Connect, but evidence there is no
   * Mac listing at all (`kind: software`, not `mac-software`). Mac ships as a
   * DMG and no longer has a row here (AWTD-942).
   */
  it('answers iOS with the released store version and a verified store link', () => {
    expect(appVersionFor('ios')).toEqual({
      latestVersion: '1.9.2',
      updateUrl: 'https://apps.apple.com/us/app/astrid-tasks/id6755752694',
    })
  })

  it('survives the shaping, so the iOS row is not silently dropped on the way out', () => {
    // appVersionFor runs the table through shapeAppVersionInfo, which discards
    // an updateUrl the client could not open. A row that was configured but
    // arrives without its link is the exact "dead button" failure this guards.
    const shaped = appVersionFor('ios')
    expect(shaped.latestVersion).toBeTruthy()
    expect(shaped.updateUrl).toBeTruthy()
  })

  /**
   * AWTD-942. This is the case that would have caught the bug.
   *
   * AWTD-924 hardcoded mac as `latestVersion: '1.1.1'` pointing at the iOS App
   * Store, reading `supportedDevices: [MacDesktop-…]` on id 6755752694 as "one
   * listing serves both platforms". It does not: that field means the iOS build
   * runs on Apple silicon. The Mac app is a notarized DMG on GitHub Releases,
   * where the newest was 1.0.3 — so every Mac user was told 1.1.1 was available
   * and sent to a page with no Mac download on it.
   *
   * The static row must stay EMPTY: Mac is resolved at request time.
   */
  it('never hardcodes a Mac version, because Mac is not on the App Store', () => {
    expect(RELEASED_APP_VERSIONS.mac).toEqual({})
  })

  it('never points Mac at the iOS App Store listing', () => {
    // The specific dead end that shipped. Any apps.apple.com URL for mac is
    // wrong while the Mac app is distributed as a DMG.
    expect(RELEASED_APP_VERSIONS.mac.updateUrl ?? '').not.toMatch(/apps\.apple\.com/)
  })

  it('gives each platform its own row, because they release independently', () => {
    expect(Object.keys(RELEASED_APP_VERSIONS).sort()).toEqual([...APP_PLATFORMS].sort())
  })

  it('whatever is configured has an openable updateUrl', () => {
    // Guards the table itself rather than the code: a row with a link the
    // client refuses to open is a card with a dead button.
    for (const platform of APP_PLATFORMS) {
      const url = RELEASED_APP_VERSIONS[platform].updateUrl
      if (url) expect(isAllowedUpdateUrl(url)).toBe(true)
    }
  })

  it('a row with latestVersion but no updateUrl still shows no card', () => {
    // Stated in the task as load-bearing: "No updateUrl -> no card, even when
    // latestVersion is newer." Asserted through the shaping seam rather than
    // the table, which now has a link in every row — going through
    // appVersionFor could no longer exercise the missing-URL case at all.
    const shaped = shapeAppVersionInfo({ latestVersion: '9.9.9' })
    expect(shaped.latestVersion).toBe('9.9.9')
    expect(shaped.updateUrl).toBeUndefined()
  })
})

describe('parseAppPlatform (AWTD-920)', () => {
  it.each([...APP_PLATFORMS])('accepts %s', p => expect(parseAppPlatform(p)).toBe(p))

  it.each([null, undefined, '', 'android', 'IOS', 'ios ', 'watchos'])(
    'rejects %p rather than guessing',
    value => expect(parseAppPlatform(value as string | null)).toBeNull(),
  )
})

describe('isAllowedUpdateUrl (AWTD-920)', () => {
  it.each([
    'https://apps.apple.com/app/id123456789',
    'http://example.com/download',
    'macappstore://apps.apple.com/app/id123456789',
    'itms-apps://itunes.apple.com/app/id123456789',
  ])('allows %s', url => expect(isAllowedUpdateUrl(url)).toBe(true))

  it.each([
    'javascript:alert(1)',
    'file:///etc/passwd',
    'data:text/html,<script>alert(1)</script>',
    'ftp://example.com/app.zip',
    'not a url',
    '',
  ])('refuses %p — it ends up in openURL on the client', url => {
    expect(isAllowedUpdateUrl(url)).toBe(false)
  })

  it('drops an unopenable updateUrl rather than passing it through', () => {
    // The degradation that matters: no URL means no card, which is right. A
    // dead button would not be. The rest of the row survives — only the link
    // is discarded.
    const shaped = shapeAppVersionInfo({
      latestVersion: '1.9.2',
      updateUrl: 'javascript:alert(1)',
      releaseNotes: 'notes',
    })
    expect(shaped.updateUrl).toBeUndefined()
    expect(shaped.latestVersion).toBe('1.9.2')
    expect(shaped.releaseNotes).toBe('notes')
  })

  it('keeps an openable updateUrl, so the shaping is not simply dropping everything', () => {
    const url = 'https://apps.apple.com/app/id123456789'
    expect(shapeAppVersionInfo({ latestVersion: '1.9.2', updateUrl: url }).updateUrl).toBe(url)
  })

  it('omits absent fields rather than sending nulls', () => {
    // Every field decodes as optional on the client, so the smallest honest
    // answer is an empty object — not four nulls.
    expect(shapeAppVersionInfo({})).toEqual({})
    expect(Object.keys(shapeAppVersionInfo({ latestVersion: '1.0.0' }))).toEqual(['latestVersion'])
  })
})
