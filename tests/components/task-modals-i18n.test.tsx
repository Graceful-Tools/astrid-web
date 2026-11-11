/**
 * @vitest-environment jsdom
 */

/**
 * AWTD-1575: the delete, copy and share dialogs of a task each had a translated
 * title over an English body ("Don't Delete", "Create a copy of …", "Include
 * comments", the two share hints).
 */
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { TaskModals } from '@/components/task-detail/TaskModals'
import { PseudoLocale, hardcodedCopy } from '@/tests/utils/pseudo-messages'
import type { Task, TaskList } from '@/types/task'

// tests/setup.ts answers every key in English; this is about what is NOT a key.
vi.unmock('@/lib/i18n/client')

const TITLE = 'Zelt aufbauen'
const lists = [{ id: 'list-1', name: 'Zeltlager' }] as TaskList[]

function task(comments: number): Task {
  return {
    id: 'task-1',
    title: TITLE,
    comments: Array.from({ length: comments }, (_, index) => ({ id: `c${index}` })),
  } as unknown as Task
}

function renderModals(open: 'delete' | 'copy' | 'share', overrides: Record<string, unknown> = {}, comments = 1) {
  const props = {
    task: task(comments),
    availableLists: lists,
    showDeleteConfirmation: open === 'delete',
    setShowDeleteConfirmation: () => {},
    onDelete: () => {},
    showCopyConfirmation: open === 'copy',
    setShowCopyConfirmation: () => {},
    copyIncludeComments: true,
    setCopyIncludeComments: () => {},
    copyTargetListId: undefined,
    setCopyTargetListId: () => {},
    showShareModal: open === 'share',
    shareUrl: 'https://example.test/s/abc',
    loadingShareUrl: false,
    shareUrlCopied: false,
    onCopyShareUrl: () => {},
    onCloseShareModal: () => {},
    ...overrides,
  }
  return render(
    <PseudoLocale>
      <TaskModals {...props} />
    </PseudoLocale>,
  )
}

describe('task dialogs have no hardcoded English (AWTD-1575)', () => {
  const data = [TITLE, 'Zeltlager', 'https://example.test/s/abc']

  it('delete confirmation', () => {
    const { container } = renderModals('delete')
    expect(container.textContent).toContain(TITLE)
    expect(hardcodedCopy(container, data)).toEqual([])
  })

  it.each([1, 3])('copy dialog with %i comment(s)', (comments) => {
    const { container } = renderModals('copy', {}, comments)
    expect(container.textContent).toContain(TITLE)
    expect(container.textContent).toContain(String(comments))
    expect(hardcodedCopy(container, data)).toEqual([])
  })

  it('share dialog, before and after the link is copied', () => {
    expect(hardcodedCopy(renderModals('share').container, data)).toEqual([])
    expect(hardcodedCopy(renderModals('share', { shareUrlCopied: true }).container, data)).toEqual([])
    expect(hardcodedCopy(renderModals('share', { shareUrl: null, loadingShareUrl: true }).container, data)).toEqual([])
  })
})
