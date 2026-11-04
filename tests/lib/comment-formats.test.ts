import { describe, it, expect } from 'vitest'
import { parseDecision, chosenNumber, decisionReply, isTradeoffGrid, RATING_STYLE } from '@/lib/comment-formats'
import { readFileSync } from 'fs'
import { join } from 'path'
import { renderMarkdownWithLinks } from '@/lib/markdown'

describe('AWTD-1524 decision parsing', () => {
  const body = '**Decision:** Which way?\n\n- **A.** Ship now (recommended)\n- **B)** Wait'
  it('parses lettered options and the recommended badge', () => {
    const d = parseDecision(body)!
    expect(d.prompt).toBe('Which way?')
    expect(d.options).toEqual([
      { letter: 'A', number: 1, text: 'Ship now', recommended: true },
      { letter: 'B', number: 2, text: 'Wait', recommended: false },
    ])
    expect(decisionReply(d.options[0])).toBe('1 — Ship now')
  })
  it('rejects fewer than two options or an unlettered item', () => {
    expect(parseDecision('**Decision:** x\n\n- **A.** only')).toBeNull()
    expect(parseDecision('**Decision:** x\n\n- **A.** one\n- plain')).toBeNull()
    expect(parseDecision('just text')).toBeNull()
  })
  it('reads the chosen option from a reply in the old letter form', () => {
    const { options } = parseDecision(body)!
    expect(chosenNumber('B — Wait', options)).toBe(2)
    expect(chosenNumber('a, thanks', options)).toBe(1)
    expect(chosenNumber('Actually no', options)).toBeNull()
  })
})

describe('AWTD-1531 a Decision shown as code stays code', () => {
  const example = '**Decision:** Which way?\n\n- **A.** Ship now (recommended)\n- **B.** Wait'
  it('inside a fenced block', () => {
    expect(parseDecision('Write it like this:\n\n```markdown\n' + example + '\n```')).toBeNull()
    expect(parseDecision('~~~\n' + example + '\n~~~')).toBeNull()
  })
  it('as an indented block', () => {
    const indented = example.split('\n').map(l => '    ' + l).join('\n')
    expect(parseDecision('Like this:\n\n' + indented)).toBeNull()
  })
  it('a one-line ```code span``` is not a fence', () => {
    const d = parseDecision('Use ```**Decision:**``` to ask.\n\n' + example)
    expect(d?.options.map(o => o.letter)).toEqual(['A', 'B'])
  })
  it('a fence opened inside a list item', () => {
    const inList = '- Write it like this:\n- ```markdown\n  ' + example.split('\n').join('\n  ') + '\n  ```'
    expect(parseDecision(inList)).toBeNull()
  })
  it('options indented as code under a real heading', () => {
    expect(parseDecision('**Decision:** Pick\n\n    - **A.** one\n    - **B.** two')).toBeNull()
  })
  it('tab-and-space indentation still counts as code', () => {
    expect(parseDecision('Like this:\n\n \t' + example.split('\n').join('\n \t'))).toBeNull()
  })
  it('a real Decision after a code example is still recognised', () => {
    const d = parseDecision('```\n' + example + '\n```\n\n' + example)
    expect(d?.options.map(o => o.letter)).toEqual(['A', 'B'])
    expect(d?.before).toContain('```')
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
    expect(html).toContain('tradeoff-very-good')
    expect(html).toContain('tradeoff-poor')
    expect(html).toContain('cheap')
  })
  it('leaves ordinary tables alone', () => {
    const html = renderMarkdownWithLinks('| a | b |\n|---|---|\n| 1 | 2 |')
    expect(html).not.toContain('tradeoff')
  })
})

describe('AWTD-1529 trade-off grid drawn like iOS', () => {
  const grid = '| Option | Cost | Fun |\n|---|---|---|\n| A | ++ cheap | -- dull |\n| B | ~ fair | + ok |'

  it('every rating class is styled in the global stylesheet, not left to Tailwind', () => {
    // lib/ is outside Tailwind's content paths, so a utility class written here is never generated.
    const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8')
    for (const { className } of Object.values(RATING_STYLE)) {
      expect(css).toContain(`.${className}`)
    }
  })

  it('scrolls sideways inside its own container', () => {
    const html = renderMarkdownWithLinks(grid)
    expect(html).toMatch(/<div class="tradeoff-scroll"><table[^>]* class="tradeoff-grid[ "]/)
  })

  it('keys each colour by name, worst to best', () => {
    const html = renderMarkdownWithLinks(grid)
    const key = html.slice(html.indexOf('tradeoff-key'))
    const names = [...key.matchAll(/tradeoff-swatch [^"]+"><\/span>([^<]+)</g)].map(m => m[1])
    expect(names).toEqual(['Very poor', 'Mixed', 'Good', 'Very good'])
    expect(key).not.toMatch(/>\s*(\+\+|--|~)\s*</)
  })

  it('still states each rating in words for screen readers', () => {
    const html = renderMarkdownWithLinks(grid)
    expect(html).toContain('<span class="sr-only">Very good. </span>cheap')
  })

  it('a reason keeps a reference-style link defined elsewhere in the comment', () => {
    const html = renderMarkdownWithLinks(
      '| Option | Docs |\n|---|---|\n| A | ++ [guide][g] |\n\n[g]: https://example.com/guide',
    )
    expect(html).toContain('href="https://example.com/guide"')
    expect(html).not.toContain('[guide][g]')
  })

  it('a rating-only cell shows its token, so it reads without colour', () => {
    const html = renderMarkdownWithLinks('| Option | Cost |\n|---|---|\n| A | ++ |\n| B | - dear |')
    expect(html).toContain('<span class="sr-only">Very good. </span>++</td>')
  })

  it('names ratings in the reader\'s language', () => {
    const html = renderMarkdownWithLinks(grid, { ratingLabels: { veryGood: 'Sehr gut', veryPoor: 'Sehr schlecht' } })
    expect(html).toContain('<span class="sr-only">Sehr gut. </span>cheap')
    expect(html).toContain('</span>Sehr schlecht</span>')
    expect(html).toContain('</span>Mixed</span>')
  })

  it('every rating name has a key in the locale files', () => {
    const en = JSON.parse(readFileSync(join(process.cwd(), 'lib/i18n/locales/en.json'), 'utf8'))
    for (const { labelKey, label } of Object.values(RATING_STYLE)) {
      expect(en.tasks.tradeoffRatings[labelKey]).toBe(label)
    }
  })
})
