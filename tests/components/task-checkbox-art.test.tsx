/**
 * AWTD-1581: the checkbox is drawn, not sixteen PNGs, so it takes the priority
 * tokens (and a partner's brand, and Dark's lighter low priority) like the
 * square beside it. AWTD-1605: the shapes are astrid-core's shared art,
 * vendored in packages/astrid-design (tests/styles/design-assets.test.ts).
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
    const box = art.querySelectorAll('[data-layer="box"] path')
    expect(box.length).toBeGreaterThan(0)
    for (const path of box) expect(path).toHaveAttribute('stroke', 'currentColor')
  })

  it('AWTD-1581: checked adds the check; repeating swaps the box for the arrows', () => {
    const { container, rerender } = render(<TaskCheckbox checked onToggle={vi.fn()} priority={2} repeating />)
    const art = () => container.querySelector('svg[data-testid="task-checkbox-art"]')!
    const layers = () => [...art().querySelectorAll('[data-layer]')].map((g) => g.getAttribute('data-layer'))
    expect(layers()).toEqual(['repeat', 'check'])
    rerender(<TaskCheckbox checked={false} onToggle={vi.fn()} priority={2} />)
    expect(layers()).toEqual(['box'])
    expect(art().querySelector('filter')).toBeNull()
  })

  it('AWTD-1605: the shapes are the vendored shared art, and the check is the checkbox-check token', () => {
    const shared = JSON.parse(read('packages/astrid-design/checkbox-art.json')) as {
      layers: Record<string, { role: string; d: string }[]>
    }
    const { container } = render(<TaskCheckbox checked onToggle={vi.fn()} priority={1} />)
    const art = container.querySelector('svg[data-testid="task-checkbox-art"]')!
    expect(art).toHaveAttribute('viewBox', '0 0 56 56')
    for (const layer of ['box', 'check']) {
      const drawn = [...art.querySelectorAll(`[data-layer="${layer}"] path`)].map((p) => p.getAttribute('d'))
      expect(drawn, layer).toEqual(shared.layers[layer].map((shape) => shape.d))
    }
    const check = [...art.querySelectorAll('[data-layer="check"] path')].find((p) => !p.hasAttribute('filter'))!
    expect(check.getAttribute('style')).toContain('rgb(var(--astrid-checkbox-check))')
    expect(read('components/task-checkbox-art.tsx')).not.toMatch(/#[0-9a-fA-F]{6}\b/)
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
