/**
 * GET /api/v1/storage/objects/:pathname
 *
 * Serves an object on self-hosted storage (`STORAGE_DRIVER=s3|local|azure-blob`,
 * AWTD-1286), standing in for Vercel Blob's public URLs. Access is the same
 * as there: anyone holding the URL can read it, and the URL is unguessable
 * (`files/<userId>/<uuid>.<ext>`). Permission checks stay where they are, at
 * `/api/secure-files/:id`, which redirects here only after checking.
 *
 * One difference is deliberate. Blob serves from its own origin; these bytes
 * come from the app's. So every response is sandboxed and never sniffed, and
 * anything that is not media, a PDF or plain text downloads rather than
 * rendering: an uploaded HTML file must not run as this site.
 *
 * 404 on Vercel Blob deployments.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { createLogger } from '@/lib/logger'
import { isSafeObjectPathname, isSelfHostedStorage, selfHostedObjectStore } from '@/lib/storage/object-store'
import type { RouteContextParams } from '@/types/next'

const log = createLogger('v1.storage.objects')

const INLINE = /^(image\/(png|jpeg|gif|webp|heic|heif|avif)|video\/|audio\/|application\/pdf$|text\/plain$)/

export async function GET(req: NextRequest, context: RouteContextParams<{ path: string[] }>) {
  if (!isSelfHostedStorage()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { path } = await context.params
  const pathname = path.join('/')
  if (!isSafeObjectPathname(pathname)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const object = await (await selfHostedObjectStore()).get(pathname, req.headers.get('range'))
    if (!object) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const headers = new Headers({
      'Content-Type': object.contentType,
      'Accept-Ranges': 'bytes',
      // Pathnames are never reused: a replacement is written under a new one.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
      'Content-Disposition': INLINE.test(object.contentType) ? 'inline' : 'attachment',
    })
    if (object.size !== undefined) headers.set('Content-Length', String(object.size))
    if (object.contentRange) headers.set('Content-Range', object.contentRange)

    return new NextResponse(object.body as BodyInit, { status: object.contentRange ? 206 : 200, headers })
  } catch (error) {
    log.error({ err: error, pathname }, 'Self-hosted object read failed')
    return NextResponse.json({ error: 'Read failed' }, { status: 500 })
  }
}
