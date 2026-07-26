/**
 * Reuse Phase 2 (task 5fac84e8): callers used to import a specific add-task
 * implementation — EnhancedTaskCreation inline, MobileQuickAdd in the mobile
 * footer — so adding a control meant finding every mount and knowing which of
 * the two it was.
 *
 * AddTaskInput is now the only entry point: one component, one `variant` prop.
 * The two implementations survive behind it because they render genuinely
 * different controls (single-line input with hashtag autocomplete vs
 * auto-expanding textarea with priority and assignee pickers), not because the
 * seam is unfinished.
 */
import { describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import { render, screen } from '@testing-library/react'
import { AddTaskInput } from '@/components/add-task-input'

vi.mock('@/components/enhanced-task-creation', () => ({
  EnhancedTaskCreation: (props: Record<string, unknown>) => (
    <div data-testid="inline-input" data-layout={String(props.layoutType)} />
  ),
  useLayoutType: () => '1-column',
}))
vi.mock('@/components/mobile-quick-add', () => ({
  MobileQuickAdd: (props: Record<string, unknown>) => (
    <div data-testid="footer-input" data-users={String((props.availableUsers as unknown[])?.length ?? 'none')} />
  ),
}))

const base = {
  selectedListId: 'list-1',
  availableLists: [],
  quickTaskInput: '',
  setQuickTaskInput: vi.fn(),
  onCreateTask: vi.fn(),
  onKeyDown: vi.fn(),
  isSessionReady: true,
}

describe('AddTaskInput (task 5fac84e8)', () => {
  it('renders the inline implementation for variant="inline"', () => {
    render(<AddTaskInput variant="inline" layoutType="3-column" isMobile={false} {...(base as never)} />)

    expect(screen.getByTestId('inline-input')).toBeTruthy()
    expect(screen.queryByTestId('footer-input')).toBeNull()
  })

  it('renders the footer implementation for variant="footer"', () => {
    render(<AddTaskInput variant="footer" availableUsers={[]} {...(base as never)} />)

    expect(screen.getByTestId('footer-input')).toBeTruthy()
    expect(screen.queryByTestId('inline-input')).toBeNull()
  })

  it('passes the layout through so the contextual placeholder still works', () => {
    render(<AddTaskInput variant="inline" layoutType="3-column" {...(base as never)} />)
    expect(screen.getByTestId('inline-input').getAttribute('data-layout')).toBe('3-column')
  })

  it('defaults the variant-only props rather than passing undefined through', () => {
    // Callers of one variant should not have to know the other's props exist.
    render(<AddTaskInput variant="inline" {...(base as never)} />)
    expect(screen.getByTestId('inline-input').getAttribute('data-layout')).toBe('1-column')

    render(<AddTaskInput variant="footer" {...(base as never)} />)
    expect(screen.getByTestId('footer-input').getAttribute('data-users')).toBe('0')
  })

  it('is the only add-task entry point components import', () => {
    // Guards the seam: a new mount must not reach past AddTaskInput to a
    // specific implementation, which is what made this hard to change before.
    const offenders: string[] = []
    const OWN = ['add-task-input.tsx', 'enhanced-task-creation.tsx', 'mobile-quick-add.tsx']
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) { walk(full); continue }
        if (!/\.tsx$/.test(entry.name) || OWN.includes(entry.name)) continue
        const src = fs.readFileSync(full, 'utf8')
        if (/\b(EnhancedTaskCreation|MobileQuickAdd)\b/.test(src)) offenders.push(full)
      }
    }
    walk(path.join(process.cwd(), 'components'))
    walk(path.join(process.cwd(), 'app'))

    expect(offenders, `import AddTaskInput instead: ${offenders.join(', ')}`).toEqual([])
  })
})
