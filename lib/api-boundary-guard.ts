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

export interface ApiBoundaryViolation {
  kind: ApiBoundaryExemption['kind']
  file: string
  line?: number
  message: string
}

const RAW_INTERNAL_CALL = /\bfetch\s*\(\s*['"`]\/api(?:\/|['"`])/

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
    return exemption.kind === 'duplicate-route' || content?.includes(exemption.contains) === true
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
    const sorted = [...lines].sort((a, b) => a.line - b.line)
    const blocks: AddedSourceLine[][] = []
    for (const line of sorted) {
      const current = blocks.at(-1)
      if (!current || line.line > current.at(-1)!.line + 1) blocks.push([line])
      else current.push(line)
    }

    for (const block of blocks) {
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
