/**
 * @vitest-environment jsdom
 *
 * ListImagesProvider resolves the user's "Show list images" choice against the
 * hide_list_images flag, and asks for settings only when signed in.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const session = { status: 'authenticated' as string }
vi.mock('next-auth/react', () => ({ useSession: () => session }))

const flags = { hide: false }
vi.mock('@/contexts/feature-flag-context', () => ({
  useFeatureFlags: () => ({ isEnabled: (key: string) => key === 'hide_list_images' && flags.hide }),
}))

const settings = { showListImages: null as boolean | null }
const updateSettings = vi.fn()
const useUserSettings = vi.fn(() => ({ settings, updateSettings }))
vi.mock('@/hooks/useUserSettings', () => ({ useUserSettings: () => useUserSettings() }))

import { ListImagesProvider, useListImagesVisibility } from '@/contexts/list-images-context'

function Probe() {
  const { showListImages, setShowListImages } = useListImagesVisibility()
  return <button onClick={() => setShowListImages(true)}>{showListImages ? 'shown' : 'hidden'}</button>
}
const renderProbe = () => render(<ListImagesProvider><Probe /></ListImagesProvider>)

beforeEach(() => {
  vi.clearAllMocks()
  session.status = 'authenticated'
  flags.hide = false
  settings.showListImages = null
})

describe('ListImagesProvider', () => {
  it('hides images for the treatment arm when the user has not chosen', () => {
    flags.hide = true
    renderProbe()
    expect(screen.getByRole('button')).toHaveTextContent('hidden')
  })

  it("shows them when the user opted back in, despite the flag", () => {
    flags.hide = true
    settings.showListImages = true
    renderProbe()
    expect(screen.getByRole('button')).toHaveTextContent('shown')
  })

  it('hides them for a control-arm user who opted out', () => {
    settings.showListImages = false
    renderProbe()
    expect(screen.getByRole('button')).toHaveTextContent('hidden')
  })

  it('stores an explicit choice through the shared settings write', () => {
    renderProbe()
    screen.getByRole('button').click()
    expect(updateSettings).toHaveBeenCalledWith({ showListImages: true })
  })

  it('makes no settings request when signed out, and shows images', () => {
    session.status = 'unauthenticated'
    flags.hide = true
    renderProbe()
    expect(useUserSettings).not.toHaveBeenCalled()
    expect(screen.getByRole('button')).toHaveTextContent('shown')
  })
})
