/**
 * RED for task 17fea642-5391-4b1f-a2dc-8dd8be825e65.
 *
 * 21 routes put a raw error message on a 500 response, exposing Prisma errors,
 * connection strings and server paths to any client that can provoke one. They
 * are not careless: ASTRID.md:726-734 prescribed exactly this, so the routes
 * were following the documented pattern.
 *
 * scripts/check-api-boundaries.ts is already diff-scoped — it inspects only
 * lines added since the merge base — so a rule here stops NEW leaks without
 * requiring every existing one to be fixed first. It just never looked at
 * app/api/, because isClientSource() deliberately excludes it.
 */
import { describe, it, expect } from 'vitest'
import { findAddedApiBoundaryViolations } from '@/lib/api-boundary-guard'

function added(file: string, content: string, line = 10) {
  return { addedLines: [{ file, line, content }], addedFiles: [] }
}

const leaks = findAddedApiBoundaryViolations

describe('leaked-error-message rule (task 17fea642)', () => {
  it('flags a raw error.message returned to the client from a route', () => {
    const found = leaks(
      added('app/api/things/route.ts', "    return NextResponse.json({ error: error.message }, { status: 500 })"),
      [],
    )
    expect(found.map((v) => v.kind)).toContain('leaked-error-message')
  })

  it('flags the `details:` variant, which is how most of them are written', () => {
    const found = leaks(
      added(
        'app/api/things/route.ts',
        "      details: error instanceof Error ? error.message : 'Unknown error',",
      ),
      [],
    )
    expect(found.map((v) => v.kind)).toContain('leaked-error-message')
  })

  it('does not flag logging, which SHOULD carry the message', () => {
    const found = leaks(
      added('app/api/things/route.ts', "    log.error({ err: error }, `failed: ${error.message}`)"),
      [],
    )
    expect(found).toHaveLength(0)
  })

  it('does not flag a message gated to development', () => {
    const found = leaks(
      added(
        'app/api/things/route.ts',
        "      details: process.env.NODE_ENV === 'development' ? error.message : undefined,",
      ),
      [],
    )
    expect(found).toHaveLength(0)
  })

  it('does not flag the sanitizer, which is the fix', () => {
    const found = leaks(
      added('app/api/things/route.ts', '    return NextResponse.json(createSafeErrorResponse(error), { status: 500 })'),
      [],
    )
    expect(found).toHaveLength(0)
  })

  it('leaves non-route files alone', () => {
    const found = leaks(added('lib/thing.ts', '  throw new Error(error.message)'), [])
    expect(found).toHaveLength(0)
  })

  it('honours a documented exemption', () => {
    const found = leaks(
      added('app/api/things/route.ts', "    return NextResponse.json({ error: error.message }, { status: 500 })"),
      [
        {
          kind: 'leaked-error-message',
          file: 'app/api/things/route.ts',
          contains: 'error.message',
          reason: 'Curated domain error, reviewed 2026-09-06.',
        },
      ],
    )
    expect(found).toHaveLength(0)
  })
})

describe('leaked-error-message: multi-line blocks (task 17fea642)', () => {
  function block(file: string, lines: string[]) {
    return {
      addedLines: lines.map((content, i) => ({ file, line: 10 + i, content })),
      addedFiles: [],
    }
  }

  it('does not flag a structured log call, where only the first line names the logger', () => {
    const found = findAddedApiBoundaryViolations(
      block('app/api/things/route.ts', [
        '    log.error({',
        '      error: error instanceof Error ? error.message : String(error),',
        '      isAbortError: error instanceof Error && error.name === "AbortError",',
        '    }, "Network error verifying token")',
      ]),
      [],
    )
    expect(found).toHaveLength(0)
  })

  it('still flags a multi-line response body', () => {
    const found = findAddedApiBoundaryViolations(
      block('app/api/things/route.ts', [
        '    return NextResponse.json({',
        '      error: "Internal server error",',
        "      details: error instanceof Error ? error.message : String(error),",
        '    }, { status: 500 })',
      ]),
      [],
    )
    expect(found.map((v) => v.kind)).toEqual(['leaked-error-message'])
  })
})
