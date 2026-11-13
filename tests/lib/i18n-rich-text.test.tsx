/** AWTD-1613: the tag helper Help uses instead of next-intl's t.rich. */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { richText } from '@/lib/i18n/rich-text'

const tags = { b: (chunks: string) => <strong>{chunks}</strong>, kbd: (chunks: string) => <kbd>{chunks}</kbd> }
const html = (message: string) => renderToStaticMarkup(<p>{richText(message, tags)}</p>)

describe('richText', () => {
  it('draws the named tags where the sentence puts them', () => {
    expect(html('Go to <b>Settings</b> → <b>Account</b>.')).toBe('<p>Go to <strong>Settings</strong> → <strong>Account</strong>.</p>')
    expect(html('<kbd>F5</kbd> or <kbd>Cmd+R</kbd>')).toBe('<p><kbd>F5</kbd> or <kbd>Cmd+R</kbd></p>')
  })

  it('leaves a sentence without tags, and tags it was not given, as text', () => {
    expect(richText('No tags here', tags)).toBe('No tags here')
    expect(html('a <i>b</i> <b>c</b>')).toBe('<p>a &lt;i&gt;b&lt;/i&gt; <strong>c</strong></p>')
  })
})
