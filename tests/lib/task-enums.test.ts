/**
 * Task e16e9b94 — the free-string columns that have a genuinely closed set get
 * a TypeScript union and validation at the API boundary, not a Postgres enum.
 *
 * WHY NOT AN ENUM, from the live-value audit (13 lists, 34 memberships, 373
 * tasks over the v1 API — one account, not a census):
 *
 *   - `ListMember.role` comes back as `owner` on the wire, and there is no such
 *     stored role. `app/api/v1/lists/[id]/members/route.ts` synthesises it from
 *     `list.ownerId`. So the wire vocabulary {owner, admin, member} and the
 *     column vocabulary {admin, member} are DIFFERENT SETS, and a Postgres enum
 *     can only constrain one of them — the response type stays a TS union
 *     either way.
 *   - Uppercase `'MEMBER'` rows already exist in the database, written by
 *     app/api/v1/lists before it was fixed (task e2803305). `ALTER COLUMN …
 *     USING` fails on those, so the "schema change" is really a data migration
 *     plus a lock-taking DDL against live rows.
 *
 * TWO COLUMNS THE TASK LISTED ARE NOT ENUMS, and enumerating them would break
 * working features:
 *
 *   - `Task.statusRole` holds a board COLUMN ID. `ready` and `doing` only look
 *     like an enum because those are the default column names;
 *     lib/project-status.ts sets it to `column.id` for user-defined columns.
 *   - the `TaskList.filter*` columns are a filter DSL — `filterAssignee` holds
 *     a user id — not a vocabulary.
 *
 * `costEstimateSource` and `reminderType` are null in every row the audit could
 * see, so there is no evidence of their intended set and none is invented here.
 */

import { describe, it, expect } from 'vitest'
import {
  COMPLETED_SOURCES,
  LIST_MEMBER_ROLES,
  LIST_TYPES,
  PUBLIC_LIST_TYPES,
  REPEATING_VALUES,
  isCompletedSource,
  isListMemberRole,
  isRepeating,
  parseCompletedSource,
  parseRepeating,
} from '@/lib/task-enums'

describe('repeating (task e16e9b94)', () => {
  it('accepts every value the audit found in production', () => {
    // never ×362, weekly ×5, custom ×4, daily ×2 — plus the two the schema
    // allows that the sample happened not to contain.
    for (const value of ['never', 'daily', 'weekly', 'monthly', 'yearly', 'custom']) {
      expect(isRepeating(value), value).toBe(true)
    }
  })

  it('REJECTS an unrecognised value rather than storing it', () => {
    // This is the column where a bad value does real damage: it drives the
    // roll-forward calculator, so a value outside the set is how a repeating
    // series silently stops repeating.
    const result = parseRepeating('fortnightly')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('repeating')
  })

  it('does not accept a near-miss by case', () => {
    // Unlike role, nothing normalises this on read, so 'Weekly' would be
    // stored and then never match.
    expect(isRepeating('Weekly')).toBe(false)
    expect(isRepeating('NEVER')).toBe(false)
  })

  it('treats absent as "leave it alone", not as an error', () => {
    expect(parseRepeating(undefined)).toEqual({ ok: true, value: undefined })
  })

  it('reads an explicit null as "never" rather than a null column', () => {
    // Prisma's column is non-null with a default; a client clearing the field
    // means "not repeating".
    expect(parseRepeating(null)).toEqual({ ok: true, value: 'never' })
  })
})

describe('completedSource (task e16e9b94)', () => {
  it('accepts the provenance values the service documents', () => {
    expect(COMPLETED_SOURCES).toEqual(['astrid', 'google', 'github', 'apple'])
    for (const value of COMPLETED_SOURCES) expect(isCompletedSource(value)).toBe(true)
  })

  it('rejects an unrecognised provenance instead of recording a lie', () => {
    // completedSource is an audit field — "where did this completion happen".
    // A value nothing wrote is worse than no value.
    expect(parseCompletedSource('slack').ok).toBe(false)
  })

  it('allows null, which is what every pre-provenance row holds', () => {
    // 171 of 373 sampled tasks have it null.
    expect(parseCompletedSource(null)).toEqual({ ok: true, value: null })
  })
})

describe('the list vocabularies (task e16e9b94)', () => {
  it('keeps listType and publicListType to the sets the permission code reads', () => {
    expect(LIST_TYPES).toEqual(['regular', 'status'])
    expect(PUBLIC_LIST_TYPES).toEqual(['copy_only', 'collaborative'])
  })

  it('keeps the STORED member roles separate from the wire ones', () => {
    // `owner` is synthesised in the members response from list.ownerId — it is
    // not a value any row holds. Putting it in this tuple would make the
    // storage validator accept a role that cannot be stored.
    expect(LIST_MEMBER_ROLES).toEqual(['admin', 'member'])
    expect(isListMemberRole('owner')).toBe(false)
  })

  it('accepts the uppercase rows that already exist in the database', () => {
    // app/api/v1/lists wrote 'MEMBER' before it was fixed (task e2803305), and
    // getUserRoleInList lowercases on read for exactly that reason. A validator
    // that rejected them would 400 on real data.
    expect(isListMemberRole('MEMBER')).toBe(true)
    expect(isListMemberRole('Admin')).toBe(true)
  })
})

describe('the API boundary rejects an invalid value (task e16e9b94)', () => {
  it('validates in the service, which is where every write surface passes through', async () => {
    // Five surfaces update tasks — legacy, v1, the agent PATCH and two MCP
    // handlers — and tests/rules/task-write-surfaces-delegate.test.ts pins that
    // they all delegate to services/task.service.ts. Validating there covers
    // all five; validating in a route would cover one and look complete.
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const source = readFileSync(join(process.cwd(), 'services/task.service.ts'), 'utf8')

    expect(source).toContain('parseRepeating')
    expect(source).toContain('parseCompletedSource')

    // The pass-through this replaced. If it comes back, the validation is dead
    // code sitting next to the assignment that ignores it.
    const code = source
      .split('\n')
      .filter(line => {
        const trimmed = line.trim()
        return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*')
      })
      .join('\n')
    expect(code).not.toContain('data.repeating = intent.repeating')
    expect(code).not.toContain("repeating: input.repeating || 'never'")
  })

  it('returns a 400 rather than throwing, so the caller gets a usable message', () => {
    // parse* returns a result the service turns into { ok: false, status: 400 }.
    // Throwing would surface as a 500, which tells a client nothing about which
    // field they got wrong.
    const bad = parseRepeating('fortnightly')
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      expect(bad.error).toContain('never')
      expect(bad.error).toContain('custom')
    }
  })
})
