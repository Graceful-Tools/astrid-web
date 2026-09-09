/**
 * RED for AWTD-865 — the predeploy checks assumed a POSIX repo.
 *
 * `npm run predeploy` on Windows reported five failed checks. None of them were
 * failures of the code being checked: `check:env`, `check:docs`, `check:unimported`
 * and the full suite all pass on macOS at the same commit. They were the CHECKERS
 * being unable to describe a Windows path.
 *
 * Two scripts stripped the repository root with a hardcoded separator:
 *
 *   scripts/check-unimported.ts:75   full.replace(`${ROOT}/`, '')
 *   scripts/check-env-schema.ts:51   file.replace(`${ROOT}/`, '')
 *
 * `join()` on Windows yields `C:\repo\app\x.ts`, so the pattern `C:\repo/` never
 * matches, the "relative" path is still ABSOLUTE, and the later `join(ROOT, file)`
 * concatenates the root onto itself. The report crashed on exactly that:
 *
 *   ENOENT: open 'C:\…\astrid-web\C:\…\astrid-web\app\api\account\delete\route.ts'
 *
 * The separator is injected rather than read from `path.sep` so this file can assert
 * the Windows behaviour from any machine. A test that only exercised the host's own
 * separator would have passed on macOS for as long as the bug existed — which is how
 * it survived to begin with.
 */

import { describe, it, expect } from 'vitest'
import { repoRelativePath } from '@/scripts/lib/repo-relative-path'

const WIN = '\\'
const POSIX = '/'

describe('repoRelativePath (AWTD-865)', () => {
  it('strips a Windows root from a Windows path', () => {
    expect(
      repoRelativePath('C:\\Users\\jonpa\\astrid-web', 'C:\\Users\\jonpa\\astrid-web\\app\\api\\route.ts', WIN)
    ).toBe('app/api/route.ts')
  })

  it('strips a POSIX root from a POSIX path', () => {
    expect(
      repoRelativePath('/Users/jonparis/astrid-web', '/Users/jonparis/astrid-web/app/api/route.ts', POSIX)
    ).toBe('app/api/route.ts')
  })

  it('always answers with FORWARD slashes, whatever the host separator', () => {
    // The relative path is not just displayed — it is matched against patterns
    // like /^app\//, used as a Map key, and printed into task reports. One
    // spelling everywhere is the only way those agree across machines.
    expect(
      repoRelativePath('C:\\repo', 'C:\\repo\\lib\\nested\\deep\\mod.ts', WIN)
    ).toBe('lib/nested/deep/mod.ts')
  })

  it('never leaves an absolute path behind — the bug that caused the ENOENT', () => {
    // The old `replace()` was a no-op when the separators disagreed, and a no-op
    // returned the absolute path unchanged. Nothing downstream noticed until a
    // read failed with the root doubled.
    const answer = repoRelativePath('C:\\repo', 'C:\\repo\\app\\x.ts', WIN)
    expect(answer.startsWith('C:')).toBe(false)
    expect(answer).not.toContain('\\')
  })

  it('tolerates a root given with a trailing separator', () => {
    expect(repoRelativePath('C:\\repo\\', 'C:\\repo\\app\\x.ts', WIN)).toBe('app/x.ts')
    expect(repoRelativePath('/repo/', '/repo/app/x.ts', POSIX)).toBe('app/x.ts')
  })

  it('returns a path outside the root unchanged rather than mangling it', () => {
    // Better to hand back something a human can recognise in an error message
    // than a silently wrong relative path built from a bad prefix guess.
    expect(repoRelativePath('C:\\repo', 'C:\\other\\x.ts', WIN)).toBe('C:/other/x.ts')
  })

  it('defaults to the host separator when none is given', () => {
    // Production callers pass nothing; the injection exists for this test file.
    const root = process.cwd()
    expect(repoRelativePath(root, `${root}${require('node:path').sep}package.json`)).toBe(
      'package.json'
    )
  })
})
