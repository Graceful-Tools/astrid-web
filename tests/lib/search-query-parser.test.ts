/**
 * Regression tests for task 5df85b9f — search filter syntax.
 *
 * The parser decides what a search means, so it is pinned hard. The most
 * important behaviour is the graceful one: a search box must never punish a
 * typo, so an unknown key degrades to free text rather than erroring.
 */

import { describe, it, expect } from 'vitest'
import {
  parseSearchQuery,
  isEmptySearch,
  priorityToNumber,
  toTextSearchTerms,
} from '@/lib/search-query-parser'

describe('parseSearchQuery (5df85b9f)', () => {
  it('treats bare words as free text', () => {
    const parsed = parseSearchQuery('repeating rollover')
    expect(parsed.text).toBe('repeating rollover')
    expect(isEmptySearch(parsed)).toBe(false)
  })

  it('parses assignee:me', () => {
    expect(parseSearchQuery('assignee:me').assignee).toBe('me')
  })

  it('parses an @handle and strips the @', () => {
    expect(parseSearchQuery('assignee:@alice@example.com').assignee).toBe('alice@example.com')
  })

  it('parses priority with aliases and numbers', () => {
    expect(parseSearchQuery('priority:high').priorities).toEqual(['high'])
    expect(parseSearchQuery('priority:3').priorities).toEqual(['high'])
    expect(parseSearchQuery('p:urgent').priorities).toEqual(['high'])
    expect(parseSearchQuery('priority:low priority:medium').priorities).toEqual(['low', 'medium'])
  })

  it('parses due filters', () => {
    expect(parseSearchQuery('due:today').due).toBe('today')
    expect(parseSearchQuery('due:overdue').due).toBe('overdue')
    expect(parseSearchQuery('due:none').due).toBe('none')
  })

  it('parses state filters including canceled', () => {
    expect(parseSearchQuery('is:open').state).toBe('open')
    expect(parseSearchQuery('is:done').state).toBe('done')
    expect(parseSearchQuery('is:canceled').state).toBe('canceled')
    // British spelling should not be a dead end.
    expect(parseSearchQuery('is:cancelled').state).toBe('canceled')
  })

  it('separates lists from labels', () => {
    const parsed = parseSearchQuery('list:Bugs label:regression')
    expect(parsed.listNames).toEqual(['Bugs'])
    expect(parsed.labelNames).toEqual(['regression'])
  })

  it('keeps quoted values together', () => {
    expect(parseSearchQuery('list:"Bugs and Polish"').listNames).toEqual(['Bugs and Polish'])
  })

  it('recognises a bare identifier as a direct hit', () => {
    const parsed = parseSearchQuery('AST-142')
    expect(parsed.identifier).toBe('AST-142')
    expect(parsed.text).toBe('')
  })

  it('uppercases a lowercase identifier', () => {
    expect(parseSearchQuery('ast-142').identifier).toBe('AST-142')
  })

  it('DEGRADES an unknown key to free text instead of erroring', () => {
    // A search box must never punish a typo. Someone typing "hostname:foo" is
    // searching for that string, not making a mistake worth shouting about.
    const parsed = parseSearchQuery('hostname:foo')
    expect(parsed.text).toBe('hostname:foo')
  })

  it('degrades an unknown VALUE for a known key to free text', () => {
    const parsed = parseSearchQuery('priority:bananas')
    expect(parsed.priorities).toEqual([])
    expect(parsed.text).toBe('priority:bananas')
  })

  it('treats a trailing colon as free text', () => {
    expect(parseSearchQuery('is:').text).toBe('is:')
  })

  it('treats a leading colon as free text', () => {
    expect(parseSearchQuery(':foo').text).toBe(':foo')
  })

  it('combines filters and free text', () => {
    const parsed = parseSearchQuery('assignee:me priority:high due:overdue rollover bug')
    expect(parsed).toMatchObject({
      assignee: 'me',
      priorities: ['high'],
      due: 'overdue',
      text: 'rollover bug',
    })
  })

  it('is case-insensitive about keys and values', () => {
    const parsed = parseSearchQuery('Assignee:ME Priority:HIGH')
    expect(parsed.assignee).toBe('me')
    expect(parsed.priorities).toEqual(['high'])
  })
})

describe('isEmptySearch (5df85b9f)', () => {
  it('is true for an empty or whitespace query', () => {
    // "No query" must not mean "show me everything".
    expect(isEmptySearch(parseSearchQuery(''))).toBe(true)
    expect(isEmptySearch(parseSearchQuery('    '))).toBe(true)
  })

  it('is false when only a filter is present', () => {
    expect(isEmptySearch(parseSearchQuery('is:open'))).toBe(false)
    expect(isEmptySearch(parseSearchQuery('AST-1'))).toBe(false)
  })
})

describe('priorityToNumber (5df85b9f)', () => {
  it('maps onto the stored values', () => {
    expect(priorityToNumber('none')).toBe(0)
    expect(priorityToNumber('low')).toBe(1)
    expect(priorityToNumber('medium')).toBe(2)
    expect(priorityToNumber('high')).toBe(3)
  })
})

describe('toTextSearchTerms (5df85b9f)', () => {
  it('strips characters that would be read as query operators', () => {
    // Users typing & or | mean the literal characters, not boolean intent.
    expect(toTextSearchTerms('foo & bar | baz')).toBe('foo bar baz')
    expect(toTextSearchTerms('a!b(c)')).toBe('a b c')
  })

  it('collapses whitespace', () => {
    expect(toTextSearchTerms('  foo   bar  ')).toBe('foo bar')
  })
})
