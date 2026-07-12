import { describe, expect, it } from 'vitest'
import { shouldReloadForControllerChange } from '@/lib/pwa-update-policy'

describe('PWA update policy', () => {
  it('reloads only once when a service worker takes control', () => {
    expect(shouldReloadForControllerChange(false)).toBe(true)
    expect(shouldReloadForControllerChange(true)).toBe(false)
  })
})
