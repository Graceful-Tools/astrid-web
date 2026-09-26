/**
 * AWTD-1017 — autolinking and the show rule, driven by the shared fixtures
 * (tests/fixtures/task-identifiers.json) that iOS and Windows copy. A case
 * that passes here and fails there is a client bug, not a contract question.
 */
import { describe, it, expect } from 'vitest'
import fixtures from '../fixtures/task-identifiers.json'
import {
  findIdentifierLinks,
  shouldShowTaskIdentifier,
  canCopyTaskIdentifier,
  type IdentifierSurface,
} from '@/lib/task-identifier-links'
import { renderMarkdownWithLinks } from '@/lib/markdown'

describe('autolink fixture cases (AWTD-1017)', () => {
  it.each(fixtures.autolink.cases)('$name', ({ text, context, links }) => {
    const found = findIdentifierLinks(text, context).map(({ match, identifier, href }) => ({ match, identifier, href }))
    expect(found).toEqual(links)
  })
})

describe('show-rule fixture cases (AWTD-1017)', () => {
  it.each(fixtures.showRule.cases)('$name', ({ identifier, lists, show, copy }) => {
    for (const [surface, expected] of Object.entries(show)) {
      expect(shouldShowTaskIdentifier({ identifier, lists }, surface as IdentifierSurface), surface).toBe(expected)
    }
    expect(canCopyTaskIdentifier({ identifier })).toBe(copy)
  })
})

describe('renderMarkdownWithLinks with identifier context (AWTD-1017)', () => {
  const context = { projectKey: 'AWTD', keys: ['AWTD'], hidden: [] }

  it('links AWTD-12 and #13 to /t/, leaving code alone', () => {
    const html = renderMarkdownWithLinks('See AWTD-12 and #13, not `AWTD-14`.', { identifiers: context })

    expect(html).toContain('href="/t/AWTD-12"')
    expect(html).toContain('href="/t/AWTD-13"')
    expect(html).toContain('>#13</a>')
    expect(html).not.toContain('href="/t/AWTD-14"')
  })

  it('links nothing without a context, as before', () => {
    expect(renderMarkdownWithLinks('See AWTD-12.')).not.toContain('/t/')
  })

  it('does not link inside a task reference title', () => {
    const html = renderMarkdownWithLinks('![Fix AWTD-12 crash](3f2a0c1e-1111-2222-3333-444455556666)', { identifiers: context })
    expect(html).not.toContain('/t/AWTD-12')
  })
})
