// @vitest-environment node
/**
 * AWTD-1064: with no DOM to sanitise in, the markdown renderers return the text escaped, with its
 * line breaks, and nothing else. This used to be a regex "sanitiser" that let `<img onerror>`,
 * `javascript:` links and `<svg onload>` through. Nothing renders markdown on the server today
 * (every caller is a client component, with its content arriving after hydration), so this is a
 * floor, not a feature.
 */
import { describe, expect, it } from 'vitest'
import { renderMarkdown, renderMarkdownWithLinks } from '@/lib/markdown'

const HOSTILE = [
  '<img src=x\nonerror=alert(1)>',
  '[x](javascript:alert(1))',
  '<svg onload="alert(1)">',
  '<object data="x"></object>',
  '@[x" onmouseover="alert(1)](u1)',
]

describe.each([
  ['renderMarkdown', renderMarkdown],
  ['renderMarkdownWithLinks', (text: string) => renderMarkdownWithLinks(text)],
])('%s without a DOM', (_name, render) => {
  it.each(HOSTILE)('emits no markup for %j', (text) => {
    const html = render(text)
    expect(html.replace(/<br>/g, '')).not.toMatch(/<[a-z!/]/i)
  })

  it('keeps the text and its line breaks', () => {
    expect(render('a **b** & <c>\nnext')).toBe('a **b** &amp; &lt;c&gt;<br>next')
  })
})
