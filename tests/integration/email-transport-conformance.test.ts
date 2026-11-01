// @vitest-environment node
//
// Server module: lib/email-transport.ts refuses to build a mail client where
// `window` exists, so under jsdom every send would be refused for the wrong
// reason.

/**
 * AWTD-1466 — email conformance: one set of assertions, every transport.
 *
 * `EMAIL_TRANSPORT=resend|smtp` picks the backend; the templates, From address
 * and callers are shared. The invitation, verification and reminder emails are
 * sent through the real send functions once per transport, and what each
 * backend RECEIVED is compared: the Resend payload (the SDK is mocked at its
 * network edge) and the message an SMTP relay was handed over a real socket
 * (tests/integration/conformance/smtp-sink.ts, the in-process twin of the
 * self-host compose's mailpit). Same subject, same bodies, same recipient.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { startSmtpSink, type SmtpSink } from './conformance/smtp-sink'

const resendSent = vi.hoisted(() => [] as Array<{ from: string; to: string[]; subject: string; html: string; text: string }>)

vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (payload: (typeof resendSent)[number]) => {
        resendSent.push(payload)
        return { data: { id: `resend-${resendSent.length}` }, error: null }
      },
    }
  },
}))

import { resetEmailTransportForTests } from '@/lib/email-transport'
import { sendInvitationEmail, sendVerificationEmail } from '@/lib/email'
import { EmailReminderService } from '@/lib/email-reminder-service'

interface Delivered {
  from: string
  to: string[]
  subject: string
  html: string
  text: string
}

/** Line endings and trailing whitespace are the wire's business, not the content's. */
function normalise(body: string): string {
  return body.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trimEnd()
}

let sink: SmtpSink

interface Transport {
  configure(): void
  last(): Delivered | undefined
}

const TRANSPORTS: Record<'resend' | 'smtp', Transport> = {
  resend: {
    configure() {
      process.env.EMAIL_TRANSPORT = 'resend'
      process.env.RESEND_API_KEY = 're_conformance'
    },
    last() {
      const sent = resendSent.at(-1)
      return sent && { ...sent, html: normalise(sent.html), text: normalise(sent.text) }
    },
  },
  smtp: {
    configure() {
      process.env.EMAIL_TRANSPORT = 'smtp'
      process.env.SMTP_URL = sink.url
    },
    last() {
      const got = sink.received.at(-1)
      return got && { from: got.from, to: got.to, subject: got.subject, html: normalise(got.html), text: normalise(got.text) }
    },
  },
}

const TEMPLATES: Record<string, () => Promise<unknown>> = {
  invitation: () =>
    sendInvitationEmail({
      id: 'inv-1',
      email: 'friend@example.com',
      token: 'tok-123',
      type: 'WORKSPACE',
      expiresAt: new Date('2030-01-01T00:00:00Z'),
      sender: { name: 'Ada Lovelace', email: 'ada@example.com' },
      message: 'Join me — émigré café ✓',
    }),
  verification: () =>
    sendVerificationEmail({ email: 'friend@example.com', token: 'verify-456', userName: 'Friend' }),
  reminder: () =>
    new EmailReminderService().sendTaskReminder({
      taskId: 'task-1',
      title: 'Water the plants',
      dueDateTime: new Date('2030-06-01T09:00:00Z'),
      assigneeEmail: 'friend@example.com',
      assigneeName: 'Friend',
      listNames: ['Home'],
    }),
}

const ORIGINAL_ENV = { ...process.env }

beforeAll(async () => {
  sink = await startSmtpSink()
})

afterAll(async () => {
  await sink.close()
})

beforeEach(() => {
  ;(process.env as Record<string, string | undefined>).NODE_ENV = 'production'
  process.env.FROM_EMAIL = 'noreply@example.com'
  // The reminder copy picks a random line; the same line for every transport.
  vi.spyOn(Math, 'random').mockReturnValue(0)
  resetEmailTransportForTests()
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.restoreAllMocks()
  resetEmailTransportForTests()
})

describe('every email transport delivers the same message (AWTD-1466)', () => {
  for (const [template, send] of Object.entries(TEMPLATES)) {
    it(`${template}: resend and smtp deliver the same subject, bodies and recipient`, async () => {
      const delivered: Record<string, Delivered | undefined> = {}
      for (const [name, transport] of Object.entries(TRANSPORTS)) {
        delete process.env.EMAIL_TRANSPORT
        delete process.env.RESEND_API_KEY
        delete process.env.SMTP_URL
        transport.configure()
        resetEmailTransportForTests()
        await send()
        delivered[name] = transport.last()
      }

      const { resend, smtp } = delivered
      expect(resend, 'the Resend transport was handed the message').toBeDefined()
      expect(smtp, 'the SMTP sink received the message').toBeDefined()
      expect(resend!.subject.length).toBeGreaterThan(0)
      expect(resend!.text.length).toBeGreaterThan(0)
      expect(resend!.to).toEqual(['friend@example.com'])
      expect(smtp).toEqual(resend)
    })
  }

  it('the SMTP envelope carries the From and recipient, not only the headers', async () => {
    TRANSPORTS.smtp.configure()
    await TEMPLATES.verification()
    const got = sink.received.at(-1)!
    expect(got.envelopeFrom).toBe('noreply@example.com')
    expect(got.envelopeTo).toEqual(['friend@example.com'])
  })
})
