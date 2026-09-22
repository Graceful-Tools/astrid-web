/**
 * The SHAPE of a share shortcode, in one place (AWTD-989).
 *
 * A shortcode is a bearer link to a shared task or list, so — exactly as with
 * `lib/invite-token-format.ts` — its generator (`lib/shortcode.ts`) and the
 * telemetry normaliser that has to strip it (`lib/legacy-api-usage.ts`) must
 * agree about what one looks like. They used to hold two hand-copied
 * definitions: `SHORTCODE_LENGTH`/`SHORTCODE_ALPHABET` in the generator and a
 * transcribed `/^[0-9A-Za-z]{8}$/` in the normaliser.
 *
 * ZERO imports, deliberately — `lib/shortcode.ts` imports Prisma, and
 * `lib/legacy-api-usage.ts` runs in the edge middleware and ships to the
 * browser. This module is the prisma-free leaf they can both reach.
 */

export const SHORTCODE_LENGTH = 8

/**
 * Alphanumerics only: a shortcode is read aloud and typed by hand, and a
 * URL-safe nanoid alphabet would put `-` and `_` in both of those paths.
 */
export const SHORTCODE_ALPHABET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

const ALPHABET_CHARS = new Set(SHORTCODE_ALPHABET)

/**
 * Derived from the alphabet itself rather than restated as a character class,
 * so adding a character to `SHORTCODE_ALPHABET` widens the matcher in the same
 * edit. A regex here would be a second definition of the same fact — which is
 * the bug this module exists to remove.
 *
 * Shape alone is NOT sufficient to treat a segment as a credential: real route
 * words are 8 alphanumeric characters too ("settings", "projects"). Callers
 * must also know the segment sits where a shortcode goes — see
 * `SHORTCODE_PARENTS` in `lib/legacy-api-usage.ts`.
 */
export function isShortcode(segment: string): boolean {
  if (segment.length !== SHORTCODE_LENGTH) return false
  for (const char of segment) {
    if (!ALPHABET_CHARS.has(char)) return false
  }
  return true
}
