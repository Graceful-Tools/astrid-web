// @vitest-environment node
//
// Server module: `lib/email-transport.ts` refuses to construct a mail client
// where `window` exists, so that no bundle can ever ship one to a browser.
// Under the suite's default jsdom environment that guard would be permanently
// tripped and every send test would pass for the wrong reason.

/**
 * Task 1e772f0c — one email transport, one send/don't-send rule.
 *
 * `lib/email.ts` and `lib/email-reminder-service.ts` each built their own
 * Resend client and each re-implemented the guard deciding whether a message
 * actually leaves the building. Two copies of that rule is one bad merge away
 * from a staging deployment mailing real users, so it is pinned here and the
 * count of clients is pinned by the rule test at the bottom.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const send = vi.hoisted(() => vi.fn())

vi.mock('resend', () => ({
  Resend: class {
    emails = { send }
  },
}))

import {
  isEmailTransportLive,
  sendTransportEmail,
  resetEmailTransportForTests,
} from '@/lib/email-transport'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  resetEmailTransportForTests()
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  resetEmailTransportForTests()
})

describe('isEmailTransportLive', () => {
  it('is false in development, so a local run logs rather than mails real people', () => {
    process.env.NODE_ENV = 'development'
    process.env.RESEND_API_KEY = 'key'

    expect(isEmailTransportLive()).toBe(false)
  })

  it('is false with no API key, whatever the environment', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.RESEND_API_KEY

    expect(isEmailTransportLive()).toBe(false)
  })

  it('is true in production with a key', () => {
    process.env.NODE_ENV = 'production'
    process.env.RESEND_API_KEY = 'key'

    expect(isEmailTransportLive()).toBe(true)
  })
})

describe('sendTransportEmail', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'production'
    process.env.RESEND_API_KEY = 'key'
  })

  it('normalises a single recipient to the provider’s array form', async () => {
    send.mockResolvedValue({ data: { id: 'msg-1' }, error: null })

    await sendTransportEmail({
      from: 'a@b.com',
      to: 'c@d.com',
      subject: 'Subject',
      html: '<p>hi</p>',
      text: 'hi',
    })

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: ['c@d.com'] }))
  })

  it('RAISES a provider error the callers used to have to remember to unpack', async () => {
    // The provider reports failure in the RESULT, not by rejecting. Four call
    // sites each destructured `{ data, error }` and checked it by hand; this is
    // that check, made once.
    send.mockResolvedValue({ data: null, error: { message: 'domain not verified' } })

    await expect(
      sendTransportEmail({ from: 'a@b.com', to: 'c@d.com', subject: 's', html: 'h', text: 't' })
    ).rejects.toThrow('domain not verified')
  })

  it('refuses to send at all when no transport is configured', async () => {
    delete process.env.RESEND_API_KEY
    resetEmailTransportForTests()

    await expect(
      sendTransportEmail({ from: 'a@b.com', to: 'c@d.com', subject: 's', html: 'h', text: 't' })
    ).rejects.toThrow(/not configured/)
    expect(send).not.toHaveBeenCalled()
  })
})

describe('there is exactly one email transport (task 1e772f0c)', () => {
  it('constructs the provider client in one module only', () => {
    const root = process.cwd()
    const files: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry.startsWith('.')) continue
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) walk(full)
        else if (/\.tsx?$/.test(entry)) files.push(full)
      }
    }
    for (const dir of ['app', 'lib', 'components', 'hooks', 'services', 'mcp']) {
      try {
        walk(join(root, dir))
      } catch {
        /* directory absent */
      }
    }

    const constructors = files
      .map(file => relative(root, file))
      .filter(file => /new\s+Resend\s*\(/.test(readFileSync(join(root, file), 'utf8')))

    expect(constructors).toEqual(['lib/email-transport.ts'])
  })
})
