/**
 * PUT /api/v1/attachment-uploads
 *
 * Upload the raw bytes of one image with a ticket from
 * POST /api/v1/tasks/:id/attachment-uploads (header `X-Upload-Ticket`).
 * The ticket is the credential: it is signed, expires in 15 minutes, and names
 * the one task, file name and type it permits. Replaying it returns the same
 * comment rather than posting a second one.
 *
 * Responds 201 with the new ATTACHMENT comment, or 200 on a replay.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { createLogger } from '@/lib/logger'
import {
  ATTACHMENT_UPLOAD_TICKET_HEADER,
  verifyAttachmentUploadTicket,
} from '@/lib/attachment-upload-ticket'
import {
  completeTaskAttachmentUpload,
  TASK_ATTACHMENT_MAX_BYTES,
} from '@/services/task-attachment-upload.service'

const log = createLogger('v1.attachment-uploads')

export async function PUT(req: NextRequest) {
  const claims = verifyAttachmentUploadTicket(req.headers.get(ATTACHMENT_UPLOAD_TICKET_HEADER))
  if (!claims) {
    return NextResponse.json({ error: 'Missing, invalid or expired upload ticket' }, { status: 401 })
  }

  // Refuse a declared oversize before reading it.
  const declared = Number(req.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > TASK_ATTACHMENT_MAX_BYTES) {
    return NextResponse.json({ error: `File exceeds ${TASK_ATTACHMENT_MAX_BYTES} bytes` }, { status: 413 })
  }

  try {
    const bytes = new Uint8Array(await req.arrayBuffer())
    const result = await completeTaskAttachmentUpload(claims, bytes)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

    return NextResponse.json(
      {
        comment: result.comment,
        fileId: result.fileId,
        taskId: claims.taskId,
        meta: { apiVersion: 'v1', idempotent: !result.created },
      },
      { status: result.created ? 201 : 200 }
    )
  } catch (error) {
    log.error({ err: error, taskId: claims.taskId }, 'Task attachment upload failed')
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
