import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { TaskLeadingControl } from '@/components/task-leading-control'
import { designTokens } from '@/lib/design/tokens'
import { getPriorityColor } from '@/lib/task-leading-control'
import en from '@/lib/i18n/locales/en.json'

/**
 * AWTD-1571: a repeating task assigned to someone else, or to nobody, wore the
 * same plain square as a one-off. Only your own task showed the repeat arrows.
 * The arrows are now the border of the photo / "U" mark too.
 */
function renderControl(props: Partial<React.ComponentProps<typeof TaskLeadingControl>> = {}) {
  const onToggleComplete = vi.fn()
  const onOpenOptions = vi.fn()
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TaskLeadingControl
        currentUserId="me"
        completed={false}
        priority={2}
        onToggleComplete={onToggleComplete}
        onOpenOptions={onOpenOptions}
        {...props}
      />
    </NextIntlClientProvider>
  )
  return { onToggleComplete, onOpenOptions }
}

describe('TaskLeadingControl repeating marks (AWTD-1571)', () => {
  it("frames another user's photo in the repeat arrows when the task repeats", () => {
    renderControl({ assigneeId: 'other', assignee: { name: 'Ada Lovelace' }, repeating: true })

    expect(screen.getByTestId('repeat-frame')).toBeInTheDocument()
    expect(screen.getByText('Ad')).toBeInTheDocument()
  })

  it('frames the "U" mark in the repeat arrows when an unassigned task repeats', () => {
    renderControl({ assigneeId: null, repeating: true })

    expect(screen.getByTestId('repeat-frame')).toBeInTheDocument()
    expect(screen.getByText('U')).toBeInTheDocument()
  })

  // AWTD-1574 moved the size itself to the token (34); the rule is unchanged:
  // the frame is the size of every other leading control.
  it("AWTD-1576: the repeat frame is the checkbox's own size, so repeating rows line up", () => {
    renderControl({ assigneeId: 'other', assignee: { name: 'Ada Lovelace' }, repeating: true })
    const frame = screen.getByTestId('repeat-frame')
    expect(frame).toHaveClass('h-leading-control', 'w-leading-control')
    expect(frame).not.toHaveClass('w-10')
  })

  it('draws no repeat frame for a one-off task', () => {
    renderControl({ assigneeId: 'other', assignee: { name: 'Ada Lovelace' } })
    expect(screen.queryByTestId('repeat-frame')).not.toBeInTheDocument()
  })

  it('still opens the options sheet when a repeating photo is tapped', async () => {
    const user = userEvent.setup()
    const { onOpenOptions, onToggleComplete } = renderControl({
      assigneeId: 'other',
      assignee: { name: 'Ada Lovelace' },
      repeating: true,
    })

    await user.click(screen.getByText('Ad'))

    expect(onOpenOptions).toHaveBeenCalledTimes(1)
    expect(onToggleComplete).not.toHaveBeenCalled()
  })
})

/**
 * AWTD-1579: "Update repeating task assigned to match recently fixed iOS."
 * iOS (AITD-612, reopened) stopped shrinking the photo inside the repeat arrows:
 * the photo or "U" fills the whole square, clipped to the same rounded square as
 * a one-off's, and the arrows are drawn as its border in place of the priority
 * outline. Web still drew a 20px round photo inside the 32px arrows bitmap.
 */
describe('TaskLeadingControl repeating marks match iOS (AWTD-1579)', () => {
  const other = { assigneeId: 'other', assignee: { name: 'Ada Lovelace' } }

  it("AWTD-1579: a repeating task's photo is the same rounded square as a one-off's, not a small circle", () => {
    renderControl({ ...other, repeating: true })

    const mark = screen.getByTestId('repeat-frame-mark')
    expect(mark).toHaveClass('repeat-frame-mark', 'rounded-lg', 'overflow-hidden')
    const avatar = screen.getByText('Ad').parentElement!
    expect(mark).toContainElement(avatar)
    expect(avatar).toHaveClass('h-full', 'w-full', 'rounded-lg')
    expect(avatar).not.toHaveClass('h-5')
    expect(avatar).not.toHaveClass('rounded-full')
  })

  it("AWTD-1579: the initials and the \"U\" are the one-off's size inside the arrows", () => {
    renderControl({ ...other, repeating: true })
    expect(screen.getByText('Ad')).toHaveClass('text-xs')
    expect(screen.getByText('Ad')).not.toHaveClass('text-[10px]')
  })

  it('AWTD-1579: the "U" of an unassigned repeating task is the one-off\'s size', () => {
    renderControl({ assigneeId: null, repeating: true })
    expect(screen.getByTestId('repeat-frame-mark')).toContainElement(screen.getByText('U'))
    expect(screen.getByText('U')).toHaveClass('text-sm')
  })

  it('AWTD-1579: the arrows are drawn as the border in the priority colour, not the checkbox bitmap', () => {
    renderControl({ ...other, repeating: true, priority: 3 })

    const frame = screen.getByTestId('repeat-frame')
    expect(frame.querySelector('img[src*="check_box_repeat"]')).toBeNull()
    const arrows = screen.getByTestId('repeat-frame-arrows')
    expect(arrows.tagName.toLowerCase()).toBe('svg')
    expect(arrows).toHaveClass('repeat-frame-arrows')
    expect(arrows).toHaveAttribute('aria-hidden', 'true')
    expect(arrows).toHaveStyle({ color: getPriorityColor(3) })
    // Two brackets, each ending in an arrowhead: rotationally symmetric.
    expect(arrows.querySelectorAll('path')).toHaveLength(2)
    expect(arrows.querySelectorAll('polygon')).toHaveLength(2)
    // The arrows replace the plain priority outline; they are not drawn on top of it.
    expect(frame.querySelector('.border-2')).toBeNull()
  })

  it('AWTD-1579: a one-off keeps the plain priority square', () => {
    renderControl(other)
    const avatar = screen.getByText('Ad').parentElement!
    expect(avatar).toHaveClass('w-leading-control', 'h-leading-control', 'rounded-lg', 'border-2')
    expect(screen.queryByTestId('repeat-frame-arrows')).not.toBeInTheDocument()
  })

  it('AWTD-1579: the frame and the photo inside it are sized by the design tokens, both the whole square', () => {
    expect(designTokens.size['repeat-frame-scale']).toBe(1)
    expect((designTokens.size as Record<string, unknown>)['repeat-frame-inner-scale']).toBe(1)

    const css = readFileSync(join(process.cwd(), 'styles', 'components.css'), 'utf8')
    const rule = (selector: string) => {
      const start = css.indexOf(`${selector} {`)
      expect(start, `${selector} is in styles/components.css`).toBeGreaterThan(-1)
      return css.slice(start, css.indexOf('}', start))
    }
    expect(rule('.repeat-frame-arrows')).toContain('var(--astrid-size-repeat-frame-scale)')
    expect(rule('.repeat-frame-mark')).toContain('var(--astrid-size-repeat-frame-inner-scale)')
  })
})

