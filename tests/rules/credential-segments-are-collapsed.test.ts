/**
 * RULE — AWTD-989 (follow-up to AWTD-984).
 *
 * `normalizeLegacyRoute` strips id segments out of a path before it is stored
 * in `LegacyApiDailyUsage.route` and `WebVitalSample.route`. Most segments are
 * collapsed by SHAPE — a uuid, a cuid, digits. Two kinds cannot be:
 *
 *   - A **shortcode** is eight alphanumerics, and so is the word "settings".
 *     Collapsing by shape alone would eat real route names, so it is collapsed
 *     only under a parent named in `SHORTCODE_PARENTS`.
 *   - An **invite token** has whatever shape whoever minted it chose. Three
 *     generators wrote `Invitation.token`, and one of them (the placeholder-user
 *     path) emitted 64 raw hex with no prefix for years — a shape the `inv_`
 *     matcher missed entirely, landing verbatim in telemetry. Those are
 *     collapsed by POSITION, under a parent named in `CREDENTIAL_PARENTS`.
 *
 * Both of those are ALLOWLISTS, and an allowlist that nobody re-reads is how
 * AWTD-984 shipped believing it had covered invitations. So this rule walks the
 * route tree and makes it self-checking in both directions:
 *
 *   1. every dynamic segment on disk is classified here, so a NEW route cannot
 *      be added without someone deciding whether its segment is a credential;
 *   2. every entry in the two sets still corresponds to a route that exists, so
 *      renaming `/s` or deleting `/api/invitations` cannot leave a set entry
 *      silently matching nothing.
 *
 * This is a classification of intent — a test cannot look at `[token]` and know
 * it is a bearer credential. What it CAN do is refuse to let the question go
 * unasked.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { CREDENTIAL_PARENTS, SHORTCODE_PARENTS } from '@/lib/legacy-api-usage'

const ROOT = process.cwd()

type Classification =
  /** A uuid / cuid / numeric id — already collapsed by shape, no allowlist needed. */
  | 'opaque-id'
  /** A closed vocabulary of real words (a locale, a feature key). Not an id at all. */
  | 'route-word'
  /** An 8-char share shortcode. Parent MUST be in SHORTCODE_PARENTS. */
  | 'shortcode'
  /** A bearer credential of any shape. Parent MUST be in CREDENTIAL_PARENTS. */
  | 'credential'

/**
 * Keyed by the PARENT directory of the dynamic segment, because that is the
 * only thing `normalizeLegacyRoute` can see at runtime — by then `[token]` has
 * become the token itself, and all that is left of the route's intent is the
 * segment in front of it.
 */
const DYNAMIC_SEGMENT_PARENTS: Record<string, Classification> = {
  // Credentials — collapsed by position, whatever shape the token has.
  invitations: 'credential', // app/api/invitations/[token]
  invite: 'credential', //      app/[locale]/invite/[token]

  // Share links — 8-char nanoid, collapsed by shape only under these parents.
  s: 'shortcode', //          app/[locale]/s/[code]
  shortcodes: 'shortcode', // app/api{,/v1}/shortcodes/[code]

  // Real words, deliberately kept in the route string: they are what makes the
  // telemetry readable, and none of them is a secret.
  app: 'route-word', //         app/[locale]
  auth: 'route-word', //        [...nextauth] — NextAuth's own action names
  features: 'route-word', //    an admin feature-flag key
  fullpage: 'route-word', //    a settings page name
  downloads: 'route-word', //   a release filename
  'agent-icon': 'route-word', // an agent slug
  connections: 'route-word', //  a connection KIND (google, github)

  // Opaque record ids — uuid or cuid, collapsed by shape before the parent is
  // ever consulted.
  admins: 'opaque-id',
  agents: 'opaque-id',
  channels: 'opaque-id',
  chat: 'opaque-id', // app/api/v1/agent/chat/[channelId]
  clients: 'opaque-id', // OAuth client_id — public by design, not a secret
  comments: 'opaque-id',
  '[kind]': 'opaque-id', // see "nested dynamic segments" below
  list: 'opaque-id',
  lists: 'opaque-id',
  members: 'opaque-id',
  messages: 'opaque-id',
  passkeys: 'opaque-id', // the credential ROW id, not the credential
  progress: 'opaque-id',
  projects: 'opaque-id',
  reminders: 'opaque-id',
  'secure-files': 'opaque-id',
  status: 'opaque-id',
  tasks: 'opaque-id',
  u: 'opaque-id',
  users: 'opaque-id',
}

function isDynamic(name: string): boolean {
  return name.startsWith('[') && name.endsWith(']')
}

/** Every `[segment]` directory under app/, as [parentName, fullPath]. */
function dynamicSegments(dir: string, out: Array<[string, string]> = []): Array<[string, string]> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const full = join(dir, entry.name)
    if (isDynamic(entry.name)) {
      out.push([dir.slice(ROOT.length + 1).split('/').pop() ?? '', full.slice(ROOT.length + 1)])
    }
    dynamicSegments(full, out)
  }
  return out
}

const SEGMENTS = dynamicSegments(join(ROOT, 'app'))

describe('every dynamic route segment is classified for telemetry (AWTD-989)', () => {
  it('finds the route tree at all', () => {
    // A silent zero here would make every assertion below vacuously true, which
    // is the one way this rule could pass while protecting nothing.
    expect(SEGMENTS.length).toBeGreaterThan(20)
  })

  it('classifies every dynamic segment that exists on disk', () => {
    const unclassified = SEGMENTS.filter(
      ([parent]) => DYNAMIC_SEGMENT_PARENTS[parent] === undefined,
    ).map(([parent, path]) => `${path} (parent "${parent}")`)

    expect(
      unclassified,
      'A new dynamic route appeared. Decide what travels in that segment and add its ' +
        'PARENT to DYNAMIC_SEGMENT_PARENTS: an opaque record id collapses by shape ' +
        'already; a bearer credential must also join CREDENTIAL_PARENTS in ' +
        'lib/legacy-api-usage.ts, or it lands in telemetry verbatim.',
    ).toEqual([])
  })

  it('keeps SHORTCODE_PARENTS exactly equal to the routes classified as shortcodes', () => {
    const declared = Object.entries(DYNAMIC_SEGMENT_PARENTS)
      .filter(([, kind]) => kind === 'shortcode')
      .map(([parent]) => parent)
      .sort()

    expect([...SHORTCODE_PARENTS].sort()).toEqual(declared)
  })

  it('keeps CREDENTIAL_PARENTS exactly equal to the routes classified as credentials', () => {
    const declared = Object.entries(DYNAMIC_SEGMENT_PARENTS)
      .filter(([, kind]) => kind === 'credential')
      .map(([parent]) => parent)
      .sort()

    expect([...CREDENTIAL_PARENTS].sort()).toEqual(declared)
  })

  it('has no classified parent that no longer exists on disk', () => {
    const onDisk = new Set(SEGMENTS.map(([parent]) => parent))
    const orphans = Object.keys(DYNAMIC_SEGMENT_PARENTS).filter(parent => !onDisk.has(parent))

    expect(
      orphans,
      'These parents are classified but own no dynamic route any more. If one is in ' +
        'SHORTCODE_PARENTS or CREDENTIAL_PARENTS it is now matching nothing — delete ' +
        'it from both places, or fix the name it was renamed to.',
    ).toEqual([])
  })

  it('never classifies a nested dynamic segment as shortcode- or credential-bearing', () => {
    // `/api/v1/users/me/connections/[kind]/[id]` — at runtime the parent of
    // `[id]` is whatever `[kind]` resolved to ("google"), so there is no fixed
    // name a parent allowlist could hold. Position-based collapsing is simply
    // not expressible there; such a segment has to be collapsible by SHAPE.
    const nested = SEGMENTS.filter(([parent]) => isDynamic(parent))
      .filter(([parent]) => {
        const kind = DYNAMIC_SEGMENT_PARENTS[parent]
        return kind === 'shortcode' || kind === 'credential'
      })
      .map(([parent, path]) => `${path} (parent "${parent}")`)

    expect(
      nested,
      'A credential under a dynamic parent cannot be collapsed by position. Give it a ' +
        'shape normalizeLegacyRoute recognises, or a static parent segment.',
    ).toEqual([])
  })
})
