/**
 * AWTD-989 — the generators and the telemetry normaliser must agree.
 *
 * AWTD-984 stopped invite tokens and share shortcodes landing in
 * `LegacyApiDailyUsage.route` and `WebVitalSample.route`, but it did so by
 * TRANSCRIBING the shapes into `lib/legacy-api-usage.ts`: `/^inv_[0-9a-f]{32}$/i`
 * copied out of the invite generator, `/^[0-9A-Za-z]{8}$/` copied out of the
 * shortcode one. Two copies of a fact drift, and this pair drifts silently in
 * the worst direction: links keep generating in the new shape while telemetry
 * stops recognising it, and the raw bearer credential goes back into the
 * database.
 *
 * So the shapes now live in `lib/invite-token-format.ts` and
 * `lib/shortcode-format.ts`, and these tests hold the round trip shut — they
 * run the REAL generators and require the REAL normaliser to strip what they
 * produce. Widening either generator without telling the normaliser fails here.
 */

import { describe, expect, it, vi } from 'vitest'

// lib/shortcode.ts and lib/list-invite.ts both import Prisma. Nothing in these
// tests touches the database — only the pure generator each module exports.
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/email', () => ({
  sendListInvitationEmail: vi.fn(),
  sendInvitationEmail: vi.fn(),
}))

import { generateShortcode } from '@/lib/shortcode'
import { generateInvitationToken } from '@/lib/list-invite'
import { normalizeLegacyRoute } from '@/lib/legacy-api-usage'
import { isShortcode, SHORTCODE_LENGTH } from '@/lib/shortcode-format'
import { isInviteToken } from '@/lib/invite-token-format'

describe('credential shapes are shared, not transcribed (AWTD-989)', () => {
  it('strips a token the real invite generator just minted', () => {
    for (let i = 0; i < 50; i++) {
      const token = generateInvitationToken()

      expect(isInviteToken(token)).toBe(true)
      expect(normalizeLegacyRoute(`/api/invitations/${token}`)).toBe('/api/invitations/:id')
      // Not only under its own route: an invite token is a credential wherever
      // it turns up, so the shape has to carry on its own too.
      expect(normalizeLegacyRoute(`/api/lists/${token}/thing`)).toBe('/api/lists/:id/thing')
    }
  })

  it('strips a code the real shortcode generator just minted', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateShortcode()

      expect(code).toHaveLength(SHORTCODE_LENGTH)
      expect(isShortcode(code)).toBe(true)
      expect(normalizeLegacyRoute(`/s/${code}`)).toBe('/s/:id')
      expect(normalizeLegacyRoute(`/api/v1/shortcodes/${code}`)).toBe('/api/v1/shortcodes/:id')
    }
  })

  it('still leaves a real route word alone under a shortcode-bearing parent', () => {
    // The shape is only half the rule. "settings" is eight characters from the
    // shortcode alphabet, and collapsing it would cost us the route name.
    expect(isShortcode('settings')).toBe(true)
    expect(normalizeLegacyRoute('/api/downloads/settings')).toBe('/api/downloads/settings')
  })

  it('rejects a segment using a character the shortcode alphabet does not contain', () => {
    // Derived from SHORTCODE_ALPHABET rather than restated as [0-9A-Za-z], so
    // this is the assertion that would change if the alphabet ever widened.
    expect(isShortcode('abcdef-h')).toBe(false)
    expect(isShortcode('abcdefg')).toBe(false)
  })
})
