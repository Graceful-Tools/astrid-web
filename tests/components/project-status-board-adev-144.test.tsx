/**
 * @vitest-environment jsdom
 */

/**
 * ADEV-144: an empty board column shows the hi-fi empathy frame for its state, in the list's
 * metaphor for the day (the rule iOS and Mac share), once the image has loaded.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, within } from '@testing-library/react'
import { buildTaskList } from '../fixtures/domain'
import { ProjectStatusBoard } from '@/components/project-status-board'
import { AstridEmptyState } from '@/components/ui/astrid-empty-state'
import { ASTRID_ICON, BRAND } from '@/lib/brand/config'
import { empathyFrameSrc } from '@/lib/empathy-art/board'
import { empathyMetaphorFor } from '@/lib/empathy-art/rules'

type Outcome = 'load' | 'error' | 'pending'
let outcome: Outcome = 'load'
const pending: Array<() => void> = []

class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  set src(_value: string) {
    const fire = () => (outcome === 'load' ? this.onload?.() : this.onerror?.())
    if (outcome === 'pending') pending.push(fire)
    else queueMicrotask(fire)
  }
}

const NOW = new Date('2026-11-20T12:00:00.000Z')

beforeEach(() => {
  outcome = 'load'
  pending.length = 0
  vi.stubGlobal('Image', FakeImage)
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const character = (root: HTMLElement) => within(root).getByTestId('empty-state-character').getAttribute('src')

describe('ADEV-144 board empty columns show the empathy frame', () => {
  const list = buildTaskList({ id: 'a623f322-4c3c-49b5-8a94-d2d9f00c82ba', name: 'Astrid Web', projectId: 'project-1', listType: 'regular' })

  const renderBoard = () =>
    render(
      <ProjectStatusBoard
        allTasks={[]}
        lists={[list]}
        selectedListId={list.id}
        currentUser={null}
        onUpdateTask={() => {}}
        onCreateTask={async () => null}
      />,
    )

  it('ADEV-144: each built-in column shows its state in the list’s metaphor for the day', async () => {
    const { getByTestId } = renderBoard()
    await act(async () => {})
    const metaphor = empathyMetaphorFor(list.id, NOW)
    for (const state of ['inbox', 'ready', 'doing', 'waiting', 'done']) {
      expect(character(getByTestId(`status-column-${state}`))).toMatch(
        new RegExp(`^/images/empathy-art/${metaphor}-${state}\\.[0-9a-f]{12}\\.webp$`),
      )
    }
  })

  it('ADEV-144: keeps the brand character until the frame has loaded', async () => {
    outcome = 'pending'
    const { getByTestId } = renderBoard()
    expect(character(getByTestId('status-column-ready'))).toBe(BRAND.icon)
    await act(async () => {})
    expect(character(getByTestId('status-column-ready'))).toBe(BRAND.icon)
    outcome = 'load'
    await act(async () => { pending.splice(0).forEach(fire => fire()) })
    expect(character(getByTestId('status-column-ready'))).toMatch(/^\/images\/empathy-art\//)
  })

  it('ADEV-144: keeps the brand character when the frame fails to load', async () => {
    outcome = 'error'
    const { getByTestId } = renderBoard()
    await act(async () => {})
    expect(character(getByTestId('status-column-ready'))).toBe(BRAND.icon)
  })

  it('ADEV-144: no characterSrc means the brand character, as before', () => {
    const { getByTestId } = render(<AstridEmptyState listType="default" />)
    expect(character(getByTestId('empty-state'))).toBe(BRAND.icon)
  })
})

describe('ADEV-144 empathyFrameSrc', () => {
  const listId = 'a623f322-4c3c-49b5-8a94-d2d9f00c82ba'

  it('gives a custom column no frame', () => {
    expect(empathyFrameSrc(listId, { id: 'custom-1', kind: 'status' }, NOW, ASTRID_ICON)).toBeNull()
  })

  it('gives a partner brand no frame, so our mascot never shows on their board', () => {
    expect(empathyFrameSrc(listId, { id: 'ready', kind: 'status' }, NOW, '/partner/icon.png')).toBeNull()
  })

  it('needs a list', () => {
    expect(empathyFrameSrc(undefined, { id: 'ready', kind: 'status' }, NOW, ASTRID_ICON)).toBeNull()
  })

  it('rotates with the UTC day', () => {
    const today = empathyFrameSrc(listId, { id: 'inbox', kind: 'inbox' }, NOW, ASTRID_ICON)
    const tomorrow = empathyFrameSrc(listId, { id: 'inbox', kind: 'inbox' }, new Date('2026-11-21T12:00:00.000Z'), ASTRID_ICON)
    expect(today).not.toBe(tomorrow)
  })
})
