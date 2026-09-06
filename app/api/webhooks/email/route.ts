/**
 * Email Webhook Endpoint
 *
 * Receives inbound emails from multiple providers and creates tasks
 * Email address: remindme@astrid.cc
 *
 * Supported Providers:
 * - Cloudflare Email Workers (https://developers.cloudflare.com/email-routing/)
 * - Mailgun (https://documentation.mailgun.com/en/latest/api-routes.html)
 * - Resend (https://resend.com/docs/dashboard/webhooks/event-types)
 */

import { capabilityGate } from '@/lib/brand/capabilities'
import { verifyMailgunSignature, verifySvixSignature } from '@/lib/webhooks/inbound-email-signatures'
import { senderAuthFromMailgun, senderAuthFromResend } from '@/lib/webhooks/sender-authentication'
import { BRAND } from '@/lib/brand/config'
import { NextRequest, NextResponse } from 'next/server'
import { emailToTaskService } from '@/lib/email-to-task-service'
import type { ParsedEmail } from '@/lib/email-to-task-service'
import { createLogger } from '@/lib/logger'
import { createSafeErrorResponse } from '@/lib/logging/error-sanitizer'

const log = createLogger('api.webhooks.email')


/**
 * Cloudflare Email Worker payload structure
 */
interface CloudflareEmailWebhook {
  from: string
  to: string | string[]
  cc?: string | string[]
  subject: string
  text?: string
  html?: string
  headers?: Record<string, string>
  raw?: string
}

/**
 * Resend webhook payload structure
 */
interface ResendInboundEmailWebhook {
  type: 'email.received'
  created_at: string
  data: {
    from: string
    to: string[]
    cc?: string[]
    bcc?: string[]
    subject: string
    text?: string
    html?: string
    reply_to?: string
    attachments?: Array<{
      filename: string
      content: string
      content_type: string
      size: number
    }>
  }
}

/**
 * Mailgun webhook payload structure (form data)
 */
interface MailgunWebhookData {
  sender: string
  recipient: string
  To: string
  Cc?: string
  subject: string
  'body-plain'?: string
  'body-html'?: string
  'stripped-text'?: string
  'stripped-html'?: string
}

export async function POST(request: NextRequest) {
  const blocked = capabilityGate('emailToTask')
  if (blocked) return blocked

  try {
    // Detect provider based on content type and headers
    const contentType = request.headers.get('content-type') || ''
    const isMailgun = contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')
    const userAgent = request.headers.get('user-agent') || ''
    const isCloudflare = userAgent.includes('Cloudflare') || request.headers.has('cf-ray')

    let parsedEmail: ParsedEmail

    if (isMailgun) {
      // Handle Mailgun webhook (form data)
      log.info('📧 Received Mailgun webhook')
      const formData = await request.formData()

      // Verify Mailgun webhook signature (mandatory)
      const mailgunSecret = process.env.MAILGUN_WEBHOOK_SIGNING_KEY
      if (!mailgunSecret) {
        log.error('❌ MAILGUN_WEBHOOK_SIGNING_KEY not configured - rejecting webhook')
        return NextResponse.json(
          { error: 'Webhook signature verification not configured' },
          { status: 500 }
        )
      }
      const isMailgunValid = verifyMailgunSignature(
        {
          timestamp: formData.get('timestamp') as string | null,
          token: formData.get('token') as string | null,
          signature: formData.get('signature') as string | null,
        },
        mailgunSecret
      )
      if (!isMailgunValid) {
        log.error('❌ Invalid Mailgun webhook signature')
        return NextResponse.json(
          { error: 'Invalid signature' },
          { status: 401 }
        )
      }
      log.info('✅ Mailgun signature verified')

      parsedEmail = parseMailgunWebhook(formData)
      parsedEmail.senderAuth = senderAuthFromMailgun(
        (field) => formData.get(field) as string | null
      )
    } else if (isCloudflare || contentType.includes('application/json')) {
      // Read the body EXACTLY ONCE, as text. It is a one-shot stream: the old
      // code parsed it with request.json() here and then called request.text()
      // inside the verifier, which threw and made every genuine Resend
      // delivery 401 (task 0a5b6337). Signature verification needs the raw
      // bytes, so the raw string is what gets kept and JSON is parsed from it.
      const rawBody = await request.text()
      let payload: Record<string, unknown>
      try {
        payload = JSON.parse(rawBody)
      } catch {
        return NextResponse.json({ error: 'Malformed JSON body' }, { status: 400 })
      }

      // Check if it's a Resend webhook (has 'type' and 'data' fields)
      if ('type' in payload && 'data' in payload) {
        log.info('📧 Received Resend webhook')

        // Verify webhook type
        if (payload.type !== 'email.received') {
          log.info(payload.type, 'Ignoring non-email webhook:')
          return NextResponse.json({ success: true, message: 'Ignored' })
        }

        // Verify Resend webhook signature (mandatory)
        const webhookSecret = process.env.RESEND_WEBHOOK_SECRET
        if (!webhookSecret) {
          log.error('❌ RESEND_WEBHOOK_SECRET not configured - rejecting webhook')
          return NextResponse.json(
            { error: 'Webhook signature verification not configured' },
            { status: 500 }
          )
        }
        // Svix, not a bare hex header. Resend signs `id.timestamp.body` with
        // the base64 secret behind the whsec_ prefix, and the timestamp is
        // checked against now so a captured delivery cannot be replayed.
        const isResendValid = verifySvixSignature(
          rawBody,
          {
            'svix-id': request.headers.get('svix-id'),
            'svix-timestamp': request.headers.get('svix-timestamp'),
            'svix-signature': request.headers.get('svix-signature'),
          },
          webhookSecret
        )
        if (!isResendValid) {
          log.error('❌ Invalid Resend webhook signature')
          return NextResponse.json(
            { error: 'Invalid signature' },
            { status: 401 }
          )
        }
        log.info('✅ Resend signature verified')

        parsedEmail = parseResendWebhook(payload as unknown as ResendInboundEmailWebhook)
        parsedEmail.senderAuth = senderAuthFromResend(
          (payload as { data?: unknown }).data
        )
      } else {
        // Assume Cloudflare Email Worker format. The isCloudflare detection is
        // by user-agent/cf-ray (both attacker-settable), so require a shared
        // secret before trusting this unsigned branch — otherwise anyone can
        // POST to create tasks + placeholder users.
        const expected = process.env.CLOUDFLARE_EMAIL_WEBHOOK_SECRET
        const provided = request.headers.get('x-astrid-webhook-secret')
        if (!expected || provided !== expected) {
          log.error('❌ Cloudflare email webhook: missing/invalid shared secret')
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
        log.info('📧 Received Cloudflare Email Worker webhook')
        parsedEmail = parseCloudflareWebhook(payload as unknown as CloudflareEmailWebhook)
        // The Worker forwards the original authentication results when it can.
        // Absent, the message counts as unauthenticated and processEmail
        // refuses it — the shared secret proves the WORKER is ours, not that
        // the sender is who the From header claims.
        parsedEmail.senderAuth = senderAuthFromResend(payload)
      }
    } else {
      throw new Error('Unsupported webhook format')
    }

    log.info({
      from: parsedEmail.from,
      to: parsedEmail.to,
      subject: parsedEmail.subject,
    }, '📧 Parsed email:')

    // Process email and create task
    const result = await emailToTaskService.processEmail(parsedEmail)

    if (!result) {
      log.error('Failed to process email - no result returned')
      return NextResponse.json(
        { error: 'Failed to process email' },
        { status: 400 }
      )
    }

    log.info({
      taskId: result.task.id,
      routing: result.routing,
      listId: result.list?.id,
      createdUsers: result.createdUsers.length,
    }, '✅ Email processed successfully:')

    // Return success response
    return NextResponse.json({
      success: true,
      task: {
        id: result.task.id,
        title: result.task.title,
      },
      routing: result.routing,
      list: result.list ? {
        id: result.list.id,
        name: result.list.name,
      } : null,
      createdPlaceholderUsers: result.createdUsers.length,
    })

  } catch (error) {
    log.error({ err: error }, 'Error processing email webhook:')

    // Log detailed error for debugging
    if (error instanceof Error) {
      log.error({
        message: error.message,
        stack: error.stack,
      }, 'Error details:')
    }

    return NextResponse.json(createSafeErrorResponse(error), { status: 500 })
  }
}

/**
 * Parse Cloudflare Email Worker webhook (JSON format)
 */
function parseCloudflareWebhook(payload: CloudflareEmailWebhook): ParsedEmail {
  // Normalize to/cc arrays
  const to = Array.isArray(payload.to) ? payload.to : [payload.to]
  const cc = payload.cc ? (Array.isArray(payload.cc) ? payload.cc : [payload.cc]) : []

  // If raw MIME email is provided, parse it server-side
  let textBody = payload.text || ''
  let htmlBody = payload.html

  if (payload.raw) {
    const parsed = parseMimeEmail(payload.raw)
    textBody = parsed.text || textBody
    htmlBody = parsed.html || htmlBody
  }

  return {
    from: payload.from,
    to,
    cc,
    bcc: [],
    subject: payload.subject,
    body: textBody,
    bodyHtml: htmlBody,
  }
}

/**
 * Parse raw MIME email to extract text and HTML parts
 * Handles multipart/alternative emails from Gmail, Outlook, etc.
 */
function parseMimeEmail(rawEmail: string): { text: string | null; html: string | null } {
  let textBody: string | null = null
  let htmlBody: string | null = null

  try {
    // Find MIME boundary
    const boundaryMatch = rawEmail.match(/boundary="([^"]+)"/)

    if (boundaryMatch) {
      // Multipart email - split by boundary
      const boundary = boundaryMatch[1]
      const parts = rawEmail.split(`--${boundary}`)

      for (const part of parts) {
        // Skip empty parts and final boundary marker
        if (!part.trim() || part.trim() === '--') continue

        // Check if this is text/plain part
        if (part.includes('Content-Type: text/plain')) {
          // Find double newline that separates headers from body
          // Try \r\n\r\n first (Windows), then \n\n (Unix)
          let bodyStart = part.indexOf('\r\n\r\n')
          let headerLength = 4
          if (bodyStart === -1) {
            bodyStart = part.indexOf('\n\n')
            headerLength = 2
          }
          if (bodyStart !== -1) {
            textBody = part.substring(bodyStart + headerLength)
              .replace(/\r\n/g, '\n')  // Normalize line endings
              .replace(/\r/g, '\n')     // Handle remaining CR
              .trim()
          }
        }

        // Check if this is text/html part
        if (part.includes('Content-Type: text/html')) {
          // Find double newline that separates headers from body
          // Try \r\n\r\n first (Windows), then \n\n (Unix)
          let bodyStart = part.indexOf('\r\n\r\n')
          let headerLength = 4
          if (bodyStart === -1) {
            bodyStart = part.indexOf('\n\n')
            headerLength = 2
          }
          if (bodyStart !== -1) {
            htmlBody = part.substring(bodyStart + headerLength)
              .replace(/\r\n/g, '\n')   // Normalize line endings
              .replace(/\r/g, '\n')      // Handle remaining CR
              .replace(/=\n/g, '')       // Remove quoted-printable soft line breaks
              .replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))  // Decode quoted-printable
              .trim()
          }
        }
      }
    } else {
      // Simple non-multipart email - find body after headers
      // Try \r\n\r\n first (Windows), then \n\n (Unix)
      let bodyStart = rawEmail.indexOf('\r\n\r\n')
      let headerLength = 4
      if (bodyStart === -1) {
        bodyStart = rawEmail.indexOf('\n\n')
        headerLength = 2
      }
      if (bodyStart !== -1) {
        textBody = rawEmail.substring(bodyStart + headerLength)
          .replace(/\r\n/g, '\n')
          .replace(/\r/g, '\n')
          .trim()
      }
    }
  } catch (error) {
    log.error({ err: error }, '❌ Error parsing MIME email:')
  }

  return { text: textBody, html: htmlBody }
}

/**
 * Parse Mailgun webhook (form data format)
 */
function parseMailgunWebhook(formData: FormData): ParsedEmail {
  const from = formData.get('sender') as string || formData.get('From') as string
  const to = (formData.get('To') as string || '').split(',').map(e => e.trim()).filter(Boolean)
  const cc = (formData.get('Cc') as string || '').split(',').map(e => e.trim()).filter(Boolean)
  const subject = formData.get('subject') as string || formData.get('Subject') as string
  const body = formData.get('stripped-text') as string || formData.get('body-plain') as string || ''
  const bodyHtml = formData.get('stripped-html') as string || formData.get('body-html') as string

  return {
    from,
    to,
    cc,
    bcc: [],
    subject,
    body,
    bodyHtml,
  }
}

/**
 * Parse Resend webhook (JSON format)
 */
function parseResendWebhook(payload: ResendInboundEmailWebhook): ParsedEmail {
  return {
    from: payload.data.from,
    to: payload.data.to || [],
    cc: payload.data.cc || [],
    bcc: payload.data.bcc || [],
    subject: payload.data.subject,
    body: payload.data.text || '',
    bodyHtml: payload.data.html,
    attachments: payload.data.attachments?.map(att => ({
      filename: att.filename,
      content: att.content,
      contentType: att.content_type,
      size: att.size,
    })),
  }
}




/**
 * GET endpoint for webhook verification
 * Some webhook providers send GET requests to verify the endpoint
 */
export async function GET() {
  const blocked = capabilityGate('emailToTask')
  if (blocked) return blocked

  return NextResponse.json({
    message: 'Email webhook endpoint',
    email: BRAND.inboundTaskEmail,
    status: 'active',
  })
}
