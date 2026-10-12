/**
 * The `?omit=` parser for GET /api/v1/tasks (AWTD-1236, deciding AWTD-1233).
 *
 * Pure, so the rules that actually matter to a client — unknown names are
 * ignored rather than rejected, whitespace is tolerated, order is the server's
 * — are table-tested here instead of through a request.
 */
import { describe, it, expect } from 'vitest'
import {
  OMITTABLE_TASK_FIELDS,
  parseOmittedTaskFields,
} from '@/lib/tasks/v1-task-omit'

describe('parseOmittedTaskFields', () => {
  it('returns nothing for an absent parameter', () => {
    expect([...parseOmittedTaskFields(null)]).toEqual([])
  })

  it('reads a single field', () => {
    expect([...parseOmittedTaskFields('description')]).toEqual(['description'])
  })

  it('reads a comma-separated list', () => {
    expect([...parseOmittedTaskFields('description,listMembers')].sort()).toEqual([
      'description',
      'listMembers',
    ])
  })

  it('tolerates whitespace and empty segments', () => {
    expect([...parseOmittedTaskFields(' description , , listMembers ')].sort()).toEqual([
      'description',
      'listMembers',
    ])
  })

  it('ignores a name it does not know rather than rejecting the request', () => {
    // Forward compatibility: a newer client naming a field this build has
    // never heard of must still get a response, not a 400.
    expect([...parseOmittedTaskFields('description,somethingNew')]).toEqual(['description'])
    expect([...parseOmittedTaskFields('somethingNew')]).toEqual([])
  })

  it('never omits a field outside the whitelist, however it is spelled', () => {
    // The whitelist is the safety rail: `id`, `title` and the permission
    // fields must not be droppable, or a lean response becomes an unusable one.
    for (const forbidden of ['id', 'title', 'lists', 'statusRole', 'ownerId']) {
      expect([...parseOmittedTaskFields(forbidden)]).toEqual([])
    }
  })

  it('is case-sensitive, so a near-miss is ignored instead of guessed at', () => {
    expect([...parseOmittedTaskFields('Description')]).toEqual([])
  })

  it('deduplicates', () => {
    expect([...parseOmittedTaskFields('description,description')]).toEqual(['description'])
  })

  it('whitelists exactly the two fields the contract documents', () => {
    expect([...OMITTABLE_TASK_FIELDS].sort()).toEqual(['description', 'listMembers'])
  })
})
