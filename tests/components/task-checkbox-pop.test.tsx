/**
 * Completing a task pops its checkbox and taps back (Jon, 2026-11-10: "Mac +
 * iOS (haptic is good)"). The Mac pops the checkbox on a spring and iOS gives a
 * haptic; every client does both where the device can
 * (docs/specs/DESIGN_SYSTEM.md → Motion).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { TaskCheckbox } from '@/components/task-checkbox'

afterEach(() => {
  // @ts-expect-error jsdom has no vibrate; each test installs its own
  delete navigator.vibrate
})

describe('completing a task', () => {
  it('pops the checkbox and gives a haptic where the device has one', () => {
    const vibrate = vi.fn()
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true })
    const { container } = render(<TaskCheckbox checked={false} onToggle={vi.fn()} priority={1} />)

    fireEvent.click(screen.getByRole('checkbox'))

    expect(container.querySelector('img')).toHaveClass('task-checkbox-pop')
    expect(vibrate).toHaveBeenCalledWith(10)
  })

  it('works on a device with no haptic', () => {
    const onToggle = vi.fn()
    const { container } = render(<TaskCheckbox checked={false} onToggle={onToggle} priority={1} />)
    fireEvent.keyDown(screen.getByRole('checkbox'), { key: ' ' })
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(container.querySelector('img')).toHaveClass('task-checkbox-pop')
  })

  it('reopening a task does neither', () => {
    const vibrate = vi.fn()
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true })
    const { container } = render(<TaskCheckbox checked onToggle={vi.fn()} priority={1} />)

    fireEvent.click(screen.getByRole('checkbox'))

    expect(container.querySelector('img')).not.toHaveClass('task-checkbox-pop')
    expect(vibrate).not.toHaveBeenCalled()
  })

  // jsdom cannot deliver animationend to React, so the reset is checked through
  // the other path: a task that is reopened is no longer popping.
  it('is not left popping once the task is reopened', () => {
    const { container, rerender } = render(<TaskCheckbox checked={false} onToggle={vi.fn()} priority={1} />)
    fireEvent.click(screen.getByRole('checkbox'))
    rerender(<TaskCheckbox checked onToggle={vi.fn()} priority={1} />)
    expect(container.querySelector('img')).toHaveClass('task-checkbox-pop')
    rerender(<TaskCheckbox checked={false} onToggle={vi.fn()} priority={1} />)
    expect(container.querySelector('img')).not.toHaveClass('task-checkbox-pop')
  })

  it('only moves for someone who has not asked for reduced motion, and from the tokens', () => {
    const css = readFileSync(join(process.cwd(), 'styles', 'components.css'), 'utf8')
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: no-preference\) \{\s*\.task-checkbox-pop \{\s*animation: taskCheckboxPop var\(--astrid-motion-spring-duration\)/,
    )
    expect(css).toContain('transform: scale(var(--astrid-state-complete-pop-scale));')
  })
})
