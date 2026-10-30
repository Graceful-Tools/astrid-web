import { NextRequest, NextResponse } from "next/server"
import { createLogger } from '@/lib/logger'
import { verifyBlobCallback } from "@/lib/blob-callback-signature"
import { recordDirectUpload } from "@/lib/direct-upload-completion"

const log = createLogger('secure-upload.upload-complete')


/**
 * Upload Complete Callback
 *
 * This endpoint is called by Vercel Blob after a successful direct upload.
 * It stores the file metadata in the database.
 *
 * The request contains:
 * - type: "blob.upload-completed"
 * - payload.blob: { url, pathname, contentType, contentDisposition }
 * - payload.tokenPayload: JSON string with our custom data
 */
export async function POST(request: NextRequest) {
  try {
    // SECURITY: verify the Vercel Blob callback signature over the RAW body
    // before trusting anything in it. Without this, anyone could POST a forged
    // tokenPayload and attach an arbitrary blob URL onto any victim's
    // task/comment/list. The tokenPayload itself is trustworthy only because
    // get-upload-url validated the caller's access to the target at mint time.
    const rawBody = await request.text()
    const signature = request.headers.get('x-vercel-signature')
    // Ed25519 only: client-token (HMAC) callbacks ended with AWTD-1386.
    if (!verifyBlobCallback(rawBody, signature, {
      webhookPublicKey: process.env.BLOB_WEBHOOK_PUBLIC_KEY,
    })) {
      log.error('❌ [UploadComplete] Invalid or missing callback signature')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    const body = JSON.parse(rawBody)

    // Field names, not the payload (task 2e15b42f).
    log.debug({ fields: Object.keys(body ?? {}) }, '[UploadComplete] Received callback')

    // Validate request type
    if (body.type !== 'blob.upload-completed') {
      log.error(body.type, '❌ [UploadComplete] Invalid request type:')
      return NextResponse.json({ error: 'Invalid request type' }, { status: 400 })
    }

    const { blob, tokenPayload } = body.payload

    if (!blob || !tokenPayload) {
      log.error('❌ [UploadComplete] Missing blob or tokenPayload')
      return NextResponse.json({ error: 'Missing required data' }, { status: 400 })
    }

    // Shared with the self-hosted upload route (AWTD-1286).
    await recordDirectUpload({ url: blob.url, contentType: blob.contentType, size: blob.size }, tokenPayload)

    return NextResponse.json({ success: true })
  } catch (error) {
    log.error({ err: error }, '❌ [UploadComplete] Error:')
    return NextResponse.json({
      error: 'Failed to process upload completion'
    }, { status: 500 })
  }
}
