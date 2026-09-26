/**
 * @vitest-environment jsdom
 */

/**
 * AWTD-1017 — comments and chat autolink task ids once they are handed the
 * reader's context, and link nothing without one.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { MessageBubble } from '@/components/shared/MessageBubble'

const base = { id: 'm1', isOwnMessage: false, createdAt: new Date('2026-09-26T12:00:00Z') }

describe('MessageBubble task-id links (AWTD-1017)', () => {
  it('links AWTD-12 and #13 to /t/', () => {
    const { container } = render(
      <MessageBubble {...base} content="Blocked by AWTD-12 and #13" identifiers={{ keys: ['AWTD'], projectKey: 'AWTD' }} />
    )
    const hrefs = Array.from(container.querySelectorAll('a')).map(a => a.getAttribute('href'))
    expect(hrefs).toEqual(['/t/AWTD-12', '/t/AWTD-13'])
  })

  it('links nothing without a context', () => {
    const { container } = render(<MessageBubble {...base} content="Blocked by AWTD-12" />)
    expect(container.querySelector('a[href^="/t/"]')).toBeNull()
  })
})
