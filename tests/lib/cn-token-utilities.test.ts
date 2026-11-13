import { describe, expect, it } from 'vitest'
import { cn } from '@/lib/utils'

// AWTD-1575: the token utilities are not in tailwind-merge's default tables, so
// a caller's override of a primitive's class kept both and CSS order decided.
describe('cn() merges the design-token utilities (AWTD-1575)', () => {
  it('lets a later opacity override a token opacity, and the reverse', () => {
    expect(cn('disabled:opacity-disabled', 'disabled:opacity-40')).toBe('disabled:opacity-40')
    expect(cn('opacity-50', 'opacity-completed')).toBe('opacity-completed')
  })

  it('lets a later duration or curve override a token one, and the reverse', () => {
    expect(cn('duration-200', 'duration-medium')).toBe('duration-medium')
    expect(cn('duration-panel', 'duration-300')).toBe('duration-300')
    expect(cn('ease-out', 'ease-fast')).toBe('ease-fast')
  })

  it('treats the press scale and the leading-control size as scale and size', () => {
    expect(cn('active:scale-95', 'active:scale-press')).toBe('active:scale-press')
    expect(cn('w-8 h-8', 'w-leading-control h-leading-control')).toBe('w-leading-control h-leading-control')
  })

  it('still merges theme colours as colours and keeps a size beside them', () => {
    expect(cn('text-theme-muted', 'text-danger')).toBe('text-danger')
    expect(cn('text-sm', 'text-theme-muted')).toBe('text-sm text-theme-muted')
    expect(cn('bg-theme-surface', 'bg-brand')).toBe('bg-brand')
    expect(cn('border-theme', 'border-brand')).toBe('border-brand')
  })

  // AWTD-1615: the type-scale sizes are sizes, not colours.
  it('keeps a token font size beside a colour in either order, and lets it override text-xs', () => {
    expect(cn('text-caption2', 'text-theme-muted')).toBe('text-caption2 text-theme-muted')
    expect(cn('text-warning', 'text-caption2')).toBe('text-warning text-caption2')
    expect(cn('text-xs', 'text-caption2')).toBe('text-caption2')
    expect(cn('text-footnote', 'text-sm')).toBe('text-sm')
  })
})
