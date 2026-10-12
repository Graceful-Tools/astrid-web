/**
 * `?omit=` for GET /api/v1/tasks — AWTD-1236, implementing the decision on
 * AWTD-1233.
 *
 * That route does two jobs: it is the list view's read AND the clients' full
 * sync. Measured 2026-10-12, `?limit=1000` was 551.8 KiB on the wire against a
 * 500 KiB budget, and `description` was 443.3 KiB of it — 80%. A list view
 * needs titles; only the sync needs descriptions, and today the list view pays
 * for the sync's payload on every fetch.
 *
 * So the field becomes OPT-OUT rather than optional: every existing caller
 * keeps the response it has today, and each client drops the bytes when it has
 * somewhere else to read a description from. That is the whole reason this is
 * `omit` and not `include` — an `include` list would have broken all four
 * clients on the day it shipped.
 */

/**
 * The fields a caller may drop. A whitelist rather than a free-form field
 * mask: `id`, `title`, the status fields and `lists.ownerId` carry identity
 * and permission, and a response missing those is not a lean response, it is
 * a broken one.
 *
 * `listMembers` is here because `leanListMembers=1` already did exactly this
 * and nothing should have two spellings (CLAUDE.md rule 6). The old parameter
 * keeps working; this is the one to document.
 */
export const OMITTABLE_TASK_FIELDS = ['description', 'listMembers'] as const

export type OmittableTaskField = (typeof OMITTABLE_TASK_FIELDS)[number]

const WHITELIST = new Set<string>(OMITTABLE_TASK_FIELDS)

/**
 * The fields named by an `omit` query parameter, ignoring anything not on the
 * whitelist.
 *
 * Ignoring rather than rejecting is deliberate and is the same choice
 * `updatedSince` makes with an unparseable cursor: a newer client naming a
 * field this build has never heard of gets a response it can use, not a 400.
 * The cost is that a typo silently sends the full payload — which is why the
 * response echoes `meta.omitted`, so a caller can see what the server actually
 * did rather than assume.
 */
export function parseOmittedTaskFields(param: string | null): Set<OmittableTaskField> {
  if (!param) return new Set()
  const omitted = new Set<OmittableTaskField>()
  for (const name of param.split(',')) {
    const field = name.trim()
    if (WHITELIST.has(field)) omitted.add(field as OmittableTaskField)
  }
  return omitted
}
