#!/usr/bin/env tsx

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { findBrokenCodePaths } from './lib/doc-code-paths'
import { findDocumentationOwnerProblems } from './lib/doc-owners'

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
}

// Ownership is a property of the doc set, not of any one file. It lived
// inside the loop above until task 293bdbdd, which reported one violated
// heading once per active Markdown file: 151 failures, one of them real.
problems.push(...findDocumentationOwnerProblems(root, activeFiles))

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

// Markdown links are only half of how a document points at the tree. The other
// half — a path in backticks, in prose or a reference table — went unchecked
// until task ff74f430, which is how ASTRID.md came to name `lib/ai-agent-config.ts`
// and four hooks that have never existed. Enforced across the authoritative doc
// set only; scripts/lib/doc-code-paths.ts explains that boundary.
for (const broken of findBrokenCodePaths(root)) {
  problems.push(`${broken.file}:${broken.line} -> ${broken.path} does not exist`)
}

if (problems.length > 0) {
  console.error(`Documentation validation failures (${problems.length}):`)
  for (const problem of problems) console.error(`- ${problem}`)
  process.exitCode = 1
} else {
  console.log(`Documentation links, code paths, owners, headings, and stack versions valid across ${activeFiles.length} active Markdown files.`)
}
