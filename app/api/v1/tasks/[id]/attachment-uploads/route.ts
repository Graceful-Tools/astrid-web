/**
 * POST /api/v1/tasks/:id/attachment-uploads
 *
 * Mint a short-lived ticket for uploading one image to a task. The client then
 * PUTs the raw bytes to `upload.url` with `upload.headers`, and the image lands
 * on the task as an ATTACHMENT comment. See services/task-attachment-upload.service.ts.
 *
 * Body: { fileName, mimeType?, caption?, clientRequestId?, aiAgentId? }
 *
 * Scope is comments:write — the result IS a comment, and it is the scope every
 * MCP connection already holds.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { resolveTaskIdOrIdentifier } from '@/lib/task-identifier'
import { resolveAgentAuthor } from '@/lib/ai-agent-author'
import { ATTACHMENT_UPLOAD_TICKET_HEADER } from '@/lib/attachment-upload-ticket'
import {
  mintTaskAttachmentUpload,
  TASK_ATTACHMENT_MAX_BYTES,
} from '@/services/task-attachment-upload.service'

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth<RouteContext>(
  { scopes: ['comments:write'], tag: 'v1.tasks.attachment-uploads' },
  async (req, auth, { params }) => {
    const { id: rawId } = await params
    const taskId = await resolveTaskIdOrIdentifier(rawId)
    if (!taskId) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Body must be a JSON object' }, { status: 400 })
    }

    if (body.aiAgentId !== undefined && auth.source === 'legacy_mcp') {
      return NextResponse.json(
        { error: 'aiAgentId cannot be selected by the caller; use an agent-bound credential' },
        { status: 400 }
      )
    }
    const author = await resolveAgentAuthor(auth, body.aiAgentId)
    if (!author.ok) return NextResponse.json({ error: author.error }, { status: 400 })

    const minted = await mintTaskAttachmentUpload({
      taskId,
      userId: auth.userId,
      authorId: author.authorId,
      fileName: body.fileName,
      mimeType: body.mimeType,
      caption: body.caption,
      clientRequestId: body.clientRequestId,
    })
    if (!minted.ok) return NextResponse.json({ error: minted.error }, { status: minted.status })

    return NextResponse.json(
      {
        taskId,
        fileName: minted.claims.fileName,
        mimeType: minted.claims.mimeType,
        clientRequestId: minted.claims.clientRequestId,
        upload: {
          method: 'PUT',
          url: new URL('/api/v1/attachment-uploads', req.nextUrl.origin).toString(),
          headers: {
            [ATTACHMENT_UPLOAD_TICKET_HEADER]: minted.ticket,
            'Content-Type': minted.claims.mimeType,
          },
          expiresAt: new Date(minted.claims.expiresAt).toISOString(),
          maxBytes: TASK_ATTACHMENT_MAX_BYTES,
        },
        meta: { apiVersion: 'v1', authSource: auth.source },
      },
      { status: 201 }
    )
  }
)
