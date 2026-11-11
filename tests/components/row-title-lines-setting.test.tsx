/**
 * The "Task titles" setting is kept per machine and applied as a class on the
 * document (docs/specs/DESIGN_SYSTEM.md → States; Jon, 2026-11-10).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'

import { ThemeProvider, useTheme } from '@/contexts/theme-context'
import { ROW_TITLE_STORAGE_KEY } from '@/lib/design/row-title'

function Probe() {
  const { rowTitleLines, setRowTitleLines } = useTheme()
  return (
    <button data-lines={rowTitleLines} onClick={() => setRowTitleLines('2')}>
      probe
    </button>
  )
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.className = ''
})

describe('row title lines setting', () => {
  it('wraps when nothing is stored', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(screen.getByRole('button')).toHaveAttribute('data-lines', 'wrap')
    expect(document.documentElement).toHaveClass('row-title-wrap')
  })

  it('applies the stored choice and does not overwrite it on load', () => {
    localStorage.setItem(ROW_TITLE_STORAGE_KEY, '1')
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(document.documentElement).toHaveClass('row-title-1')
    expect(document.documentElement).not.toHaveClass('row-title-wrap')
    expect(localStorage.getItem(ROW_TITLE_STORAGE_KEY)).toBe('1')
  })

  it('stores a new choice and swaps the class', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>)
    act(() => screen.getByRole('button').click())
    expect(localStorage.getItem(ROW_TITLE_STORAGE_KEY)).toBe('2')
    expect(document.documentElement).toHaveClass('row-title-2')
    expect(document.documentElement).not.toHaveClass('row-title-wrap')
  })
})
