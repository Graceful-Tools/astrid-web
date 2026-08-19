/**
 * @vitest-environment jsdom
 */

/**
 * The options sheet must rise from the BOTTOM OF THE SCREEN, not from the row
 * that opened it (Jon, 2026-08-18: "When I tap on the checkbox icon in project
 * view, the popup bottom sheet on mobile appears from wherever the list row is,
 * so it doesn't show correctly on screen").
 *
 * The sheet was always styled `fixed inset-x-0 bottom-0` — the CSS was never
 * wrong. What broke it is that `position: fixed` is resolved against the
 * nearest ancestor that establishes a containing block, and EVERY ancestor
 * this sheet renders inside on mobile establishes one:
 *
 *   - `.task-card` sets `will-change: transform` (styles/components.css), so a
 *     sheet rendered inside a task row is pinned to that row;
 *   - MainContent's mobile task-area wrapper sets
 *     `transform: translateX(0) scale(1)` unconditionally for the task-detail
 *     parallax, so a sheet rendered at board level is pinned to that wrapper.
 *
 * Measured on an iPhone 12 viewport (390x664) before the fix: the sheet sat at
 * y=158..423 and its "full screen" backdrop was a 360x62 rectangle over one
 * card. Portalling to `document.body` is the only fix that holds, because no
 * amount of styling escapes a transformed ancestor.
 *
 * These tests therefore assert ANCESTRY, not classes: the sheet and its
 * backdrop must not be descendants of a transformed container.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { PriorityAssigneePicker } from '@/components/priority-assignee-picker'

vi.mock('@/lib/i18n/client', () => ({ useTranslations: () => ({ t: (k: string) => k }) }))

/** The two fixed layers the sheet renders: the panel and the backdrop. */
function sheetLayers() {
  const sheet = document.querySelector('.fixed.inset-x-0.bottom-0.z-50')
  const backdrop = document.querySelector('.fixed.inset-0.z-40')
  return { sheet, backdrop }
}

/**
 * A faithful stand-in for the containing blocks the sheet actually renders
 * inside on mobile: `.task-card`'s `will-change: transform` and MainContent's
 * parallax `transform`. jsdom does no layout, so the property under test is
 * "is the sheet inside this element", which is exactly what decides the bug.
 */
function TransformedHost({ children }: { children: React.ReactNode }) {
  return (
    <div data-testid="transformed-host" style={{ transform: 'translateX(0) scale(1)' }}>
      <div className="task-card" style={{ willChange: 'transform' }}>
        {children}
      </div>
    </div>
  )
}

describe('the options bottom sheet escapes transformed ancestors (mobile board/project view)', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ json: async () => ({ users: [] }) }) as never
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders the sheet outside the transformed row that opened it', () => {
    const { getByTestId } = render(
      <TransformedHost>
        <PriorityAssigneePicker
          isOpen
          onClose={() => {}}
          onSelect={() => {}}
          selectedPriority={0}
          selectedAssignee={null}
          availableUsers={[]}
          taskId="task-1"
          listIds={['list-1']}
        />
      </TransformedHost>,
    )

    const host = getByTestId('transformed-host')
    const { sheet } = sheetLayers()

    expect(sheet, 'the bottom sheet did not render').toBeTruthy()
    expect(
      host.contains(sheet as Node),
      'the sheet is inside a transformed ancestor, so `fixed bottom-0` anchors to the row instead of the screen',
    ).toBe(false)
  })

  it('renders the backdrop outside the transformed row, so it can cover the screen', () => {
    const { getByTestId } = render(
      <TransformedHost>
        <PriorityAssigneePicker
          isOpen
          onClose={() => {}}
          onSelect={() => {}}
          selectedPriority={0}
          selectedAssignee={null}
          availableUsers={[]}
          taskId="task-1"
          listIds={['list-1']}
        />
      </TransformedHost>,
    )

    const host = getByTestId('transformed-host')
    const { backdrop } = sheetLayers()

    expect(backdrop, 'the backdrop did not render').toBeTruthy()
    expect(
      host.contains(backdrop as Node),
      'the backdrop is inside a transformed ancestor, so it covers the row instead of the screen',
    ).toBe(false)
  })

  it('portals both layers to document.body', () => {
    render(
      <TransformedHost>
        <PriorityAssigneePicker
          isOpen
          onClose={() => {}}
          onSelect={() => {}}
          selectedPriority={0}
          selectedAssignee={null}
          availableUsers={[]}
          taskId="task-1"
          listIds={['list-1']}
        />
      </TransformedHost>,
    )

    const { sheet, backdrop } = sheetLayers()
    expect(sheet?.parentElement).toBe(document.body)
    expect(backdrop?.parentElement).toBe(document.body)
  })

  it('still renders nothing when closed', () => {
    render(
      <TransformedHost>
        <PriorityAssigneePicker
          isOpen={false}
          onClose={() => {}}
          onSelect={() => {}}
          selectedPriority={0}
          selectedAssignee={null}
          availableUsers={[]}
          taskId="task-1"
          listIds={['list-1']}
        />
      </TransformedHost>,
    )

    const { sheet, backdrop } = sheetLayers()
    expect(sheet).toBeNull()
    expect(backdrop).toBeNull()
  })
})
