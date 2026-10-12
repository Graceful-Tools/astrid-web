/**
 * Short-lived, signed tickets for uploading one task attachment.
 *
 * An MCP tool argument is the wrong place for file bytes — a single screenshot
 * is hundreds of KB of base64, which the model would have to read and write as
 * text. So the authenticated caller mints a ticket (POST
 * /api/v1/tasks/:id/attachment-uploads) and the client PUTs the raw bytes with
 * it (PUT /api/v1/attachment-uploads), the way a presigned URL works.
 *
 * The ticket is a bearer credential, so it is deliberately narrow: one task,
 * one image name and type, one idempotency key, a 15-minute life, and an HMAC
 * over all of it with NEXTAUTH_SECRET. It carries the decisions already made
 * at mint time — who is uploading, and who the comment is signed as — so the
 * PUT does not have to be re-authenticated by a client that has no token.
 * Task access is still re-checked at PUT time.
 */

import { createHmac, timingSafeEqual } from 'crypto'

export const ATTACHMENT_UPLOAD_TICKET_TTL_MS = 15 * 60 * 1000
export const ATTACHMENT_UPLOAD_TICKET_HEADER = 'X-Upload-Ticket'

export interface AttachmentUploadTicket {
  /** The authenticated caller — uploader of the file and linker of it. */
  userId: string
  /** Who the comment is signed as (the agent, when one is speaking). */
  authorId: string
  taskId: string
  fileName: string
  mimeType: string
  caption: string | null
  clientRequestId: string
  /** Epoch ms. */
  expiresAt: number
}

const PURPOSE = 'task-attachment-upload:v1'

function secret(): string {
  const value = process.env.NEXTAUTH_SECRET
  if (!value) throw new Error('NEXTAUTH_SECRET is required to sign upload tickets')
  return value
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(`${PURPOSE}:${payload}`).digest('base64url')
}

export function signAttachmentUploadTicket(ticket: AttachmentUploadTicket): string {
  const payload = Buffer.from(JSON.stringify(ticket)).toString('base64url')
  return `${payload}.${sign(payload)}`
}

/** The ticket's claims, or null when it is malformed, forged, or expired. */
export function verifyAttachmentUploadTicket(
  token: string | null | undefined,
  now: number = Date.now(),
): AttachmentUploadTicket | null {
  if (!token) return null
  const [payload, signature, extra] = token.split('.')
  if (!payload || !signature || extra !== undefined) return null

  let expected: Buffer
  try {
    expected = Buffer.from(sign(payload))
  } catch {
    return null
  }
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null

  let claims: AttachmentUploadTicket
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }

  const strings = [claims?.userId, claims?.authorId, claims?.taskId, claims?.fileName, claims?.mimeType, claims?.clientRequestId]
  if (strings.some(value => typeof value !== 'string' || value.length === 0)) return null
  if (typeof claims.expiresAt !== 'number' || claims.expiresAt <= now) return null
  return claims
}
