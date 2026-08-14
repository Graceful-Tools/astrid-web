/**
 * POST /api/v1/upload
 *
 * Direct upload of a small file (≤10MB) to Vercel Blob via multipart
 * form data. Returns the public Blob URL. Mirrors POST /api/upload.
 *
 * This is the simplest upload path. The SecureFile chain (request-upload,
 * get-upload-url, upload-url, confirm-upload) for larger or
 * access-controlled files is a separate v1 PR — that chain has multiple
 * round-trips and Blob signing concerns that need iOS-coordinated
 * testing.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { put } from '@vercel/blob'
import { randomUUID } from 'crypto'
import { validateUploadFile, MAX_DIRECT_UPLOAD_BYTES } from '@/lib/upload-validation'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.upload')

export const POST = withAuth(
  { scopes: ['attachments:write'], tag: 'v1.upload' },
  async (req, auth) => {
    try {
      const formData = await req.formData()
      const file = formData.get('file') as File | null
      if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })

      if (file.size > MAX_DIRECT_UPLOAD_BYTES) {
        return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 400 })
      }
      const validation = validateUploadFile(file)
      if (!validation.valid) {
        return NextResponse.json({ error: validation.error }, { status: 400 })
      }

      const fileId = randomUUID()
      const pathname = `uploads/${auth.userId}/${fileId}.${validation.extension}`
      const blob = await put(pathname, file, {
        access: 'public',
        contentType: file.type,
      })

      return NextResponse.json({
        url: blob.url,
        name: file.name,
        size: file.size,
        type: file.type,
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      log.error({ err: error }, 'Error uploading file')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
