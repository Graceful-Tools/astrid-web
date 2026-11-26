/**
 * @vitest-environment jsdom
 *
 * MainContent, rendered through the harness in tests/utils/test-providers.tsx
 * (ADEV-296). Replaces two source-pin files that read MainContent.tsx and
 * TaskRow.tsx as text:
 *
 *   - task-row-drag-capability-wiring: the iPad drag fix is real only if the
 *     components ask for it. TaskRow's own half is covered by task-row.test.tsx.
 *   - main-content-board-height: the task-area wrapper was `relative` AND
 *     `absolute` at once, so the mobile board had no height to scroll inside.
 *   - the MainContent half of list-header-spacing (AWTD-1264).
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const device = vi.hoisted(() => ({ phone: false, tablet: false, touch: false }))

vi.mock('@/lib/layout-detection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/layout-detection')>()
  return {
    ...actual,
    isMobilePhoneDevice: () => device.phone,
    isTouchDevice: () => device.touch,
    getDeviceType: () => (device.tablet ? 'tablet' : device.phone ? 'phone' : 'desktop'),
  }
})

import { MainContent } from '@/components/TaskManager/MainContent/MainContent'
import { PROMOTE_DROP_TARGET_ID } from '@/lib/subtask-promotion'
import { makeMainContentProps } from '../utils/test-providers'

const GRABBER = '.absolute.bottom-0\\.5'
const rowOf = (container: HTMLElement) => container.querySelector('[data-task-id="task-1"]') as HTMLElement

beforeEach(() => {
  device.phone = false
  device.tablet = false
  device.touch = false
})

describe('MainContent drag wiring', () => {
  it('keeps HTML5 draggable on a desktop with a pointer, and no grabber', () => {
    const { container } = render(<MainContent {...makeMainContentProps({ manualSortActive: true })} />)
    expect(rowOf(container).getAttribute('draggable')).toBe('true')
    expect(rowOf(container).querySelector(GRABBER)).toBeNull()
  })

  it('gives a touch tablet BOTH native draggable and the grabber, so it is not mistaken for a phone', () => {
    // isMobilePhoneDevice() is true on an iPad in some user agents, so the
    // layout signal is what tells them apart.
    device.tablet = true
    device.touch = true
    const { container } = render(
      <MainContent {...makeMainContentProps({ isMobile: true, manualSortActive: true })} />,
    )
    expect(rowOf(container).getAttribute('draggable'), 'a trackpad on a tablet still drags').toBe('true')
    expect(rowOf(container).querySelector(GRABBER), 'a finger on a tablet has something to grab').not.toBeNull()
  })

  it('turns native drag off on a phone and offers the grabber instead', () => {
    device.phone = true
    device.touch = true
    const { container } = render(
      <MainContent {...makeMainContentProps({ isMobile: true, manualSortActive: true })} />,
    )
    expect(rowOf(container).getAttribute('draggable')).toBe('false')
    expect(rowOf(container).querySelector(GRABBER)).not.toBeNull()
  })

  it('shows the promote strip with the id the touch path looks for, only while a subtask is dragged', () => {
    const { container, rerender } = render(<MainContent {...makeMainContentProps()} />)
    expect(screen.queryByTestId('promote-to-top-level-target')).toBeNull()

    rerender(<MainContent {...makeMainContentProps({ promoteTargetVisible: true })} />)
    const strip = screen.getByTestId('promote-to-top-level-target')
    expect(strip.id).toBe(PROMOTE_DROP_TARGET_ID)
    expect(container.querySelector(`#${PROMOTE_DROP_TARGET_ID}`)).toBe(strip)
    expect(strip).toHaveAttribute('aria-label', 'Move out of subtask')
  })
})

describe('MainContent list header spacing (AWTD-1264)', () => {
  const headerOf = (container: HTMLElement) => container.querySelector('.text-center') as HTMLElement

  it('keeps the gap above the add-task input in list view, and drops it on the board', () => {
    const list = render(<MainContent {...makeMainContentProps()} />)
    expect(headerOf(list.container).classList.contains('mb-6')).toBe(true)
    list.unmount()

    const board = render(
      <MainContent {...makeMainContentProps({ hasProjectBoard: true, taskViewMode: 'board' })} />,
    )
    expect(headerOf(board.container).classList.contains('mb-0')).toBe(true)
    expect(headerOf(board.container).classList.contains('mb-6')).toBe(false)
  })
})

describe('MainContent task-area wrapper (mobile board height)', () => {
  const wrapperOf = (container: HTMLElement) =>
    container.querySelector('.theme-bg-primary.flex.flex-col.z-10') as HTMLElement

  it('never carries relative and absolute together', () => {
    for (const overrides of [
      { isMobile: false },
      { isMobile: true },
      { isMobile: true, hasProjectBoard: true, taskViewMode: 'board' as const },
    ]) {
      const { container, unmount } = render(<MainContent {...makeMainContentProps(overrides)} />)
      const cls = wrapperOf(container).classList
      expect(cls.contains('relative') && cls.contains('absolute'), JSON.stringify(overrides)).toBe(false)
      unmount()
    }
  })

  it('pins the mobile board to the screen and bounds the mobile list', () => {
    const board = render(
      <MainContent {...makeMainContentProps({ isMobile: true, hasProjectBoard: true, taskViewMode: 'board' })} />,
    )
    expect(wrapperOf(board.container).classList.contains('absolute')).toBe(true)
    board.unmount()

    const list = render(<MainContent {...makeMainContentProps({ isMobile: true })} />)
    expect(wrapperOf(list.container).classList.contains('h-full')).toBe(true)
  })
})
