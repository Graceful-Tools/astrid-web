import { describe, it, expect } from 'vitest'
import { shouldReloadForControllerChange } from '@/lib/pwa-update-policy'

/**
 * A `controllerchange` fires in two situations that look identical to the
 * listener: a NEW service worker took over from an old one (an update — reload
 * so the page runs the new code), and the FIRST service worker ever claimed
 * the page (`clients.claim()` on install — nothing to reload for). Treating
 * both as an update reloaded every first visit about a second after load,
 * dropping whatever the visitor had started doing. It also made the passkey
 * dialog E2E test flake on Firefox, the browser slow enough that the reload
 * landed after the test's first click.
 */
describe('shouldReloadForControllerChange', () => {
  it('reloads once when an updated worker takes over from a previous one', () => {
    expect(shouldReloadForControllerChange({ hasReloaded: false, hadController: true })).toBe(true)
    expect(shouldReloadForControllerChange({ hasReloaded: true, hadController: true })).toBe(false)
  })

  it('never reloads for the first worker claiming a page that had none', () => {
    expect(shouldReloadForControllerChange({ hasReloaded: false, hadController: false })).toBe(false)
  })
})
