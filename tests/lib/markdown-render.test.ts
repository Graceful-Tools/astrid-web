import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '@/lib/markdown'

describe('renderMarkdown — full markdown support', () => {
  describe('inline formatting', () => {
    it('renders bold text', () => {
      expect(renderMarkdown('**hello**')).toContain('<strong>hello</strong>')
    })

    it('renders italic text', () => {
      expect(renderMarkdown('*hello*')).toContain('<em>hello</em>')
    })

    it('renders inline code', () => {
      const html = renderMarkdown('run `npm test`')
      expect(html).toContain('<code')
      expect(html).toContain('npm test')
    })
  })

  describe('headings', () => {
    it('renders h1', () => {
      const html = renderMarkdown('# Title')
      expect(html).toContain('<h1')
      expect(html).toContain('Title')
    })

    it('renders h2', () => {
      const html = renderMarkdown('## Subtitle')
      expect(html).toContain('<h2')
      expect(html).toContain('Subtitle')
    })

    it('renders h3', () => {
      const html = renderMarkdown('### Section')
      expect(html).toContain('<h3')
      expect(html).toContain('Section')
    })

    it('renders inline markdown inside headings', () => {
      const html = renderMarkdown('## **Bold** heading')
      expect(html).toContain('<h2')
      expect(html).toContain('<strong>Bold</strong>')
    })
  })

  describe('lists', () => {
    it('renders unordered list with dashes', () => {
      const html = renderMarkdown('- item one\n- item two\n- item three')
      expect(html).toContain('<ul')
      expect(html).toContain('<li>item one</li>')
      expect(html).toContain('<li>item two</li>')
      expect(html).toContain('<li>item three</li>')
    })

    it('renders unordered list with asterisks', () => {
      const html = renderMarkdown('* foo\n* bar')
      expect(html).toContain('<ul')
      expect(html).toContain('<li>foo</li>')
    })

    it('renders ordered list', () => {
      const html = renderMarkdown('1. first\n2. second\n3. third')
      expect(html).toContain('<ol')
      expect(html).toContain('<li>first</li>')
      expect(html).toContain('<li>second</li>')
    })

    it('renders inline markdown inside list items', () => {
      const html = renderMarkdown('- **bold** item\n- `code` item')
      expect(html).toContain('<strong>bold</strong>')
      expect(html).toContain('<code')
    })
  })

  describe('code blocks', () => {
    it('renders fenced code blocks', () => {
      const html = renderMarkdown('```\nnpm run test\n```')
      expect(html).toContain('<pre')
      expect(html).toContain('<code>')
      expect(html).toContain('npm run test')
    })

    it('escapes HTML inside code blocks', () => {
      const html = renderMarkdown('```\n<script>alert("xss")</script>\n```')
      expect(html).toContain('&lt;script&gt;')
      expect(html).not.toContain('<script>')
    })

    it('preserves multiple lines in code blocks', () => {
      const html = renderMarkdown('```\nline 1\nline 2\nline 3\n```')
      expect(html).toContain('line 1\nline 2\nline 3')
    })
  })

  describe('tables', () => {
    it('renders a markdown table', () => {
      const md = '| Command | Purpose |\n|---------|----------|\n| `npm test` | Run tests |\n| `npm build` | Build app |'
      const html = renderMarkdown(md)
      expect(html).toContain('<table')
      expect(html).toContain('<th')
      expect(html).toContain('Command')
      expect(html).toContain('<td')
      expect(html).toContain('Run tests')
    })

    it('renders inline markdown inside table cells', () => {
      const md = '| Name | Status |\n|------|--------|\n| **bold** | `code` |'
      const html = renderMarkdown(md)
      expect(html).toContain('<strong>bold</strong>')
      expect(html).toContain('<code')
    })
  })

  describe('mixed content', () => {
    it('renders headings followed by lists', () => {
      const md = '## Steps\n- step one\n- step two'
      const html = renderMarkdown(md)
      expect(html).toContain('<h2')
      expect(html).toContain('<ul')
    })

    it('handles empty input', () => {
      expect(renderMarkdown('')).toBe('')
    })

    it('handles plain text without markdown', () => {
      const html = renderMarkdown('just plain text')
      expect(html).toContain('just plain text')
    })
  })
})
