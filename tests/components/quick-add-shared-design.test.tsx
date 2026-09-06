/**
 * Task f699462a: "in 2 and 3 column keep the 'add a task' to list input /
 * button ABOVE the list, but reuse the same input and design as the one that is
 * at the bottom of the list in 1-column view. Reuse code. Main difference is
 * allow bigger button 'Add Task' when there is room in a wide enough column."
 *
 * Before this task the two desktop columns rendered a different control from
 * 1-column: a single-line <Input> with a blue "Add Task" button
 * (enhanced-task-creation.tsx), while 1-column pinned an expanding <textarea>
 * with a priority/assignee button to the bottom (mobile-quick-add.tsx). Same
 * job, two designs, two files. This asserts one control in two placements.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AddTaskInput } from '@/components/add-task-input'

// jsdom has no ResizeObserver and lays everything out at zero width, so the
// component can never measure a real column here. Report a width we control.
let observedWidth = 0
const realResizeObserver = globalThis.ResizeObserver

beforeEach(() => {
  globalThis.ResizeObserver = class {
    constructor(private cb: ResizeObserverCallback) {}
    observe(el: Element) {
      this.cb([{ target: el, contentRect: { width: observedWidth } } as never], this as never)
    }
    unobserve() {}
    disconnect() {}
  } as never
})

afterEach(() => {
  globalThis.ResizeObserver = realResizeObserver
})

const base = {
  selectedListId: 'list-1',
  availableLists: [{ id: 'list-1', name: 'Groceries' }],
  availableUsers: [],
  quickTaskInput: '',
  setQuickTaskInput: vi.fn(),
  onCreateTask: vi.fn(),
  onKeyDown: vi.fn(),
  isSessionReady: true,
}

describe('The add-task control is one design in two placements (task f699462a)', () => {
  it('gives the inline placement the same expanding textarea as the 1-column bar', () => {
    const { container } = render(
      <AddTaskInput variant="inline" layoutType="3-column" {...(base as never)} />,
    )

    expect(container.querySelector('textarea')).toBeTruthy()
    // The retired design used a single-line <input> for the title.
    expect(container.querySelector('input[type="text"], input:not([type])')).toBeNull()
  })

  it('gives the inline placement the same priority/assignee control as the 1-column bar', () => {
    render(<AddTaskInput variant="inline" layoutType="3-column" {...(base as never)} />)
    expect(screen.getByLabelText(/priority or assignee/i)).toBeTruthy()
  })

  it('keeps the inline placement in the flow so it sits above the list', () => {
    const { container } = render(
      <AddTaskInput variant="inline" layoutType="3-column" {...(base as never)} />,
    )
    // The 1-column bar floats over the list; a column header must not.
    expect(container.querySelector('.fixed')).toBeNull()
  })

  it('still pins the footer placement to the bottom of the 1-column view', () => {
    const { container } = render(<AddTaskInput variant="footer" {...(base as never)} />)
    expect(container.querySelector('.fixed')).toBeTruthy()
  })

  it('labels the button "Add task" when the column is wide enough for the words', () => {
    observedWidth = 600
    render(<AddTaskInput variant="inline" layoutType="2-column" {...(base as never)} />)
    expect(screen.getByRole('button', { name: /add task/i }).textContent).toMatch(/add task/i)
  })

  it('drops back to the icon-only button in a narrow column', () => {
    observedWidth = 260
    render(<AddTaskInput variant="inline" layoutType="3-column" {...(base as never)} />)
    expect(screen.getByRole('button', { name: /add task/i }).textContent?.trim()).toBe('')
  })

  it('keeps the hashtag autocomplete the retired desktop input owned', () => {
    render(
      <AddTaskInput
        variant="inline"
        layoutType="3-column"
        {...(base as never)}
        quickTaskInput="buy milk #groc"
      />,
    )
    expect(screen.getByText('Groceries')).toBeTruthy()
  })
})
