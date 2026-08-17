/**
 * @vitest-environment jsdom
 */

/**
 * The quick picker's shape (task 8599e136).
 *
 * Jon: "quick picker is full width. it shouldn't be. priority pickers should be
 * rounded square and the width should not be full width. It can be taller given
 * we have more choices and need more vertical height to show the assignee
 * picker."
 *
 * WHAT THESE CAN AND CANNOT PROVE, stated up front because it matters. jsdom
 * computes no layout, so nothing here measures a pixel. They assert the
 * geometry-bearing classes and the structure that produces them — enough to
 * catch someone reinstating `flex-1` or dropping the max-width, which is the
 * regression worth guarding. Whether it LOOKS right on a phone and a desktop
 * window is a judgement only a real browser can settle, and I have not made it.
 *
 * The three constraints, and why each was wrong before:
 *   - `inset-x-0` alone stretched the sheet edge to edge on every screen. On a
 *     desktop window that is a very wide strip holding four small controls. It
 *     is capped and centred now, while still filling a phone — where full width
 *     IS right for a bottom sheet.
 *   - `flex-1` made each priority option a quarter of the screen wide. A chip
 *     carrying one or three characters reads better as a fixed square.
 *   - 50vh had to hold priority, board state, complete/reopen AND a scrolling
 *     list of people, which is what left the assignee list cramped.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { PriorityAssigneePicker } from '@/components/priority-assignee-picker'

vi.mock('@/lib/i18n/client', () => ({ useTranslations: () => ({ t: (k: string) => k }) }))

global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ users: [] }) }) as never

const BASE = {
  isOpen: true,
  onClose: vi.fn(),
  onSelect: vi.fn(),
  selectedPriority: 0,
  selectedAssignee: null,
  availableUsers: [],
}

/** The positioned sheet wrapper — the element carrying the width constraint. */
function sheet(container: HTMLElement) {
  return container.querySelector('[class*="fixed"][class*="bottom-0"]') as HTMLElement
}

beforeEach(() => vi.clearAllMocks())

describe('the picker is not full width (task 8599e136)', () => {
  it('caps its width and centres itself', () => {
    const { container } = render(<PriorityAssigneePicker {...BASE} />)
    const el = sheet(container)

    expect(el, 'no positioned sheet found').toBeTruthy()
    expect(el.className, 'the sheet has no max-width, so it spans the screen').toMatch(/max-w-/)
    expect(el.className, 'a capped sheet that is not centred sits against one edge').toMatch(
      /mx-auto/,
    )
  })

  it('still spans a phone, where full width is correct for a bottom sheet', () => {
    // Capping must not turn into a narrow column on mobile.
    const { container } = render(<PriorityAssigneePicker {...BASE} />)
    expect(sheet(container).className).toMatch(/inset-x-0/)
  })
})

describe('priority options are rounded squares (task 8599e136)', () => {
  const priorityButtons = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('button')).filter(b =>
      /^(○|!+)$/.test((b.textContent || '').trim()),
    )

  it('renders all four options', () => {
    const { container } = render(<PriorityAssigneePicker {...BASE} />)
    expect(priorityButtons(container)).toHaveLength(4)
  })

  it('gives each an equal height and width rather than stretching it', () => {
    const { container } = render(<PriorityAssigneePicker {...BASE} />)
    for (const button of priorityButtons(container)) {
      expect(
        button.className,
        'a priority chip is stretching to fill the row instead of being square',
      ).not.toMatch(/flex-1/)
      expect(button.className).toMatch(/\bh-12\b/)
      expect(button.className).toMatch(/\bw-12\b/)
    }
  })

  it('rounds them', () => {
    const { container } = render(<PriorityAssigneePicker {...BASE} />)
    for (const button of priorityButtons(container)) {
      expect(button.className).toMatch(/rounded-/)
    }
  })
})

describe('there is room for the assignee list (task 8599e136)', () => {
  it('allows more height than the old 50vh', () => {
    const { container } = render(<PriorityAssigneePicker {...BASE} />)
    const el = sheet(container)
    const maxHeight = el.style.maxHeight

    expect(maxHeight).toMatch(/vh$/)
    expect(
      Number.parseInt(maxHeight, 10),
      'the sheet is still short enough to crowd the assignee list',
    ).toBeGreaterThan(50)
  })

  it('scrolls its contents rather than growing past the viewport', () => {
    const { container } = render(<PriorityAssigneePicker {...BASE} />)
    const scroller = container.querySelector('[class*="overflow-y-auto"]')
    expect(scroller, 'a taller sheet with no scroll container can exceed the screen').toBeTruthy()
  })
})
