/**
 * AWTD-1206: tags on a task row.
 *
 *   - a tag's text never wraps;
 *   - a name longer than 12 characters is cut, with an ellipsis;
 *   - the chips themselves still reflow onto the next line.
 *
 * The last one is the container's `flex-wrap`, which was already right — it is
 * asserted here anyway, because the fix is only correct as a pair. Capping the
 * text without wrapping chips would push them off the row instead.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TaskRowContent } from '@/components/task-row-content'
import type { Task } from '@/types/task'

vi.mock('@/lib/i18n/client', () => ({ useTranslations: () => ({ t: (k: string) => k }) }))
vi.mock('@/components/list-glyph', () => ({ ListGlyph: () => <span data-testid="glyph" /> }))
vi.mock('@/components/task-leading-control', () => ({ TaskLeadingControl: () => <span /> }))
vi.mock('@/components/public-task-copy-button', () => ({ PublicTaskCopyButton: () => <span /> }))

const task = (lists: Array<Record<string, unknown>>) =>
  ({ id: 't1', title: 'A task', completed: false, lists }) as unknown as Task

const row = (lists: Array<Record<string, unknown>>, isMobile = false) =>
  render(
    <TaskRowContent
      task={task(lists)}
      onToggleComplete={() => {}}
      onCopyPublic={() => {}}
      isMobile={isMobile}
      currentListId={null}
    />,
  )

const LONG = 'Astrid Web To-do' // 16 characters

describe('a list tag on a task row (AWTD-1206)', () => {
  it('cuts a long list name to 12 characters', () => {
    row([{ id: 'l1', name: LONG, color: '#ef4444', listType: 'regular' }])
    expect(screen.getByText('Astrid Web T…')).toBeInTheDocument()
    expect(screen.queryByText(LONG)).toBeNull()
  })

  it('cuts a long LABEL name the same way', () => {
    row([{ id: 'l2', name: LONG, color: '#3b82f6', listType: 'label' }])
    expect(screen.getByText('Astrid Web T…')).toBeInTheDocument()
  })

  it('leaves a short name alone', () => {
    row([{ id: 'l3', name: 'Bugs', color: '#ef4444', listType: 'regular' }])
    expect(screen.getByText('Bugs')).toBeInTheDocument()
  })

  it('never lets the text wrap, on desktop as well as mobile', () => {
    // The desktop branch carried no nowrap at all, so a long name wrapped
    // inside its own chip. That is the bug.
    const { unmount } = row([{ id: 'l4', name: LONG, color: '#ef4444', listType: 'regular' }])
    expect(screen.getByText('Astrid Web T…').className).toContain('whitespace-nowrap')
    unmount()
    row([{ id: 'l5', name: LONG, color: '#ef4444', listType: 'regular' }], true)
    expect(screen.getByText('Astrid Web T…').className).toContain('whitespace-nowrap')
  })

  it('still lets the chips themselves reflow onto the next line', () => {
    row([
      { id: 'l6', name: 'One', color: '#ef4444', listType: 'regular' },
      { id: 'l7', name: 'Two', color: '#3b82f6', listType: 'label' },
    ])
    const strip = screen.getByText('One').closest('.flex-wrap')
    expect(strip).not.toBeNull()
  })
})
