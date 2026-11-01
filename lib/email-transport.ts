/**
 * The one outbound email transport.
 *
 * `lib/email.ts` and `lib/email-reminder-service.ts` each constructed their own
 * Resend client and each re-implemented the same "development, or no API key →
 * log instead of send" guard (task 1e772f0c). Two clients for one transport is
 * two places to change when the provider moves, and — more immediately — two
 * places for the send/don't-send rule to disagree, which is the kind of drift
 * nobody notices until a partner's staging deployment mails real users.
 *
 * This module is the seam. It is deliberately narrow: subject, recipients,
 * bodies. Everything about WHAT to say — templates, brand copy, the From
 * address — stays with the callers.
 *
 * `EMAIL_TRANSPORT` picks the backend (AWTD-1466) — one code path, backend
 * chosen by env (docs/architecture/PLATFORM_ASSESSMENT_2026-11.md §5):
 *
 * - `resend` (the default, and what hosted Astrid runs): unchanged — without
 *   RESEND_API_KEY nothing is sent and callers log instead.
 * - `smtp`: any SMTP relay through nodemailer — Azure Communication Services
 *   SMTP, SendGrid, Exchange Online, a partner's own relay. `SMTP_URL`, or
 *   `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_SECURE`.
 * - `log`: never send; every caller logs the message it would have sent.
 *
 * Inbound mail (email-to-task) is webhooks and is not touched by this.
 */

import { Resend } from 'resend'
import type { Transporter } from 'nodemailer'
import { createLogger } from '@/lib/logger'

const log = createLogger('email-transport')

/** The variables the transport reads. `process.env` is one; tests pass a plain object. */
export type EmailEnv = Record<string, string | undefined>

export const EMAIL_TRANSPORTS = ['resend', 'smtp', 'log'] as const
export type EmailTransportKind = (typeof EMAIL_TRANSPORTS)[number]

/**
 * The configured transport. Unset is `resend`, so a deployment that sets
 * nothing new behaves exactly as before. An unrecognised value is an error
 * rather than a fallback: a deployment that asked for SMTP and silently got
 * Resend (or nothing) would find out when nobody received their invitations.
 */
export function emailTransportKind(env: EmailEnv = process.env): EmailTransportKind {
  // Read as `process.env.EMAIL_TRANSPORT` by default — spelled out so the env
  // drift check (scripts/check-env-schema.ts) can see the read.
  const raw = (env === process.env ? process.env.EMAIL_TRANSPORT : env.EMAIL_TRANSPORT)?.trim().toLowerCase()
  if (!raw) return 'resend'
  if ((EMAIL_TRANSPORTS as readonly string[]).includes(raw)) return raw as EmailTransportKind
  throw new Error(`EMAIL_TRANSPORT="${env.EMAIL_TRANSPORT}" is not one of ${EMAIL_TRANSPORTS.join(', ')}`)
}

function hasSmtpRelay(env: EmailEnv): boolean {
  return !!(env.SMTP_URL?.trim() || env.SMTP_HOST?.trim())
}

/**
 * Settings the configured transport cannot run without, by name. `resend`
 * needs none: without a key it logs, which is today's behaviour and stays so.
 */
export function missingEmailSettings(env: EmailEnv = process.env): string[] {
  return emailTransportKind(env) === 'smtp' && !hasSmtpRelay(env) ? ['SMTP_URL (or SMTP_HOST)'] : []
}

/** Called at server start (instrumentation.ts): a half-configured relay stops the boot. */
export function assertEmailConfiguration(env: EmailEnv = process.env): void {
  const missing = missingEmailSettings(env)
  if (missing.length > 0) {
    throw new Error(`EMAIL_TRANSPORT=${emailTransportKind(env)} is missing: ${missing.join(', ')}`)
  }
}

/**
 * Lazily constructed, so importing this module never requires a key.
 *
 * The originals built their client at module load, which meant the guard and
 * the client could answer differently if the environment was read at different
 * times. One accessor, one answer.
 */
let client: Resend | null | undefined

function getClient(): Resend | null {
  if (client === undefined) {
    const apiKey = process.env.RESEND_API_KEY
    client = typeof window === 'undefined' && apiKey ? new Resend(apiKey) : null
  }
  return client
}

/**
 * Will a send actually leave the building?
 *
 * False in development and wherever no key is configured — callers log the
 * message they would have sent instead, which is how the invite and
 * verification flows stay testable locally.
 */
export function isEmailTransportLive(): boolean {
  if (process.env.NODE_ENV === 'development' || typeof window !== 'undefined') return false
  const kind = emailTransportKind()
  if (kind === 'smtp') return hasSmtpRelay(process.env)
  if (kind === 'log') return false
  return !!process.env.RESEND_API_KEY && !!getClient()
}

/** nodemailer's connection options, from SMTP_URL or the separate settings. */
function smtpOptions(env: EmailEnv): string | { host: string; port: number; secure: boolean; auth?: { user: string; pass: string } } {
  const url = env.SMTP_URL?.trim()
  if (url) return url
  const secure = env.SMTP_SECURE?.trim().toLowerCase() === 'true'
  const user = env.SMTP_USER?.trim()
  return {
    host: env.SMTP_HOST!.trim(),
    port: Number(env.SMTP_PORT) || (secure ? 465 : 587),
    secure,
    ...(user ? { auth: { user, pass: env.SMTP_PASS ?? '' } } : {}),
  }
}

let smtp: { key: string; transporter: Transporter } | undefined

/** One pooled-by-nodemailer transporter, rebuilt when any SMTP setting changes. */
async function getSmtpTransporter(): Promise<Transporter> {
  const key = [process.env.SMTP_URL, process.env.SMTP_HOST, process.env.SMTP_PORT, process.env.SMTP_USER,
    process.env.SMTP_PASS, process.env.SMTP_SECURE].join('|')
  if (smtp?.key !== key) {
    // Loaded only when selected, so hosted Astrid never loads it.
    const nodemailer = await import('nodemailer')
    const createTransport = nodemailer.createTransport ?? nodemailer.default.createTransport
    smtp = { key, transporter: createTransport(smtpOptions(process.env) as never) }
  }
  return smtp.transporter
}

async function sendViaSmtp(email: OutboundEmail): Promise<{ id?: string }> {
  const transporter = await getSmtpTransporter()
  try {
    const info = await transporter.sendMail({
      from: email.from,
      to: Array.isArray(email.to) ? email.to : [email.to],
      subject: email.subject,
      html: email.html,
      text: email.text,
    })
    return { id: info.messageId }
  } catch (error) {
    log.error({ err: error }, 'Email transport error')
    throw new Error(`Email sending failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export interface OutboundEmail {
  from: string
  to: string | string[]
  subject: string
  html: string
  text: string
}

/**
 * Send one email, or throw.
 *
 * The provider reports a failure in its RESULT rather than by rejecting, which
 * is easy to drop on the floor — every caller here used to unpack `{ data,
 * error }` and remember to check. Raising it is that check, made once.
 */
export async function sendTransportEmail(email: OutboundEmail): Promise<{ id?: string } | null> {
  const kind = emailTransportKind()
  if (kind === 'log') {
    throw new Error('Email transport is not configured (EMAIL_TRANSPORT=log only logs)')
  }
  if (kind === 'smtp') {
    if (typeof window !== 'undefined' || !hasSmtpRelay(process.env)) {
      throw new Error('Email transport is not configured (EMAIL_TRANSPORT=smtp needs SMTP_URL or SMTP_HOST)')
    }
    return sendViaSmtp(email)
  }

  const transport = getClient()
  if (!transport) {
    throw new Error('Email transport is not configured (no RESEND_API_KEY)')
  }

  const { data, error } = await transport.emails.send({
    from: email.from,
    to: Array.isArray(email.to) ? email.to : [email.to],
    subject: email.subject,
    html: email.html,
    text: email.text,
  })

  if (error) {
    log.error({ err: error }, 'Email transport error')
    throw new Error(`Email sending failed: ${error.message}`)
  }

  return data ?? null
}

/** Test seam: forget the memoized clients so a changed setting is picked up. */
export function resetEmailTransportForTests(): void {
  client = undefined
  smtp = undefined
}
