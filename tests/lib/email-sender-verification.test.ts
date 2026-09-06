/**
 * RED for the third half of task 0a5b6337 — the acting user was resolved
 * straight from the From header.
 *
 * From is unauthenticated. Anyone who can get a message to the inbound address
 * could therefore act as ANY user, and the group routing then creates a shared
 * list and invites every recipient — so a spoofed From is both an
 * impersonation and a way to pull arbitrary addresses into a list. Worse,
 * findOrCreateUserFromEmail would mint a placeholder user for an address that
 * had never proved it exists.
 *
 * Both providers publish an SPF/DKIM/DMARC verdict. Acting on the sender now
 * requires it.
 */
import { describe, it, expect } from 'vitest'
import {
  senderIsAuthenticated,
  type SenderAuthentication,
} from '@/lib/webhooks/sender-authentication'

const pass: SenderAuthentication = { spf: 'pass', dkim: 'pass', dmarc: 'pass' }

describe('senderIsAuthenticated (task 0a5b6337)', () => {
  it('accepts a message that passed DKIM', () => {
    expect(senderIsAuthenticated(pass)).toBe(true)
  })

  it('accepts DKIM pass even when SPF is unavailable', () => {
    // DKIM survives forwarding; SPF does not. Requiring both would reject a
    // large share of legitimate forwarded mail.
    expect(senderIsAuthenticated({ dkim: 'pass' })).toBe(true)
  })

  it('rejects a message that failed DKIM', () => {
    expect(senderIsAuthenticated({ ...pass, dkim: 'fail' })).toBe(false)
  })

  it('rejects a message that failed SPF with no DKIM result', () => {
    expect(senderIsAuthenticated({ spf: 'fail' })).toBe(false)
  })

  it('rejects when the provider reported NOTHING', () => {
    // The dangerous default. An unknown verdict must not read as a pass, or a
    // provider that stops sending the header silently reopens the hole.
    expect(senderIsAuthenticated(undefined)).toBe(false)
    expect(senderIsAuthenticated({})).toBe(false)
  })

  it('rejects SPF pass alone when DKIM explicitly failed', () => {
    expect(senderIsAuthenticated({ spf: 'pass', dkim: 'fail' })).toBe(false)
  })

  it('is not fooled by a verdict string that merely contains "pass"', () => {
    expect(senderIsAuthenticated({ dkim: 'passed-nothing' as never })).toBe(false)
    expect(senderIsAuthenticated({ dkim: 'permerror' as never })).toBe(false)
  })
})
