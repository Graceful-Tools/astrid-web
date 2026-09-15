#!/usr/bin/env tsx
import { readFileSync } from 'node:fs'
import { runGit } from './lib/git-exec'
import {
  findAddedApiBoundaryViolations,
  type AddedSourceLine,
} from '../lib/api-boundary-guard'
import { API_BOUNDARY_EXEMPTIONS } from '../lib/api-boundary-exemptions'

function git(args: string[]): string {
  const result = runGit(process.cwd(), args)
  if (!result.ok) throw new Error(`git ${args.join(' ')} failed: ${'stderr' in result ? result.stderr : result.code}`)
  return result.stdout.trim()
}

/**
 * Falling back to HEAD compares the branch against itself, which makes this
 * guard pass without checking anything. That is the right answer only when git
 * ANSWERED that there is no origin/main — a shallow clone, a fresh repo. When
 * the machine was merely too loaded to fork, runGit throws rather than let a
 * gate go quietly vacuous (task cea0ddf5).
 */
function baseRevision(): string {
  if (process.env.API_BOUNDARY_BASE) return process.env.API_BOUNDARY_BASE
  const result = runGit(process.cwd(), ['merge-base', 'HEAD', 'origin/main'])
  return result.ok ? result.stdout.trim() : 'HEAD'
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
  {
    addedLines,
    addedFiles: allAddedFiles,
    existingFiles,
    readFile: file => {
      try {
        return readFileSync(file, 'utf8')
      } catch {
        return null
      }
    },
  },
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
