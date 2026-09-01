#!/usr/bin/env tsx

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'

const root = process.cwd()
const docsRoot = join(root, 'docs')
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
}

function markdownFiles(directory: string): string[] {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) {
      return name === 'archive' ? [] : markdownFiles(path)
    }
    return extname(name) === '.md' ? [path] : []
  })
}

const files = [
  ...readdirSync(root)
    .filter(name => extname(name) === '.md')
    .map(name => join(root, name)),
  ...markdownFiles(docsRoot),
]
const activeFiles = files.filter(file => !file.startsWith(join(docsRoot, 'templates')))

const problems: string[] = []

for (const file of activeFiles) {
  const source = readFileSync(file, 'utf8')
  const destinations = [
    ...source.matchAll(/!?\[[^\]]*]\((<[^>]+>|[^)\s]+)(?:\s+["'][^"']*["'])?\)/g),
    ...source.matchAll(/^\s*\[[^\]]+]:\s*(<[^>]+>|\S+)/gm),
  ].map(match => match[1].replace(/^<|>$/g, ''))

  for (const destination of destinations) {
    if (
      destination.startsWith('#') ||
      destination.startsWith('/') ||
      /^[a-z][a-z\d+.-]*:/i.test(destination)
    ) {
      continue
    }

    const relativePath = decodeURIComponent(destination.split(/[?#]/, 1)[0])
    if (!relativePath) continue

    const target = resolve(dirname(file), relativePath)
    if (!existsSync(target)) {
      problems.push(
        `${file.slice(root.length + 1)} -> ${destination}`,
      )
    }
  }

  const documentationOwners = [
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
      heading: '# Product Contract — shared behavior & copy across Web and iOS/Mac',
      indexLink: '(./PRODUCT_CONTRACT.md)',
    },
  ] as const

  const docsIndex = readFileSync(join(docsRoot, 'README.md'), 'utf8')
  for (const owner of documentationOwners) {
    const source = readFileSync(owner.path, 'utf8')
    if (!source.startsWith(`${owner.heading}\n`)) {
      problems.push(
        `${relative(root, owner.path)} -> ${owner.domain} owner must start with "${owner.heading}"`,
      )
    }

    const headingOwners = activeFiles.filter(file =>
      readFileSync(file, 'utf8').split(/\r?\n/).includes(owner.heading),
    )
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
}

const canonicalVersionReferences = [
  ['next', 'Next.js'],
  ['react', 'React'],
  ['typescript', 'TypeScript'],
  ['prisma', 'Prisma'],
  ['@prisma/client', '@prisma/client'],
  ['dexie', 'Dexie'],
  ['vitest', 'Vitest'],
  ['@playwright/test', 'Playwright'],
  ['jsdom', 'jsdom'],
  ['@testing-library/react', 'React Testing Library'],
  ['tailwindcss', 'Tailwind CSS'],
  ['lucide-react', 'Lucide React'],
  ['react-hook-form', 'React Hook Form'],
  ['zod', 'Zod'],
  ['eslint', 'ESLint'],
  ['autoprefixer', 'autoprefixer'],
  ['openai', 'OpenAI'],
  ['resend', 'Resend'],
  ['web-push', 'web-push'],
] as const

const stackSource = readFileSync(join(docsRoot, 'context/stack.md'), 'utf8')
for (const [packageName, label] of canonicalVersionReferences) {
  const range = packageJson.dependencies[packageName] ?? packageJson.devDependencies[packageName]
  const version = range?.replace(/^[~^]/, '')
  if (!version || !stackSource.includes(`${label} ${version}`)) {
    problems.push(
      `docs/context/stack.md -> ${label} must match package.json (${version ?? 'missing package'})`,
    )
  }
}

if (problems.length > 0) {
  console.error(`Documentation validation failures (${problems.length}):`)
  for (const problem of problems) console.error(`- ${problem}`)
  process.exitCode = 1
} else {
  console.log(`Documentation links, owners, headings, and stack versions valid across ${activeFiles.length} active Markdown files.`)
}
