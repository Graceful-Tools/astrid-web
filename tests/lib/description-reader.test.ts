/**
 * AWTD-1629 — web half of iOS AITD-649. Mirrors
 * `DescriptionReader.initialMode(text, isReadOnly, entry:)` in astrid-ios.
 */
import { describe, it, expect } from 'vitest'
import { descriptionReaderInitialMode, descriptionReaderSaveNeeded } from '@/lib/description-reader'

describe('descriptionReaderInitialMode (AWTD-1629)', () => {
  it('tapping to write opens edit mode, even over an existing description', () => {
    expect(descriptionReaderInitialMode('Some text', false, 'write')).toBe('edit')
    expect(descriptionReaderInitialMode('', false, 'write')).toBe('edit')
  })

  it('the expand button reads a written description', () => {
    expect(descriptionReaderInitialMode('Some text', false, 'expand')).toBe('preview')
  })

  it('the expand button on an empty description opens editing', () => {
    expect(descriptionReaderInitialMode('', false, 'expand')).toBe('edit')
    expect(descriptionReaderInitialMode('  \n', false, 'expand')).toBe('edit')
  })

  it('a read-only task never opens an editor', () => {
    expect(descriptionReaderInitialMode('Some text', true, 'write')).toBe('preview')
    expect(descriptionReaderInitialMode('', true, 'expand')).toBe('preview')
  })
})

describe('descriptionReaderSaveNeeded (AWTD-1629)', () => {
  it('saves only when the text changed, and clearing counts as a change', () => {
    expect(descriptionReaderSaveNeeded('a', 'a')).toBe(false)
    expect(descriptionReaderSaveNeeded('a', 'ab')).toBe(true)
    expect(descriptionReaderSaveNeeded('a', '')).toBe(true)
    expect(descriptionReaderSaveNeeded(undefined, '')).toBe(false)
  })
})
