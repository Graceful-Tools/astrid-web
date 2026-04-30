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
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.upload')

const ALLOWED_FILE_TYPES: Record<string, string[]> = {
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  png: ['image/png'],
  gif: ['image/gif'],
  webp: ['image/webp'],
  pdf: ['application/pdf'],
  txt: ['text/plain'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
}
const ALLOWED_EXTENSIONS = Object.keys(ALLOWED_FILE_TYPES)

function validateUploadFile(file: File): { valid: boolean; extension: string; error?: string } {
  const parts = file.name.toLowerCase().split('.')
  const extension = parts.length > 1 ? parts.pop() || '' : ''
  if (!extension || !ALLOWED_EXTENSIONS.includes(extension)) {
    return {
      valid: false,
      extension: '',
      error: `File extension not allowed. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`,
    }
  }
  const allowedMimes = ALLOWED_FILE_TYPES[extension]
  if (!allowedMimes.includes(file.type)) {
    return {
      valid: false,
      extension: '',
      error: `File type mismatch. Expected ${allowedMimes.join(' or ')} for .${extension} file`,
    }
  }
  return { valid: true, extension }
}

export const POST = withAuth(
  { scopes: ['attachments:write'], tag: 'v1.upload' },
  async (req, auth) => {
    try {
      const formData = await req.formData()
      const file = formData.get('file') as File | null
      if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })

      if (file.size > 10 * 1024 * 1024) {
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
