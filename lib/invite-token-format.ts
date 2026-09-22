/**
 * The SHAPE of an invitation token, in one place (AWTD-989).
 *
 * An invite token is a bearer credential: redeeming one accepts the invitation.
 * Two places therefore care about its shape, and they have to agree —
 * `lib/list-invite.ts` mints it, and `lib/legacy-api-usage.ts` collapses it out
 * of telemetry so it never lands in `LegacyApiDailyUsage.route` verbatim
 * (AWTD-984). The second of those transcribed the regex from the first by hand,
 * which meant the shape could change in the generator while the normaliser kept
 * matching the old one — share links would keep working and the credential
 * would quietly go back into the database.
 *
 * ZERO imports, deliberately, and no Prisma anywhere in the chain:
 * `lib/legacy-api-usage.ts` reaches the client bundle via `lib/web-vitals.ts` →
 * `components/web-vitals-reporter.tsx`, and it runs in the edge middleware.
 * Adding one Prisma-importing module to that chain 500'd every request for
 * ~12 minutes once already.
 *
 * The generator lives in `lib/list-invite.ts` rather than here, because minting
 * needs `crypto.randomBytes` and this module must stay importable from a
 * browser bundle.
 */

/** Marks the token as ours at a glance, in logs and in support requests. */
export const INVITE_TOKEN_PREFIX = 'inv_'

/** 16 bytes = 128 bits of entropy, hex-encoded. */
export const INVITE_TOKEN_BYTES = 16

/** Hex is two characters per byte. */
export const INVITE_TOKEN_HEX_LENGTH = INVITE_TOKEN_BYTES * 2

/**
 * Built from the constants above rather than written out, so widening the token
 * cannot leave the matcher behind. No `g` flag — a stateful `lastIndex` would
 * make `test()` answer differently on alternate calls.
 */
export const INVITE_TOKEN_PATTERN = new RegExp(
  `^${INVITE_TOKEN_PREFIX}[0-9a-f]{${INVITE_TOKEN_HEX_LENGTH}}$`,
  'i',
)

/** Does this path segment look like an invite token we issued? */
export function isInviteToken(segment: string): boolean {
  return INVITE_TOKEN_PATTERN.test(segment)
}
