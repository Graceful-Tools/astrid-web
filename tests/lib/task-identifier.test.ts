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
  toBranchName,
  MAX_PROJECT_KEY_LENGTH,
} from '@/lib/task-identifier'

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
