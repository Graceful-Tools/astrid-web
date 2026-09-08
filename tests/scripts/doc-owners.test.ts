/**
 * Task 293bdbdd: a predeploy report listed 151 documentation failures of which
 * exactly one was actionable. The other 150 were two assertions repeated once
 * per active Markdown file, because the ownership block in
 * scripts/check-doc-links.ts sat inside that script's per-file loop while
 * checking nothing that varied per file. The duplicates pushed the real
 * failure — a broken path in docs/PRODUCT_CONTRACT.md — out of the truncated
 * report and into invisibility.
 *
 * Ownership is a property of the doc set, not of a file. Each problem is
 * therefore reported exactly once, however many files are in scope.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  documentationOwners,
  findDocumentationOwnerProblems,
} from '@/scripts/lib/doc-owners'

/** A doc set with every owner correct, plus `filler` unrelated Markdown files. */
function buildFixture(filler: number): { root: string; activeFiles: string[] } {
  const root = mkdtempSync(join(tmpdir(), 'doc-owners-'))
  mkdirSync(join(root, 'docs', 'context'), { recursive: true })

  const owners = documentationOwners(root)
  const activeFiles: string[] = []
  for (const owner of owners) {
    writeFileSync(owner.path, `${owner.heading}\n\nBody.\n`)
    activeFiles.push(owner.path)
  }

  writeFileSync(
    join(root, 'docs', 'README.md'),
    owners.map(owner => `- [${owner.domain}]${owner.indexLink}`).join('\n'),
  )

  for (let index = 0; index < filler; index += 1) {
    const path = join(root, 'docs', `note-${index}.md`)
    writeFileSync(path, `# Note ${index}\n\nUnrelated prose.\n`)
    activeFiles.push(path)
  }

  return { root, activeFiles }
}

describe('findDocumentationOwnerProblems (task 293bdbdd)', () => {
  let fixture: { root: string; activeFiles: string[] }

  beforeAll(() => {
    fixture = buildFixture(40)
  })

  afterAll(() => {
    rmSync(fixture.root, { recursive: true, force: true })
  })

  it('reports nothing when every owner is in order', () => {
    expect(findDocumentationOwnerProblems(fixture.root, fixture.activeFiles)).toEqual([])
  })

  it('reports a wrong owner heading once, not once per file in the doc set', () => {
    const { root, activeFiles } = buildFixture(40)
    const productContract = join(root, 'docs', 'PRODUCT_CONTRACT.md')
    writeFileSync(productContract, '# Product Contract\n\nRenamed heading.\n')

    const problems = findDocumentationOwnerProblems(root, activeFiles)
    rmSync(root, { recursive: true, force: true })

    // Two distinct problems: the opening heading, and the domain now having no
    // owner document at all. Each stated once.
    expect(problems).toHaveLength(2)
    expect(new Set(problems).size).toBe(problems.length)
  })

  it('reports a missing docs/README.md link once', () => {
    const { root, activeFiles } = buildFixture(40)
    writeFileSync(join(root, 'docs', 'README.md'), 'No owner links here.\n')

    const problems = findDocumentationOwnerProblems(root, activeFiles)
    rmSync(root, { recursive: true, force: true })

    expect(problems).toHaveLength(documentationOwners(root).length)
    expect(new Set(problems).size).toBe(problems.length)
  })

  it('never repeats a problem, whatever the size of the doc set', () => {
    const small = buildFixture(1)
    writeFileSync(join(small.root, 'docs', 'API_CONTRACT.md'), '# Renamed\n')
    const fromSmall = findDocumentationOwnerProblems(small.root, small.activeFiles)
    rmSync(small.root, { recursive: true, force: true })

    const large = buildFixture(60)
    writeFileSync(join(large.root, 'docs', 'API_CONTRACT.md'), '# Renamed\n')
    const fromLarge = findDocumentationOwnerProblems(large.root, large.activeFiles)
    rmSync(large.root, { recursive: true, force: true })

    // The doc set grew sixtyfold; the ownership verdict is the same size.
    expect(fromLarge).toHaveLength(fromSmall.length)
  })
})
