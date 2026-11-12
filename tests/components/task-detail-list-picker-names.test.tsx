/**
 * AWTD-1602 — List names not showing up in the task's list picker.
 *
 * Jon's iPad screenshot (light theme, a task open inside a board card): the
 * Lists picker showed each row's coloured # and nothing else. The names were
 * drawn in `text-white`, left over from when the menu was dark grey; the menu
 * became `bg-theme-surface` (white in Light) during the theme migration and
 * the text class stayed behind. The name now takes the theme's primary text
 * colour, which reads on the surface in every theme.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TaskDetailListsRow } from '@/components/task-detail/TaskDetailListsRow'
import type { Task, TaskList } from '@/types/task'

const LISTS = [
  { id: 'l1', name: 'Astrid iOS To-do', color: '#3b82f6', privacy: 'PRIVATE' },
  { id: 'l2', name: 'Health', color: '#f59e0b', privacy: 'PRIVATE' },
] as unknown as TaskList[]

describe('task list picker (AWTD-1602)', () => {
  it('draws each suggestion’s name in the theme text colour, not white', () => {
    render(
      <TaskDetailListsRow
        task={{ id: 't1', lists: [] } as unknown as Task}
        availableLists={LISTS}
        onUpdate={vi.fn()}
        editingLists
        setEditingLists={vi.fn()}
        tempLists={[]}
        setTempLists={vi.fn()}
        listSearchTerm=""
        setListSearchTerm={vi.fn()}
        showListSuggestions
        setShowListSuggestions={vi.fn()}
        selectedSuggestionIndex={-1}
        listSearchRef={{ current: null }}
        listInputRef={{ current: null }}
      />
    )

    for (const name of ['Astrid iOS To-do', 'Health']) {
      const label = screen.getByText(name)
      expect(label.className).not.toMatch(/\btext-white\b/)
      expect(label.className).toMatch(/\btext-theme-primary\b/)
    }
  })
})
