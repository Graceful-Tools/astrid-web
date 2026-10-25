/**
 * AWTD-1064 — the web draws markdown as iOS does (astrid-core docs/CONTRACTS.md D38, resolved
 * toward iOS 2026-10-03). The Apple apps draw descriptions, comments and chat through astrid-core.
 * Where `marked` plus DOMPurify read a text differently, the web now gives the core's reading.
 * These are the three user-visible changes, one per test. The shared fixture
 * (core-rules-markdown-parity.test.ts) locks every case.
 */
import { describe, expect, it } from 'vitest'
import { renderMarkdownWithLinks } from '@/lib/markdown'

describe('D38: what the web now draws as iOS does', () => {
  it('numbers an ordered list from its first number', () => {
    // Before: the sanitiser dropped `start`, so "3. three" was numbered 1.
    const html = renderMarkdownWithLinks('3. three\n4. four')
    expect(html).toContain('<ol start="3">')
  })

  it('shows a reference inside a code span as typed, not as a pill', () => {
    const html = renderMarkdownWithLinks('`@[Ann](u1)`')
    expect(html).not.toContain('href="/u/u1"')
    expect(html).toContain('<code>@[Ann](u1)</code>')
  })

  it('shows a reference inside a code block as typed', () => {
    const html = renderMarkdownWithLinks('```\n@[Ann](u1)\n```')
    expect(html).not.toContain('<a')
    expect(html).toContain('@[Ann](u1)')
  })

  it('reads inline HTML as its text, even the tags the allowlist keeps', () => {
    // Before: <strong> typed in a description drew bold text.
    const html = renderMarkdownWithLinks('a <strong>strong</strong> word')
    expect(html).not.toContain('<strong>')
    expect(html).toContain('a strong word')
  })

  it('does not let typed HTML make a link', () => {
    const html = renderMarkdownWithLinks('see <a href="https://example.com">here</a>')
    expect(html).not.toContain('<a')
    expect(html).toContain('see here')
  })

  it('still formats the same text written as markdown', () => {
    expect(renderMarkdownWithLinks('a **strong** word')).toContain('<strong>strong</strong>')
    expect(renderMarkdownWithLinks('Ask @[Ann](u1)')).toContain('href="/u/u1"')
  })
})
