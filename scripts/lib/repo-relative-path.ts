/**
 * A repository-relative path, spelled the same way on every machine (AWTD-865).
 *
 * The predeploy checks describe files by their path relative to the repo root:
 * they match them against patterns like `/^app\//`, use them as Map keys, join
 * them back onto the root to read the file, and print them into failure reports.
 * All four want ONE spelling, and until this existed two scripts built it by
 * hand with a hardcoded separator:
 *
 *   full.replace(`${ROOT}/`, '')
 *
 * On Windows `join()` produces `C:\repo\app\x.ts`, so the pattern `C:\repo/`
 * matched nothing, `replace` was a silent no-op, and the "relative" path was
 * still absolute. Nothing downstream checked; the failure surfaced later as a
 * read of the root concatenated onto itself:
 *
 *   ENOENT: open 'C:\…\astrid-web\C:\…\astrid-web\app\api\account\delete\route.ts'
 *
 * The failure mode worth designing against is not the crash, though — it is the
 * QUIET half. `check-env-schema.ts` had the same line and did not crash: it just
 * stopped deduplicating by relative path and counted 156 files where macOS
 * counted 151, then reported five env vars as undeclared on Windows only.
 *
 * Forward slashes always, including on Windows. A relative path here is an
 * identifier rather than something handed to the filesystem, and an identifier
 * that changes shape per platform is not an identifier.
 */

import { sep as hostSep } from 'node:path'

/**
 * @param root      absolute path to the repository root
 * @param absolute  absolute path to a file inside it
 * @param separator the platform separator; injected so tests can assert the
 *                  Windows behaviour from a POSIX machine. A test that only ever
 *                  exercised the host's own separator would have passed on macOS
 *                  for as long as this bug existed, which is how it survived.
 */
export function repoRelativePath(
  root: string,
  absolute: string,
  separator: string = hostSep,
): string {
  const toPosix = (value: string) => value.split(separator).join('/')

  const normalizedRoot = toPosix(root).replace(/\/+$/, '')
  const normalizedFile = toPosix(absolute)

  const prefix = `${normalizedRoot}/`
  if (!normalizedFile.startsWith(prefix)) {
    // Outside the root. Hand it back recognisable rather than guessing at a
    // prefix — a wrong relative path is harder to diagnose than an odd-looking
    // absolute one.
    return normalizedFile
  }

  return normalizedFile.slice(prefix.length)
}
