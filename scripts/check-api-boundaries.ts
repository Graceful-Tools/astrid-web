#!/usr/bin/env tsx
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import {
  findAddedApiBoundaryViolations,
  type AddedSourceLine,
} from '../lib/api-boundary-guard'
import { API_BOUNDARY_EXEMPTIONS } from '../lib/api-boundary-exemptions'

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function baseRevision(): string {
  if (process.env.API_BOUNDARY_BASE) return process.env.API_BOUNDARY_BASE
  try {
    return git(['merge-base', 'HEAD', 'origin/main'])
  } catch {
    return 'HEAD'
  }
}

function parseAddedLines(diff: string): AddedSourceLine[] {
  const additions: AddedSourceLine[] = []
  let file = ''
  let nextLine = 0

  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      file = line.slice(6)
      continue
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/)
    if (hunk) {
      nextLine = Number(hunk[1])
      continue
    }
    if (!file || line.startsWith('---')) continue
    if (line.startsWith('+')) {
      additions.push({ file, line: nextLine, content: line.slice(1) })
      nextLine += 1
    } else if (!line.startsWith('-')) {
      nextLine += 1
    }
  }
  return additions
}

const base = baseRevision()
const diff = git(['diff', '--no-ext-diff', '--unified=0', '--no-color', base, '--'])
const addedLines = parseAddedLines(diff)
const addedFiles = git(['diff', '--name-only', '--diff-filter=A', base, '--'])
  .split('\n')
  .filter(Boolean)
const untracked = git(['ls-files', '--others', '--exclude-standard'])
  .split('\n')
  .filter(Boolean)

for (const file of untracked) {
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((content, index) => {
    addedLines.push({ file, line: index + 1, content })
  })
}

const allAddedFiles = [...new Set([...addedFiles, ...untracked])]
const existingFiles = new Set(git(['ls-files', '--cached', '--others', '--exclude-standard']).split('\n'))
const violations = findAddedApiBoundaryViolations(
  { addedLines, addedFiles: allAddedFiles, existingFiles },
  API_BOUNDARY_EXEMPTIONS,
)

if (violations.length === 0) {
  console.log('✅ No new raw internal API calls or duplicate route implementations.')
  process.exit(0)
}

console.error('❌ API boundary guard failed:')
for (const violation of violations) {
  const location = violation.line ? `${violation.file}:${violation.line}` : violation.file
  console.error(`  [${violation.kind}] ${location} — ${violation.message}`)
}
console.error('Use lib/api.ts, share the route implementation, or add a narrow reasoned exemption.')
process.exit(1)
