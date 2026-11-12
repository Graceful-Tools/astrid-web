/**
 * AWTD-1581: the checkbox is drawn, not sixteen PNGs, so it takes the priority
 * tokens (and a partner's brand, and Dark's lighter low priority) like the
 * square beside it. Interim step 5 of the shared-assets proposal; the art's
 * home moves to astrid-core with the core half.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

import { TaskCheckbox } from '@/components/task-checkbox'
import { priorityTextClass } from '@/lib/design/priority'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('the checkbox art (AWTD-1581)', () => {
  it.each([0, 1, 2, 3] as const)('AWTD-1581: priority %i is drawn in its priority token, not a bitmap', (priority) => {
    const { container } = render(<TaskCheckbox checked={false} onToggle={vi.fn()} priority={priority} />)
    expect(container.querySelector('img')).toBeNull()
    const art = container.querySelector('svg[data-testid="task-checkbox-art"]')!
    expect(art).toHaveClass(priorityTextClass(priority))
    expect(art.querySelector('rect')).toHaveAttribute('stroke', 'currentColor')
  })

  it('AWTD-1581: checked adds the check; repeating swaps the box for the arrows', () => {
    const { container, rerender } = render(<TaskCheckbox checked onToggle={vi.fn()} priority={2} repeating />)
    const art = () => container.querySelector('svg[data-testid="task-checkbox-art"]')!
    expect(art().querySelector('rect')).toBeNull()
    expect(art().querySelectorAll('polygon')).toHaveLength(2)
    expect(art().querySelectorAll('polyline')).toHaveLength(2)
    rerender(<TaskCheckbox checked={false} onToggle={vi.fn()} priority={2} />)
    expect(art().querySelector('rect')).not.toBeNull()
    expect(art().querySelectorAll('polygon, polyline')).toHaveLength(0)
  })

  it('AWTD-1581: two checked boxes on a page do not share a shadow filter id', () => {
    const { container } = render(
      <>
        <TaskCheckbox checked onToggle={vi.fn()} priority={1} />
        <TaskCheckbox checked onToggle={vi.fn()} priority={3} />
      </>,
    )
    const ids = [...container.querySelectorAll('filter')].map((f) => f.id)
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })

  it.each(['components/task-checkbox.tsx', 'components/quick-add.tsx'])('AWTD-1581: %s no longer loads the PNGs', (file) => {
    expect(read(file)).not.toMatch(/check_box/)
  })
})
