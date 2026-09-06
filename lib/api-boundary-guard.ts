export interface AddedSourceLine {
  file: string
  line: number
  content: string
}

export interface ApiBoundaryChanges {
  addedLines: AddedSourceLine[]
  addedFiles: string[]
  existingFiles?: ReadonlySet<string>
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

      const offset = content.slice(0, content.search(LEAKED_ERROR_MESSAGE)).split('\n').length - 1
      const violation: ApiBoundaryViolation = {
        kind: 'leaked-error-message',
        file,
        line: block[Math.min(offset, block.length - 1)].line,
        message:
          'Do not return an error message to the client. Use createSafeErrorResponse() from ' +
          'lib/logging/error-sanitizer.ts, which reveals details in development only.',
      }
      if (!isExempt(violation, exemptions, content)) violations.push(violation)
    }
  }

  const existingFiles = changes.existingFiles ?? new Set(changes.addedFiles)
  for (const file of changes.addedFiles) {
    const counterpart = duplicateCounterpart(file)
    if (!counterpart || !existingFiles.has(counterpart)) continue
    const violation: ApiBoundaryViolation = {
      kind: 'duplicate-route',
      file,
      message: `Route duplicates ${counterpart}; share an implementation or document an exemption.`,
    }
    if (!isExempt(violation, exemptions)) violations.push(violation)
  }

  return violations
}
