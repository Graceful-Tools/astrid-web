/**
 * Regression tests for task 12f54df4 — human-readable identifiers (AST-142).
 *
 * The value of this feature is entirely in the identifier travelling *outside*
 * the product: branch names, commit messages, PR titles, standups. So the
 * parsing, derivation and slugification are the parts worth pinning.
 */

import { describe, it, expect } from 'vitest'
import {
  parseIdentifier,
  formatIdentifier,
  deriveProjectKey,
  resolveProjectKeyCollision,
  ensureProjectKey,
  allocateTaskIdentifier,
  toBranchName,
  MAX_PROJECT_KEY_LENGTH,
} from '@/lib/task-identifier'
import identifierFixtures from '../fixtures/task-identifiers.json'

describe('parseIdentifier (12f54df4)', () => {
  it('parses a well-formed identifier', () => {
    expect(parseIdentifier('AST-142')).toEqual({ key: 'AST', sequence: 142 })
  })

  it('is case-insensitive on input but canonical uppercase on output', () => {
    // People type `ast-142`. The same identifier must not resolve two ways.
    expect(parseIdentifier('ast-142')).toEqual({ key: 'AST', sequence: 142 })
    expect(parseIdentifier('AsT-142')).toEqual({ key: 'AST', sequence: 142 })
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseIdentifier('  AST-142  ')).toEqual({ key: 'AST', sequence: 142 })
  })

  it('returns null for anything that is not identifier-shaped', () => {
    // A UUID must pass through untouched, or every existing lookup breaks.
    expect(parseIdentifier('550e8400-e29b-41d4-a716-446655440000')).toBeNull()
    expect(parseIdentifier('AST')).toBeNull()
    expect(parseIdentifier('142')).toBeNull()
    expect(parseIdentifier('-142')).toBeNull()
    expect(parseIdentifier('AST-')).toBeNull()
    expect(parseIdentifier('AST-0')).toBeNull()
    expect(parseIdentifier('TOOLONGKEY-1')).toBeNull()
    expect(parseIdentifier(null)).toBeNull()
    expect(parseIdentifier(undefined)).toBeNull()
  })

  it('round-trips with formatIdentifier', () => {
    const parsed = parseIdentifier('AST-142')!
    expect(formatIdentifier(parsed.key, parsed.sequence)).toBe('AST-142')
  })
})

describe('deriveProjectKey (12f54df4)', () => {
  it('uses initials for a multi-word name', () => {
    // Punctuation separates words, so "To-do" contributes T and D.
    expect(deriveProjectKey('Astrid Web To-do')).toBe('AWTD')
    expect(deriveProjectKey('Bugs and Polish')).toBe('BAP')
  })

  it('uses leading letters for a single word', () => {
    expect(deriveProjectKey('Astrid')).toBe('ASTRI')
  })

  it('respects the length cap', () => {
    const key = deriveProjectKey('One Two Three Four Five Six Seven')!
    expect(key.length).toBeLessThanOrEqual(MAX_PROJECT_KEY_LENGTH)
  })

  it('pads a one-character key rather than refusing one', () => {
    // Refusing would leave the project with no identifiers at all, which is
    // worse than a slightly ugly key.
    expect(deriveProjectKey('X')).toBe('XX')
  })

  it('keeps digits that carry meaning', () => {
    expect(deriveProjectKey('Project 42')).toBe('P4')
  })

  it('returns null when there is nothing usable', () => {
    expect(deriveProjectKey('')).toBeNull()
    expect(deriveProjectKey('   ')).toBeNull()
    expect(deriveProjectKey('!!!')).toBeNull()
    // Must start with a letter so it can't be confused with a bare sequence.
    expect(deriveProjectKey('42')).toBeNull()
  })
})

describe('resolveProjectKeyCollision (12f54df4)', () => {
  it('returns the candidate when it is free', () => {
    expect(resolveProjectKeyCollision('AST', ['XYZ'])).toBe('AST')
  })

  it('appends a digit on collision', () => {
    expect(resolveProjectKeyCollision('AST', ['AST'])).toBe('AST2')
    expect(resolveProjectKeyCollision('AST', ['AST', 'AST2'])).toBe('AST3')
  })

  it('is case-insensitive about what is taken', () => {
    expect(resolveProjectKeyCollision('AST', ['ast'])).toBe('AST2')
  })

  it('never exceeds the length cap', () => {
    const taken = ['ABCDE', 'ABCD2', 'ABCD3', 'ABCD4']
    const resolved = resolveProjectKeyCollision('ABCDE', taken)
    expect(resolved.length).toBeLessThanOrEqual(MAX_PROJECT_KEY_LENGTH)
    expect(taken).not.toContain(resolved)
  })

  it('keeps going past the single-digit space', () => {
    const taken = ['AST', ...Array.from({ length: 8 }, (_, i) => `AST${i + 2}`)]
    const resolved = resolveProjectKeyCollision('AST', taken)
    expect(taken).not.toContain(resolved)
  })
})

describe('toBranchName (12f54df4)', () => {
  it('produces a usable git ref', () => {
    expect(toBranchName('AST-142', 'Fix repeating rollover'))
      .toBe('ast-142-fix-repeating-rollover')
  })

  it('collapses punctuation and never leaves a trailing separator', () => {
    const branch = toBranchName('AST-1', 'Fix: the "thing" (again)!')
    expect(branch).toBe('ast-1-fix-the-thing-again')
    expect(branch).not.toMatch(/-$/)
    expect(branch).not.toMatch(/--/)
  })

  it('truncates long titles without leaving a dangling dash', () => {
    const branch = toBranchName('AST-1', 'a'.repeat(200))
    expect(branch.length).toBeLessThanOrEqual(60)
    expect(branch).not.toMatch(/-$/)
  })

  it('falls back to the bare identifier when the title has no usable characters', () => {
    expect(toBranchName('AST-142', '!!!')).toBe('ast-142')
    expect(toBranchName('AST-142', '')).toBe('ast-142')
  })

  it('emits only characters git accepts in a ref', () => {
    const branch = toBranchName('AST-9', 'Ünïcödé and émojis 🎉 here')
    expect(branch).toMatch(/^[a-z0-9-]+$/)
  })
})

/**
 * AWTD-1016 — project keys are unique across astrid.cc, not per owner.
 *
 * `Task.identifier` is globally unique, so a key that two owners share makes
 * every task create in the second owner's project fail on that index (a 500,
 * or a false 409 when a clientRequestId was sent). The key has to be unique
 * wherever the identifier is.
 */
describe('ensureProjectKey / allocateTaskIdentifier across owners (AWTD-1016)', () => {
  type FakeProject = { id: string; name: string; ownerId: string; key: string | null; nextSequence: number }

  function fakeClient(projects: FakeProject[], lists: Array<{ id: string; projectId: string }>) {
    const matches = (project: FakeProject, where: Record<string, unknown> = {}) =>
      Object.entries(where).every(([field, condition]) => {
        const value = project[field as keyof FakeProject]
        if (condition && typeof condition === 'object' && 'not' in condition) {
          return value !== (condition as { not: unknown }).not
        }
        return value === condition
      })

    return {
      project: {
        findUnique: async ({ where }: { where: { id: string } }) =>
          projects.find(project => project.id === where.id) ?? null,
        findMany: async ({ where }: { where?: Record<string, unknown> }) =>
          projects.filter(project => matches(project, where)),
        update: async ({ where, data }: { where: { id: string }; data: { key: string } }) => {
          if (projects.some(project => project.key === data.key && project.id !== where.id)) {
            throw Object.assign(new Error('Unique constraint failed on key'), { code: 'P2002' })
          }
          const project = projects.find(candidate => candidate.id === where.id)!
          project.key = data.key
          return project
        },
      },
      // No project here has been renamed, so no key is held as an alias (AWTD-1024).
      projectKeyAlias: { findMany: async () => [] },
      taskList: {
        findFirst: async ({ where }: { where: { id: { in: string[] } } }) =>
          lists.find(list => where.id.in.includes(list.id)) ?? null,
      },
      // allocateSequenceRange's UPDATE ... RETURNING — values are [count, projectId, count].
      $queryRaw: async (query: { values: unknown[] }) => {
        const [count, projectId] = query.values as [number, string]
        const project = projects.find(candidate => candidate.id === projectId)!
        project.nextSequence += count
        return [{ nextSequence: project.nextSequence - count, key: project.key }]
      },
    }
  }

  it('gives a second owner\'s same-named project a key nobody else holds (AWTD-1016)', async () => {
    const projects: FakeProject[] = [
      { id: 'p-alice', name: 'Astrid', ownerId: 'alice', key: 'ASTRI', nextSequence: 2 },
      { id: 'p-bob', name: 'Astrid', ownerId: 'bob', key: null, nextSequence: 1 },
    ]
    const client = fakeClient(projects, [])

    const key = await ensureProjectKey('p-bob', client as never)

    expect(key).not.toBe('ASTRI')
    expect(key).toBe('ASTR2')
  })

  it('mints a distinct identifier for the first task in the second owner\'s project (AWTD-1016)', async () => {
    const projects: FakeProject[] = [
      { id: 'p-alice', name: 'Astrid', ownerId: 'alice', key: 'ASTRI', nextSequence: 2 },
      { id: 'p-bob', name: 'Astrid', ownerId: 'bob', key: null, nextSequence: 1 },
    ]
    const client = fakeClient(projects, [{ id: 'l-bob', projectId: 'p-bob' }])

    const minted = await allocateTaskIdentifier(['l-bob'], client as never)

    // Alice's first task is ASTRI-1; Bob's must not be.
    expect(minted?.identifier).not.toBe('ASTRI-1')
    expect(minted).toEqual({ identifier: 'ASTR2-1', sequence: 1 })
  })
})

/**
 * AWTD-1016 — the shared fixture file is the contract every client parses
 * against (docs/specs/TASK_IDENTIFIERS.md, "Consistency across clients"). The
 * parse half is pinned to the one implementation here, so the fixtures cannot
 * drift from the server that mints the ids.
 */
describe('tests/fixtures/task-identifiers.json parse cases (AWTD-1016)', () => {
  it.each(identifierFixtures.parse)('parses "$input"', ({ input, expected }) => {
    expect(parseIdentifier(input)).toEqual(expected)
  })
})
