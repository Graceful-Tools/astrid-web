/**
 * PUT /api/v1/storage/uploads/:token
 *
 * A direct upload on self-hosted storage (`STORAGE_DRIVER=s3|local`,
 * AWTD-1286). This is the URL `presigned.uploadUrl` names off Vercel: the
 * client PUTs the raw bytes with `Content-Type`, exactly as it would to
 * Vercel Blob, and gets Blob's `{ url, pathname, contentType }` back, which
 * the replace-file flow passes to confirm-upload.
 *
 * The token is the credential (lib/storage/upload-token.ts): signed, an hour
 * long, one pathname, its types and size. When it carries a completion
 * payload, the file is recorded here, by the same code Blob's callback runs.
 *
 * 404 on Vercel Blob deployments, where this route has nothing to do.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { createLogger } from '@/lib/logger'
import { recordDirectUpload } from '@/lib/direct-upload-completion'
import { putObject } from '@/lib/secure-storage'
import { isSelfHostedStorage } from '@/lib/storage/object-store'
import { verifyUploadToken } from '@/lib/storage/upload-token'
import type { RouteContextParams } from '@/types/next'

const log = createLogger('v1.storage.uploads')

export async function PUT(req: NextRequest, context: RouteContextParams<{ token: string }>) {
  if (!isSelfHostedStorage()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { token } = await context.params
  const grant = verifyUploadToken(token)
  if (!grant) {
    return NextResponse.json({ error: 'Missing, invalid or expired upload grant' }, { status: 401 })
  }

  const contentType = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (!grant.allowedContentTypes.map(type => type.toLowerCase()).includes(contentType)) {
    return NextResponse.json({ error: `Content type ${contentType || '(none)'} is not allowed` }, { status: 415 })
  }

  // Refuse a declared oversize before reading it, and an undeclared one after.
  const declared = Number(req.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > grant.maximumSizeInBytes) {
    return NextResponse.json({ error: `File exceeds ${grant.maximumSizeInBytes} bytes` }, { status: 413 })
  }

  try {
    const bytes = new Uint8Array(await req.arrayBuffer())
    if (bytes.length > grant.maximumSizeInBytes) {
      return NextResponse.json({ error: `File exceeds ${grant.maximumSizeInBytes} bytes` }, { status: 413 })
    }

    const object = await putObject(grant.pathname, Buffer.from(bytes), { contentType })
    if (grant.tokenPayload) {
      await recordDirectUpload({ url: object.url, contentType, size: bytes.length }, grant.tokenPayload)
    }

    return NextResponse.json({
      url: object.url,
      downloadUrl: object.url,
      pathname: object.pathname,
      contentType,
    })
  } catch (error) {
    log.error({ err: error }, 'Self-hosted direct upload failed')
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
