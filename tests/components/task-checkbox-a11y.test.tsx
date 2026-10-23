/**
 * The task checkbox is a checkbox to assistive tech and keyboards (AWTD-1339).
 * It was a bare clickable div with no role or name, so no screen reader,
 * keyboard user or end-to-end test could find "the checkbox for this task".
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TaskCheckbox } from '@/components/task-checkbox'

describe('TaskCheckbox (AWTD-1339)', () => {
  it('is a named checkbox that reports its state', () => {
    const { rerender } = render(<TaskCheckbox checked={false} onToggle={vi.fn()} priority={0} />)
    expect(screen.getByRole('checkbox', { name: 'Mark complete' })).toHaveAttribute('aria-checked', 'false')
    rerender(<TaskCheckbox checked onToggle={vi.fn()} priority={0} />)
    expect(screen.getByRole('checkbox', { name: 'Mark incomplete' })).toHaveAttribute('aria-checked', 'true')
  })

  it('toggles from the keyboard, with Space or Enter', () => {
    const onToggle = vi.fn()
    render(<TaskCheckbox checked={false} onToggle={onToggle} priority={2} />)
    const box = screen.getByRole('checkbox')
    fireEvent.keyDown(box, { key: ' ' })
    fireEvent.keyDown(box, { key: 'Enter' })
    fireEvent.keyDown(box, { key: 'a' })
    expect(onToggle).toHaveBeenCalledTimes(2)
  })

  it('still toggles on click without bubbling to the row', () => {
    const onToggle = vi.fn()
    const rowClick = vi.fn()
    render(<div onClick={rowClick}><TaskCheckbox checked={false} onToggle={onToggle} priority={0} /></div>)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(rowClick).not.toHaveBeenCalled()
  })
})
