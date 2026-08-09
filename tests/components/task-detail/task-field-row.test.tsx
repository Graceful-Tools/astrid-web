/**
 * @vitest-environment jsdom
 */

/**
 * One row shape for every task-detail field, mirroring iOS `TwoColumnRow`.
 *
 * Web hand-rolled the two-column grid per row and the four rows drifted apart:
 * When used `items-start` with a `pt-2` label, Priority and Lists used
 * `items-center` with no padding, and Description was not a two-column row at
 * all — it stacked the label above the value. Ten stray `mt-1`s inside
 * `items-center` flex rows pushed values off their labels' baseline on top of
 * that. The result is labels sitting at different heights down the panel.
 *
 * iOS avoids this by construction: every field row is one `TwoColumnRow`, and
 * its comment spells out the invariant — the icon column is exactly as wide as
 * the title row's checkbox, with the same horizontal padding and gap, so the
 * icon sits centred under the checkbox and the content's left edge lands on the
 * title field's left edge. On web that arithmetic is 16 + 32 + 8 = 56px, in the
 * header row and in every field row.
 */

import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  TaskFieldRow,
  FIELD_ICON_COLUMN_CLASS,
  FIELD_ROW_GAP_CLASS,
} from '@/components/task-detail/TaskFieldRow'

describe('TaskFieldRow (task detail field layout)', () => {
  it('keeps the label as the accessible name when an icon stands in for it', () => {
    // iOS: "the word is redundant next to a calendar chip", but the label stays
    // as the accessibility name. A screen reader must still hear "When".
    render(
      <TaskFieldRow label="When" icon={<svg data-testid="cal" />}>
        <span>Today</span>
      </TaskFieldRow>,
    )

    expect(screen.getByTestId('cal')).toBeInTheDocument()
    expect(screen.getByLabelText('When')).toBeInTheDocument()
    // The word itself is not repeated next to the icon.
    expect(screen.queryByText('When')).not.toBeInTheDocument()
  })

  it('renders a text label when no icon is given', () => {
    render(
      <TaskFieldRow label="Description">
        <span>Body</span>
      </TaskFieldRow>,
    )

    expect(screen.getByText('Description')).toBeInTheDocument()
  })

  it('aligns the icon column to the header checkbox width', () => {
    // The invariant: icon column w-8 matches the leading control's w-8, and the
    // row gap matches the header's space-x-2. Change one without the other and
    // the content stops lining up with the title.
    expect(FIELD_ICON_COLUMN_CLASS).toContain('w-8')
    expect(FIELD_ROW_GAP_CLASS).toContain('gap-2')
  })

  it('centres label and content by default', () => {
    const { container } = render(
      <TaskFieldRow label="Priority" icon={<svg />}>
        <span>High</span>
      </TaskFieldRow>,
    )

    expect(container.firstElementChild?.className).toContain('items-center')
  })

  it('tops-aligns only when the row asks for it', () => {
    // Multi-line content (an open description editor, the lists chip cloud)
    // needs the label at the top; everything else stays centred.
    const { container } = render(
      <TaskFieldRow label="Description" align="start">
        <textarea />
      </TaskFieldRow>,
    )

    expect(container.firstElementChild?.className).toContain('items-start')
    expect(container.firstElementChild?.className).not.toContain('items-center')
  })

  it('gives the content column the remaining width', () => {
    const { container } = render(
      <TaskFieldRow label="Lists" icon={<svg />}>
        <span data-testid="content">Work</span>
      </TaskFieldRow>,
    )

    const content = screen.getByTestId('content').parentElement
    expect(content?.className).toContain('flex-1')
    expect(container.firstElementChild?.className).toContain('flex')
  })
})
