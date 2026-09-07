/**
 * The acceptance criterion of epic 9dedd8aa, made executable.
 *
 * The epic's goal was one implementation per task verb, reached by every
 * surface: "37 duplicated /api vs /api/v1 paths either delegate to the service
 * or are deprecated via lib/api-deprecation.ts" (task dc9d67bb).
 *
 * The three verb slices each assert their own half — task-delete-parity,
 * task-create-parity and task-write-path-parity all ratchet the surfaces they
 * touched. What none of them asserts is the property the EPIC is about: that
 * no task-write surface anywhere hand-rolls a write, so a sixth surface added
 * next year cannot quietly reintroduce the divergence the epic spent three
 * slices removing.
 *
 * That is what this file is for. It is a ratchet, not a style rule: the failure
 * mode it guards against is a real one that happened five times over, and cost
 * a missing deletion tombstone, missing AST-nnn identifiers, and repeating
 * series killed outright by a completion that arrived through the wrong door.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isLegacyApiPath, buildDeprecationHeaders } from '@/lib/api-deprecation'

const ROOT = process.cwd()

/**
 * Every surface that accepts a task create, update or delete from a client.
 * Adding a sixth means adding it here — and making it delegate first.
 */
const TASK_WRITE_SURFACES = [
  'app/api/tasks/route.ts',
  'app/api/tasks/[id]/route.ts',
  'app/api/v1/tasks/route.ts',
  'app/api/v1/tasks/[id]/route.ts',
  'app/api/v1/agent/tasks/[id]/route.ts',
  'app/api/mcp/operations/handlers/task-operations.ts',
  'mcp/handlers/tasks.ts',
] as const

/** The service function each verb must be reached through. */
const VERBS = ['createTaskWithSideEffects', 'updateTaskWithSideEffects', 'deleteTaskWithSideEffects']

describe('every task-write surface delegates to the service (epic 9dedd8aa)', () => {
  it.each(TASK_WRITE_SURFACES)('%s writes no task row of its own', (file) => {
    const src = readFileSync(join(ROOT, file), 'utf8')

    // The whole epic in one assertion: create, update and delete each have
    // exactly one implementation, and it is not here.
    expect(src).not.toMatch(/prisma\.task\.create\(/)
    expect(src).not.toMatch(/prisma\.task\.update\(/)
    expect(src).not.toMatch(/prisma\.task\.delete\(/)
  })

  it('each surface reaches the service for at least one verb', () => {
    // Guards the inverse mistake: a file that passes the rule above by having
    // stopped writing tasks at all, because someone deleted the handler.
    for (const file of TASK_WRITE_SURFACES) {
      const src = readFileSync(join(ROOT, file), 'utf8')
      expect(
        VERBS.some(verb => src.includes(verb)),
        `${file} calls none of the task service verbs`
      ).toBe(true)
    }
  })
})

/**
 * The other half of the acceptance: the duplicated legacy paths are formally
 * deprecated, so clients still on them are being told so on every response.
 *
 * These are the legacy `/api/*` task paths that have a `/api/v1` counterpart —
 * the "duplicated" set the epic counts. They are NOT deleted here, and that is
 * deliberate: lib/legacy-api-usage.ts sets a >=28-day observation bar because
 * iOS clients in the wild pin these paths, and as of 2026-09-06 the durable
 * census has only been recording since 2026-08-29. Deleting on eight days of
 * evidence is the exact mistake `safeToDelete` exists to prevent.
 */
const DUPLICATED_TASK_PATHS = [
  '/api/tasks',
  '/api/tasks/abc123',
  '/api/tasks/abc123/comments',
  '/api/tasks/abc123/copy',
  '/api/tasks/copy',
  '/api/public-tasks',
  '/api/user/my-tasks-preferences',
] as const

describe('the duplicated legacy task paths are deprecated, not silently kept', () => {
  it.each(DUPLICATED_TASK_PATHS)('%s is classified legacy', (path) => {
    expect(isLegacyApiPath(path)).toBe(true)
  })

  it.each(DUPLICATED_TASK_PATHS)('%s carries RFC 8594 retirement headers', (path) => {
    const headers = buildDeprecationHeaders(path)

    // A client pinned to a legacy path learns the date it stops working from
    // the response itself, rather than from the outage.
    expect(headers['Deprecation']).toBeDefined()
    expect(headers['Sunset']).toBeDefined()
  })

  it('does not deprecate the v1 successors it points clients towards', () => {
    for (const path of DUPLICATED_TASK_PATHS) {
      expect(isLegacyApiPath(path.replace('/api/', '/api/v1/'))).toBe(false)
    }
  })
})
