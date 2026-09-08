/**
 * No index that another index already covers (task 466c10f1).
 *
 * Every extra index is paid for on every INSERT, UPDATE and DELETE of the row,
 * forever, and read back by nothing. The schema had 31 of them.
 *
 * TWO KINDS, WITH DIFFERENT STANDARDS OF PROOF — which is why they are two
 * tests rather than one number.
 *
 * 1. DUPLICATING A @unique CONSTRAINT. Postgres implements UNIQUE by building
 *    a unique B-tree index on exactly those columns. A second, non-unique
 *    index on the same columns can therefore serve no lookup, no ordering and
 *    no range that the first one cannot. This is a proof from the structure of
 *    the index, not a claim about any workload, so no production query plan
 *    can overturn it — and this task's acceptance bar allows a contract test
 *    in place of a plan for exactly this reason. Seventeen of these existed,
 *    including MCPToken.token, OAuthToken.accessToken,
 *    OAuthAuthorizationCode.code, Shortcode.code, Invitation.token and
 *    ListInvite.token: doubled write cost on the tables every authenticated
 *    request touches. They are gone, and this test is what keeps them gone.
 *
 * 2. A PREFIX OF A COMPOSITE — `@@index([assigneeId])` beside
 *    `@@index([assigneeId, completed])`. The composite can serve a lookup on
 *    assigneeId, so the narrow one is redundant for that query. But it is not
 *    redundant in the same absolute sense: the narrow index is physically
 *    smaller, so a plan that scans a large fraction of it touches fewer pages.
 *    Whether that matters is a question about THIS database's workload, and
 *    the task opens by saying to review these with production query plans.
 *    Fourteen remain, listed below rather than dropped on a guess. That list
 *    is the input for whoever has the plans; the test asserts the count so a
 *    fifteenth cannot appear unnoticed.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

interface ModelIndexes {
  model: string
  indexes: string[][]
  uniqueFields: string[]
  uniqueComposites: string[][]
}

function parseSchema(): ModelIndexes[] {
  const src = readFileSync('prisma/schema.prisma', 'utf8')
  const models = [...src.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)]

  return models.map(([, model, body]) => ({
    model,
    indexes: [...body.matchAll(/@@index\(\[([^\]]+)\]/g)].map(m =>
      m[1].split(',').map(s => s.trim().replace(/\(.*\)$/, '')),
    ),
    uniqueFields: [...body.matchAll(/^\s*(\w+)\s+\S+.*@unique/gm)].map(m => m[1]),
    uniqueComposites: [...body.matchAll(/@@unique\(\[([^\]]+)\]/g)].map(m =>
      m[1].split(',').map(s => s.trim()),
    ),
  }))
}

const sameColumns = (a: string[], b: string[]) =>
  a.length === b.length && a.every((c, i) => c === b[i])

describe('schema indexes are not redundant (task 466c10f1)', () => {
  const schema = parseSchema()

  it('parses the schema at all', () => {
    expect(schema.length).toBeGreaterThan(30)
    expect(schema.find(m => m.model === 'Task')?.indexes.length).toBeGreaterThan(5)
  })

  it('no @@index duplicates a @unique constraint', () => {
    const offenders: string[] = []

    for (const { model, indexes, uniqueFields, uniqueComposites } of schema) {
      for (const index of indexes) {
        const duplicatesField = index.length === 1 && uniqueFields.includes(index[0])
        const duplicatesComposite = uniqueComposites.some(u => sameColumns(u, index))
        if (duplicatesField || duplicatesComposite) {
          offenders.push(`${model}.@@index([${index.join(', ')}])`)
        }
      }
    }

    expect(
      offenders,
      `Postgres already built a unique B-tree on these columns for the @unique ` +
        `constraint. The second index serves no read and is maintained on every ` +
        `write:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })

  /**
   * Held, not blessed. Lower this as production query plans justify each drop;
   * it must never go up.
   */
  const PREFIX_REDUNDANT_AWAITING_QUERY_PLANS = 14

  it(`has no more than ${PREFIX_REDUNDANT_AWAITING_QUERY_PLANS} prefix-redundant indexes`, () => {
    const offenders: string[] = []

    for (const { model, indexes } of schema) {
      for (const index of indexes) {
        if (index.length !== 1) continue
        const covering = indexes.filter(other => other.length > 1 && other[0] === index[0])
        if (covering.length === 0) continue
        offenders.push(
          `${model}.@@index([${index[0]}]) ⊂ ${covering.map(c => `[${c.join(', ')}]`).join(', ')}`,
        )
      }
    }

    expect(
      offenders.length,
      offenders.length > PREFIX_REDUNDANT_AWAITING_QUERY_PLANS
        ? `A new single-column index sits under a composite that starts with the ` +
          `same column. Extend the composite instead:\n  ${offenders.join('\n  ')}`
        : `Down to ${offenders.length} — lower the constant to lock it in.`,
    ).toBeLessThanOrEqual(PREFIX_REDUNDANT_AWAITING_QUERY_PLANS)
  })

  it('the columns the 15-minute sync filters on are indexed', () => {
    // lib/sync/github/sync-all-links.ts runs `where: { provider }` ordered by
    // lastReconciledAt on every pass, 96 times a day, and ExternalListLink had
    // no index touching either column.
    const link = schema.find(m => m.model === 'ExternalListLink')
    expect(link, 'ExternalListLink model not found').toBeDefined()
    expect(
      link!.indexes.some(i => i[0] === 'provider'),
      'ExternalListLink needs an index leading with provider — the sync pass ' +
        'filters on it every 15 minutes.',
    ).toBe(true)
  })
})
