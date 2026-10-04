import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logger'
import { detectPlatform } from '@/lib/analytics-events'
import { clientErrorsRateLimiter, createRateLimitHeaders } from '@/lib/rate-limiter'
import { normalizeVitalsRoute } from '@/lib/web-vitals'
import { CLIENT_ERROR_BOUNDARIES, CLIENT_ERROR_LIMITS } from '@/lib/client-error-report'

const log = createLogger('internal.client-errors')

/**
 * Render errors caught by the app's error boundaries (AWTD-1076).
 *
 * A task row tapped on a phone fell into "Something went wrong" and the
 * exception was never recorded anywhere — the boundary only logged in
 * development, and a client-side crash makes no failing request. This writes
 * one error-level log line per report, so `vercel logs --query "client render
 * error"` names what broke and in which browser.
 *
 * Unauthenticated, like the web-vitals beacon, because a crash can precede or
 * replace the session. It stores nothing: what protects it is a per-IP rate
 * limit, an enumerated boundary, bounded strings, and redaction of anything an
 * error message might carry that identifies a person or a record.
 */

const ReportSchema = z.object({
  boundary: z.enum(CLIENT_ERROR_BOUNDARIES),
  message: z.string().max(CLIENT_ERROR_LIMITS.message),
  stack: z.string().max(CLIENT_ERROR_LIMITS.stack).optional(),
  digest: z.string().max(CLIENT_ERROR_LIMITS.digest).optional(),
  path: z.string().min(1).max(CLIENT_ERROR_LIMITS.path),
})

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
// No `/` or `:` on either side: Safari writes stack frames as `fn@https://…`,
// and redacting those would destroy the one browser this exists to diagnose.
const EMAIL = /[^\s@"'<>()/:]+@[^\s@"'<>()/:]+\.[a-z]{2,}/gi

function redact(text: string | undefined): string | undefined {
  return text?.replace(UUID, ':id').replace(EMAIL, ':email')
}

export async function POST(request: NextRequest) {
  const limit = await clientErrorsRateLimiter.checkRateLimitAsync(request)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: createRateLimitHeaders(limit) },
    )
  }

  try {
    const report = ReportSchema.parse(await request.json())

    log.error(
      {
        boundary: report.boundary,
        message: redact(report.message),
        stack: redact(report.stack),
        digest: report.digest,
        route: normalizeVitalsRoute(report.path),
        platform: detectPlatform(request),
        // The browser is the question a phone-only crash turns on.
        userAgent: request.headers.get('user-agent')?.slice(0, 300) ?? null,
      },
      'client render error',
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    // A malformed report is not an incident; answer 200 and say so quietly.
    log.warn({ err }, 'malformed client-error report')
    return NextResponse.json({ ok: false })
  }
}
