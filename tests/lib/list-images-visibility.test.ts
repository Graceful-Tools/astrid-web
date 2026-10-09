import { describe, it, expect } from 'vitest'
import { shouldShowListImages, HIDE_LIST_IMAGES_FEATURE_KEY } from '@/lib/list-images-visibility'
import { FEATURE_KEYS } from '@/lib/feature-flags'

describe('shouldShowListImages (hide_list_images A/B test)', () => {
  it('follows the experiment when the user has not chosen', () => {
    expect(shouldShowListImages(null, false)).toBe(true)
    expect(shouldShowListImages(null, true)).toBe(false)
    expect(shouldShowListImages(undefined, true)).toBe(false)
  })

  it("lets the user's explicit choice win over the flag, both ways", () => {
    expect(shouldShowListImages(true, true)).toBe(true)
    expect(shouldShowListImages(false, false)).toBe(false)
  })

  it('is a registered feature key, so the admin page and /api/v1/features carry it', () => {
    expect(FEATURE_KEYS).toContain(HIDE_LIST_IMAGES_FEATURE_KEY)
  })
})
