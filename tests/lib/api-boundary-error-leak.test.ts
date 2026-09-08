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

/**
 * A NARROWED DOMAIN ERROR IS NOT A LEAK (task 17fea642, second pass).
 *
 * The rule above treats every `error.message` on a response body the same, and
 * that is too blunt. Auditing app/api found 24 matches for the pattern the
 * original finding named — and 15 of them are this shape:
 *
 *     } catch (error) {
 *       if (error instanceof ListImageClaimError) {
 *         return NextResponse.json({ error: error.message }, { status: 409 })
 *       }
 *       log.error({ err: error }, '...')
 *       return NextResponse.json(createSafeErrorResponse(error), { status: 500 })
 *     }
 *
 * That message is a string WE wrote, for the caller, on a 4xx. It carries no
 * Prisma text and no server path, and it exists so the catch-all beneath it can
 * be sanitised without destroying the one sentence a client can act on. It is
 * the pattern the fix is supposed to produce, not the one it is supposed to
 * prevent.
 *
 * Flagging it anyway has a cost that is easy to miss: the only way past the
 * gate is an entry in API_BOUNDARY_EXEMPTIONS, so writing the CORRECT code
 * requires an exemption. A list where the right answer needs an exemption
 * teaches people to reach for exemptions, and then nobody reads them.
 *
 * So the guard narrows the way the code narrows — by the `instanceof` in front
 * of it. `instanceof Error` explicitly does NOT count: that is the catch-all,
 * and `error instanceof Error ? error.message : …` is precisely the shape the
 * original finding was about.
 */
describe('typed domain errors are not leaks (task 17fea642)', () => {
  const block = (file: string, lines: string[]) => ({
    addedLines: lines.map((content, i) => ({ file, line: 10 + i, content })),
    addedFiles: [],
  })

  it('does not flag a message narrowed to an app-defined error class', () => {
    const found = leaks(
      block('app/api/things/route.ts', [
        '      if (error instanceof ListImageClaimError) {',
        '        return NextResponse.json({ error: error.message }, { status: 409 })',
        '      }',
      ]),
      [],
    )
    expect(found).toHaveLength(0)
  })

  it('still flags `error instanceof Error ? error.message : …` — that is the catch-all', () => {
    const found = leaks(
      block('app/api/things/route.ts', [
        '      return NextResponse.json(',
        '        { error: error instanceof Error ? error.message : String(error) },',
        '        { status: 500 },',
        '      )',
      ]),
      [],
    )
    expect(found.map(v => v.kind)).toContain('leaked-error-message')
  })

  it('still flags an unnarrowed message even when a typed error is caught elsewhere in the block', () => {
    // The narrowing has to be the branch this return is IN. A typed check that
    // returned earlier says nothing about what reaches the catch-all below it.
    const found = leaks(
      block('app/api/things/route.ts', [
        '      if (error instanceof ListImageClaimError) {',
        '        return NextResponse.json({ error: error.message }, { status: 409 })',
        '      }',
        '      return NextResponse.json({ error: error.message }, { status: 500 })',
      ]),
      [],
    )
    expect(found.map(v => v.kind)).toContain('leaked-error-message')
  })
})
