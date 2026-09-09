/**
 * Check that each documentation domain has exactly one authoritative owner
 * document, that the owner opens with the agreed heading, and that docs/README.md
 * links to it — extracted from scripts/check-doc-links.ts so the invariant can be
 * tested (task 293bdbdd).
 *
 * These checks are about the doc set as a whole, not about any one file. That
 * distinction is the entire point of this module: while the block lived inside
 * the link checker's per-file loop, one violated heading was reported once per
 * active Markdown file. A predeploy report of 151 failures held exactly one
 * actionable line and 150 copies of two others, which is how the real failure
 * came to be truncated out of the task that reported it.
 */

import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

export interface DocumentationOwner {
  domain: string
  /** Absolute path to the document that owns the domain. */
  path: string
  /** The first line the owner must open with. */
  heading: string
  /** The link docs/README.md must carry, exactly as written there. */
  indexLink: string
}

/** The authoritative owner of each documentation domain. */
export function documentationOwners(root: string): DocumentationOwner[] {
  const docsRoot = join(root, 'docs')
  return [
    {
      domain: 'Architecture',
      path: join(docsRoot, 'ARCHITECTURE.md'),
      heading: '# Astrid Architecture',
      indexLink: '(./ARCHITECTURE.md)',
    },
    {
      domain: 'Local operations',
      path: join(docsRoot, 'CLI_OPERATIONS.md'),
      heading: '# Local CLI Operations — Astrid Web',
      indexLink: '(./CLI_OPERATIONS.md)',
    },
    {
      domain: 'API contracts',
      path: join(docsRoot, 'API_CONTRACT.md'),
      heading: '# Astrid API Contract',
      indexLink: '(./API_CONTRACT.md)',
    },
    {
      domain: 'Testing',
      path: join(docsRoot, 'context/testing.md'),
      heading: '# Testing Strategy',
      indexLink: '(./context/testing.md)',
    },
    {
      domain: 'Security',
      path: join(root, 'SECURITY.md'),
      heading: '# Security Policy',
      indexLink: '(../SECURITY.md)',
    },
    {
      domain: 'Product behavior',
      path: join(docsRoot, 'PRODUCT_CONTRACT.md'),
      heading: '# Product Contract — shared behavior & copy across Web, iOS/Mac and Windows',
      indexLink: '(./PRODUCT_CONTRACT.md)',
    },
  ]
}

/**
 * Every ownership problem in the doc set, each reported once.
 *
 * `activeFiles` is the set of Markdown files in scope — the same set the link
 * checker walks, minus templates.
 */
export function findDocumentationOwnerProblems(
  root: string,
  activeFiles: string[],
): string[] {
  const problems: string[] = []
  const docsIndex = readFileSync(join(root, 'docs', 'README.md'), 'utf8')
  const headingLines = new Map(
    activeFiles.map(file => [file, readFileSync(file, 'utf8').split(/\r?\n/)] as const),
  )

  for (const owner of documentationOwners(root)) {
    const source = readFileSync(owner.path, 'utf8')
    // Compare the first LINE, not the first bytes. `startsWith(heading + '\n')`
    // failed for every owner on a Windows checkout, where `core.autocrlf` makes
    // each file open `# Astrid Architecture\r\n` — six lines of noise on every
    // run, burying whatever the real documentation failure was (AWTD-865). The
    // heading-uniqueness check just below already split on /\r?\n/, which is
    // what made this a slip rather than a decision.
    if (source.split(/\r?\n/, 1)[0] !== owner.heading) {
      problems.push(
        `${relative(root, owner.path)} -> ${owner.domain} owner must start with "${owner.heading}"`,
      )
    }

    const headingOwners = [...headingLines]
      .filter(([, lines]) => lines.includes(owner.heading))
      .map(([file]) => file)
    if (headingOwners.length !== 1 || headingOwners[0] !== owner.path) {
      problems.push(
        `${owner.domain} authoritative heading must occur only in ${relative(root, owner.path)}`,
      )
    }

    if (!docsIndex.includes(owner.indexLink)) {
      problems.push(
        `docs/README.md -> missing ${owner.domain} owner link ${owner.indexLink}`,
      )
    }
  }

  return problems
}
