/**
 * No index that another index already covers (task 466c10f1, AWTD-855).
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
 *    Whether that matters is a question about THIS database's workload.
 *
 *    Fourteen of these were held back for production query plans. On
 *    2026-09-11 those plans were finally taken (see below), and the answer was
 *    emphatically not "drop them all": NINE of the fourteen were being chosen
 *    by the planner in production, two of them hundreds of thousands of times.
 *    Five had nothing relying on them and are gone. The nine that remain are
 *    listed here WITH THE EVIDENCE THAT KEPT THEM, which is this test's real
 *    job now — a bare count would let someone re-litigate the same cleanup
 *    next quarter and get it wrong the same way.
 */

import { describe, it, expect } from 'vitest'
import {
  parsePrismaSchema,
  findPrefixRedundantIndexes,
  describePrefixRedundant,
  sameColumns,
} from '../../scripts/lib/schema-indexes'

describe('schema indexes are not redundant (task 466c10f1)', () => {
  const schema = parsePrismaSchema()

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
   * KEPT ON PRODUCTION EVIDENCE, not on a guess and not on inertia.
   *
   * Scan counts are from pg_stat_user_indexes on the production database,
   * gathered 2026-09-11 by `npx tsx scripts/index-drop-evidence.ts --prod` over
   * a 5.4-day statistics window. Each number is the number of times the
   * PLANNER CHOSE THE NARROW INDEX over the composite that supposedly covers
   * it — which is the whole question, and the reason none of these may be
   * dropped on the structural argument alone.
   *
   * To revisit one: re-run that script against production. Do not delete a row
   * here without a fresh plan showing the scans have gone to zero.
   */
  const KEPT_ON_EVIDENCE: Record<string, string> = {
    'User.isAIAgent': '2,029 planner-chosen scans; composite [isAIAgent, aiAgentType] took 1,989',
    'TaskList.ownerId': '984 scans; the composite [ownerId, isFavorite] took 2,024 — both are live',
    'TaskList.projectId': '9,512 scans; more than the [projectId, listType] composite at 4,322',
    'Task.assigneeId': '877 scans on the hottest table; [assigneeId, completed] took 120,767',
    'Task.creatorId': '1,773 scans; [creatorId, createdAt] took 6,072',
    'Task.completed':
      '332,459 scans — while its composite [completed, priority, createdAt] took ZERO. ' +
      'Dropping this one would have moved a third of a million lookups onto an index ' +
      'the planner has never once chosen.',
    'Task.createdAt': '1,126 scans; [createdAt, completed] took 769',
    'Task.dueDateTime': '157,675 scans; [dueDateTime, completed] took 290',
    'Comment.taskId':
      '1,581,363 scans — the single hottest index in the database after the primary keys, ' +
      'and 100x what [taskId, createdAt] served at 12,878',
  }

  it('every prefix-redundant index that remains is one production evidence kept', () => {
    const remaining = findPrefixRedundantIndexes(schema)
    const keys = remaining.map(e => `${e.model}.${e.column}`).sort()
    const recorded = Object.keys(KEPT_ON_EVIDENCE).sort()

    const undocumented = keys.filter(k => !recorded.includes(k))
    const stale = recorded.filter(k => !keys.includes(k))

    expect(
      undocumented,
      `A single-column index sits under a composite that starts with the same ` +
        `column, and no production evidence justifies it. Either extend the ` +
        `composite instead of adding it, or run ` +
        `\`npx tsx scripts/index-drop-evidence.ts --prod\` and record the scan ` +
        `count here:\n  ${undocumented.join('\n  ')}`,
    ).toEqual([])

    expect(
      stale,
      `These are recorded as kept-on-evidence but are no longer in the schema. ` +
        `Remove the row — a justification for an index that does not exist is ` +
        `how the next reader mistakes this list for the current state:\n  ${stale.join('\n  ')}`,
    ).toEqual([])
  })

  /**
   * Held, not blessed. Lower this as production plans justify each drop; it
   * must never go up. 31 → 14 (the unique-duplicate half, 2026-09-08) → 9
   * (the five with production evidence, 2026-09-11).
   */
  const PREFIX_REDUNDANT_KEPT_ON_EVIDENCE = 9

  it(`has no more than ${PREFIX_REDUNDANT_KEPT_ON_EVIDENCE} prefix-redundant indexes`, () => {
    const offenders = findPrefixRedundantIndexes(schema).map(describePrefixRedundant)

    expect(
      offenders.length,
      offenders.length > PREFIX_REDUNDANT_KEPT_ON_EVIDENCE
        ? `A new single-column index sits under a composite that starts with the ` +
          `same column. Extend the composite instead:\n  ${offenders.join('\n  ')}`
        : `Down to ${offenders.length} — lower the constant to lock it in.`,
    ).toBeLessThanOrEqual(PREFIX_REDUNDANT_KEPT_ON_EVIDENCE)
  })

  /**
   * The five dropped in 20260911150000_drop_five_prefix_redundant_indexes.
   * Pinned so that re-adding one has to be a deliberate act with a fresh plan,
   * rather than a `@@index` added back by someone reading the model top to
   * bottom and noticing a foreign key without an index.
   */
  const DROPPED_ON_EVIDENCE: [string, string][] = [
    ['ProjectMember', 'projectId'],
    ['ListMember', 'listId'],
    ['Task', 'reminderTime'],
    ['Invitation', 'email'],
    ['Invitation', 'senderId'],
  ]

  it.each(DROPPED_ON_EVIDENCE)(
    '%s.@@index([%s]) stays dropped — production showed nothing relied on it',
    (model, column) => {
      const found = schema.find(m => m.model === model)
      expect(found, `${model} model not found`).toBeDefined()
      expect(
        found!.indexes.some(i => i.length === 1 && i[0] === column),
        `@@index([${column}]) is back on ${model}. It was dropped on production ` +
          `evidence (0 scans, with a sibling index leading on the same column ` +
          `serving the workload). If a plan now justifies it, drop this row and ` +
          `say so — but a foreign key without its own narrow index is not a bug ` +
          `when a composite already leads with that column.`,
      ).toBe(false)
    },
  )

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
