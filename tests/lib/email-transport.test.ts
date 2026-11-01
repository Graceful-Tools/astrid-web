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
import { row } from '../fixtures/prisma-rows'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const send = vi.hoisted(() => vi.fn())
const sendMail = vi.hoisted(() => vi.fn())
const createTransport = vi.hoisted(() => vi.fn(() => ({ sendMail })))

vi.mock('@vercel/otel', () => ({ registerOTel: vi.fn() }))
vi.mock('nodemailer', () => ({ default: { createTransport }, createTransport }))

vi.mock('resend', () => ({
  Resend: class {
    emails = { send }
  },
}))

import {
  assertEmailConfiguration,
  emailTransportKind,
  isEmailTransportLive,
  missingEmailSettings,
  sendTransportEmail,
  resetEmailTransportForTests,
} from '@/lib/email-transport'

// NODE_ENV is declared readonly by Next's env types. These suites set it on
// purpose and restore the whole `process.env` object around each test, so the
// write is scoped — it just needs to get past the readonly declaration.
// (AWTD-916)
function setNodeEnv(value: string) {
  ;(process.env as Record<string, string | undefined>).NODE_ENV = value
}

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
    setNodeEnv('development')
    process.env.RESEND_API_KEY = 'key'

    expect(isEmailTransportLive()).toBe(false)
  })

  it('is false with no API key, whatever the environment', () => {
    setNodeEnv('production')
    delete process.env.RESEND_API_KEY

    expect(isEmailTransportLive()).toBe(false)
  })

  it('is true in production with a key', () => {
    setNodeEnv('production')
    process.env.RESEND_API_KEY = 'key'

    expect(isEmailTransportLive()).toBe(true)
  })
})

describe('sendTransportEmail', () => {
  beforeEach(() => {
    setNodeEnv('production')
    process.env.RESEND_API_KEY = 'key'
  })

  it('normalises a single recipient to the provider’s array form', async () => {
    send.mockResolvedValue(row({ data: { id: 'msg-1' }, error: null }))

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
    send.mockResolvedValue(row({ data: null, error: { message: 'domain not verified' } }))

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

describe('EMAIL_TRANSPORT selects the backend (AWTD-1466)', () => {
  const email = { from: 'a@b.com', to: 'c@d.com', subject: 's', html: 'h', text: 't' }

  it('defaults to resend when unset, so production keeps its behaviour', () => {
    expect(emailTransportKind({})).toBe('resend')
    expect(emailTransportKind({ EMAIL_TRANSPORT: '' })).toBe('resend')
    // Today's production config: a Resend key and nothing new.
    expect(missingEmailSettings({ RESEND_API_KEY: 're_live' })).toEqual([])
    expect(missingEmailSettings({})).toEqual([])
  })

  it('accepts resend, smtp and log, case-insensitively', () => {
    expect(emailTransportKind({ EMAIL_TRANSPORT: 'SMTP' })).toBe('smtp')
    expect(emailTransportKind({ EMAIL_TRANSPORT: 'log' })).toBe('log')
    expect(emailTransportKind({ EMAIL_TRANSPORT: ' resend ' })).toBe('resend')
  })

  it('refuses an unknown transport rather than guessing', () => {
    expect(() => emailTransportKind({ EMAIL_TRANSPORT: 'sendgrid' })).toThrow(/EMAIL_TRANSPORT="sendgrid"/)
    expect(() => assertEmailConfiguration({ EMAIL_TRANSPORT: 'sendgrid' })).toThrow(/sendgrid/)
  })

  it('smtp with no SMTP_URL or SMTP_HOST refuses to boot', () => {
    expect(missingEmailSettings({ EMAIL_TRANSPORT: 'smtp' })).toEqual(['SMTP_URL (or SMTP_HOST)'])
    expect(() => assertEmailConfiguration({ EMAIL_TRANSPORT: 'smtp' })).toThrow(/EMAIL_TRANSPORT=smtp is missing: SMTP_URL/)
    expect(() => assertEmailConfiguration({ EMAIL_TRANSPORT: 'smtp', SMTP_URL: 'smtp://relay:25' })).not.toThrow()
    expect(() => assertEmailConfiguration({ EMAIL_TRANSPORT: 'smtp', SMTP_HOST: 'relay' })).not.toThrow()
  })

  it('smtp is live in production once a relay is configured, with no Resend key', () => {
    setNodeEnv('production')
    delete process.env.RESEND_API_KEY
    process.env.EMAIL_TRANSPORT = 'smtp'
    process.env.SMTP_URL = 'smtp://relay:25'

    expect(isEmailTransportLive()).toBe(true)
  })

  it('smtp is still not live in development', () => {
    setNodeEnv('development')
    process.env.EMAIL_TRANSPORT = 'smtp'
    process.env.SMTP_URL = 'smtp://relay:25'

    expect(isEmailTransportLive()).toBe(false)
  })

  it('log never sends, even with a Resend key in production', async () => {
    setNodeEnv('production')
    process.env.EMAIL_TRANSPORT = 'log'
    process.env.RESEND_API_KEY = 'key'

    expect(isEmailTransportLive()).toBe(false)
    await expect(sendTransportEmail(email)).rejects.toThrow(/not configured/)
    expect(send).not.toHaveBeenCalled()
  })

  it('smtp sends through nodemailer with the same message and returns its id', async () => {
    setNodeEnv('production')
    process.env.EMAIL_TRANSPORT = 'smtp'
    process.env.SMTP_URL = 'smtp://relay:25'
    sendMail.mockResolvedValue({ messageId: '<m1@relay>' })

    await expect(sendTransportEmail(email)).resolves.toEqual({ id: '<m1@relay>' })
    expect(createTransport).toHaveBeenCalledWith('smtp://relay:25')
    expect(sendMail).toHaveBeenCalledWith({ from: 'a@b.com', to: ['c@d.com'], subject: 's', html: 'h', text: 't' })
    expect(send).not.toHaveBeenCalled()
  })

  it('smtp builds its connection from host/port/user/pass/secure when there is no URL', async () => {
    setNodeEnv('production')
    process.env.EMAIL_TRANSPORT = 'smtp'
    process.env.SMTP_HOST = 'smtp.example.com'
    process.env.SMTP_PORT = '465'
    process.env.SMTP_USER = 'u'
    process.env.SMTP_PASS = 'p'
    process.env.SMTP_SECURE = 'true'
    sendMail.mockResolvedValue({ messageId: 'x' })

    await sendTransportEmail(email)
    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      auth: { user: 'u', pass: 'p' },
    })
  })

  it('smtp raises a relay failure', async () => {
    setNodeEnv('production')
    process.env.EMAIL_TRANSPORT = 'smtp'
    process.env.SMTP_URL = 'smtp://relay:25'
    sendMail.mockRejectedValue(new Error('550 relay denied'))

    await expect(sendTransportEmail(email)).rejects.toThrow('Email sending failed: 550 relay denied')
  })
})

describe('instrumentation refuses a half-configured email transport (AWTD-1466)', () => {
  async function boot() {
    vi.resetModules()
    const { register } = await import('@/instrumentation')
    return register()
  }

  it('register() refuses EMAIL_TRANSPORT=smtp with no SMTP_URL', async () => {
    ;(process.env as Record<string, string | undefined>).NEXT_RUNTIME = 'nodejs'
    process.env.EMAIL_TRANSPORT = 'smtp'
    delete process.env.SMTP_URL
    delete process.env.SMTP_HOST

    await expect(boot()).rejects.toThrow(/EMAIL_TRANSPORT=smtp is missing: SMTP_URL/)
  })

  it('register() accepts today\'s production email config (Resend key, no EMAIL_TRANSPORT)', async () => {
    ;(process.env as Record<string, string | undefined>).NEXT_RUNTIME = 'nodejs'
    delete process.env.EMAIL_TRANSPORT
    process.env.RESEND_API_KEY = 're_live'

    await expect(boot()).resolves.toBeUndefined()
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
