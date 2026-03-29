import { describe, it, expect } from 'vitest'
import { renderMarkdownWithLinks } from '@/lib/markdown'

describe('renderMarkdownWithLinks — reference rendering', () => {
  // ─── @mention rendering ──────────────────────────────────
  describe('@mention references', () => {
    it('renders @[Name](userId) as a linked mention with blue classes', () => {
      const html = renderMarkdownWithLinks('@[Alice](user-123)')
      expect(html).toContain('href="/u/user-123"')
      expect(html).toContain('@Alice')
      expect(html).toContain('text-blue-700')
      expect(html).toContain('bg-blue-100')
    })

    it('includes dark mode classes', () => {
      const html = renderMarkdownWithLinks('@[Bob](user-456)')
      expect(html).toContain('dark:text-blue-300')
      expect(html).toContain('dark:bg-blue-900/30')
    })
  })

  // ─── #list rendering ─────────────────────────────────────
  describe('#list references', () => {
    it('renders #[ListName](listId) as a linked list reference with green classes', () => {
      const html = renderMarkdownWithLinks('#[Work](list-abc)')
      expect(html).toContain('href="/lists/list-abc"')
      expect(html).toContain('#Work')
      expect(html).toContain('text-green-700')
      expect(html).toContain('bg-green-100')
    })

    it('includes dark mode classes for lists', () => {
      const html = renderMarkdownWithLinks('#[Personal](list-xyz)')
      expect(html).toContain('dark:text-green-300')
      expect(html).toContain('dark:bg-green-900/30')
    })
  })

  // ─── !task rendering ─────────────────────────────────────
  describe('!task references', () => {
    it('renders ![TaskTitle](taskId) as a linked task reference with amber classes', () => {
      const html = renderMarkdownWithLinks('![Buy milk](task-789)')
      expect(html).toContain('href="/?task=task-789"')
      expect(html).toContain('!Buy milk')
      expect(html).toContain('text-amber-700')
      expect(html).toContain('bg-amber-100')
    })

    it('includes dark mode classes for tasks', () => {
      const html = renderMarkdownWithLinks('![Fix bug](task-001)')
      expect(html).toContain('dark:text-amber-300')
      expect(html).toContain('dark:bg-amber-900/30')
    })
  })

  // ─── Mixed content ───────────────────────────────────────
  describe('mixed content', () => {
    it('renders text with all three reference types correctly', () => {
      const input = 'Hey @[Alice](u1), check #[Work](l1) for ![Fix bug](t1)'
      const html = renderMarkdownWithLinks(input)

      // Mention
      expect(html).toContain('href="/u/u1"')
      expect(html).toContain('@Alice')

      // List
      expect(html).toContain('href="/lists/l1"')
      expect(html).toContain('#Work')

      // Task
      expect(html).toContain('href="/?task=t1"')
      expect(html).toContain('!Fix bug')

      // Surrounding text preserved
      expect(html).toContain('Hey')
      expect(html).toContain('check')
      expect(html).toContain('for')
    })
  })

  // ─── References processed before safeLinkify ─────────────
  describe('references processed before safeLinkify', () => {
    it('reference [Name](id) is NOT treated as a markdown link', () => {
      const html = renderMarkdownWithLinks('@[Alice](user-123)')
      // Should be rendered as mention, not as a generic markdown link
      expect(html).toContain('href="/u/user-123"')
      expect(html).toContain('@Alice')
      // Should NOT have target="_blank" (that is for external links)
      // The mention link should use the mention-specific classes
      expect(html).toContain('bg-blue-100')
    })

    it('#[Name](id) is NOT treated as a markdown link', () => {
      const html = renderMarkdownWithLinks('#[Groceries](list-1)')
      expect(html).toContain('href="/lists/list-1"')
      expect(html).toContain('#Groceries')
      expect(html).toContain('bg-green-100')
    })
  })

  // ─── Plain markdown still works ──────────────────────────
  describe('plain markdown alongside references', () => {
    it('renders **bold** text', () => {
      const html = renderMarkdownWithLinks('**bold text** and @[Alice](u1)')
      expect(html).toContain('<strong>bold text</strong>')
      expect(html).toContain('@Alice')
    })

    it('renders *italic* text', () => {
      const html = renderMarkdownWithLinks('*italic* and #[Work](l1)')
      expect(html).toContain('<em>italic</em>')
      expect(html).toContain('#Work')
    })

    it('renders `code` text', () => {
      const html = renderMarkdownWithLinks('`code` and ![Task](t1)')
      expect(html).toContain('<code>code</code>')
      expect(html).toContain('!Task')
    })
  })

  // ─── HTML escaping ───────────────────────────────────────
  describe('HTML escaping', () => {
    it('escapes <script> in reference name', () => {
      const html = renderMarkdownWithLinks('@[<script>alert(1)</script>](user-evil)')
      expect(html).not.toContain('<script>')
      expect(html).toContain('&lt;script&gt;')
    })

    it('escapes HTML entities in list name', () => {
      const html = renderMarkdownWithLinks('#[List & <b>Friends</b>](list-esc)')
      expect(html).toContain('&amp;')
      expect(html).toContain('&lt;b&gt;')
      expect(html).not.toContain('<b>Friends</b>')
    })
  })

  // ─── Regular markdown links still work ───────────────────
  describe('regular markdown links', () => {
    it('[Google](https://google.com) is still linkified', () => {
      const html = renderMarkdownWithLinks('Visit [Google](https://google.com)')
      expect(html).toContain('href="https://google.com"')
      expect(html).toContain('>Google</a>')
      expect(html).toContain('target="_blank"')
    })

    it('regular links coexist with references', () => {
      const input = '@[Alice](u1) shared [Link](https://example.com) on #[Work](l1)'
      const html = renderMarkdownWithLinks(input)
      expect(html).toContain('href="/u/u1"')
      expect(html).toContain('href="https://example.com"')
      expect(html).toContain('href="/lists/l1"')
    })
  })

  // ─── Edge cases ──────────────────────────────────────────
  describe('edge cases', () => {
    it('returns empty string for empty input', () => {
      expect(renderMarkdownWithLinks('')).toBe('')
    })

    it('encodes special characters in IDs', () => {
      const html = renderMarkdownWithLinks('@[User](id with spaces)')
      expect(html).toContain('href="/u/id%20with%20spaces"')
    })

    it('handles newlines as <br>', () => {
      const html = renderMarkdownWithLinks('line1\nline2')
      expect(html).toContain('<br>')
    })
  })
})
