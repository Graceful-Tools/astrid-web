/**
 * @vitest-environment jsdom
 *
 * The hide_list_images A/B test at its render sites: with images hidden the
 * sidebar row shows the list's glyph, the list header shows nothing at all —
 * its width goes to the title (AWTD-1155) — and neither the header nor list
 * settings offers an image to pick. With images shown, both are unchanged.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { buildTaskList, buildUser } from '../fixtures/domain'

const visibility = { showListImages: true, setShowListImages: vi.fn() }
vi.mock('@/contexts/list-images-context', () => ({
  useListImagesVisibility: () => visibility,
}))

global.fetch = vi.fn(() =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({ repositories: [], cached: true }) } as Response)
)

vi.mock('@/lib/layout-detection', () => ({
  shouldPreventAutoFocus: () => false,
  shouldIgnoreTouchDuringKeyboard: () => false,
  needsAggressiveKeyboardProtection: () => false,
  getFocusProtectionThreshold: () => 300,
  isMobileDevice: () => false,
}))

import { ListItem } from '@/components/TaskManager/Sidebar/ListItem'
import { ListAdminSettings } from '@/components/list-admin-settings'
import { ListHeaderImage } from '@/components/TaskManager/MainContent/ListHeaderImage'

const list = buildTaskList({
  id: 'list-1',
  name: 'Groceries',
  color: '#ff0000',
  ownerId: 'user-1',
  privacy: 'PRIVATE',
  imageUrl: '/icons/default_list_2.png',
  members: [],
  admins: [],
  tasks: [],
})
const user = buildUser({ id: 'user-1', name: 'Owner', email: 'o@example.com', image: null })

const renderRow = () =>
  render(<ListItem list={list} selectedListId="" isMobile={false} taskCount={3} onClick={() => {}} />)

beforeEach(() => { visibility.showListImages = true })

describe('sidebar list row', () => {
  it('draws the list image when images are shown', () => {
    renderRow()
    expect(screen.getByAltText('Groceries')).toHaveAttribute('src', '/icons/default_list_2.png')
    expect(screen.queryByTestId('list-color-glyph')).toBeNull()
  })

  it('draws the colour glyph and no image when hide_list_images hides them', () => {
    visibility.showListImages = false
    renderRow()
    expect(screen.queryByRole('img', { name: 'Groceries' })).toBeNull()
    expect(screen.getByTestId('list-color-glyph')).toHaveStyle({ color: '#ff0000' })
    expect(screen.getByText('Groceries')).toBeInTheDocument()
  })
})

describe('list settings', () => {
  const renderSettings = () =>
    render(
      <ListAdminSettings
        list={list}
        currentUser={user}
        canEditSettings
        onUpdate={() => {}}
        onDelete={() => {}}
        onEditImage={() => {}}
      />
    )

  it('offers the image picker when images are shown', () => {
    renderSettings()
    expect(screen.getByText('List Image')).toBeInTheDocument()
  })

  it('offers no image to set when they are hidden', () => {
    visibility.showListImages = false
    renderSettings()
    expect(screen.queryByText('List Image')).toBeNull()
  })
})

describe('list header', () => {
  it('draws the image, clickable to pick, when images are shown', () => {
    const onPick = vi.fn()
    render(<ListHeaderImage list={list} onPick={onPick} />)
    screen.getByAltText('Groceries').click()
    expect(onPick).toHaveBeenCalled()
  })

  it('draws nothing when they are hidden: no image, no picker, no glyph taking the title\'s room (AWTD-1155)', () => {
    visibility.showListImages = false
    const onPick = vi.fn()
    const { container } = render(<ListHeaderImage list={list} onPick={onPick} />)
    expect(container).toBeEmptyDOMElement()
  })
})
