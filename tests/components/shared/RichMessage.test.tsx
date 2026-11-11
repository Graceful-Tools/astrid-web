/**
 * AWTD-1575 — a translated sentence with an element in the middle of it.
 *
 * The locale files hold no markup, so the bold word, link or <code> address is
 * handed to the message by placeholder name and lands wherever that language
 * put the placeholder.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { RichMessage, fillMessage } from '@/components/shared/RichMessage'

describe('RichMessage', () => {
  it('puts each element where its placeholder is, in the order the message has them', () => {
    const { container } = render(
      <p>
        <RichMessage
          message="{b} zuerst, dann {a}."
          values={{ a: <strong>A</strong>, b: <em>B</em> }}
        />
      </p>,
    )
    expect(container.querySelector('p')?.innerHTML).toBe('<em>B</em> zuerst, dann <strong>A</strong>.')
  })

  it('fills a placeholder that appears twice, and leaves an unknown one as written', () => {
    const { container } = render(
      <p>
        <RichMessage message="{x} and {x}, not {y}" values={{ x: 'one' }} />
      </p>,
    )
    expect(container.textContent).toBe('one and one, not {y}')
  })
})

describe('fillMessage', () => {
  it('inserts a typed name literally, whatever it contains', () => {
    // String.replace reads "$&" in a replacement as "the match"; a list may be named anything.
    expect(fillMessage('Delete "{name}"?', { name: 'Cash $& carry' })).toBe('Delete "Cash $& carry"?')
  })

  it('leaves a placeholder with no value alone', () => {
    expect(fillMessage('{a} {b}', { a: '1' })).toBe('1 {b}')
  })
})
