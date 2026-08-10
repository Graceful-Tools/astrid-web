/**
 * Task 0a54e46f — the rendered markdown has to LOOK rendered.
 *
 * Tailwind preflight strips the browser's default heading, list, quote and
 * table styles. Without a `.prose` container (app/globals.css restores them
 * there) a heading parses into a correct `<h1>` and then renders at body size
 * with no weight — the markup is right, the reader sees no difference, and
 * every renderer unit test still passes.
 *
 * That is the exact failure this file exists to catch, because it is invisible
 * to lib/markdown tests.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import '@testing-library/jest-dom'
import { readFileSync } from 'fs'
import { join } from 'path'
import { MessageBubble } from '@/components/shared/MessageBubble'

describe('markdown surfaces render inside a .prose container (task 0a54e46f)', () => {
  it('MessageBubble — the comment and chat surface — wraps content in .prose', () => {
    const { container } = render(
      <MessageBubble
        id="m1"
        content={'## Heading\n\n- one\n- two'}
        isOwnMessage={false}
        createdAt={new Date('2026-08-09T12:00:00Z')}
      />
    )

    const heading = container.querySelector('h2')
    expect(heading).toBeInTheDocument()

    // The heading must sit inside a .prose ancestor, or it renders unstyled.
    expect(heading?.closest('.prose')).not.toBeNull()
  })

  it('MessageBubble renders list markup, not literal dashes', () => {
    const { container } = render(
      <MessageBubble
        id="m2"
        content={'- one\n- two'}
        isOwnMessage={false}
        createdAt={new Date('2026-08-09T12:00:00Z')}
      />
    )

    expect(container.querySelector('ul')).toBeInTheDocument()
    expect(container.querySelectorAll('li')).toHaveLength(2)
    expect(container.textContent).not.toContain('- one')
  })

  // The two description surfaces are checked at the source level rather than
  // rendered: both live inside components whose full render pulls in the task
  // detail tree, and the property under test is a single className on the
  // element that receives the rendered HTML. A source check states that
  // invariant directly instead of standing up a page to infer it.
  const DESCRIPTION_SURFACES = [
    'components/task-detail/TaskFieldEditors.tsx',
    'components/task-detail-viewonly.tsx',
  ]

  it.each(DESCRIPTION_SURFACES)(
    '%s renders the description through a .prose container',
    file => {
      const source = readFileSync(join(process.cwd(), file), 'utf8')

      // Find the element that injects rendered markdown, and require `prose`
      // in the className of that same element.
      const injection = source.indexOf('renderMarkdownWithLinks(task.description')
      expect(injection).toBeGreaterThan(-1)

      const elementStart = source.lastIndexOf('<div', injection)
      const openingTag = source.slice(elementStart, injection)

      // Read the className VALUE rather than scanning the whole tag: the first
      // version of this check searched the raw slice and was satisfied by the
      // word "prose" appearing in a code comment above the attribute, so it
      // passed with the class removed.
      const className = openingTag.match(/className="([^"]*)"/)?.[1]
      expect(className, `no className on the element receiving markdown in ${file}`).toBeDefined()
      expect(className!.split(/\s+/)).toContain('prose')
    }
  )
})
