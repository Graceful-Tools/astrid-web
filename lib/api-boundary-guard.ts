export interface AddedSourceLine {
  file: string
  line: number
  content: string
}

export interface ApiBoundaryChanges {
  addedLines: AddedSourceLine[]
  addedFiles: string[]
  existingFiles?: ReadonlySet<string>
  /**
   * Reads a repo file, or returns null when it cannot be read. Supplied by the
   * caller so this module stays a pure function of its input; the duplicate
   * route check needs both routes' sources to tell a shared implementation
   * from two copies of one.
   */
  readFile?: (file: string) => string | null
}

export type ApiBoundaryExemption =
  | {
      kind: 'raw-internal-call'
      file: string
      contains: string
      reason: string
    }
  | {
      kind: 'duplicate-route'
      file: string
      reason: string
    }
  | {
      kind: 'leaked-error-message'
      file: string
      contains: string
      reason: string
    }

export interface ApiBoundaryViolation {
  kind: ApiBoundaryExemption['kind']
  file: string
  line?: number
  message: string
}

const RAW_INTERNAL_CALL = /\bfetch\s*\(\s*['"`]\/api(?:\/|['"`])/

/**
 * An error's message on its way into a response body.
 *
 * Matches the two shapes the routes actually use — `error: error.message` and
 * `details: error instanceof Error ? error.message : …` — plus the bare
 * `err.message` variant (task 17fea642).
 */
const LEAKED_ERROR_MESSAGE = /\b(?:error|err|e)\.message\b/

/** Logging SHOULD carry the message; it never reaches the client. */
const IS_LOGGING = /\b(?:log|logger|console)\s*\.\s*\w+\s*\(|\blogError\s*\(/

/**
 * Already correct: a message revealed only in development is the same contract
 * `createSafeErrorResponse` implements.
 */
const DEV_GATED = /NODE_ENV\s*[=!]==?\s*['"`]development['"`]/

/**
 * A narrowing to an APP-DEFINED error class — `error instanceof
 * ListImageClaimError`, `instanceof UnknownAgentError`.
 *
 * A message reached through one of these is a string we wrote for the caller,
 * returned with a 4xx. It is the shape this whole rule is trying to produce:
 * the typed branch exists so the catch-all under it can be sanitised without
 * losing the one sentence a client can act on.
 *
 * `instanceof Error` is excluded on purpose. That IS the catch-all, and
 * `error instanceof Error ? error.message : String(error)` is exactly the
 * pattern the original finding named (task 17fea642).
 */
const TYPED_ERROR_NARROWING = /\binstanceof\s+(?!Error\b)[A-Z]\w*/

/** A line that closes a block — used to tell when a typed branch has ended. */
const CLOSES_BLOCK = /^\s*\}/

function isApiRoute(file: string): boolean {
  return file.startsWith('app/api/') && /\.ts$/.test(file)
}

/** Group added lines into runs of consecutive line numbers. */
function contiguousBlocks(lines: AddedSourceLine[]): AddedSourceLine[][] {
  const sorted = [...lines].sort((a, b) => a.line - b.line)
  const blocks: AddedSourceLine[][] = []
  for (const line of sorted) {
    const current = blocks.at(-1)
    if (!current || line.line > current.at(-1)!.line + 1) blocks.push([line])
    else current.push(line)
  }
  return blocks
}

function isClientSource(file: string): boolean {
  if (!/\.(ts|tsx|js|jsx)$/.test(file)) return false
  if (file.startsWith('app/api/')) return false
  return ['app/', 'components/', 'contexts/', 'hooks/', 'lib/']
    .some(prefix => file.startsWith(prefix))
}

function duplicateCounterpart(file: string): string | null {
  if (!file.startsWith('app/api/') || !file.endsWith('/route.ts')) return null
  if (file.startsWith('app/api/v1/')) {
    return file.replace('app/api/v1/', 'app/api/')
  }
  return file.replace('app/api/', 'app/api/v1/')
}

/**
 * Modules essentially every route imports: auth, logging, the Prisma client,
 * the cache, the typed client. Two routes both importing these have shown
 * nothing — so they never count as a shared implementation, or the check below
 * would pass for any pair of routes at all.
 */
const ROUTE_INFRASTRUCTURE_MODULES: ReadonlySet<string> = new Set([
  '@/lib/api',
  '@/lib/api-auth-middleware',
  '@/lib/api-auth-wrapper',
  '@/lib/logger',
  '@/lib/prisma',
  '@/lib/redis',
  '@/lib/session-utils',
])

/** `@/lib/...` modules a source file imports. */
function importedLibModules(source: string): Set<string> {
  const modules = new Set<string>()
  for (const match of source.matchAll(/from\s+['"](@\/lib\/[^'"]+)['"]/g)) {
    modules.add(match[1])
  }
  return modules
}

/**
 * Direct database access — the thing a delegating handler must no longer
 * contain. Scoped to Prisma on purpose: the queries and the transaction ARE the
 * implementation, whereas a route that merely invalidates a cache key is still
 * delegating the rule.
 */
const DIRECT_DATA_ACCESS = /\b(?:prisma|tx)\s*\.\s*\w/

/**
 * True when a legacy/v1 route pair genuinely shares one implementation rather
 * than holding two copies of it.
 *
 * The check is deliberately two-sided, because either half alone is cheap to
 * satisfy while still leaving the duplication this guard exists to catch:
 *
 * 1. **Both import a common `@/lib/` module** that is not infrastructure — the
 *    shared rule itself, e.g. both `leave` routes importing `@/lib/list-leave`.
 * 2. **Neither reaches the database directly.** A handler that still calls
 *    `prisma.` owns logic, whatever else it also imports, and two handlers that
 *    both own logic are two implementations no matter how much they share.
 *
 * What is left in each route is then only what genuinely differs: legacy's
 * session auth and bare response, v1's OAuth scopes and `meta` envelope. That
 * is the arrangement this repo settled on in task e0613ae5 and it is the
 * arrangement the guard's message asks for, so the guard should recognise it.
 *
 * Without this, adding the v1 twin the iOS and Mac apps require (ASTRID.md rule
 * 5) meant an exemption entry for writing the CORRECT code — the exact failure
 * mode lib/api-boundary-exemptions.ts documents at its head, where an exemption
 * list that blesses right answers stops being read. (Tasks 359ca48f, aa5a35f0.)
 *
 * Unreadable sources fall back to reporting the duplicate: this is allowed to
 * clear a violation only on positive evidence.
 */
function sharesImplementation(
  file: string,
  counterpart: string,
  readFile: ApiBoundaryChanges['readFile']
): boolean {
  if (!readFile) return false
  const source = readFile(file)
  const counterpartSource = readFile(counterpart)
  if (!source || !counterpartSource) return false

  if (DIRECT_DATA_ACCESS.test(source) || DIRECT_DATA_ACCESS.test(counterpartSource)) {
    return false
  }

  const counterpartModules = importedLibModules(counterpartSource)
  return [...importedLibModules(source)].some(
    module => counterpartModules.has(module) && !ROUTE_INFRASTRUCTURE_MODULES.has(module)
  )
}

function isExempt(
  violation: Pick<ApiBoundaryViolation, 'kind' | 'file'>,
  exemptions: readonly ApiBoundaryExemption[],
  content?: string,
): boolean {
  return exemptions.some(exemption => {
    if (
      exemption.kind !== violation.kind ||
      exemption.file !== violation.file ||
      exemption.reason.trim().length === 0
    ) {
      return false
    }
    if (exemption.kind === 'duplicate-route') return true
    return content?.includes(exemption.contains) === true
  })
}

export function findAddedApiBoundaryViolations(
  changes: ApiBoundaryChanges,
  exemptions: readonly ApiBoundaryExemption[],
): ApiBoundaryViolation[] {
  const violations: ApiBoundaryViolation[] = []

  const linesByFile = new Map<string, AddedSourceLine[]>()
  for (const added of changes.addedLines) {
    if (!isClientSource(added.file)) continue
    const lines = linesByFile.get(added.file) ?? []
    lines.push(added)
    linesByFile.set(added.file, lines)
  }

  for (const [file, lines] of linesByFile) {
    for (const block of contiguousBlocks(lines)) {
      const content = block.map(line => line.content).join('\n')
      if (!RAW_INTERNAL_CALL.test(content)) continue
      const fetchLineOffset = content.slice(0, content.search(/\bfetch\b/)).split('\n').length - 1
      const line = block[Math.min(fetchLineOffset, block.length - 1)].line
      const violation: ApiBoundaryViolation = {
        kind: 'raw-internal-call',
        file,
        line,
        message: 'Use the canonical typed client in lib/api.ts.',
      }
      if (!isExempt(violation, exemptions, content)) violations.push(violation)
    }
  }

  // Server routes: an error message must not reach the client. Diff-scoped like
  // the rest of this guard, so it stops NEW leaks without the 21 existing ones
  // having to be fixed in the same change (task 17fea642).
  //
  // Judged per contiguous BLOCK, not per line: a `log.error({ error:
  // error.message, ... }, 'msg')` spans several lines and only the opening one
  // names the logger. Line-at-a-time would flag every structured log call in
  // app/api, which is the one place the message belongs.
  const routeLinesByFile = new Map<string, AddedSourceLine[]>()
  for (const added of changes.addedLines) {
    if (!isApiRoute(added.file)) continue
    const lines = routeLinesByFile.get(added.file) ?? []
    lines.push(added)
    routeLinesByFile.set(added.file, lines)
  }

  for (const [file, lines] of routeLinesByFile) {
    for (const block of contiguousBlocks(lines)) {
      const content = block.map(line => line.content).join('\n')
      if (!LEAKED_ERROR_MESSAGE.test(content)) continue
      if (IS_LOGGING.test(content)) continue
      if (DEV_GATED.test(content)) continue

      // Walk the block rather than judging it whole, because the same catch
      // routinely holds both shapes: a typed 409 that may carry its message,
      // and a catch-all beneath it that may not. Judging the block would
      // either bless the catch-all or condemn the typed branch, and the second
      // is worse — it makes the CORRECT code need an exemption, which is how
      // an exemption list stops being read.
      let insideTypedBranch = false
      const offender = block.find(({ content: text }) => {
        if (insideTypedBranch && CLOSES_BLOCK.test(text)) insideTypedBranch = false
        const narrowsHere = TYPED_ERROR_NARROWING.test(text)
        if (narrowsHere) insideTypedBranch = true
        if (!LEAKED_ERROR_MESSAGE.test(text)) return false
        return !(narrowsHere || insideTypedBranch)
      })
      if (!offender) continue

      const violation: ApiBoundaryViolation = {
        kind: 'leaked-error-message',
        file,
        line: offender.line,
        message:
          'Do not return an error message to the client. Use createSafeErrorResponse() from ' +
          'lib/logging/error-sanitizer.ts, which reveals details in development only. ' +
          'A message narrowed to an app-defined error class is fine — that branch is the point.',
      }
      if (!isExempt(violation, exemptions, content)) violations.push(violation)
    }
  }

  const existingFiles = changes.existingFiles ?? new Set(changes.addedFiles)
  for (const file of changes.addedFiles) {
    const counterpart = duplicateCounterpart(file)
    if (!counterpart || !existingFiles.has(counterpart)) continue
    if (sharesImplementation(file, counterpart, changes.readFile)) continue
    const violation: ApiBoundaryViolation = {
      kind: 'duplicate-route',
      file,
      message: `Route duplicates ${counterpart}; share an implementation or document an exemption.`,
    }
    if (!isExempt(violation, exemptions)) violations.push(violation)
  }

  return violations
}
