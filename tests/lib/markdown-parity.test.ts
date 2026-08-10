/**
 * Task 0a54e46f — markdown parity for task descriptions, comments and chat.
 *
 * These all target `renderMarkdownWithLinks`, the renderer those three surfaces
 * actually use. `renderMarkdown` (plain `marked`) already passes the construct
 * half of this and is covered by tests/lib/markdown-render.test.ts — the bug was
 * that descriptions never went through it.
 *
 * Spec agreed 2026-08-09: full GFM matching the editor preview, the Astrid
 * reference syntax preserved, and bare domains left as plain text.
 */
import { describe, it, expect } from 'vitest'
import { renderMarkdownWithLinks } from '@/lib/markdown'

describe('renderMarkdownWithLinks — GFM construct parity (task 0a54e46f)', () => {
  describe('headings', () => {
    it('renders # as h1', () => {
      expect(renderMarkdownWithLinks('# Heading one')).toContain('<h1')
    })

    it('renders ## as h2', () => {
      expect(renderMarkdownWithLinks('## Heading two')).toContain('<h2')
    })

    it('renders ### as h3', () => {
      const html = renderMarkdownWithLinks('### Heading three')
      expect(html).toContain('<h3')
      expect(html).toContain('Heading three')
    })

    it('renders #### through ###### as h4-h6', () => {
      expect(renderMarkdownWithLinks('#### four')).toContain('<h4')
      expect(renderMarkdownWithLinks('##### five')).toContain('<h5')
      expect(renderMarkdownWithLinks('###### six')).toContain('<h6')
    })

    it('does not leave the hash characters in the output', () => {
      expect(renderMarkdownWithLinks('### Heading three')).not.toContain('###')
    })

    it('renders a link inside a heading', () => {
      const html = renderMarkdownWithLinks('### See [docs](https://astrid.cc/docs)')
      expect(html).toContain('<h3')
      expect(html).toContain('href="https://astrid.cc/docs"')
    })
  })

  describe('lists', () => {
    it('renders a bullet list', () => {
      const html = renderMarkdownWithLinks('- one\n- two')
      expect(html).toContain('<ul>')
      expect(html).toContain('<li>')
      expect(html).toContain('one')
      expect(html).toContain('two')
    })

    it('renders a numbered list', () => {
      const html = renderMarkdownWithLinks('1. one\n2. two')
      expect(html).toContain('<ol>')
      expect(html).toContain('<li>')
    })

    it('renders task checkboxes', () => {
      const html = renderMarkdownWithLinks('- [ ] todo\n- [x] done')
      expect(html).toContain('type="checkbox"')
      expect(html).toContain('checked')
    })
  })

  describe('blocks', () => {
    it('renders a fenced code block as pre/code, with no stray backticks', () => {
      const html = renderMarkdownWithLinks('```\nconst x = 1\n```')
      expect(html).toContain('<pre>')
      expect(html).toContain('const x = 1')
      expect(html).not.toContain('`')
    })

    it('renders a blockquote', () => {
      expect(renderMarkdownWithLinks('> quoted')).toContain('<blockquote>')
    })

    it('renders a horizontal rule', () => {
      expect(renderMarkdownWithLinks('---')).toContain('<hr>')
    })

    it('renders a table', () => {
      const html = renderMarkdownWithLinks('| a | b |\n|---|---|\n| 1 | 2 |')
      expect(html).toContain('<table>')
      expect(html).toContain('<th>')
      expect(html).toContain('<td>')
    })
  })

  describe('inline', () => {
    it('renders strikethrough', () => {
      expect(renderMarkdownWithLinks('~~gone~~')).toContain('<del>')
    })

    it('still renders bold, italic and inline code', () => {
      expect(renderMarkdownWithLinks('**b**')).toContain('<strong>b</strong>')
      expect(renderMarkdownWithLinks('*i*')).toContain('<em>i</em>')
      expect(renderMarkdownWithLinks('`c`')).toContain('<code>c</code>')
    })
  })

  describe('links', () => {
    it('links a www. URL to its FULL host, not a truncated one', () => {
      // Regression: safeLinkify's trailing-character class backtracked and
      // produced href="https://www.astrid" with ".cc" orphaned outside the tag.
      const html = renderMarkdownWithLinks('go to www.astrid.cc now')
      expect(html).toContain('href="https://www.astrid.cc"')
      expect(html).not.toContain('href="https://www.astrid"')
    })

    it('links a scheme-qualified URL', () => {
      expect(renderMarkdownWithLinks('see https://astrid.cc here')).toContain(
        'href="https://astrid.cc"'
      )
    })

    it('does NOT link a bare domain with no scheme or www', () => {
      const html = renderMarkdownWithLinks('go to astrid.cc now')
      expect(html).not.toContain('<a')
    })

    it('opens external links in a new tab', () => {
      const html = renderMarkdownWithLinks('[docs](https://astrid.cc)')
      expect(html).toContain('target="_blank"')
      expect(html).toContain('rel="noopener noreferrer"')
    })
  })

  describe('security', () => {
    it('drops a javascript: href', () => {
      const html = renderMarkdownWithLinks('[click](javascript:alert(1))')
      expect(html).not.toContain('javascript:')
    })

    it('does not emit a script tag from raw HTML in the source', () => {
      const html = renderMarkdownWithLinks('<script>alert(1)</script>')
      expect(html).not.toContain('<script>')
    })

    it('does not emit an img tag from raw HTML in the source', () => {
      const html = renderMarkdownWithLinks('<img src=x onerror=alert(1)>')
      expect(html).not.toContain('<img')
      expect(html).not.toContain('onerror')
    })
  })

  describe('references survive full markdown rendering', () => {
    it('does not turn a task reference into an image', () => {
      const html = renderMarkdownWithLinks('blocked by ![Fix the thing](task-789)')
      expect(html).not.toContain('<img')
      expect(html).toContain('href="/?task=task-789"')
      expect(html).toContain('!Fix the thing')
    })

    it('keeps all three reference types inside a heading', () => {
      const html = renderMarkdownWithLinks('## @[Jon](u1) #[Web](l1) ![Task](t1)')
      expect(html).toContain('<h2')
      expect(html).toContain('href="/u/u1"')
      expect(html).toContain('href="/lists/l1"')
      expect(html).toContain('href="/?task=t1"')
    })

    it('keeps references inside a list item', () => {
      const html = renderMarkdownWithLinks('- see @[Jon](u1)')
      expect(html).toContain('<li>')
      expect(html).toContain('href="/u/u1"')
    })

    it('does not linkify a reference id as if it were a URL', () => {
      const html = renderMarkdownWithLinks('#[Astrid Web To-do](list-456)')
      expect(html).toContain('href="/lists/list-456"')
      expect(html).toContain('#Astrid Web To-do')
    })
  })
})
