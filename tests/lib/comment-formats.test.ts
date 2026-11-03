import { describe, it, expect } from 'vitest'
import { parseDecision, chosenLetter, decisionReply, isTradeoffGrid } from '@/lib/comment-formats'
import { renderMarkdownWithLinks } from '@/lib/markdown'

describe('AWTD-1524 decision parsing', () => {
  const body = '**Decision:** Which way?\n\n- **A.** Ship now (recommended)\n- **B)** Wait'
  it('parses lettered options and the recommended badge', () => {
    const d = parseDecision(body)!
    expect(d.prompt).toBe('Which way?')
    expect(d.options).toEqual([
      { letter: 'A', text: 'Ship now', recommended: true },
      { letter: 'B', text: 'Wait', recommended: false },
    ])
    expect(decisionReply(d.options[0])).toBe('A — Ship now')
  })
  it('rejects fewer than two options or an unlettered item', () => {
    expect(parseDecision('**Decision:** x\n\n- **A.** only')).toBeNull()
    expect(parseDecision('**Decision:** x\n\n- **A.** one\n- plain')).toBeNull()
    expect(parseDecision('just text')).toBeNull()
  })
  it('reads the chosen letter from a reply', () => {
    expect(chosenLetter('B — Wait')).toBe('B')
    expect(chosenLetter('a, thanks')).toBe('A')
    expect(chosenLetter('Actually no')).toBeNull()
  })
})

describe('AWTD-1524 trade-off grid', () => {
  it('recognises rated tables only', () => {
    expect(isTradeoffGrid([['x', '+ fast', '- slow']])).toBe(true)
    expect(isTradeoffGrid([['x', '+ fast', 'nope']])).toBe(false)
    expect(isTradeoffGrid([['x', '-', '-']])).toBe(false)
  })
  it('renders coloured cells', () => {
    // jsdom is required for sanitising; the test env is shared with markdown-render tests.
    const html = renderMarkdownWithLinks('| Opt | Cost |\n|---|---|\n| A | ++ cheap |\n| B | 🔴 dear |')
    expect(html).toContain('bg-[#38761D]')
    expect(html).toContain('cheap')
  })
  it('leaves ordinary tables alone', () => {
    const html = renderMarkdownWithLinks('| a | b |\n|---|---|\n| 1 | 2 |')
    expect(html).not.toContain('bg-[#')
  })
})
