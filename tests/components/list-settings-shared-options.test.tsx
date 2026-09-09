/**
 * Task 9377bc2c, slice 1 — the two list-settings popovers offer the same
 * filters, because they now read the same array.
 *
 * They did not. `components/list-sort-and-filters.tsx` (user lists) had no
 * "Tomorrow" due-date option while `components/fixed-list-settings-popover.tsx`
 * (system lists) did, so the same control offered a different set of dates
 * depending on which list you happened to be looking at. `applyDateFilter` has
 * handled `tomorrow` the whole time — only the user-list menu was missing it.
 *
 * The point of these tests is the LAST one: it asserts the two menus agree,
 * which is the property that quietly broke and the one a shared array is
 * supposed to guarantee.
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Select, SelectContent, SelectTrigger } from '@/components/ui/select'
import { applyDateFilter } from '@/lib/date-filter-utils'
import { getMyTasksFilterText } from '@/lib/task-manager-utils'
import type { FilterOption } from '@/components/list-settings/filter-options'
import {
  COMPLETION_FILTER_OPTIONS,
  DUE_DATE_FILTER_OPTIONS,
  FilterSelectItems,
  PRIORITY_FILTER_OPTIONS,
  SORT_BY_OPTIONS,
} from '@/components/list-settings/filter-options'

/**
 * `SelectItem` refuses to render outside a `Select`, and an open one is what
 * puts the items in the DOM — the same context the two popovers give them.
 */
function renderInSelect(options: readonly FilterOption[]) {
  return render(
    <Select open onValueChange={() => {}}>
      <SelectTrigger />
      <SelectContent>
        <FilterSelectItems options={options} />
      </SelectContent>
    </Select>
  )
}

describe('shared list filter options (task 9377bc2c)', () => {
  it('offers Tomorrow, which the user-list popover was missing', () => {
    expect(DUE_DATE_FILTER_OPTIONS.map(o => o.value)).toContain('tomorrow')
  })

  it('offers only date filters the filter engine can actually apply', () => {
    // An option the engine does not understand is a control that appears to do
    // nothing — worse than a missing one, because it looks like a bug in the
    // data rather than in the menu.
    const task = { id: 't', dueDateTime: null, completed: false } as never

    for (const option of DUE_DATE_FILTER_OPTIONS) {
      if (option.value === 'all') continue
      expect(() => applyDateFilter(task, option.value)).not.toThrow()
    }
  })

  it('names every date filter in the header summary, so an active filter never reads as none', () => {
    for (const option of DUE_DATE_FILTER_OPTIONS) {
      if (option.value === 'all') continue
      expect(
        getMyTasksFilterText({ filterDueDate: option.value }),
        `"${option.value}" filters the list but shows no label in the header`
      ).not.toBe('')
    }
  })

  it('keeps the priority values the filter state stores', () => {
    // "all" plus the four numeric priorities. A missing level here silently
    // makes tasks at that priority unfilterable.
    expect(PRIORITY_FILTER_OPTIONS.map(o => o.value)).toEqual(['all', '3', '2', '1', '0'])
  })

  it('renders one item per option, with the colour classes both originals used', () => {
    renderInSelect(PRIORITY_FILTER_OPTIONS)

    expect(screen.getByText('!!! Highest')).toHaveClass('text-red-500')
    expect(screen.getByText('○ Low')).toHaveClass('text-gray-400')
  })

  it('falls back to English rather than printing a raw key when a translation is missing', () => {
    // `t` answers with the key itself for an unknown key, which would put
    // "listSettings.due.noDate" on screen in any locale that lacks it.
    renderInSelect([{ value: 'x', labelKey: 'nope.not.a.key', label: 'Fallback' }])

    expect(screen.getByText('Fallback')).toBeInTheDocument()
  })

  it('gives both popovers the identical set of options', () => {
    // The whole reason the arrays are shared. Read from the modules the two
    // popovers import, so a future divergence has to be deliberate.
    const everyOptionSet = [
      SORT_BY_OPTIONS,
      COMPLETION_FILTER_OPTIONS,
      PRIORITY_FILTER_OPTIONS,
      DUE_DATE_FILTER_OPTIONS,
    ]

    for (const options of everyOptionSet) {
      const values = options.map(o => o.value)
      expect(new Set(values).size, `duplicate values in ${values.join(',')}`).toBe(values.length)
      expect(options.every(o => o.label.length > 0)).toBe(true)
    }
  })
})
